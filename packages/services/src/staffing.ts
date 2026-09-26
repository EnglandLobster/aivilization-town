import type { ServicesCommand, ServicesEvent, ServicesPorts, ServicesState } from './model';
import { canProvide, providerOverlap, servingProviders, canSupplyAttendance } from './supply';

export function decideStaffing(
  s: ServicesState,
  actorId: string,
  at: number,
  c: Extract<ServicesCommand, { type: 'close' | 'start-session' | 'stop-session' }>,
  p: ServicesPorts,
) {
  const no = (reason: string) => ({ accepted: false as const, reason });
  const slot = s.slots[c.id];
  const service = slot && s.services[slot.serviceId];
  if (!slot || !service || service.participationMode !== 'hosted')
    return no('hosted-slot-required');
  if (slot.revision !== c.expectedRevision) return no('revision-conflict');
  if (at < slot.start || at >= slot.end) return no('slot-not-active-now');
  if (c.type === 'start-session') {
    if (!service.active || !slot.active || !canProvide(service, actorId, p))
      return no('service-provider-required');
    if (!p.presentAndIdle(actorId, service.locationId))
      return no('provider-requires-location-and-idle');
    const until = c.until ?? slot.end;
    if (!Number.isSafeInteger(until) || until <= at || until > slot.end)
      return no('invalid-participation-end');
    if (servingProviders(slot, at).some((v) => v.residentId === actorId))
      return no('provider-already-serving');
    if ((slot.providers?.length ?? 0) >= s.policy.maxProviderShiftsPerSlot!)
      return no('slot-provider-history-limit');
    const events: ServicesEvent[] = [
      {
        type: 'ServiceSlotChanged',
        slot: {
          ...slot,
          revision: slot.revision + 1,
          startedAt: slot.startedAt ?? at,
          providers: [...(slot.providers ?? []), { residentId: actorId, startedAt: at, until }],
        },
      },
    ];
    return {
      accepted: true as const,
      events,
      participation: { residentId: actorId, locationId: service.locationId, until, bookingId: '' },
    };
  }
  const own = servingProviders(slot, at).find((v) => v.residentId === actorId);
  if (!own) return no('own-active-provider-shift-required');
  const nextSlot = {
    ...slot,
    revision: slot.revision + 1,
    providers: slot.providers!.map((v) => (v === own ? { ...v, endedAt: at } : v)),
  };
  const next = { ...s, slots: { ...s.slots, [slot.id]: nextSlot } };
  const events: ServicesEvent[] = [{ type: 'ServiceSlotChanged', slot: nextSlot }];
  const releases = [{ residentId: actorId, startedAt: own.startedAt, expectedUntil: own.until }];
  const latest = Math.max(
    at,
    ...Object.values(s.bookings)
      .filter((b) => b.slotId === slot.id && b.status === 'checked-in')
      .map((b) => b.attendingUntil ?? slot.end),
  );
  if (!canSupplyAttendance(next, nextSlot, { units: 0 }, at, latest, p)) {
    for (const b of Object.values(s.bookings)
      .filter(
        (v) =>
          v.slotId === slot.id &&
          v.status === 'checked-in' &&
          v.checkedInAt !== undefined &&
          (v.attendingUntil ?? slot.end) > at,
      )
      .sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
      events.push({
        type: 'BookingChanged',
        booking: {
          ...b,
          revision: b.revision + 1,
          status: 'ended',
          attendingUntil: at,
          endedAt: at,
          attendedMs: at - b.checkedInAt!,
          providerOverlapMs: providerOverlap(nextSlot, b.checkedInAt!, at),
          endReason: 'staffing-interrupted',
        },
      });
      releases.push({
        residentId: b.residentId,
        startedAt: b.checkedInAt!,
        expectedUntil: b.attendingUntil ?? slot.end,
      });
    }
  }
  return { accepted: true as const, events, releases };
}
