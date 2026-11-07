import type { Journey, JourneyInterruption, MobilityEvent, MobilityState } from './model';
export const VEHICLE_JOURNEY_INTERRUPTION_VERSION = 'vehicle-journey-interruption-v1' as const;
type InterruptionEvent = Extract<MobilityEvent, { type: 'VehicleJourneyInterrupted' }>;
function valid(j: Journey, i: JourneyInterruption) {
  return (
    i.version === VEHICLE_JOURNEY_INTERRUPTION_VERSION &&
    i.executor === 'system' &&
    ['AgentDied', 'AgentEmigrated'].includes(i.populationType) &&
    typeof i.populationEventId === 'string' &&
    i.populationEventId.trim().length > 0 &&
    typeof i.populationPolicyVersion === 'string' &&
    i.populationPolicyVersion.trim().length > 0 &&
    j.people.includes(i.participantId) &&
    Number.isSafeInteger(j.departedAt) &&
    j.departedAt >= 0 &&
    Number.isSafeInteger(j.arrivesAt) &&
    j.arrivesAt > j.departedAt &&
    Number.isSafeInteger(i.stoppedAt) &&
    i.stoppedAt >= j.departedAt &&
    i.stoppedAt < j.arrivesAt &&
    Number.isSafeInteger(i.elapsedMs) &&
    i.elapsedMs === i.stoppedAt - j.departedAt
  );
}
/** A population reference is verified by the outer application; this domain never decides death. */
export function interruptVehicleJourney(input: {
  state: MobilityState;
  vehicleId: string;
  expectedRevision: number;
  source: Omit<JourneyInterruption, 'version' | 'elapsedMs'>;
}): { accepted: true; event: InterruptionEvent } | { accepted: false; reason: string } {
  const v = input.state.vehicles[input.vehicleId];
  if (!v?.journey || v.journey.interruption)
    return { accepted: false, reason: 'vehicle-active-journey-required' };
  if (
    v.revision !== input.expectedRevision ||
    !Number.isSafeInteger(v.revision) ||
    v.revision >= Number.MAX_SAFE_INTEGER
  )
    return { accepted: false, reason: 'vehicle-interruption-revision-conflict' };
  const interruption: JourneyInterruption = {
    ...input.source,
    version: VEHICLE_JOURNEY_INTERRUPTION_VERSION,
    elapsedMs: input.source.stoppedAt - v.journey.departedAt,
  };
  if (!valid(v.journey, interruption))
    return { accepted: false, reason: 'invalid-vehicle-interruption-source-or-boundary' };
  return {
    accepted: true,
    event: {
      type: 'VehicleJourneyInterrupted',
      value: {
        id: v.id,
        revision: v.revision + 1,
        interruption,
      },
    },
  };
}
/** Apply only recorded stop facts. Does not change the anchor, authority, riders, fares or cargo. */
export function applyVehicleJourneyInterruption(
  s: MobilityState,
  e: InterruptionEvent,
): MobilityState {
  const v = s.vehicles[e.value.id];
  if (
    !v?.journey ||
    v.journey.interruption ||
    !Number.isSafeInteger(e.value.revision) ||
    e.value.revision !== v.revision + 1 ||
    !valid(v.journey, e.value.interruption)
  )
    throw Error('invalid-vehicle-journey-interruption');
  return {
    ...s,
    vehicles: {
      ...s.vehicles,
      [v.id]: {
        ...v,
        revision: e.value.revision,
        journey: { ...v.journey, interruption: { ...e.value.interruption } },
      },
    },
  };
}
