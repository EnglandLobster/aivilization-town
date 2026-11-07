import { emptyLogisticsState } from '@aivilization/logistics';
import { applyMaterialCommit, MATERIAL_CUSTODY_POLICY } from '@aivilization/materials';
import type { WorldProjection } from '@aivilization/world';
export const LOGISTICS_VEHICLE_SEED_VERSION = 'explicit-vehicle-cargo-v1';
/** New manifest initial assets only. Enabling an existing journal never adds load capacity to historical vehicles. */
export function seedOpenLogistics(w: WorldProjection): Partial<WorldProjection> {
  if (!w.materials?.reservations || !w.premises?.facilityUsePolicy)
    throw Error('logistics-physical-domains-required');
  return {
    logistics: emptyLogisticsState(),
    materials: applyMaterialCommit(w.materials, [
      { type: 'MaterialCustodyEnabled', policy: MATERIAL_CUSTODY_POLICY },
    ]).state,
    ...(w.residentMobility
      ? {
          residentMobility: {
            ...w.residentMobility,
            vehicles: Object.fromEntries(
              Object.entries(w.residentMobility.vehicles).map(([id, v]) => [
                id,
                {
                  ...v,
                  cargoCapacity: {
                    version: 'vehicle-cargo-capacity-v1' as const,
                    units: 40,
                    source: 'scenario-seed' as const,
                    sourceId: LOGISTICS_VEHICLE_SEED_VERSION,
                  },
                },
              ]),
            ),
          },
        }
      : {}),
  };
}
