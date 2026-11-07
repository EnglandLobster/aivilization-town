import {
  emptyPremisesState,
  applyPremisesEvent,
  PREMISES_POLICY,
  PUBLIC_LAND_USE_POLICY,
  PREMISES_FACILITY_USE_POLICY,
} from '@aivilization/premises';
import { applyMaterialCommit, MATERIAL_RESERVATIONS_POLICY } from '@aivilization/materials';
import type { WorldProjection } from '@aivilization/world';
export const CONSTRUCTION_SITE_SEED_VERSION = 'explicit-construction-sites-v1';
/** New manifest geometry only; no old world is silently given land, goods or buildings. */
export function seedOpenPremises(w: WorldProjection, facilityUse = true) {
  if (!w.materials) throw Error('materials-required-for-premises');
  let premises = emptyPremisesState(PREMISES_POLICY, PUBLIC_LAND_USE_POLICY);
  if (facilityUse)
    premises = applyPremisesEvent(premises, {
      type: 'PremisesFacilityUseEnabled',
      policy: PREMISES_FACILITY_USE_POLICY,
    });
  const locations = Object.values(w.locations)
    .filter((l) => l.connections !== undefined && (l.kind === 'production' || l.kind === 'social'))
    .sort((a, b) => a.locationId.localeCompare(b.locationId))
    .slice(0, 4);
  for (const [i, l] of locations.entries())
    premises = applyPremisesEvent(premises, {
      type: 'ConstructionSiteRegistered',
      site: {
        id: `public-site-${i + 1}`,
        parentLocationId: l.locationId,
        usableFloorArea: 400,
        occupiedFloorArea: 0,
        reservedFloorArea: 0,
        accessTravelMs: 60000,
        revision: 1,
        source: 'scenario-seed',
        sourceId: CONSTRUCTION_SITE_SEED_VERSION,
      },
    });
  const materials = w.materials.reservations
    ? w.materials
    : applyMaterialCommit(w.materials, [
        { type: 'MaterialReservationsEnabled', policy: MATERIAL_RESERVATIONS_POLICY },
      ]).state;
  return { premises, materials };
}
