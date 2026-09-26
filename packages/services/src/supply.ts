import type {
  Booking,
  ProviderShift,
  Service,
  ServicesPorts,
  ServicesState,
  ServiceSlot,
} from './model';

export const SERVICE_SUPPLY_VERSION = 'service-supply-v1';
export function providerOverlap(slot: ServiceSlot, start: number, end: number): number {
  const intervals = (slot.providers ?? [])
    .map((p) => [Math.max(start, p.startedAt), Math.min(end, p.endedAt ?? p.until)] as const)
    .filter(([a, b]) => a < b)
    .sort(([a], [b]) => a - b);
  let total = 0,
    coveredUntil = start;
  for (const [a, b] of intervals) {
    total += Math.max(0, b - Math.max(a, coveredUntil));
    coveredUntil = Math.max(coveredUntil, b);
  }
  return total;
}
export function servingProviders(slot: ServiceSlot, at: number): readonly ProviderShift[] {
  return (slot.providers ?? []).filter((p) => p.startedAt <= at && (p.endedAt ?? p.until) > at);
}
export function serviceSupply(s: ServicesState, slot: ServiceSlot, at: number, p: ServicesPorts) {
  const service = s.services[slot.serviceId]!;
  const providers = servingProviders(slot, at);
  const nominal = Math.min(
    service.capacity,
    slot.capacity,
    p.locationCapacity(service.locationId) ?? 0,
  );
  const staffed =
    s.policy.version === 'resident-services-v3' && service.participationMode === 'hosted';
  const capacity =
    !service.active || !slot.active || at < slot.start || at >= slot.end
      ? 0
      : staffed
        ? Math.min(nominal, providers.length * (service.unitsPerProvider ?? 1))
        : nominal;
  const attending = Object.values(s.bookings).filter(
    (b) =>
      b.slotId === slot.id &&
      b.status === 'checked-in' &&
      (b.checkedInAt ?? slot.start) <= at &&
      (b.attendingUntil ?? slot.end) > at,
  );
  const occupied = attending.reduce((n, b) => n + b.units, 0);
  return {
    version: SERVICE_SUPPLY_VERSION,
    observedAt: at,
    capacityBasis: staffed ? 'actual-provider-time' : 'declared-capacity',
    nominalCapacity: nominal,
    capacity,
    occupied,
    available: Math.max(0, capacity - occupied),
    activeProviderCount: providers.length,
    nextChangeAt:
      at < slot.start
        ? slot.start
        : at >= slot.end
          ? null
          : Math.min(
              slot.end,
              ...providers.map((v) => v.until),
              ...attending.map((b) => b.attendingUntil ?? slot.end),
            ),
  };
}
/** Check every capacity boundary over the requested interval, including departures mid-session. */
export function canSupplyAttendance(
  s: ServicesState,
  slot: ServiceSlot,
  b: Pick<Booking, 'units'>,
  start: number,
  end: number,
  p: ServicesPorts,
): boolean {
  const boundaries = new Set([start]);
  for (const provider of slot.providers ?? []) {
    boundaries.add(provider.startedAt);
    boundaries.add(provider.endedAt ?? provider.until);
  }
  for (const other of Object.values(s.bookings))
    if (other.slotId === slot.id && other.status === 'checked-in') {
      boundaries.add(other.checkedInAt ?? slot.start);
      boundaries.add(other.attendingUntil ?? slot.end);
    }
  return [...boundaries]
    .filter((at) => at >= start && at < end)
    .every((at) => {
      const supply = serviceSupply(s, slot, at, p);
      return supply.capacity - supply.occupied >= b.units;
    });
}
export function canProvide(service: Service, actorId: string, p: ServicesPorts): boolean {
  if (service.enterpriseId === undefined) return service.ownerId === actorId;
  return (
    (service.ownerId === actorId &&
      p.controlsEnterprise?.(actorId, service.enterpriseId) === true) ||
    p.employedBy?.(actorId, service.enterpriseId) === true
  );
}
export function personalProviderOverlap(
  slot: ServiceSlot,
  actorId: string,
  start: number,
  end: number,
): number {
  return providerOverlap(
    { ...slot, providers: slot.providers?.filter((v) => v.residentId === actorId) ?? [] },
    start,
    end,
  );
}
