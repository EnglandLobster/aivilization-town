import {
  activeRide,
  assignedRide,
  authorizedDriver,
  type MobilityState,
  type MobilityEvent,
  type MobilityCommand,
  type MobilityDecision,
  type MobilityPorts,
  type Ride,
  type Vehicle,
  type FareEffect,
} from './model';
const validId = (id: string) =>
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id) && !Object.hasOwn(Object.prototype, id);
const no = (reason: string): MobilityDecision => ({ accepted: false, reason });
const yes = (
  events: readonly MobilityEvent[],
  fares: readonly FareEffect[] = [],
): MobilityDecision => ({ accepted: true, events, fares });
const rideEvent = (r: Ride, at: number, change: Partial<Ride>): MobilityEvent => ({
  type: 'RideChanged',
  value: { ...r, ...change, at, revision: r.revision + 1 },
});
const vehicleEvent = (v: Vehicle, change: Partial<Vehicle>): MobilityEvent => ({
  type: 'VehicleChanged',
  value: { ...v, ...change, revision: v.revision + 1 },
});
const occupied = (s: MobilityState, actor: string, except = '') =>
  Object.values(s.rides).some(
    (r) => r.id !== except && activeRide(r) && (r.riderId === actor || r.driverId === actor),
  );
const vehicleBusy = (s: MobilityState, id: string, except = '') =>
  !!s.vehicles[id]?.journey ||
  Object.values(s.rides).some((r) => r.id !== except && assignedRide(r) && r.vehicleId === id);
