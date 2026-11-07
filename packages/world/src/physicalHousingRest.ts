import { createEventEnvelope } from '@aivilization/sim-core';
import {
  PHYSICAL_HOUSING_REST_POLICY,
  assertPhysicalHousingRestPolicy,
  physicalHousingRestEffect,
  type PhysicalRestSource,
} from '@aivilization/society';
import { residentialStructureAt, assertResidentialStructureInterval } from '@aivilization/premises';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import { premisesAtLocation } from './premisesAccess';

function assertActivation(w: WorldProjection) {
  if (w.physicalHousingRest) throw Error('physical-housing-rest-already-enabled');
  if (!w.residentRest || !w.premises || !w.housingOccupancy)
    throw Error('physical-housing-needs-elapsed-rest-premises-and-occupancy');
  if (Object.keys(w.residentRest.activeByActor).length)
    throw Error('physical-housing-activation-needs-no-active-sleep');
  assertResidentialStructureInterval(w.premises, w.clock.now, w.clock.now);
}
export function enablePhysicalHousingRestEvent(input: {
  readonly projection: WorldProjection;
  readonly simulationId: string;
  readonly requestId: string;
  readonly nextSequence: number;
}): WorldEvent {
  assertActivation(input.projection);
  return createEventEnvelope({
    id: input.requestId,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentPhysicalHousingRestEnabled',
    payload: { policy: PHYSICAL_HOUSING_REST_POLICY },
  });
}
export function assertPhysicalHousingTimeInterval(w: WorldProjection, from: number, until: number) {
  if (!w.physicalHousingRest) return;
  assertPhysicalHousingRestPolicy(w.physicalHousingRest);
  if (!w.residentRest || !w.premises || !w.housingOccupancy)
    throw Error('physical-housing-needs-elapsed-rest-premises-and-occupancy');
  assertResidentialStructureInterval(w.premises, from, until);
}
/** Read only actual location. An expired contract cannot make the physical structure disappear. */
export function residentPhysicalRestSource(
  w: WorldProjection,
  actorId: string,
): PhysicalRestSource {
  const actor = w.agents[actorId],
    locationId = actor?.locationId;
  if (!locationId || !w.locations[locationId]) throw Error('physical-rest-location-unavailable');
  const physical = w.premises ? residentialStructureAt(w.premises, locationId) : undefined;
  if (physical) return { kind: 'resident-built-residence', ...physical };
  if (!premisesAtLocation(w, locationId) && w.locations[locationId].kind === 'residence')
    return { kind: 'initial-world-residence', locationId };
  return { kind: 'unsheltered', locationId };
}
export function residentPhysicalRestEffect(
  w: WorldProjection,
  actorId: string,
  at: number,
  baseEnergyPerSecond: number,
) {
  if (!w.physicalHousingRest) throw Error('physical-housing-rest-not-enabled');
  return physicalHousingRestEffect({
    policy: w.physicalHousingRest,
    source: residentPhysicalRestSource(w, actorId),
    at,
    baseEnergyPerSecond,
  });
}
export function applyPhysicalHousingRestProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentPhysicalHousingRestEnabled') return undefined;
  assertActivation(w);
  assertPhysicalHousingRestPolicy(e.payload.policy);
  if (e.occurredAt !== w.clock.now) throw Error('invalid-physical-housing-activation-time');
  return { ...w, physicalHousingRest: { ...e.payload.policy } };
}
/** Validate recorded source facts, never reintegrate body effects in the reducer. */
export function assertPhysicalHousingRestEvidence(w: WorldProjection, e: WorldEvent) {
  if (e.type !== 'PhysiologyChanged') return;
  const elapsed = e.payload.elapsed,
    evidence = elapsed?.physicalHousing;
  if (!w.physicalHousingRest) {
    if (evidence) throw Error('physical-housing-rest-not-enabled');
    return;
  }
  if (!elapsed?.restSessionId) {
    if (evidence) throw Error('physical-housing-evidence-needs-real-sleep');
    return;
  }
  const session = w.residentRest?.sessions[elapsed.restSessionId];
  if (
    !evidence ||
    !session ||
    session.actorId !== e.payload.agentId ||
    session.locationId !== w.agents[e.payload.agentId]?.locationId ||
    session.status !== 'active' ||
    session.settledAt !== elapsed.from ||
    elapsed.until > session.until ||
    elapsed.until > w.clock.now
  )
    throw Error('physical-housing-rest-source-mismatch');
  assertPhysicalHousingTimeInterval(w, elapsed.from, elapsed.until);
  const actual = residentPhysicalRestEffect(
    w,
    e.payload.agentId,
    elapsed.from,
    session.energyPerSecond,
  );
  if (
    evidence.policyVersion !== actual.policyVersion ||
    evidence.at !== actual.at ||
    evidence.multiplier !== actual.multiplier ||
    evidence.energyPerSecond !== actual.energyPerSecond ||
    Object.keys(evidence.source).length !== Object.keys(actual.source).length ||
    Object.entries(actual.source).some(
      ([key, value]) =>
        !Object.hasOwn(evidence.source, key) || Reflect.get(evidence.source, key) !== value,
    )
  )
    throw Error('physical-housing-rest-source-mismatch');
}
