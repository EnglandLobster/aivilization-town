import type { WorldProjection } from '../projection';
import type { WorldEvent } from '../events';
export function applyResidentParticipationEnded(
  w: WorldProjection,
  event: Extract<WorldEvent, { type: 'ResidentParticipationEnded' }>,
): WorldProjection {
  const p = event.payload,
    previous = w.activityTimeByAgent[p.agentId];
  if (
    p.policyVersion !== 'resident-participation-end-v1' ||
    !previous ||
    previous.commandType !== 'ResidentParticipate' ||
    previous.startedAt !== p.startedAt ||
    previous.availableAt !== p.previousAvailableAt ||
    p.endedAt !== w.clock.now ||
    p.endedAt < p.startedAt ||
    p.endedAt >= p.previousAvailableAt ||
    !Number.isFinite(p.durationSeconds) ||
    p.durationSeconds * 1000 !== p.endedAt - p.startedAt
  )
    throw new Error('invalid-participation-ended-event');
  return {
    ...w,
    activityTimeByAgent: {
      ...w.activityTimeByAgent,
      [p.agentId]: { ...previous, availableAt: p.endedAt, durationSeconds: p.durationSeconds },
    },
  };
}
