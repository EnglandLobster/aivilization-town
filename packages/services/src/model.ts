import { applyServicePolicyUpgrade, type ServicePolicyUpgradeEvent } from './policyTransition';
import { applyServiceSupplyRelationEvent } from './serviceSupplyRelations';
import type {
  ServiceSupplyRelation,
  ServiceSupplyRelationEvent,
  ServiceSupplyRelationPolicy,
} from './serviceSupplyRelationModel';
import { applyServiceAffiliationEvent } from './serviceAffiliation';
import type { ServiceAffiliationEvent, ServiceAffiliations } from './serviceAffiliationModel';
import { applyServicePrincipalEvent } from './servicePrincipals';
import { applyServiceSupplyEvent } from './serviceSupply';
import type { ServiceSupplyEvent, ServiceDirectoryRegistration } from './serviceSupplyModel';
import type { ServicePrincipalEvent, ServicePrincipalsPolicy } from './servicePrincipalModel';
import {
  type ResourceControl,
  type PrincipalControl,
  type PrincipalAuthorization,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import type { ServiceControlEvent, ServiceControlPolicy } from './serviceControlModel';
import { applyServiceRecordEvent } from './serviceRecordEvents';
import { assertOrdinaryServiceRecord } from './ordinaryServiceRecords';
import { applyServiceControlEvent } from './serviceControl';

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
export const validServiceRecordId = (id: string): boolean =>
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id) && id !== 'constructor';
export type Service = {
  supplyRelation?: ServiceSupplyRelation;
  id: string;
  ownerId: string;
  control?: ResourceControl | PrincipalControl;
  principalAt?: number;
  namedProviders?: readonly string[];
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
  policyTransition?: Omit<ServicePolicyUpgradeEvent, 'type' | 'policy'>;
  affiliations?: ServiceAffiliations;
  relationPolicy?: ServiceSupplyRelationPolicy;
  registration?: ServiceDirectoryRegistration;
  policy: ServicesPolicy;
  controlPolicy?: ServiceControlPolicy;
  principalPolicy?: ServicePrincipalsPolicy;
  services: Readonly<Record<string, Service>>;
  slots: Readonly<Record<string, ServiceSlot>>;
  bookings: Readonly<Record<string, Booking>>;
  queues: Readonly<Record<string, QueueEntry>>;
  sequence: number;
};
export type ServicesEvent =
  | ServicePolicyUpgradeEvent
  | ServiceSupplyRelationEvent
  | ServiceAffiliationEvent
  | ServiceSupplyEvent
  | ServiceControlEvent
  | ServicePrincipalEvent
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
  principalAdministration?: PrincipalAuthorization<PrincipalOperationRequest>;
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
  if (
    e.type === 'ServiceSupplyRelationsEnabled' ||
    e.type === 'ServiceSupplyRelationChanged' ||
    e.type === 'ServiceSupplyPrincipalControlChanged'
  ) {
    if (!s) throw Error('services-not-enabled');
    return applyServiceSupplyRelationEvent(s, e);
  }
  if (
    e.type === 'ServiceAffiliationsEnabled' ||
    e.type === 'ServiceAffiliationConsentApproved' ||
    e.type === 'ServiceAffiliationConsentRevoked' ||
    e.type === 'ServiceAffiliatedPrincipalControlChanged'
  ) {
    if (!s) throw Error('services-not-enabled');
    return applyServiceAffiliationEvent(s, e);
  }
  if (e.type === 'ServicesEnabled') {
    if (s) throw new Error('services-already-enabled');
    return emptyServicesState(e.policy);
  }
  if (!s) throw new Error('services-not-enabled');
  if (e.type === 'ServicePolicyUpgraded') return applyServicePolicyUpgrade(s, e);
  if (
    e.type === 'ServiceSupplyEnabled' ||
    e.type === 'PrincipalServiceCreated' ||
    e.type === 'PrincipalServiceReopened'
  )
    return applyServiceSupplyEvent(s, e);
  if (
    e.type === 'ServicePrincipalsEnabled' ||
    e.type === 'ServicePrincipalAuthoritySeparated' ||
    e.type === 'ServicePrincipalControlChanged' ||
    e.type === 'ServicePrincipalOperationCommitted'
  )
    return applyServicePrincipalEvent(s, e);
  if (e.type === 'ServiceControlEnabled' || e.type === 'ServiceControlChanged')
    return applyServiceControlEvent(s, e);
  assertOrdinaryServiceRecord(s, e);
  return applyServiceRecordEvent(s, e);
}
