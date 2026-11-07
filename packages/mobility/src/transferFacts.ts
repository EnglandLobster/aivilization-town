import type { MobilityState } from './model';
import { vehiclePrincipalBusy } from './vehiclePrincipals';
/** Actual vehicle, named driver permissions and existing mobility obligations; no transported goods become vehicle-owner inventory. */
export function vehicleTransferFacts(s: MobilityState, id: string) {
  const vehicle = s.vehicles[id],
    control = vehicle?.control;
  if (!s.principalPolicy || !vehicle || !control || !control.offer) return undefined;
  return {
    version: 'vehicle-sale-source-v1' as const,
    kind: 'vehicle' as const,
    id: vehicle.id,
    revision: vehicle.revision,
    controlVersion: control.version,
    seller: structuredClone(control.controller),
    offer: structuredClone(control.offer),
    authorId: vehicle.ownerId,
    locationId: vehicle.locationId,
    seats: vehicle.seats,
    authorized: [...vehicle.authorized],
    cargoCapacity: vehicle.cargoCapacity ? structuredClone(vehicle.cargoCapacity) : null,
    busy: vehiclePrincipalBusy(s, id),
    encumbrances: [
      ...Object.values(s.drivers)
        .filter((d) => d.vehicleId === id)
        .map((d) => ({ kind: 'driver', id: d.id, revision: d.revision })),
      ...Object.values(s.rides)
        .filter((r) => r.vehicleId === id && !['completed', 'cancelled'].includes(r.status))
        .map((r) => ({ kind: 'ride', id: r.id, revision: r.revision })),
      ...Object.values(s.quotes)
        .filter(
          (q) =>
            q.vehicleId === id &&
            q.active &&
            s.rides[q.rideId] &&
            !['completed', 'cancelled'].includes(s.rides[q.rideId]!.status),
        )
        .map((q) => ({ kind: 'ride-quote', id: q.id, revision: q.revision })),
    ].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
  };
}
