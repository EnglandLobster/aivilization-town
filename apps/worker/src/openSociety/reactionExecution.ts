import {
  applyProgramReactionEvent,
  enqueueProgramReaction,
  finishProgramReaction,
  stopProgramWatch,
  type ProgramReactionEvent,
} from '@aivilization/collaboration';
import type { OpenSocietyEffects, OpenSocietyState, OpenSocietyManifest } from './types';
import { applyOpenSocietyEffects } from './state';
import { reactionSourceToken, type ReactionSourceCache } from './reactionSources';
import { digest } from './journal';
import { executeResidentProgram, mergeProgramEffects } from './programExecution';
import { worldExperiences } from './worldTools';
export function stoppedReactionExperiences(events: readonly ProgramReactionEvent[]) {
  return events.flatMap((e) =>
    e.type === 'ProgramWatchChanged' && ['failed', 'expired'].includes(e.watch.status)
      ? [
          {
            id: `reaction-stop-${digest([e.watch.id, e.watch.revision])}`,
            ownerId: e.watch.runnerId,
            at: e.watch.at,
            kind: 'observation' as const,
            summary: JSON.stringify({
              kind: 'program-watch-stopped',
              watchId: e.watch.id,
              status: e.watch.status,
              reason: e.watch.reason,
            }),
            sourceIds: [e.watch.id, e.watch.programId],
            people: [],
            provenance: 'firsthand' as const,
          },
        ]
      : [],
  );
}
/** Application outbox: queue metadata and origin facts share one durable commit. Never execute here. */
export function appendProgramReactions(
  before: OpenSocietyState,
  effects: OpenSocietyEffects,
): OpenSocietyEffects {
  if (
    !Object.values(before.coordination?.reactions?.watches ?? {}).some(
      (w) => w.status === 'active',
    ) &&
    !(effects.coordinationEvents ?? []).some(
      (e) => e.type === 'ProgramWatchChanged' && e.watch.status === 'active',
    )
  )
    return effects;
  const after = applyOpenSocietyEffects(before, effects);
  let s = after.coordination?.reactions;
  if (!s) return effects;
  const events: ProgramReactionEvent[] = [],
    cache: ReactionSourceCache = new Map();
  for (const w of Object.values(s.watches).sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    if (w.status !== 'active') continue;
    const p = after.coordination?.programs[w.programId];
    const observed = p
      ? reactionSourceToken(after, p, w.runnerId, cache)
      : { accepted: false as const, reason: 'program-not-found' };
    const token = observed.accepted ? observed.token : digest({ unavailable: observed.reason });
    const changes = enqueueProgramReaction(
      s,
      w.id,
      token,
      before.revision + 1,
      after.world.clock.now,
    );
    events.push(...changes);
    s = changes.reduce(applyProgramReactionEvent, s);
  }
  if (!events.length) return effects;
  return mergeProgramEffects(effects, {
    coordinationEvents: events,
    experiences: stoppedReactionExperiences(events),
  });
}
export function executeQueuedProgramReaction(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  id: string,
): OpenSocietyEffects {
  const s = state.coordination?.reactions,
    r = s?.reactions[id],
    w = r ? s?.watches[r.watchId] : undefined;
  if (!s || !r || !w || r.status !== 'pending' || w.status !== 'active')
    throw new Error('reaction-not-pending');
  if (state.world.clock.now >= w.expiresAt) {
    const events = stopProgramWatch(
      s,
      w,
      'expired',
      'watch-expired',
      state.world.clock.now,
      state.revision + 1,
    );
    return { coordinationEvents: events, experiences: stoppedReactionExperiences(events) };
  }
  const runId = `reaction-run-${digest([id]).slice(0, 32)}`;
  const execution = executeResidentProgram({
    state,
    manifest,
    runnerId: w.runnerId,
    programId: w.programId,
    programRevision: w.programRevision,
    runId,
    reactionId: id,
  });
  const status =
    execution.error === undefined
      ? 'succeeded'
      : execution.error === 'program-conditions-not-met'
        ? 'skipped'
        : 'failed';
  const events = finishProgramReaction(
    s,
    id,
    status,
    state.world.clock.now,
    runId,
    execution.error,
  );
  return mergeProgramEffects(execution.effects, {
    coordinationEvents: events,
    experiences: [
      ...worldExperiences(state, execution.effects.worldEvents ?? []),
      ...stoppedReactionExperiences(events),
    ],
  });
}
