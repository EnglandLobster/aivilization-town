import type { PremisesState } from './model';
export const PREMISES_FACILITY_USE_POLICY = {
  version: 'premises-facility-use-v1',
  materialUnitsPerStorageUnit: 1,
  workstationsPerProduction: 1,
} as const;
export type PremisesFacilityUsePolicy = typeof PREMISES_FACILITY_USE_POLICY;
/** Explicit bootstrap assets at a pre-existing location, never inferred from its name or social use. */
export type ServiceFacilityEndowment = {
  readonly locationId: string;
  readonly careStations: number;
  readonly teachingStations: number;
  readonly source: 'scenario-seed' | 'authorized-extension';
  readonly sourceId: string;
};
export function premisesServiceFacilityCapacity(
  s: PremisesState,
  locationId: string,
  kind: 'careStations' | 'teachingStations',
): number {
  const b = Object.values(s.buildings).find((b) => b.locationId === locationId);
  if (b) return b.status === 'operational' && b.condition > 0 ? b.blueprint.fixtures[kind] : 0;
  return s.serviceFacilityEndowments?.[locationId]?.[kind] ?? 0;
}
export function assertPremisesFacilityUsePolicy(p: PremisesFacilityUsePolicy) {
  if (
    p.version !== PREMISES_FACILITY_USE_POLICY.version ||
    p.materialUnitsPerStorageUnit !== 1 ||
    p.workstationsPerProduction !== 1
  )
    throw Error('invalid-premises-facility-use-policy');
}
/** Physical storage remains present even when people may not enter or operate the building. */
export function premisesStorageCapacity(s: PremisesState, locationId: string): number | undefined {
  if (!s.facilityUsePolicy) return undefined;
  const b = Object.values(s.buildings).find((b) => b.locationId === locationId);
  return b
    ? b.status === 'demolished'
      ? 0
      : b.blueprint.fixtures.storageUnits * s.facilityUsePolicy.materialUnitsPerStorageUnit
    : undefined;
}
export function premisesWorkstationCapacity(
  s: PremisesState,
  locationId: string,
): number | undefined {
  if (!s.facilityUsePolicy) return undefined;
  const b = Object.values(s.buildings).find((b) => b.locationId === locationId);
  return b
    ? b.status === 'operational' && b.condition > 0
      ? b.blueprint.fixtures.workstations
      : 0
    : undefined;
}
