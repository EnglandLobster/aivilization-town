import { createEventEnvelope } from '@aivilization/sim-core';
import {
  HOUSING_OCCUPANCY_POLICY,
  assertHousingOccupancyState,
  decideHousingDeparture,
  applyHousingDeparture,
  recordHousingOccupancyChange,
} from '@aivilization/society';
import { mayResideInPremises } from '@aivilization/premises';
import type { WorldProjection } from './projection';
import { resolveAgentResidenceLocationId, resolveResidentialOccupancy } from './projection';
import type { WorldEvent } from './events';
import { premisesAtLocation } from './premisesAccess';
type Context = {
  projection: WorldProjection;
  simulationId: string;
  requestId: string;
  nextSequence: number;
};
export function enableHousingOccupancyEvent(input: Context): WorldEvent {
  if (input.projection.housingOccupancy) throw Error('housing-occupancy-already-enabled');
  return createEventEnvelope({
    id: input.requestId,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentHousingOccupancyEnabled',
    payload: { policy: HOUSING_OCCUPANCY_POLICY, revisions: {} },
  });
}
export function leaveResidentHousing(
  input: Context & { actorId: string; expectedResidenceId: string; expectedRevision: number },
) {
  const w = input.projection,
    state = w.housingOccupancy,
    actor = w.agents[input.actorId];
  if (!state || !actor)
    return { accepted: false as const, reason: 'housing-occupancy-or-actor-unavailable' };
  const d = decideHousingDeparture({
    ...input,
    state,
    at: w.clock.now,
    currentResidenceId: resolveAgentResidenceLocationId(w, actor),
  });
  if (!d.accepted) return d;
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: input.requestId,
        simulationId: input.simulationId,
        sequence: input.nextSequence,
        occurredAt: w.clock.now,
        type: 'ResidentHousingVacated' as const,
        payload: d.event,
      }),
    ],
  };
}
export function applyHousingOccupancyProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type === 'ResidentHousingOccupancyEnabled') {
    assertHousingOccupancyState(e.payload);
    if (
      w.housingOccupancy ||
      Object.keys(e.payload.revisions).length ||
      e.occurredAt !== w.clock.now
    )
      throw Error('invalid-housing-occupancy-activation');
    return { ...w, housingOccupancy: structuredClone(e.payload) };
  }
  if (e.type !== 'ResidentHousingVacated') return undefined;
  const p = e.payload,
    actor = w.agents[p.actorId];
  if (!w.housingOccupancy || !actor || e.occurredAt !== w.clock.now || p.at !== w.clock.now)
    throw Error('invalid-housing-departure-world-source');
  const housingOccupancy = applyHousingDeparture(
    w.housingOccupancy,
    resolveAgentResidenceLocationId(w, actor),
    p,
  );
  return {
    ...w,
    housingOccupancy,
    agents: { ...w.agents, [p.actorId]: { ...actor, residenceLocationId: null } },
  };
}
export function advanceHousingOccupancyRevision(
  w: WorldProjection,
  actorId: string,
): WorldProjection {
  return w.housingOccupancy
    ? { ...w, housingOccupancy: recordHousingOccupancyChange(w.housingOccupancy, actorId) }
    : w;
}
/** Read current permission separately from retained occupation; do not treat continued presence as a new right. */
export function residentHousingOccupancyFacts(w: WorldProjection, actorId: string) {
  const actor = w.agents[actorId];
  if (!actor) throw Error('unknown-housing-resident');
  const residenceId = resolveAgentResidenceLocationId(w, actor),
    location = residenceId ? w.locations[residenceId] : undefined,
    building = residenceId ? premisesAtLocation(w, residenceId) : undefined;
  const physicallyAvailable =
    !!location &&
    (!building ||
      (building.status === 'operational' &&
        building.condition > 0 &&
        building.blueprint.primaryUse === 'residence'));
  const currentPermission = !!residenceId && (!building || mayResideInPremises(building, actorId));
  return {
    residenceId,
    locationId: actor.locationId,
    physicallyAvailable,
    currentPermission,
    source: !residenceId
      ? 'none'
      : building
        ? 'resident-built-premises'
        : 'initial-world-residence',
    capacity: location?.capacity ?? null,
    registeredOccupants: location ? resolveResidentialOccupancy(w, location.locationId) : 0,
    building: building
      ? {
          id: building.id,
          revision: building.revision,
          condition: building.condition,
          status: building.status,
          primaryUse: building.blueprint.primaryUse,
        }
      : null,
    requiresRightsResolution: !!residenceId && (!currentPermission || !physicallyAvailable),
  };
}
