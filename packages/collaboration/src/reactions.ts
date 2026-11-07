import { coordinationId, programPrincipals, type CoordinationState } from './programModel';
import { prepareProgramRun } from './programAuthorization';
import {
  emptyProgramReactions,
  type ProgramReaction,
  type ProgramReactionEvent,
  type ProgramReactionsState,
  type ProgramWatch,
} from './reactionModel';
const no = (reason: string) => ({ accepted: false as const, reason });
const yes = (events: readonly ProgramReactionEvent[]) => ({ accepted: true as const, events });
const tokenValid = (v: string) => /^[a-f0-9]{64}$/.test(v);
export function registerProgramWatch(input: {
  coordination: CoordinationState;
  actorId: string;
  id: string;
  programId: string;
  programRevision: number;
  maxReactions: number;
  expiresAt: number;
  sourceToken: string;
  at: number;
  exists: (id: string) => boolean;
}) {
  const { coordination: c, actorId, at } = input,
    s = c.reactions;
  if (!s) return no('program-reactions-not-enabled');
  if (!coordinationId(input.id)) return no('invalid-watch-id');
  if (s.watches[input.id]) return no('watch-id-conflict');
  const check = prepareProgramRun(
    c,
    actorId,
    input.programId,
    input.programRevision,
    at,
    input.exists,
  );
  if (!check.accepted) return check;
  if (!check.program.conditions?.some((v) => v.source.kind !== 'clock'))
    return no('watch-requires-event-source');
  if (
    !tokenValid(input.sourceToken) ||
    !Number.isSafeInteger(input.maxReactions) ||
    input.maxReactions < 1 ||
    input.maxReactions > s.policy.maxReactions ||
    !Number.isSafeInteger(input.expiresAt) ||
    input.expiresAt <= at ||
    input.expiresAt > at + s.policy.maxHorizonMs
  )
    return no('invalid-watch-bounds');
  const all = Object.values(s.watches);
  if (
    all.length >= s.policy.maxWatches ||
    all.filter((w) => w.runnerId === actorId).length >= s.policy.maxWatchesPerRunner
  )
    return no('watch-quota');
  return yes([
    {
      type: 'ProgramWatchChanged',
      watch: {
        id: input.id,
        runnerId: actorId,
        programId: input.programId,
        programRevision: input.programRevision,
        participants: [
          ...new Set([
            check.program.ownerId,
            ...check.program.runners,
            ...programPrincipals(check.program),
          ]),
        ],
        maxReactions: input.maxReactions,
        expiresAt: input.expiresAt,
        sourceToken: input.sourceToken,
        enqueued: 0,
        completed: 0,
        succeeded: 0,
        revision: 1,
        status: 'active',
        at,
      },
    },
  ]);
}
export function pendingProgramReactions(s: ProgramReactionsState): readonly ProgramReaction[] {
  return Object.values(s.reactions)
    .filter((r) => r.status === 'pending')
    .sort(
      (a, b) =>
        a.sourceSequence - b.sourceSequence ||
        (a.watchId < b.watchId
          ? -1
          : a.watchId > b.watchId
            ? 1
            : a.id < b.id
              ? -1
              : a.id > b.id
                ? 1
                : 0),
    );
}
/** Termination settles each outstanding queue entry without consuming any mandate. */
export function stopProgramWatch(
  s: ProgramReactionsState,
  watch: ProgramWatch,
  status: 'cancelled' | 'failed' | 'expired',
  reason: string,
  at: number,
  sequence?: number,
): readonly ProgramReactionEvent[] {
  if (watch.status !== 'active') return [];
  const pending = pendingProgramReactions(s).filter((r) => r.watchId === watch.id);
  return [
    ...pending.map((r) => ({
      type: 'ProgramReactionChanged' as const,
      reaction: { ...r, status: 'cancelled' as const, revision: r.revision + 1, at, reason },
    })),
    {
      type: 'ProgramWatchChanged',
      watch: {
        ...watch,
        completed: watch.completed + pending.length,
        status,
        reason,
        at,
        revision: watch.revision + 1,
        ...(sequence === undefined ? {} : { stoppedAtSequence: sequence }),
      },
    },
  ];
}
export function cancelProgramWatch(
  s: ProgramReactionsState,
  actor: string,
  id: string,
  revision: number,
  at: number,
) {
  const w = Object.hasOwn(s.watches, id) ? s.watches[id] : undefined;
  if (!w || w.runnerId !== actor) return no('watch-not-found');
  if (w.revision !== revision) return no('revision-conflict');
  if (w.status !== 'active') return no('watch-not-active');
  return yes(stopProgramWatch(s, w, 'cancelled', 'runner-cancelled', at));
}
/** Application supplies only a permission-checked fingerprint, never source text or a new authority. */
export function enqueueProgramReaction(
  s: ProgramReactionsState,
  id: string,
  sourceToken: string,
  sourceSequence: number,
  at: number,
): readonly ProgramReactionEvent[] {
  const w = s.watches[id];
  if (!w || w.status !== 'active') return [];
  if (
    !Number.isSafeInteger(at) ||
    at < w.at ||
    !Number.isSafeInteger(sourceSequence) ||
    sourceSequence < 1 ||
    !tokenValid(sourceToken)
  )
    throw new Error('invalid-reaction-observation');
  if (at >= w.expiresAt)
    return stopProgramWatch(s, w, 'expired', 'watch-expired', at, sourceSequence);
  if (w.sourceToken === sourceToken || w.enqueued >= w.maxReactions) return [];
  if (pendingProgramReactions(s).length >= s.policy.maxPending)
    return stopProgramWatch(s, w, 'failed', 'reaction-queue-overloaded', at, sourceSequence);
  const reaction: ProgramReaction = {
    id: `${w.id}:${w.enqueued + 1}`,
    watchId: w.id,
    sourceSequence,
    enqueuedAt: at,
    at,
    revision: 1,
    status: 'pending',
  };
  return [
    {
      type: 'ProgramWatchChanged',
      watch: { ...w, sourceToken, enqueued: w.enqueued + 1, revision: w.revision + 1, at },
    },
    { type: 'ProgramReactionChanged', reaction },
  ];
}
export function finishProgramReaction(
  s: ProgramReactionsState,
  id: string,
  status: 'succeeded' | 'skipped' | 'failed',
  at: number,
  runId: string,
  reason?: string,
): readonly ProgramReactionEvent[] {
  const r = s.reactions[id],
    w = r ? s.watches[r.watchId] : undefined;
  if (!r || !w || r.status !== 'pending' || w.status !== 'active')
    throw new Error('reaction-not-pending');
  if (!Number.isSafeInteger(at) || at < r.enqueuedAt || !runId)
    throw new Error('invalid-reaction-outcome');
  const events: ProgramReactionEvent[] = [
    {
      type: 'ProgramReactionChanged',
      reaction: {
        ...r,
        status,
        at,
        runId,
        revision: r.revision + 1,
        ...(reason ? { reason } : {}),
      },
    },
  ];
  const changed: ProgramWatch = {
    ...w,
    completed: w.completed + 1,
    succeeded: w.succeeded + (status === 'succeeded' ? 1 : 0),
    at,
    revision: w.revision + 1,
    status: status !== 'failed' && w.completed + 1 === w.maxReactions ? 'completed' : 'active',
  };
  events.push({ type: 'ProgramWatchChanged', watch: changed });
  if (status === 'failed') {
    const next = events.reduce(applyProgramReactionEvent, s);
    events.push(
      ...stopProgramWatch(
        next,
        next.watches[w.id]!,
        'failed',
        reason ?? 'reaction-failed',
        at,
        r.sourceSequence,
      ),
    );
  }
  return events;
}
export function applyProgramReactionEvent(
  s: ProgramReactionsState | undefined,
  e: ProgramReactionEvent,
): ProgramReactionsState {
  if (e.type === 'ProgramReactionsEnabled') {
    if (s) throw new Error('program-reactions-already-enabled');
    return emptyProgramReactions(e.policy);
  }
  if (!s) throw new Error('program-reactions-not-enabled');
  if (e.type === 'ProgramWatchChanged') {
    const w = e.watch,
      old = s.watches[w.id];
    if (
      w.revision !== (old?.revision ?? 0) + 1 ||
      (old && old.status !== 'active') ||
      w.completed > w.enqueued ||
      w.enqueued > w.maxReactions ||
      w.succeeded > w.completed
    )
      throw new Error('invalid-watch-event');
    return { ...s, watches: { ...s.watches, [w.id]: w } };
  }
  const r = e.reaction,
    old = s.reactions[r.id];
  if (
    r.revision !== (old?.revision ?? 0) + 1 ||
    (old && old.status !== 'pending') ||
    (!old && r.status !== 'pending') ||
    !s.watches[r.watchId]
  )
    throw new Error('invalid-reaction-event');
  return { ...s, reactions: { ...s.reactions, [r.id]: r } };
}

export function nextReactionBoundary(s: ProgramReactionsState | undefined): number | undefined {
  const times = Object.values(s?.watches ?? {})
    .filter((w) => w.status === 'active')
    .map((w) => w.expiresAt);
  return times.length ? Math.min(...times) : undefined;
}
export function expireProgramWatches(
  s: ProgramReactionsState,
  at: number,
): readonly ProgramReactionEvent[] {
  let working = s;
  const events: ProgramReactionEvent[] = [];
  for (const w of Object.values(s.watches)
    .filter((w) => w.status === 'active' && w.expiresAt <= at)
    .sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id, 'en'))) {
    const changes = stopProgramWatch(
      working,
      working.watches[w.id]!,
      'expired',
      'watch-expired',
      w.expiresAt,
    );
    events.push(...changes);
    working = changes.reduce(applyProgramReactionEvent, working);
  }
  return events;
}
