import {
  registerProgramWatch,
  cancelProgramWatch,
  type ProgramWatch,
} from '@aivilization/collaboration';
import type { OpenSocietyState } from './types';
import type { ToolExecution } from './informationTools';
import { ToolRefusal, stringArg, numberArg, pageItems } from './arguments';
import { reactionSourceToken } from './reactionSources';
export function visibleProgramWatch(w: ProgramWatch) {
  return {
    id: w.id,
    runnerId: w.runnerId,
    programId: w.programId,
    programRevision: w.programRevision,
    participants: w.participants,
    maxReactions: w.maxReactions,
    expiresAt: w.expiresAt,
    enqueued: w.enqueued,
    completed: w.completed,
    succeeded: w.succeeded,
    revision: w.revision,
    status: w.status,
    at: w.at,
    ...(w.reason ? { reason: w.reason } : {}),
    ...(w.stoppedAtSequence === undefined ? {} : { stoppedAtSequence: w.stoppedAtSequence }),
  };
}
export function executeReactionTool(
  state: OpenSocietyState,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
): ToolExecution {
  const c = state.coordination,
    s = c?.reactions;
  if (!c || !s) throw new ToolRefusal('program-reactions-not-enabled');
  const id = stringArg(args, 'id'),
    result = (data: unknown): ToolExecution => ({ data, effects: {} });
  const visible = (w: ProgramWatch) => w.participants.includes(actorId);
  if (name === 'reactions.list')
    return result(
      pageItems(
        Object.values(s.watches)
          .filter(visible)
          .sort((a, b) => a.id.localeCompare(b.id, 'en'))
          .map(visibleProgramWatch),
        args,
      ),
    );
  if (name === 'reactions.read' || name === 'reactions.history') {
    const w = Object.hasOwn(s.watches, id) ? s.watches[id] : undefined;
    if (!w || !visible(w)) throw new ToolRefusal('watch-not-found');
    if (name === 'reactions.read') return result(visibleProgramWatch(w));
    return result(
      pageItems(
        Object.values(s.reactions)
          .filter((r) => r.watchId === id)
          .sort((a, b) => a.sourceSequence - b.sourceSequence || a.id.localeCompare(b.id, 'en')),
        args,
      ),
    );
  }
  if (name === 'reactions.cancel') {
    const d = cancelProgramWatch(
      s,
      actorId,
      id,
      numberArg(args, 'expectedRevision'),
      state.world.clock.now,
    );
    if (!d.accepted) throw new ToolRefusal(d.reason);
    return { data: { id, cancelled: true }, effects: { coordinationEvents: d.events } };
  }
  if (name !== 'reactions.watch') throw new ToolRefusal('unknown-reaction-command');
  const programId = stringArg(args, 'programId'),
    p = Object.hasOwn(c.programs, programId) ? c.programs[programId] : undefined;
  // Access check before calculating any private dependencies.
  if (!p || !p.runners.includes(actorId)) throw new ToolRefusal('program-not-found');
  const token = reactionSourceToken(state, p, actorId);
  if (!token.accepted) throw new ToolRefusal(token.reason);
  const d = registerProgramWatch({
    coordination: c,
    actorId,
    id,
    programId,
    programRevision: numberArg(args, 'programRevision'),
    maxReactions: numberArg(args, 'maxReactions'),
    expiresAt: numberArg(args, 'expiresAt'),
    sourceToken: token.token,
    at: state.world.clock.now,
    exists: (id) => Object.hasOwn(state.world.agents, id),
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  const w = d.events.find((e) => e.type === 'ProgramWatchChanged');
  return {
    data: w?.type === 'ProgramWatchChanged' ? visibleProgramWatch(w.watch) : null,
    effects: { coordinationEvents: d.events },
  };
}
