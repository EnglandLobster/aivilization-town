import { currentServiceEnterprise } from './serviceSupplyRelationFacts';
import type { ServicesState } from './model';

export function serviceDirectoryHasOpenCommitments(
  directory: ServicesState,
  id: string,
  at: number,
): boolean {
  const slots = Object.values(directory.slots).filter((s) => s.serviceId === id);
  const ids = new Set(slots.map((s) => s.id));
  return (
    Object.values(directory.bookings).some(
      (b) => ids.has(b.slotId) && ['requested', 'accepted', 'checked-in'].includes(b.status),
    ) ||
    Object.values(directory.queues).some((q) => q.serviceId === id && q.status === 'waiting') ||
    slots.some((s) =>
      (s.providers ?? []).some((p) => p.startedAt <= at && (p.endedAt ?? p.until) > at),
    )
  );
}

/** Directory control and existing supply commitments survive a manager's departure. */
export function enterpriseServiceEstateIds(
  directory: ServicesState,
  enterpriseId: string,
  at: number,
): readonly string[] {
  return Object.values(directory.services)
    .filter((service) => {
      if (
        service.control?.controller.kind === 'enterprise' &&
        service.control.controller.id === enterpriseId
      )
        return true;
      if (currentServiceEnterprise(service) !== enterpriseId) return false;
      if (service.active) return true;
      return serviceDirectoryHasOpenCommitments(directory, service.id, at);
    })
    .map((s) => s.id)
    .sort();
}
