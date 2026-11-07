import type { EarnedWageEstatePayment } from './earnedWageEstate';
import type {
  EarnedPayrollEvent,
  EnterpriseServiceBusinessEvent,
  EnterpriseServiceAuthorization,
} from '@aivilization/enterprise';
import type { ResidentLaborTerms } from './residentLaborModel';
import type { EarnedCompensationPayload } from './earnedCompensation';
export const SERVICE_EMPLOYMENT_VERSION = 'resident-service-employment-v1';
export const SERVICE_CLEARING_ORDER = 'productive-then-service-then-timed-each-source-id-ascending';
export type ServiceEmploymentState = {
  readonly policyVersion: typeof SERVICE_EMPLOYMENT_VERSION;
  readonly clearingOrder: typeof SERVICE_CLEARING_ORDER;
  readonly claims: Readonly<Record<string, ServiceClaimContext>>;
};
export type ServiceClaimContext = {
  readonly id: string;
  readonly serviceId: string;
  readonly actorId: string;
  readonly enterpriseId: string;
  readonly startedAt: number;
  readonly until: number;
  readonly plannedMs: number;
  readonly authorizationRevision: number;
  readonly authorization: EnterpriseServiceAuthorization;
  readonly terms: ResidentLaborTerms;
  readonly lastSourceId: string;
  readonly withheldMicros: number;
};
export type ServiceCompensation = {
  readonly record: ServiceClaimContext;
  readonly compensation: EarnedCompensationPayload;
};
export type ServiceBusinessAuthorizationPayload = {
  readonly actorId: string;
  readonly enterpriseId: string;
  readonly serviceId: string;
  readonly expectedServiceRevision: number;
  readonly events: readonly (EarnedPayrollEvent | EnterpriseServiceBusinessEvent)[];
};
export type ServiceEnterpriseAccounting = {
  readonly enterpriseId: string;
  readonly event: Extract<
    EnterpriseServiceBusinessEvent,
    { type: 'EnterpriseServiceAccountingRecorded' }
  >;
};

export type ServiceWagePaidPayload = {
  readonly estatePayment?: EarnedWageEstatePayment;
  readonly actorId: string;
  readonly claimId: string;
  readonly compensation: EarnedCompensationPayload;
};
