import type { OpenAgentPolicy } from '@aivilization/agent-runtime';
import type { OpenSocietyState, ResidentRuntimeState } from './types';

/**
 * When a direct message should wake its recipient. Without a pacing policy this is the arrival
 * time (historical behavior). With `resident-message-pacing-v1`, a message waits until the
 * recipient's current activity or journey ends and until the minimum interval since the start of
 * their last opportunity has passed. It never moves an earlier wake later.
 */
export function messageWakeAt(
  state: OpenSocietyState,
  policy: OpenAgentPolicy,
  resident: ResidentRuntimeState,
  at: number,
): number {
  const pacing = policy.messageWake;
  if (!pacing) return at;
  // beginTurn names turns `turn-${ordinal}-${actorId}` with the same ordinal it records here.
  const lastTurn = state.turns[`turn-${resident.lastTurnOrdinal}-${resident.actorId}`];
  const busyUntil = pacing.deferDuringActivity ? residentBusyUntil(state, resident.actorId) : 0;
  return Math.max(at, (lastTurn?.startedAt ?? -Infinity) + pacing.minIntervalMs, busyUntil);
}
/** End of the resident's own committed activity or journey; 0 when idle. */
export function residentBusyUntil(state: OpenSocietyState, actorId: string): number {
  return Math.max(
    state.world.activityTimeByAgent[actorId]?.availableAt ?? 0,
    state.world.transitByAgent?.[actorId]?.arrivesAt ?? 0,
  );
}