export function decideMobility(
  s: MobilityState,
  actor: string,
  at: number,
  c: MobilityCommand,
  p: MobilityPorts,
): MobilityDecision {
  if (!p.exists(actor)) return no('unknown-resident');
  const future = (n: number) =>
    Number.isSafeInteger(n) && n > at && n <= at + s.policy.maxHorizonMs;
  if (c.type === 'vehicles.authorize' || c.type === 'vehicles.revoke') {
    const v = s.vehicles[c.id];
    if (!v || v.ownerId !== actor) return no('vehicle-owner-required');
    if (v.revision !== c.expectedRevision) return no('revision-conflict');
    if (!p.exists(c.residentId) || c.residentId === actor) return no('invalid-driver');
    if (vehicleBusy(s, v.id)) return no('vehicle-busy');
    return yes([
      vehicleEvent(v, {
        authorized:
          c.type === 'vehicles.authorize'
            ? [...new Set([...v.authorized, c.residentId])]
            : v.authorized.filter((id) => id !== c.residentId),
      }),
    ]);
  }
  if (c.type === 'drivers.register') {
    const v = s.vehicles[c.vehicleId];
    if (!v || !authorizedDriver(v, actor)) return no('vehicle-authorization-required');
    if (vehicleBusy(s, v.id) || occupied(s, actor)) return no('driver-or-vehicle-busy');
    return yes([
      {
        type: 'DriverChanged',
        value: {
          id: actor,
          vehicleId: v.id,
          online: false,
          revision: (s.drivers[actor]?.revision ?? 0) + 1,
        },
      },
    ]);
  }
  if (c.type === 'drivers.online' || c.type === 'drivers.offline') {
    const d = s.drivers[actor];
    if (!d) return no('driver-registration-required');
    if (c.type === 'drivers.online' && !authorizedDriver(s.vehicles[d.vehicleId]!, actor))
      return no('vehicle-authorization-required');
    return yes([
      {
        type: 'DriverChanged',
        value: { ...d, online: c.type === 'drivers.online', revision: d.revision + 1 },
      },
    ]);
  }
  if (c.type === 'rides.request') {
    const pickupId = p.location(actor);
    if (!validId(c.id) || s.rides[c.id]) return no('ride-id-conflict');
    if (occupied(s, actor)) return no('resident-already-has-ride');
    if (
      !pickupId ||
      !p.idle(actor) ||
      !p.destinationExists(c.destinationId) ||
      pickupId === c.destinationId ||
      !future(c.expiresAt)
    )
      return no('invalid-ride-request');
    return yes([
      {
        type: 'RideChanged',
        value: {
          id: c.id,
          riderId: actor,
          pickupId,
          destinationId: c.destinationId,
          expiresAt: c.expiresAt,
          status: 'requested',
          revision: 1,
          at,
        },
      },
    ]);
  }
  if (c.type === 'rides.quote') {
    const r = s.rides[c.rideId],
      d = s.drivers[actor],
      v = d && s.vehicles[d.vehicleId];
    if (!r || r.status !== 'requested' || r.expiresAt <= at || r.riderId === actor)
      return no('ride-not-open');
    if (!d?.online || !v || !authorizedDriver(v, actor))
      return no('online-authorized-driver-required');
    if (occupied(s, actor) || vehicleBusy(s, v.id)) return no('driver-or-vehicle-busy');
    if (
      !validId(c.id) ||
      s.quotes[c.id] ||
      !Number.isSafeInteger(c.fare) ||
      c.fare <= 0 ||
      c.fare > s.policy.maxFare ||
      !future(c.expiresAt) ||
      c.expiresAt > r.expiresAt
    )
      return no('invalid-quote');
    if (
      Object.values(s.quotes).filter((q) => q.rideId === r.id).length >= s.policy.maxQuotesPerRide
    )
      return no('quote-capacity-reached');
    return yes([
      {
        type: 'RideQuoteChanged',
        value: {
          id: c.id,
          rideId: r.id,
          driverId: actor,
          vehicleId: v.id,
          fare: c.fare,
          expiresAt: c.expiresAt,
          active: true,
          revision: 1,
        },
      },
    ]);
  }
  if (c.type === 'rides.withdraw') {
    const q = s.quotes[c.id];
    if (!q || q.driverId !== actor || !q.active) return no('active-own-quote-required');
    if (q.revision !== c.expectedRevision) return no('revision-conflict');
    if (s.rides[q.rideId]?.quoteId === q.id) return no('quote-already-accepted');
    return yes([
      { type: 'RideQuoteChanged', value: { ...q, active: false, revision: q.revision + 1 } },
    ]);
  }
  if (!('id' in c) || !('expectedRevision' in c)) return no('unknown-mobility-command');
  const r = s.rides[c.id];
  if (!r) return no('ride-not-found');
  if (r.revision !== c.expectedRevision) return no('revision-conflict');
  if (c.type === 'rides.cancel') {
    if (actor !== r.riderId && actor !== r.driverId) return no('ride-party-required');
    if (!activeRide(r) || r.status === 'riding') return no('ride-cannot-cancel-after-departure');
    return yes(
      [rideEvent(r, at, { status: 'cancelled', endReason: 'party-cancelled' })],
      r.driverId ? [{ kind: 'refund', ride: r }] : [],
    );
  }
  if (r.expiresAt <= at) return no('ride-expired');
  if (c.type === 'rides.book') {
    const q = s.quotes[c.quoteId];
    if (r.riderId !== actor || r.status !== 'requested') return no('own-open-ride-required');
    if (!q || q.rideId !== r.id || !q.active || q.expiresAt <= at) return no('quote-not-available');
    const d = s.drivers[q.driverId],
      v = s.vehicles[q.vehicleId];
    if (!d?.online || d.vehicleId !== q.vehicleId || !v || !authorizedDriver(v, q.driverId))
      return no('driver-not-available');
    if (vehicleBusy(s, v.id) || occupied(s, q.driverId) || occupied(s, actor, r.id))
      return no('driver-or-vehicle-busy');
    const updated: Ride = {
      ...r,
      status: 'booked',
      driverId: q.driverId,
      vehicleId: q.vehicleId,
      quoteId: q.id,
      fare: q.fare,
      revision: r.revision + 1,
      at,
    };
    return yes([{ type: 'RideChanged', value: updated }], [{ kind: 'fund', ride: updated }]);
  }
  const v = r.vehicleId ? s.vehicles[r.vehicleId] : undefined;
  if (!v || !r.driverId) return no('ride-not-booked');
  if (c.type === 'rides.pickup') {
    if (actor !== r.driverId || r.status !== 'booked') return no('booked-driver-required');
    if (
      !authorizedDriver(v, actor) ||
      v.journey ||
      !p.idle(actor) ||
      p.location(actor) !== v.locationId
    )
      return no('driver-must-be-at-idle-vehicle');
    if (v.locationId === r.pickupId) return yes([rideEvent(r, at, { status: 'ready' })]);
    const arrivesAt = p.arrivalAt([actor], v.locationId, r.pickupId);
    if (arrivesAt === null || arrivesAt >= r.expiresAt)
      return no('pickup-route-unavailable-before-deadline');
    return yes([
      vehicleEvent(v, {
        journey: { from: v.locationId, to: r.pickupId, people: [actor], departedAt: at, arrivesAt },
      }),
      rideEvent(r, at, { status: 'pickup' }),
    ]);
  }
  if (c.type === 'rides.board') {
    if (actor !== r.riderId || r.status !== 'ready') return no('ready-rider-required');
    const people = [r.driverId, r.riderId];
    if (
      v.journey ||
      v.locationId !== r.pickupId ||
      people.some((id) => !p.idle(id) || p.location(id) !== r.pickupId)
    )
      return no('both-parties-must-be-at-pickup-and-idle');
    const arrivesAt = p.arrivalAt(people, r.pickupId, r.destinationId);
    if (arrivesAt === null) return no('destination-or-route-unavailable');
    return yes([
      vehicleEvent(v, {
        journey: { from: r.pickupId, to: r.destinationId, people, departedAt: at, arrivesAt },
      }),
      rideEvent(r, at, { status: 'riding' }),
    ]);
  }
  return no('unknown-mobility-command');
}
export function applyMobilityEvent(s: MobilityState, e: MobilityEvent): MobilityState {
  const key =
    e.type === 'VehicleChanged'
      ? 'vehicles'
      : e.type === 'DriverChanged'
        ? 'drivers'
        : e.type === 'RideChanged'
          ? 'rides'
          : 'quotes';
  if (e.value.revision !== (s[key][e.value.id]?.revision ?? 0) + 1)
    throw new Error('mobility-revision-gap');
  // The event carries the final facts. No decisions or time reads during replay.
  switch (e.type) {
    case 'VehicleChanged':
      return { ...s, vehicles: { ...s.vehicles, [e.value.id]: e.value } };
    case 'DriverChanged':
      return { ...s, drivers: { ...s.drivers, [e.value.id]: e.value } };
    case 'RideChanged':
      return { ...s, rides: { ...s.rides, [e.value.id]: e.value } };
    case 'RideQuoteChanged':
      return { ...s, quotes: { ...s.quotes, [e.value.id]: e.value } };
  }
}
export function advanceMobility(s: MobilityState, at: number, p: MobilityPorts): MobilityDecision {
  const events: MobilityEvent[] = [],
    fares: FareEffect[] = [];
  for (const v of Object.values(s.vehicles).sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    const j = v.journey;
    if (!j || j.arrivesAt > at || j.people.some((id) => p.location(id) !== j.to || !p.idle(id)))
      continue;
    const parked = { ...v };
    delete parked.journey;
    events.push({
      type: 'VehicleChanged',
      value: { ...parked, locationId: j.to, revision: v.revision + 1 },
    });
    const r = Object.values(s.rides).find((r) => r.vehicleId === v.id && assignedRide(r));
    if (r?.status === 'riding') {
      events.push(rideEvent(r, j.arrivesAt, { status: 'completed' }));
      fares.push({ kind: 'pay', ride: r });
    } else if (r?.status === 'pickup' && r.expiresAt > at)
      events.push(rideEvent(r, j.arrivesAt, { status: 'ready' }));
  }
  for (const r of Object.values(s.rides).sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    if (!activeRide(r) || r.status === 'riding' || r.expiresAt > at) continue;
    events.push(rideEvent(r, r.expiresAt, { status: 'cancelled', endReason: 'deadline-expired' }));
    if (r.driverId) fares.push({ kind: 'refund', ride: r });
  }
  return yes(events, fares);
}
export function nextMobilityBoundary(
  s: MobilityState | undefined,
  now: number,
): number | undefined {
  if (!s) return undefined;
  const values = [
    ...Object.values(s.vehicles).map((v) => v.journey?.arrivesAt),
    ...Object.values(s.rides)
      .filter((r) => activeRide(r) && r.status !== 'riding')
      .map((r) => r.expiresAt),
  ].filter((n): n is number => n !== undefined && n > now);
  return values.length ? Math.min(...values) : undefined;
}
