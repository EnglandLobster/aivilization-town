import { applyPremisesEvent, type ServiceFacilityEndowment } from '@aivilization/premises';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
export const DECLARED_SERVICE_FACILITIES_VERSION = 'declared-service-facilities-v1';
export type ServiceFacilitiesRegisteredPayload = {
  readonly policyVersion: typeof DECLARED_SERVICE_FACILITIES_VERSION;
  readonly facilities: readonly ServiceFacilityEndowment[];
};
/** Cross-domain physical capacity: one participant and one provider per station. */
export function serviceFacilityFitsLocation(w: WorldProjection, f: ServiceFacilityEndowment) {
  const l = w.locations[f.locationId];
  return !!l && l.capacity !== null && 2 * (f.careStations + f.teachingStations) <= l.capacity;
}
/** Operator input only. Names/kinds of legacy locations never infer a station count. */
export function parseDeclaredServiceFacilities(
  input: unknown,
): readonly ServiceFacilityEndowment[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 64)
    throw Error('invalid-service-facility-declaration');
  return input.map((v: unknown) => {
    if (
      !v ||
      typeof v !== 'object' ||
      Array.isArray(v) ||
      Object.keys(v).sort().join(',') !== 'careStations,locationId,sourceId,teachingStations' ||
      !('locationId' in v) ||
      typeof v.locationId !== 'string' ||
      !('sourceId' in v) ||
      typeof v.sourceId !== 'string' ||
      !('careStations' in v) ||
      typeof v.careStations !== 'number' ||
      !('teachingStations' in v) ||
      typeof v.teachingStations !== 'number'
    )
      throw Error('invalid-service-facility-declaration');
    return {
      locationId: v.locationId,
      sourceId: v.sourceId,
      careStations: v.careStations,
      teachingStations: v.teachingStations,
      source: 'authorized-extension' as const,
    };
  });
}
function boundedFacilityBatch(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.length <= 64;
}
export function applyServiceFacilitiesRegistration(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentServiceFacilitiesRegistered') return undefined;
  const p = e.payload;
  if (
    !w.premises ||
    !w.serviceEngagements ||
    e.occurredAt !== w.clock.now ||
    p.policyVersion !== DECLARED_SERVICE_FACILITIES_VERSION ||
    !boundedFacilityBatch(p.facilities)
  )
    throw Error('invalid-service-facility-registration');
  let premises = w.premises;
  for (const f of p.facilities) {
    if (f.source !== 'authorized-extension' || !serviceFacilityFitsLocation(w, f))
      throw Error('service-facility-source-or-location-invalid');
    premises = applyPremisesEvent(premises, {
      type: 'ServiceFacilityEndowed',
      endowment: structuredClone(f),
    });
  }
  return { ...w, premises };
}
export function registerServiceFacilitiesEvent(input: {
  projection: WorldProjection;
  declaration: unknown;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  const event = createEventEnvelope({
    id: `${input.requestId}:facilities`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentServiceFacilitiesRegistered' as const,
    payload: {
      policyVersion: DECLARED_SERVICE_FACILITIES_VERSION,
      facilities: parseDeclaredServiceFacilities(input.declaration),
    } satisfies ServiceFacilitiesRegisteredPayload,
  });
  applyServiceFacilitiesRegistration(input.projection, event);
  return event;
}
