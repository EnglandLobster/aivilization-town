import { assertResidentDepartureActivitySource } from '../residentDepartureActivitySource';
import { applyResidentRestEvent, emptyResidentRestState } from '@aivilization/society';
import { RESIDENT_ACTIVITY_PROGRESS_VERSION, type WorldEvent } from '../events';
import type { WorldProjection } from '../projection';

export function applyResidentRestProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type === 'ResidentRestEnabled') {
    if (
      w.residentRest ||
      Object.values(w.activityTimeByAgent).some(
        (a) => a.availableAt > w.clock.now && a.settlementTiming === 'effects-at-commit',
      )
    )
      throw Error('rest-activation-requires-no-active-prepaid-effects');
    return { ...w, residentRest: emptyResidentRestState(e.payload.policy) };
  }
  if (e.type !== 'ResidentRestSessionChanged') return undefined;
  if (!w.residentRest) throw Error('resident-rest-not-enabled');
  const s = e.payload.session;
  if (e.payload.departure) {
    assertResidentDepartureActivitySource(w, e.payload.departure, s.actorId, e.occurredAt);
    if (s.status !== 'interrupted' || s.settledAt !== w.clock.now)
      throw Error('departure-rest-interruption-required');
  }

  if (
    !w.agents[s.actorId] ||
    s.settledAt > w.clock.now ||
    (e.payload.previousRevision === 0 && s.startedAt !== w.clock.now)
  )
    throw Error('rest-event-world-facts-mismatch');
  const residentRest = applyResidentRestEvent(w.residentRest, {
    type: 'ResidentRestSessionChanged',
    ...e.payload,
  });
  if (s.status !== 'interrupted') return { ...w, residentRest };
  const reservation = w.activityTimeByAgent[s.actorId];
  if (
    !reservation ||
    reservation.policyVersion !== RESIDENT_ACTIVITY_PROGRESS_VERSION ||
    reservation.commandType !== 'AgentSleep' ||
    reservation.startedAt !== s.startedAt ||
    reservation.availableAt !== s.until ||
    s.settledAt !== w.clock.now
  )
    throw Error('rest-interruption-reservation-mismatch');
  return {
    ...w,
    residentRest,
    activityTimeByAgent: {
      ...w.activityTimeByAgent,
      [s.actorId]: {
        ...reservation,
        availableAt: s.settledAt,
        durationSeconds: s.elapsedMs / 1000,
      },
    },
  };
}
