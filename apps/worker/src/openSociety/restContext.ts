import type { WorldProjection } from '@aivilization/world';

/** One own active session only; no other resident's body or growing history enters context. */
export function ownRestContext(world: WorldProjection, actorId: string) {
  const state = world.residentRest;
  if (!state) return undefined;
  const id = state.activeByActor[actorId];
  const session = id ? state.sessions[id] : undefined;
  return {
    policyVersion: state.policy.version,
    active: session
      ? {
          id: session.id,
          revision: session.revision,
          startedAt: session.startedAt,
          until: session.until,
          settledAt: session.settledAt,
          elapsedMs: session.elapsedMs,
          wakeWith: 'town life wake',
        }
      : null,
    readWith: 'town city observe --view action',
  };
}
