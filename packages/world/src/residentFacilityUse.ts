import { activeMaterialWorkstations } from './residentMaterials';
import {
  applyPremisesEvent,
  premisesStorageCapacity,
  premisesWorkstationCapacity,
  type PremisesFacilityUsePolicy,
} from '@aivilization/premises';
import { materialLocationStorageUsage } from '@aivilization/materials';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import { mayOperateWorldPremises } from './premisesAccess';
import type { ResidentPremisesPayload } from './residentPremises';
/** Upgrade preflight preserves all prior real possessions and unfinished sessions. No destructive normalization. */
export function enableResidentFacilityUseEvent(input: {
  projection: WorldProjection;
  policy: PremisesFacilityUsePolicy;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}) {
  const w = input.projection,
    s = w.premises;
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (!s || !w.materials) return no('premises-and-materials-required');
  if (s.facilityUsePolicy) return no('premises-facility-use-already-enabled');
  const event = { type: 'PremisesFacilityUseEnabled' as const, policy: input.policy },
    next = applyPremisesEvent(s, event);
  for (const b of Object.values(s.buildings)) {
    const storage = premisesStorageCapacity(next, b.locationId)!;
    if (materialLocationStorageUsage(w.materials, b.locationId).total > storage)
      return no(`premises-storage-over-capacity:${b.id}`);
    const active = Object.values(w.materials.productions).filter(
      (p) => p.session && w.materials?.stocks[p.stockId]?.locationId === b.locationId,
    );
    if (
      active.length > premisesWorkstationCapacity(next, b.locationId)! ||
      active.some((p) => !mayOperateWorldPremises(w, p.session!.actorId, b.locationId))
    )
      return no(`premises-workstations-over-capacity-or-not-authorized:${b.id}`);
  }
  const payload: ResidentPremisesPayload = {
    policyVersion: 'resident-premises-v1',
    events: [event],
    materialEvents: [],
    efforts: [],
  };
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: `${input.requestId}:facility-use`,
        simulationId: input.simulationId,
        type: 'ResidentPremisesCommitted',
        sequence: input.nextSequence,
        occurredAt: w.clock.now,
        payload,
      }),
    ],
  };
}
export function premisesFacilityAvailability(w: WorldProjection, locationId: string) {
  if (!w.premises?.facilityUsePolicy || !w.materials) return undefined;
  const storageCapacity = premisesStorageCapacity(w.premises, locationId);
  if (storageCapacity === undefined) return undefined;
  return {
    policyVersion: w.premises.facilityUsePolicy.version,
    storageCapacity,
    storageUsage: materialLocationStorageUsage(w.materials, locationId),
    workstationCapacity: premisesWorkstationCapacity(w.premises, locationId),
    workstationsInUse: activeMaterialWorkstations(w, locationId),
  };
}
