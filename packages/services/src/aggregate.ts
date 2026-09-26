import { decideStaffing } from './staffing';
import { canSupplyAttendance, providerOverlap, servingProviders } from './supply';
import {
  assertServicesPolicy,
  type ServicesState,
  type ServicesCommand,
  type ServicesPorts,
  type ServicesEvent,
  type ServiceSlot,
  type Booking,
} from './model';
/** Sweep half-open intervals: ending capacity is released before simultaneous starts. */
function available(
  s: ServicesState,
  slot: ServiceSlot,
  units: number,
  ports: ServicesPorts,
): boolean {
  const service = s.services[slot.serviceId]!;
  const locationCapacity = ports.locationCapacity(service.locationId);
  if (locationCapacity === undefined) return false;
  const occupied = Object.values(s.bookings)
    .filter((b) => ['accepted', 'checked-in'].includes(b.status))
    .map((b) => ({ b, t: s.slots[b.slotId]! }))
    .filter(({ t }) => t.start < slot.end && t.end > slot.start);
  for (const scope of ['service', 'location'] as const) {
    const entries = occupied.filter(({ t }) =>
      scope === 'service'
        ? t.serviceId === service.id
        : s.services[t.serviceId]?.locationId === service.locationId,
    );
    const points: [number, number][] = [
      [slot.start, units],
      [slot.end, -units],
    ];
    for (const { b, t } of entries)
      points.push([Math.max(t.start, slot.start), b.units], [Math.min(t.end, slot.end), -b.units]);
    let n = 0;
    for (const [, delta] of points.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
      n += delta;
      if (n > (scope === 'service' ? service.capacity : locationCapacity)) return false;
    }
  }
  return (
    units + occupied.filter(({ t }) => t.id === slot.id).reduce((n, { b }) => n + b.units, 0) <=
    slot.capacity
  );
}
export function decideServices(
  s: ServicesState,
  a: string,
  at: number,
  c: ServicesCommand,
  p: ServicesPorts,
):
  | {
      accepted: true;
      events: readonly ServicesEvent[];
      releases?: readonly { residentId: string; startedAt: number; expectedUntil: number }[];
      release?: { residentId: string; startedAt: number; expectedUntil: number };
      participation?: { residentId: string; locationId: string; until: number; bookingId: string };
    }
  | { accepted: false; reason: string } {
  assertServicesPolicy(s.policy);
  const no = (reason: string) => ({ accepted: false as const, reason });
  const yes = (...events: ServicesEvent[]) => ({ accepted: true as const, events });
  const int = (n: number) => Number.isSafeInteger(n) && n > 0;
  if (!p.exists(a) || !Number.isSafeInteger(at) || at < 0) return no('invalid-actor-or-time');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(c.id) || c.id === 'constructor')
    return no('invalid-id');
  if (c.type === 'stop-session') {
    if (s.policy.version !== 'resident-services-v3') return no('staffing-policy-required');
    return decideStaffing(s, a, at, c, p);
  }
  if (c.type === 'publish') {
    const cap = p.locationCapacity(c.locationId);
    if (
      Object.hasOwn(s.services, c.id) ||
      !int(c.capacity) ||
      c.capacity > s.policy.maxCapacity ||
      cap === undefined ||
      c.capacity > cap ||
      !c.title.trim() ||
      c.title.length > 120 ||
      !c.description.trim() ||
      c.description.length > s.policy.maxText
    )
      return no('invalid-service');
    if (
      c.kind === 'transport' &&
      (!c.destinationId ||
        c.destinationId === c.locationId ||
        p.locationCapacity(c.destinationId) === undefined)
    )
      return no('transport-destination-required');
    if (c.kind === 'lodging' && c.capacity > 1) return no('lodging-capacity-one-per-offer');
    if (
      c.participationMode !== undefined &&
      (!['hosted', 'self-service'].includes(c.participationMode) ||
        (c.kind === 'course' && c.participationMode !== 'hosted'))
    )
      return no('invalid-participation-mode');
    const mode =
      c.participationMode ??
      (['appointment', 'course'].includes(c.kind) ? 'hosted' : 'self-service');
    if (
      (c.unitsPerProvider !== undefined || c.enterpriseId !== undefined) &&
      s.policy.version !== 'resident-services-v3'
    )
      return no('staffing-policy-required');
    if (
      c.unitsPerProvider !== undefined &&
      (!int(c.unitsPerProvider) || c.unitsPerProvider > s.policy.maxCapacity || mode !== 'hosted')
    )
      return no('invalid-provider-capacity');
    if (
      c.enterpriseId !== undefined &&
      (mode !== 'hosted' || p.controlsEnterprise?.(a, c.enterpriseId) !== true)
    )
      return no('enterprise-owner-required');
    const { type: _type, ...service } = c;
    void _type;
    return yes({
      type: 'ServiceChanged',
      service: {
        ...service,
        ownerId: a,
        revision: 1,
        active: true,
        ...(s.policy.version === 'resident-services-v3' && mode === 'hosted'
          ? { unitsPerProvider: c.unitsPerProvider ?? 1 }
          : {}),
        ...(s.policy.version !== 'resident-services-v1'
          ? {
              participationMode:
                c.participationMode ??
                (['appointment', 'course'].includes(c.kind)
                  ? ('hosted' as const)
                  : ('self-service' as const)),
            }
          : {}),
      },
    });
  }
  if (c.type === 'start-session') {
    if (s.policy.version === 'resident-services-v3') return decideStaffing(s, a, at, c, p);
    const slot = s.slots[c.id],
      service = slot ? s.services[slot.serviceId] : undefined;
    if (
      !slot ||
      !service ||
      (s.policy.version === 'resident-services-v1'
        ? service.kind !== 'course'
        : service.participationMode !== 'hosted') ||
      service.ownerId !== a ||
      slot.revision !== c.expectedRevision ||
      slot.startedAt !== undefined ||
      at < slot.start ||
      at >= slot.end ||
      !p.presentAndIdle(a, service.locationId)
    )
      return no('teacher-session-requires-time-location-and-idle');
    const until = c.until ?? slot.end;
    if (!Number.isSafeInteger(until) || until <= at || until > slot.end)
      return no('invalid-participation-end');
    return {
      ...yes({
        type: 'ServiceSlotChanged',
        slot: {
          ...slot,
          revision: slot.revision + 1,
          startedAt: at,
          ...(s.policy.version !== 'resident-services-v1' ? { providerUntil: until } : {}),
        },
      }),
      participation: {
        residentId: a,
        locationId: service.locationId,
        until,
        bookingId: '',
      },
    };
  }
  if (c.type === 'schedule') {
    const service = s.services[c.serviceId];
    if (!service?.active || service.ownerId !== a) return no('active-service-owner-required');
    if (
      Object.hasOwn(s.slots, c.id) ||
      !Number.isSafeInteger(c.start) ||
      !Number.isSafeInteger(c.end) ||
      c.start < at ||
      c.end <= c.start ||
      !int(c.capacity) ||
      c.capacity > service.capacity
    )
      return no('invalid-slot');
    return yes({
      type: 'ServiceSlotChanged',
      slot: {
        id: c.id,
        serviceId: c.serviceId,
        start: c.start,
        end: c.end,
        capacity: c.capacity,
        revision: 1,
        active: true,
      },
    });
  }
  if (c.type === 'close') {
    const service = s.services[c.id];
    if (!service || service.ownerId !== a) return no('owner-required');
    if (service.revision !== c.expectedRevision) return no('revision-conflict');
    if (
      Object.values(s.bookings).some(
        (b) =>
          s.slots[b.slotId]?.serviceId === service.id &&
          ['accepted', 'checked-in'].includes(b.status),
      )
    )
      return no('outstanding-bookings');
    return yes({
      type: 'ServiceChanged',
      service: { ...service, active: false, revision: service.revision + 1 },
    });
  }
  if (c.type === 'join') {
    if (!s.services[c.serviceId]?.active || Object.hasOwn(s.queues, c.id))
      return no('invalid-service-or-queue-id');
    if (
      Object.values(s.queues).some(
        (q) => q.serviceId === c.serviceId && q.residentId === a && q.status === 'waiting',
      )
    )
      return no('already-queued');
    return yes({
      type: 'QueueEntryChanged',
      entry: {
        id: c.id,
        serviceId: c.serviceId,
        residentId: a,
        sequence: s.sequence + 1,
        status: 'waiting',
        at,
      },
    });
  }
  if ((c.type === 'leave' && !('expectedRevision' in c)) || c.type === 'call') {
    const q = s.queues[c.id];
    if (!q || q.status !== 'waiting') return no('queue-not-waiting');
    if (c.type === 'leave') {
      if (q.residentId !== a) return no('queue-not-yours');
      return yes({ type: 'QueueEntryChanged', entry: { ...q, status: 'left' } });
    }
    const slot = s.slots[c.slotId];
    if (s.services[q.serviceId]?.ownerId !== a || slot?.serviceId !== q.serviceId)
      return no('queue-owner-slot-required');
    const first = Object.values(s.queues)
      .filter((v) => v.serviceId === q.serviceId && v.status === 'waiting')
      .sort((a, b) => a.sequence - b.sequence)[0];
    if (first?.id !== q.id) return no('queue-order-required');
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(c.bookingId) ||
      Object.hasOwn(s.bookings, c.bookingId) ||
      at >= slot.end ||
      !available(s, slot, 1, p)
    )
      return no('slot-unavailable');
    // Calling offers a place. The queued resident still requests/accepts attendance by check-in.
    return yes(
      { type: 'QueueEntryChanged', entry: { ...q, status: 'called' } },
      {
        type: 'BookingChanged',
        booking: {
          id: c.bookingId,
          slotId: slot.id,
          residentId: q.residentId,
          units: 1,
          revision: 1,
          status: 'accepted',
          at,
        },
      },
    );
  }
  if (c.type === 'request') {
    const slot = s.slots[c.slotId];
    if (
      !slot?.active ||
      !s.services[slot.serviceId]?.active ||
      at >= slot.end ||
      !int(c.units) ||
      c.units > slot.capacity ||
      Object.hasOwn(s.bookings, c.id)
    )
      return no('invalid-booking');
    if (
      Object.values(s.bookings).some(
        (b) =>
          b.slotId === slot.id &&
          b.residentId === a &&
          !(
            s.policy.version === 'resident-services-v3'
              ? ['cancelled', 'expired', 'ended', 'completed']
              : ['cancelled', 'expired']
          ).includes(b.status),
      )
    )
      return no('duplicate-booking');
    return yes({
      type: 'BookingChanged',
      booking: {
        id: c.id,
        slotId: slot.id,
        residentId: a,
        units: c.units,
        revision: 1,
        status: 'requested',
        at,
      },
    });
  }
  const b = s.bookings[c.id];
  if (!b) return no('booking-not-found');
  const slot = s.slots[b.slotId]!,
    service = s.services[slot.serviceId]!;
  if (a !== b.residentId && a !== service.ownerId) return no('booking-not-yours');
  if (b.revision !== c.expectedRevision) return no('revision-conflict');
  let next: Booking = { ...b, revision: b.revision + 1 };
  if (c.type === 'leave') {
    if (service.kind === 'transport') return no('journey-cannot-be-ended-by-attendance');
    if (
      s.policy.version === 'resident-services-v1' ||
      a !== b.residentId ||
      b.status !== 'checked-in' ||
      b.checkedInAt === undefined ||
      b.attendingUntil === undefined ||
      at >= b.attendingUntil
    )
      return no('active-personal-attendance-required');
    return {
      ...yes({
        type: 'BookingChanged',
        booking: {
          ...next,
          status: 'ended',
          endedAt: at,
          attendingUntil: at,
          attendedMs: at - b.checkedInAt,
          providerOverlapMs:
            s.policy.version === 'resident-services-v3'
              ? providerOverlap(slot, b.checkedInAt, at)
              : slot.startedAt === undefined
                ? 0
                : Math.max(
                    0,
                    Math.min(at, slot.providerUntil ?? slot.end) -
                      Math.max(b.checkedInAt, slot.startedAt),
                  ),
        },
      }),
      release: { residentId: a, startedAt: b.checkedInAt, expectedUntil: b.attendingUntil },
    };
  }
  if (c.type === 'accept') {
    if (
      a !== service.ownerId ||
      b.status !== 'requested' ||
      !service.active ||
      at >= slot.end ||
      !available(s, slot, b.units, p)
    )
      return no('slot-unavailable-or-owner-required');
    next.status = 'accepted';
  } else if (c.type === 'cancel') {
    if (!['requested', 'accepted'].includes(b.status)) return no('booking-cannot-cancel');
    next.status = 'cancelled';
  } else {
    if (
      a !== b.residentId ||
      b.status !== 'accepted' ||
      at < slot.start ||
      at >= slot.end ||
      !p.presentAndIdle(a, service.locationId)
    )
      return no('check-in-requires-time-location-and-idle');
    if (service.kind === 'course' && slot.startedAt === undefined)
      return no('teacher-session-not-started');
    const v2 = s.policy.version !== 'resident-services-v1';
    if (
      s.policy.version === 'resident-services-v2' &&
      service.participationMode === 'hosted' &&
      (slot.startedAt === undefined || (slot.providerUntil ?? slot.end) <= at)
    )
      return no('provider-session-not-active');
    const staffed =
      s.policy.version === 'resident-services-v3' && service.participationMode === 'hosted';
    const latest = staffed
      ? Math.min(slot.end, Math.max(at, ...servingProviders(slot, at).map((v) => v.until)))
      : v2 && service.participationMode === 'hosted'
        ? Math.min(slot.end, slot.providerUntil ?? slot.end)
        : slot.end;
    if (staffed && latest <= at) return no('provider-session-not-active');
    const until = c.until ?? latest;
    if (!Number.isSafeInteger(until) || until <= at || until > latest)
      return no('invalid-participation-end');
    if (staffed && !canSupplyAttendance(s, slot, b, at, until, p))
      return no('insufficient-provider-capacity');
    next = {
      ...next,
      status: 'checked-in',
      checkedInAt: at,
      ...(v2 ? { attendingUntil: until } : {}),
    };
    return {
      ...yes({ type: 'BookingChanged', booking: next }),
      participation: {
        residentId: a,
        locationId: service.locationId,
        until,
        bookingId: b.id,
      },
    };
  }
  return yes({ type: 'BookingChanged', booking: next });
}
export function advanceServices(s: ServicesState, at: number): ServicesEvent[] {
  const end = (b: Booking) => b.attendingUntil ?? s.slots[b.slotId]!.end;
  return Object.values(s.bookings)
    .filter((b) => ['requested', 'accepted', 'checked-in'].includes(b.status) && end(b) <= at)
    .sort((a, b) => end(a) - end(b) || a.id.localeCompare(b.id, 'en'))
    .map((b) => {
      const slot = s.slots[b.slotId]!;
      const v2 = s.policy.version !== 'resident-services-v1';
      const participated = b.status === 'checked-in';
      const endedAt = end(b);
      return {
        type: 'BookingChanged',
        booking: {
          ...b,
          status: participated ? (v2 ? 'ended' : 'completed') : 'expired',
          revision: b.revision + 1,
          ...(v2
            ? {
                endedAt,
                attendedMs: participated ? endedAt - b.checkedInAt! : 0,
                providerOverlapMs:
                  s.policy.version === 'resident-services-v3' && participated
                    ? providerOverlap(slot, b.checkedInAt!, endedAt)
                    : participated && slot.startedAt !== undefined
                      ? Math.max(
                          0,
                          Math.min(endedAt, slot.providerUntil ?? slot.end) -
                            Math.max(b.checkedInAt!, slot.startedAt),
                        )
                      : 0,
              }
            : {}),
        },
      };
    });
}
