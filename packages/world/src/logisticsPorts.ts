import { residentFinancialAccount } from './residentFinancialAccounts';
import { effectiveController } from '@aivilization/authority';
import {
  loadedFreight,
  freightCustodian,
  physicalLoadUnits,
  type Freight,
  type LogisticsPorts,
} from '@aivilization/logistics';
import { authorizedDriver } from '@aivilization/mobility';
import { asLocationId } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import { mayEnterWorldPremises, premisesStorageControllerAllowed } from './premisesAccess';
import { resolveSpatialRoute } from './spatial';

export type LogisticsAuthorization = Pick<LogisticsPorts, 'authorize' | 'controllerAvailable'>;
const presentIdle = (w: WorldProjection, id: string, location: string) =>
  !!w.agents[id] &&
  w.agents[id].physiology.health > 0 &&
  w.agents[id].locationId === location &&
  !w.transitByAgent?.[id] &&
  (w.activityTimeByAgent[id]?.availableAt ?? 0) <= w.clock.now &&
  mayEnterWorldPremises(w, id, location);
export const residentHandCargo = (w: WorldProjection, actorId: string) =>
  Object.values(w.logistics?.freight ?? {}).filter(
    (f) =>
      loadedFreight(f) &&
      !freightCustodian(w.logistics?.custody, f).vehicleId &&
      freightCustodian(w.logistics?.custody, f).carrierId === actorId,
  );
export const vehicleFreightCargo = (w: WorldProjection, vehicleId: string) =>
  Object.values(w.logistics?.freight ?? {}).filter(
    (f) => loadedFreight(f) && freightCustodian(w.logistics?.custody, f).vehicleId === vehicleId,
  );
function heldCargoUnits(w: WorldProjection, records: readonly Freight[]) {
  return records.reduce((n, f) => {
    const custody = w.materials?.custodies?.records[f.id];
    if (!custody || custody.status !== 'loaded') throw Error('freight-physical-custody-mismatch');
    return n + physicalLoadUnits(custody.held);
  }, 0);
}
export function personalPhysicalLoad(w: WorldProjection, actorId: string) {
  return (
    physicalLoadUnits(w.agents[actorId]?.inventory ?? {}) +
    heldCargoUnits(w, residentHandCargo(w, actorId))
  );
}
export function personalTravelLoadFailure(w: WorldProjection, actorId: string) {
  if (!w.logistics) return undefined;
  return personalPhysicalLoad(w, actorId) > w.logistics.policy.personalLoadCapacity + 1e-8
    ? 'personal-load-capacity-exceeded'
    : undefined;
}
/** All vehicle journey entry points call this: a driving permit does not convey another courier's custody. */
export function vehicleTravelLoadFailure(
  w: WorldProjection,
  vehicleId: string,
  people: readonly string[],
  driverId: string,
) {
  if (!w.logistics) return undefined;
  const vehicle = w.residentMobility?.vehicles[vehicleId];
  if (!vehicle || !authorizedDriver(vehicle, driverId)) return 'vehicle-authorization-required';
  const cargo = vehicleFreightCargo(w, vehicleId);
  if (cargo.some((f) => freightCustodian(w.logistics?.custody, f).carrierId !== driverId))
    return 'vehicle-freight-custodian-required';
  if (people.length > vehicle.seats || new Set(people).size !== people.length)
    return 'vehicle-passenger-capacity';
  const load =
    heldCargoUnits(w, cargo) + people.reduce((n, id) => n + personalPhysicalLoad(w, id), 0);
  return load > (vehicle.cargoCapacity?.units ?? 0) + 1e-8
    ? 'vehicle-load-capacity-exceeded'
    : undefined;
}
export function freightCargoAccess(
  w: WorldProjection,
  f: Freight,
  operation: 'load' | 'deliver' | 'return',
) {
  const holder = freightCustodian(w.logistics?.custody, f);
  const location = operation === 'deliver' ? f.destinationLocationId : f.sourceLocationId;
  if (
    operation === 'deliver' &&
    !premisesStorageControllerAllowed(w, f.recipient, f.destinationLocationId)
  )
    return 'freight-destination-storage-permit-required';
  if (!presentIdle(w, holder.carrierId, location)) return 'freight-carrier-not-present-and-idle';
  if (holder.vehicleId) {
    const vehicle = w.residentMobility?.vehicles[holder.vehicleId];
    if (
      !vehicle ||
      vehicle.journey ||
      vehicle.locationId !== location ||
      !authorizedDriver(vehicle, holder.carrierId)
    )
      return 'freight-vehicle-not-present-and-authorized';
    if (operation === 'load') {
      const current = vehicleTravelLoadFailure(w, vehicle.id, [holder.carrierId], holder.carrierId);
      if (current) return current;
      const used =
        heldCargoUnits(w, vehicleFreightCargo(w, vehicle.id)) +
        personalPhysicalLoad(w, holder.carrierId);
      if (used + physicalLoadUnits(f.items) > (vehicle.cargoCapacity?.units ?? 0) + 1e-8)
        return 'freight-load-capacity';
    }
  } else if (
    operation === 'load' &&
    personalPhysicalLoad(w, holder.carrierId) + physicalLoadUnits(f.items) >
      (w.logistics?.policy.personalLoadCapacity ?? 0) + 1e-8
  )
    return 'freight-load-capacity';
  if (operation !== 'load') {
    const custody = w.materials?.custodies?.records[f.id];
    if (!custody || custody.status !== 'loaded' || custody.consumerId !== f.id)
      return 'freight-physical-custody-mismatch';
  }
  return undefined;
}
export function logisticsRouteExists(w: WorldProjection, from: string, to: string) {
  if (!w.locations[from]?.connections || !w.locations[to]?.connections) return false;
  const route = resolveSpatialRoute({
    locations: w.locations,
    fromLocationId: asLocationId(from),
    toLocationId: asLocationId(to),
    destinationOccupancy: 0,
    activeTransits: [],
  });
  return !!route && route.travelDurationSeconds > 0;
}
export function residentLogisticsPorts(
  w: WorldProjection,
  auth: LogisticsAuthorization,
): LogisticsPorts {
  return {
    ...auth,
    exists: (id) => !!w.agents[id],
    stock: (id) => {
      const s = w.materials?.stocks[id];
      return s
        ? { locationId: s.locationId, controller: effectiveController(s), status: s.status }
        : undefined;
    },
    material: (id) => {
      const r = w.materials?.reservations?.records[id];
      return r && (r.beneficiary.kind === 'resident' || r.beneficiary.kind === 'collective')
        ? {
            stockId: r.stockId,
            revision: r.revision,
            status: r.status,
            expiresAt: r.expiresAt,
            beneficiary: { kind: r.beneficiary.kind, id: r.beneficiary.id },
            consumer: r.consumer,
            held: r.held,
          }
        : undefined;
    },
    account: (account) => residentFinancialAccount(w, account),
    presentAndIdle: (id, location) => presentIdle(w, id, location),
    routeExists: (from, to) => logisticsRouteExists(w, from, to),
    cargoAccess: (f, operation) => freightCargoAccess(w, f, operation),
  };
}
