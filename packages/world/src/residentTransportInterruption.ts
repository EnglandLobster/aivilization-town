import { interruptVehicleJourney, applyMobilityEvent } from '@aivilization/mobility';
import { tradeFactsEqual as equal } from '@aivilization/commerce';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldAgentTransitState, WorldProjection } from './projection';
import type { WorldEvent } from './events';
import {
  assertResidentDepartureActivitySource,
  type ResidentDepartureActivitySource,
} from './residentDepartureActivitySource';
export type InterruptedResidentTravel = {
  readonly vehicleId: string;
  readonly transit: WorldAgentTransitState;
  readonly source: ResidentDepartureActivitySource;
};
export type ResidentTransportInterruption = {
  readonly vehicleId: string;
  readonly source: ResidentDepartureActivitySource;
  readonly transits: readonly WorldAgentTransitState[];
};
export function residentVehicleDepartureInterruption(input: {
  projection: WorldProjection;
  vehicleId: string;
  source: ResidentDepartureActivitySource;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  const w = input.projection,
    source = input.source,
    v = w.residentMobility?.vehicles[input.vehicleId];
  assertResidentDepartureActivitySource(w, source, source.actorId, w.clock.now);
  if (!v?.journey || !w.residentMobility) throw Error('departure-vehicle-journey-required');
  const d = interruptVehicleJourney({
    state: w.residentMobility,
    vehicleId: v.id,
    expectedRevision: v.revision,
    source: {
      executor: 'system',
      participantId: source.actorId,
      populationEventId: source.populationEventId,
      populationType: source.populationType,
      populationPolicyVersion: source.populationPolicyVersion,
      stoppedAt: source.at,
    },
  });
  if (!d.accepted) throw Error(d.reason);
  const transits = v.journey.people.map((id) => {
    const t = w.transitByAgent?.[id];
    if (!t) throw Error('departure-vehicle-transit-required');
    return structuredClone(t);
  });
  return createEventEnvelope({
    id: input.requestId,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: w.clock.now,
    type: 'ResidentMobilityCommitted',
    payload: {
      policyVersion: 'resident-mobility-v1' as const,
      events: [d.event],
      transportInterruption: { vehicleId: v.id, source, transits },
    },
  });
}
/** Recorded route remains the physical reference after body removal; no node arrival is invented. */
export function applyResidentTransportInterruption(
  w: WorldProjection,
  event: Extract<WorldEvent, { type: 'ResidentMobilityCommitted' }>,
): WorldProjection {
  const p = event.payload.transportInterruption;
  const e = event.payload.events[0];
  if (
    !p ||
    event.payload.events.length !== 1 ||
    e?.type !== 'VehicleJourneyInterrupted' ||
    !w.residentMobility ||
    e.value.id !== p.vehicleId
  )
    throw Error('invalid-transport-interruption-packet');
  assertResidentDepartureActivitySource(w, p.source, p.source.actorId, event.occurredAt);
  const v = w.residentMobility.vehicles[p.vehicleId],
    j = v?.journey,
    i = e.value.interruption;
  if (
    !j ||
    new Set(j.people).size !== j.people.length ||
    i.participantId !== p.source.actorId ||
    i.populationEventId !== p.source.populationEventId ||
    i.populationType !== p.source.populationType ||
    i.populationPolicyVersion !== p.source.populationPolicyVersion ||
    i.stoppedAt !== p.source.at ||
    !equal(
      p.transits,
      j.people.map((id) => w.transitByAgent?.[id]),
    )
  )
    throw Error('transport-interruption-source-or-transit-mismatch');
  const mobility = applyMobilityEvent(w.residentMobility, e);
  const agents = { ...w.agents },
    transitByAgent = { ...w.transitByAgent },
    activityTimeByAgent = { ...w.activityTimeByAgent },
    interruptedTravelByAgent = { ...w.interruptedTravelByAgent };
  for (const t of p.transits) {
    const a = agents[t.agentId],
      busy = activityTimeByAgent[t.agentId];
    if (
      !a ||
      interruptedTravelByAgent[t.agentId] ||
      a.locationId !== j.from ||
      t.fromLocationId !== j.from ||
      t.toLocationId !== j.to ||
      t.departedAt !== j.departedAt ||
      t.arrivesAt !== j.arrivesAt ||
      !busy ||
      busy.activity !== 'travel' ||
      busy.startedAt !== j.departedAt ||
      busy.availableAt !== j.arrivesAt
    )
      throw Error('transport-interruption-body-reservation-mismatch');
    agents[t.agentId] = { ...a, locationId: null };
    delete transitByAgent[t.agentId];
    activityTimeByAgent[t.agentId] = {
      ...busy,
      availableAt: i.stoppedAt,
      durationSeconds: i.elapsedMs / 1000,
    };
    interruptedTravelByAgent[t.agentId] = {
      vehicleId: v.id,
      transit: structuredClone(t),
      source: structuredClone(p.source),
    };
  }
  return {
    ...w,
    residentMobility: mobility,
    agents,
    transitByAgent,
    activityTimeByAgent,
    interruptedTravelByAgent,
  };
}
