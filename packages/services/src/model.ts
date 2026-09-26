export const SERVICES_POLICY = {
  version: 'resident-services-v1',
  maxCapacity: 100,
  maxText: 8000,
} as const;
export const CONTINUOUS_SERVICES_POLICY = {
  ...SERVICES_POLICY,
  version: 'resident-services-v2',
} as const;
export const STAFFED_SERVICES_POLICY = {
  ...CONTINUOUS_SERVICES_POLICY,
  version: 'resident-services-v3',
  maxProviderShiftsPerSlot: 1000,
} as const;
export type ServicesPolicy = {
  version: 'resident-services-v1' | 'resident-services-v2' | 'resident-services-v3';
  maxCapacity: number;
  maxText: number;
  maxProviderShiftsPerSlot?: number;
};
export function assertServicesPolicy(p: ServicesPolicy) {
  if (
    !['resident-services-v1', 'resident-services-v2', 'resident-services-v3'].includes(p.version) ||
    (p.version === 'resident-services-v3' &&
      (!Number.isSafeInteger(p.maxProviderShiftsPerSlot) ||
        (p.maxProviderShiftsPerSlot ?? 0) < 1)) ||
    [p.maxCapacity, p.maxText].some((n) => !Number.isSafeInteger(n) || n < 1)
  )
    throw new Error('invalid-services-policy');
}
export type ServiceKind = 'appointment' | 'course' | 'event' | 'transport' | 'lodging';
export type Service = {
  id: string;
  ownerId: string;
  kind: ServiceKind;
  locationId: string;
  destinationId?: string;
  enterpriseId?: string;
  unitsPerProvider?: number;
  participationMode?: 'hosted' | 'self-service';
  title: string;
  description: string;
  capacity: number;
  revision: number;
  active: boolean;
};
export type ProviderShift = {
  residentId: string;
  startedAt: number;
  until: number;
  endedAt?: number;
};
export type ServiceSlot = {
  id: string;
  serviceId: string;
  start: number;
  end: number;
  capacity: number;
  revision: number;
  active: boolean;
  startedAt?: number;
  providerUntil?: number;
  providers?: readonly ProviderShift[];
};
export type Booking = {
  id: string;
  slotId: string;
  residentId: string;
  units: number;
  revision: number;
  status: 'requested' | 'accepted' | 'checked-in' | 'completed' | 'cancelled' | 'expired' | 'ended';
  at: number;
  checkedInAt?: number;
  attendingUntil?: number;
  endedAt?: number;
  attendedMs?: number;
  providerOverlapMs?: number;
  endReason?: 'staffing-interrupted';
};
export type QueueEntry = {
  id: string;
  serviceId: string;
  residentId: string;
  sequence: number;
  status: 'waiting' | 'left' | 'called';
  at: number;
};
export type ServicesState = {
  policy: ServicesPolicy;
  services: Readonly<Record<string, Service>>;
  slots: Readonly<Record<string, ServiceSlot>>;
  bookings: Readonly<Record<string, Booking>>;
  queues: Readonly<Record<string, QueueEntry>>;
  sequence: number;
};
export type ServicesEvent =
  | { type: 'ServicesEnabled'; policy: ServicesPolicy }
  | { type: 'ServiceChanged'; service: Service }
  | { type: 'ServiceSlotChanged'; slot: ServiceSlot }
  | { type: 'BookingChanged'; booking: Booking }
  | { type: 'QueueEntryChanged'; entry: QueueEntry };
export type ServicesCommand =
  | {
      type: 'publish';
      id: string;
      kind: ServiceKind;
      locationId: string;
      destinationId?: string;
      enterpriseId?: string;
      unitsPerProvider?: number;
      participationMode?: 'hosted' | 'self-service';
      title: string;
      description: string;
      capacity: number;
    }
  | {
      type: 'schedule';
      id: string;
      serviceId: string;
      start: number;
      end: number;
      capacity: number;
    }
  | {
      type: 'close' | 'start-session' | 'stop-session';
      id: string;
      expectedRevision: number;
      until?: number;
    }
  | { type: 'request'; id: string; slotId: string; units: number }
  | {
      type: 'accept' | 'cancel' | 'check-in' | 'leave';
      id: string;
      expectedRevision: number;
      until?: number;
    }
  | { type: 'join'; id: string; serviceId: string }
  | { type: 'leave'; id: string }
  | { type: 'call'; id: string; slotId: string; bookingId: string };
export type ServicesPorts = {
  exists: (id: string) => boolean;
  controlsEnterprise?: (actorId: string, enterpriseId: string) => boolean;
  employedBy?: (actorId: string, enterpriseId: string) => boolean;
  locationCapacity: (id: string) => number | undefined;
  presentAndIdle: (residentId: string, locationId: string) => boolean;
};
export function emptyServicesState(policy: ServicesPolicy = SERVICES_POLICY): ServicesState {
  assertServicesPolicy(policy);
  return { policy, services: {}, slots: {}, bookings: {}, queues: {}, sequence: 0 };
}
export function applyServicesEvent(s: ServicesState | undefined, e: ServicesEvent): ServicesState {
  if (e.type === 'ServicesEnabled') {
    if (s) throw new Error('services-already-enabled');
    return emptyServicesState(e.policy);
  }
  if (!s) throw new Error('services-not-enabled');
  const revision = (previous: number | undefined, next: number) => {
    if ((previous ?? 0) + 1 !== next) throw new Error('services-revision-gap');
  };
  switch (e.type) {
    case 'ServiceChanged':
      revision(s.services[e.service.id]?.revision, e.service.revision);
      return { ...s, services: { ...s.services, [e.service.id]: e.service } };
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
