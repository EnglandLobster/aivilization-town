import type { ServicesState, ServicesEvent } from './model';
import { sameServiceControlFacts } from './servicePrincipalFacts';
export type ServiceRecordEvent = Extract<
  ServicesEvent,
  { type: 'ServiceChanged' | 'ServiceSlotChanged' | 'BookingChanged' | 'QueueEntryChanged' }
>;
/** Internal fact application; callers must validate the appropriate command or principal envelope first. */
export function applyServiceRecordEvent(s: ServicesState, e: ServiceRecordEvent): ServicesState {
  const revision = (previous: number | undefined, next: number) => {
    if ((previous ?? 0) + 1 !== next) throw new Error('services-revision-gap');
  };
  switch (e.type) {
    case 'ServiceChanged':
      if (e.service.active && s.policyTransition?.retiredServiceIds.includes(e.service.id))
        throw new Error('legacy-service-republication-required');
      if (
        !sameServiceControlFacts(s.services[e.service.id], e.service) ||
        (s.controlPolicy &&
          s.services[e.service.id] &&
          s.services[e.service.id]!.ownerId !== e.service.ownerId)
      )
        throw Error('service-control-event-required');
      revision(s.services[e.service.id]?.revision, e.service.revision);
      if (
        !s.services[e.service.id] &&
        s.registration &&
        (!Number.isSafeInteger(s.registration.revision + 1) ||
          Object.keys(s.services).length >= s.registration.policy.maxRegisteredServices)
      )
        throw Error('service-directory-registration-limit');
      return {
        ...s,
        ...(!s.services[e.service.id] && s.registration
          ? { registration: { ...s.registration, revision: s.registration.revision + 1 } }
          : {}),
        services: { ...s.services, [e.service.id]: e.service },
      };
    case 'ServiceSlotChanged':
      revision(s.slots[e.slot.id]?.revision, e.slot.revision);
      return { ...s, slots: { ...s.slots, [e.slot.id]: e.slot } };
    case 'BookingChanged':
      revision(s.bookings[e.booking.id]?.revision, e.booking.revision);
      return { ...s, bookings: { ...s.bookings, [e.booking.id]: e.booking } };
    case 'QueueEntryChanged':
      if (!s.queues[e.entry.id] && e.entry.sequence !== s.sequence + 1)
        throw new Error('queue-sequence-gap');
      return {
        ...s,
        sequence: Math.max(s.sequence, e.entry.sequence),
        queues: { ...s.queues, [e.entry.id]: e.entry },
      };
  }
}
