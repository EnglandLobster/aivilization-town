import type { Booking, ServicesState } from './model';
import { personallyAdministersService } from './serviceControl';
import { personalProviderOverlap } from './supply';

/** Queries and attention previews share the same current authority and actual participation facts. */
export function canReadServiceBooking(
  state: ServicesState,
  booking: Booking,
  actorId: string,
  at: number,
): boolean {
  const slot = state.slots[booking.slotId];
  if (!slot) return false;
  return (
    booking.residentId === actorId ||
    personallyAdministersService(state.services[slot.serviceId], actorId) ||
    (state.policy.version === 'resident-services-v3' &&
      booking.checkedInAt !== undefined &&
      personalProviderOverlap(
        slot,
        actorId,
        booking.checkedInAt,
        Math.min(at, booking.endedAt ?? booking.attendingUntil ?? slot.end),
      ) > 0)
  );
}
