import type {
  PrincipalAuthorization,
  PrincipalControlRequest,
  PrincipalOperationRequest,
} from '@aivilization/authority';
import type { ServicePrincipalEvent } from './servicePrincipalModel';
export const SERVICE_AFFILIATION_POLICY = {
  version: 'resident-service-affiliation-v4',
  maxConsentHorizonMs: 30 * 86400000,
} as const;
export type ServiceAffiliationPolicy = typeof SERVICE_AFFILIATION_POLICY;
export type ServiceAffiliationConsent = {
  readonly version: number;
  readonly serviceId: string;
  readonly enterpriseId: string;
  readonly request: PrincipalControlRequest;
  readonly approvedAt: number;
  readonly expiresAt: number;
  readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
  readonly status: 'available' | 'revoked' | 'used';
};
export type ServiceAffiliations = {
  readonly policy: ServiceAffiliationPolicy;
  readonly revision: number;
  readonly consents: Readonly<Record<string, ServiceAffiliationConsent>>;
};
export type ServiceAffiliationCommand =
  | {
      readonly type: 'services.approve-control';
      readonly request: PrincipalControlRequest;
      readonly expiresAt: number;
      readonly registryRevision: number;
    }
  | {
      readonly type: 'services.revoke-control';
      readonly expectedConsentVersion: number;
      readonly registryRevision: number;
    };
export type ServiceAffiliationEvent =
  | { readonly type: 'ServiceAffiliationsEnabled'; readonly policy: ServiceAffiliationPolicy }
  | {
      readonly type: 'ServiceAffiliationConsentApproved';
      readonly previousRegistryRevision: number;
      readonly consent: ServiceAffiliationConsent;
    }
  | {
      readonly type: 'ServiceAffiliationConsentRevoked';
      readonly serviceId: string;
      readonly previousRegistryRevision: number;
      readonly consentVersion: number;
      readonly at: number;
      readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
    }
  | (Omit<
      Extract<ServicePrincipalEvent, { type: 'ServicePrincipalControlChanged' }>,
      'type' | 'affiliationAuthorization'
    > & {
      readonly type: 'ServiceAffiliatedPrincipalControlChanged';
      readonly previousRegistryRevision: number;
      readonly consentVersion: number;
    });
