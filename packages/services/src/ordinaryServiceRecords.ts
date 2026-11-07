import type { ServicesState } from './model';
import type { ServiceRecordEvent } from './serviceRecordEvents';

/** Old records remain readable, but cannot serve as a new organizational management channel. */
export function assertOrdinaryServiceRecord(s: ServicesState, e: ServiceRecordEvent): void {
  const id =
    e.type === 'ServiceChanged'
      ? e.service.id
      : e.type === 'ServiceSlotChanged'
        ? e.slot.serviceId
        : e.type === 'BookingChanged'
          ? s.slots[e.booking.slotId]?.serviceId
          : e.entry.serviceId;
  if (!id || s.services[id]?.control?.policyVersion !== 'resource-principals-v2') return;
  if (e.type === 'ServiceChanged') throw Error('service-principal-operation-envelope-required');
  if (e.type === 'ServiceSlotChanged') {
    const previous = s.slots[e.slot.id];
    if (
      !previous ||
      (['serviceId', 'start', 'end', 'capacity', 'active'] as const).some(
        (k) => previous[k] !== e.slot[k],
      )
    )
      throw Error('service-principal-operation-envelope-required');
  }
  if (e.type === 'BookingChanged') {
    const previous = s.bookings[e.booking.id];
    if ((!previous || previous.status === 'requested') && e.booking.status === 'accepted')
      throw Error('service-principal-operation-envelope-required');
    if (
      previous &&
      (['slotId', 'residentId', 'units', 'at'] as const).some((k) => previous[k] !== e.booking[k])
    )
      throw Error('service-booking-immutable-terms');
  }
  if (e.type === 'QueueEntryChanged' && e.entry.status === 'called')
    throw Error('service-principal-operation-envelope-required');
}
