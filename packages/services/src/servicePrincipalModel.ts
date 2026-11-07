import {
  RESOURCE_PRINCIPAL_POLICY,
  type PrincipalControlChanged,
  type PrincipalAuthorization,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import type { ServicesCommand, ServicesEvent, ServicesState } from './model';
export const SERVICE_PRINCIPALS_POLICY = {
  version: 'resident-service-principals-v2',
  control: RESOURCE_PRINCIPAL_POLICY,
  maxProviders: 128,
} as const;
export const INDEPENDENT_SERVICE_PRINCIPALS_POLICY = {
  ...SERVICE_PRINCIPALS_POLICY,
  version: 'resident-service-principals-v3',
} as const;
export type ServicePrincipalsPolicy =
  | typeof SERVICE_PRINCIPALS_POLICY
  | typeof INDEPENDENT_SERVICE_PRINCIPALS_POLICY;
export type ServiceAdministrativeCommand =
  | Extract<ServicesCommand, { type: 'schedule' | 'call' }>
  | {
      [K in 'close' | 'accept' | 'cancel']: {
        readonly type: K;
        readonly id: string;
        readonly expectedRevision: number;
      };
    }['close' | 'accept' | 'cancel'];
export type ServicePrincipalProviderCommand = {
  readonly type: 'services.authorize-provider' | 'services.revoke-provider';
  readonly id: string;
  readonly expectedRevision: number;
  readonly residentId: string;
};
export type ServicePrincipalEvent =
  | {
      readonly type: 'ServicePrincipalAuthoritySeparated';
      readonly previousVersion: typeof SERVICE_PRINCIPALS_POLICY.version;
      readonly policy: typeof INDEPENDENT_SERVICE_PRINCIPALS_POLICY;
    }
  | { readonly type: 'ServicePrincipalsEnabled'; readonly policy: ServicePrincipalsPolicy }
  | {
      readonly type: 'ServicePrincipalControlChanged';
      readonly serviceId: string;
      readonly previousRevision: number;
      readonly change: PrincipalControlChanged;
      readonly inheritedProviders?: readonly string[];
      readonly affiliationAuthorization?: PrincipalAuthorization;
    }
  | {
      readonly type: 'ServicePrincipalOperationCommitted';
      readonly serviceId: string;
      readonly previousRevision: number;
      readonly at: number;
      readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
      readonly events: readonly Extract<
        ServicesEvent,
        { type: 'ServiceChanged' | 'ServiceSlotChanged' | 'BookingChanged' | 'QueueEntryChanged' }
      >[];
      readonly capacityProof?: { readonly locationId: string; readonly capacity: number };
      readonly providers?: readonly string[];
    };
export function serviceAdministrativeSubject(
  s: ServicesState,
  c: ServiceAdministrativeCommand,
): string | undefined {
  if (c.type === 'schedule') return c.serviceId;
  if (c.type === 'close') return c.id;
  if (c.type === 'call') return s.queues[c.id]?.serviceId;
  return s.slots[s.bookings[c.id]?.slotId ?? '']?.serviceId;
}
export function serviceAdministrativeRequest(
  s: ServicesState,
  c: ServiceAdministrativeCommand,
): PrincipalOperationRequest {
  const serviceId = serviceAdministrativeSubject(s, c),
    v = serviceId ? s.services[serviceId] : undefined;
  if (!v?.control || v.control.policyVersion !== 'resource-principals-v2')
    throw Error('service-principal-control-required');
  const capability =
    c.type === 'accept' || c.type === 'cancel'
      ? `bookings.${c.type}`
      : c.type === 'call'
        ? 'queues.call'
        : `services.${c.type}`;
  return {
    resourceKind: 'service',
    resourceId: v.id,
    resourceRevision: v.revision,
    controlVersion: v.control.version,
    operation: { capability, arguments: { command: structuredClone(c) } },
  };
}
export function serviceProviderRequest(
  s: ServicesState,
  c: ServicePrincipalProviderCommand,
): PrincipalOperationRequest {
  const v = s.services[c.id];
  if (!v?.control || v.control.policyVersion !== 'resource-principals-v2')
    throw Error('service-principal-control-required');
  return {
    resourceKind: 'service',
    resourceId: v.id,
    resourceRevision: c.expectedRevision,
    controlVersion: v.control.version,
    operation: { capability: c.type, arguments: structuredClone(c) },
  };
}
