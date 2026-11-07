import type {
  PrincipalAuthorization,
  PrincipalOperationRequest,
  ResourcePrincipal,
} from '@aivilization/authority';
import type { ServicePrincipalEvent } from './servicePrincipalModel';
export const SERVICE_SUPPLY_RELATION_POLICY = {
  version: 'resident-service-supply-relations-v5',
  maxOfferHorizonMs: 30 * 86400000,
  maxTermsChars: 2000,
} as const;
export type ServiceSupplyRelationPolicy = typeof SERVICE_SUPPLY_RELATION_POLICY;
export type ServiceSupplyRelationOffer = {
  readonly enterpriseId: string;
  readonly terms: string;
  readonly expiresAt: number;
  readonly offeredAt: number;
  readonly controller: ResourcePrincipal;
  readonly controlVersion: number;
  readonly resourceRevision: number;
  readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
};
export type ServiceSupplyRelation = {
  readonly policyVersion: typeof SERVICE_SUPPLY_RELATION_POLICY.version;
  readonly version: number;
  readonly enterpriseId: string | null;
  readonly at: number;
  readonly offer?: ServiceSupplyRelationOffer;
};
export type ServiceSupplyRelationCommand =
  | {
      readonly type: 'services.offer-supply';
      readonly enterpriseId: string;
      readonly expiresAt: number;
      readonly terms: string;
    }
  | { readonly type: 'services.accept-supply' }
  | {
      readonly type: 'services.end-supply' | 'services.cancel-supply';
      readonly subject: ResourcePrincipal;
    };
export type ServiceSupplyRelationEvent =
  | { readonly type: 'ServiceSupplyRelationsEnabled'; readonly policy: ServiceSupplyRelationPolicy }
  | {
      readonly type: 'ServiceSupplyRelationChanged';
      readonly serviceId: string;
      readonly previousRevision: number;
      readonly previousSupplyVersion: number;
      readonly at: number;
      readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
      readonly relation: ServiceSupplyRelation;
    }
  | (Omit<Extract<ServicePrincipalEvent, { type: 'ServicePrincipalControlChanged' }>, 'type'> & {
      readonly type: 'ServiceSupplyPrincipalControlChanged';
      readonly supplyVersion: number;
      readonly consentVersion?: number;
    });
