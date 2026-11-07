import type { ServiceAttendanceBody } from './serviceAttendance';
import type { ServiceElapsedBody, ServiceElapsedInterval } from './elapsedBody';
import type { Controller, ControlAuthorizationPort } from '@aivilization/authority';
import type { Inventory, AccountingTransaction } from '@aivilization/economy';
import type { ResidentServiceEffectId, ServiceParticipantCondition } from '@aivilization/society';
export const SERVICE_ENGAGEMENTS_POLICY = {
  version: 'resident-service-engagements-v1',
  effectsVersion: 'resident-service-effects-v1',
  maxTotal: 10000,
  maxPerController: 500,
  maxTermsChars: 8000,
  maxDurationMs: 8 * 3600000,
  maxWindowMs: 30 * 86400000,
  cadenceMs: 60000,
  maxPricePerHour: 1000000,
  maxMaterialRefs: 20,
} as const;
export type ServiceEngagementPolicy = typeof SERVICE_ENGAGEMENTS_POLICY;
export type ServiceAccount = {
  readonly sector: 'agent' | 'collective' | 'enterprise';
  readonly id: string;
};
export type ServicePayer =
  | ServiceAccount
  | { readonly sector: 'treasury'; readonly id: 'public-treasury' };
export const SERVICE_PUBLIC_FUNDING_POLICY = {
  version: 'resident-service-public-funding-v1',
  treasuryId: 'public-treasury',
  visibility: 'public-terms-and-ledger',
} as const;
export type EngagementMaterialRef = { readonly id: string; readonly revision: number };
export type ServiceEngagementTerms = {
  readonly id: string;
  readonly controller: Controller;
  readonly title: string;
  readonly terms: string;
  readonly locationId: string;
  readonly providerId: string;
  readonly recipientId: string;
  readonly payer: ServicePayer;
  readonly revenue: ServiceAccount;
  readonly providerShareBps: number;
  readonly pricePerHour: number;
  readonly modelId: ResidentServiceEffectId;
  readonly maxDurationMs: number;
  readonly startAt: number;
  readonly endAt: number;
  readonly materials: readonly EngagementMaterialRef[];
};
export type ServicePresence = {
  readonly actorId: string;
  readonly startedAt: number;
  readonly until: number;
};
export type ServiceEngagement = ServiceEngagementTerms & {
  readonly createdBy: string;
  readonly createdAt: number;
  readonly decisionId?: string;
  readonly revision: number;
  readonly at: number;
  readonly status: 'offered' | 'accepted' | 'funded' | 'ended';
  readonly acceptedAt?: number;
  readonly fundedBy?: string;
  readonly fundingDecisionId?: string;
  readonly maximumCharge: number;
  readonly escrow: number;
  readonly charged: number;
  readonly providerPaid: number;
  readonly revenuePaid: number;
  readonly refunded: number;
  readonly progressMs: number;
  readonly settledAt: number;
  readonly providerPresence?: ServicePresence;
  readonly recipientPresence?: ServicePresence;
  readonly educationCeiling?: number;
  readonly endReason?:
    | 'completed'
    | 'expired'
    | 'cancelled'
    | 'participant-left'
    | 'participant-time-ended'
    | 'facility-unavailable'
    | 'participant-unavailable'
    | 'physical-budget-exhausted';
};
export type EngagementSettlement = {
  readonly elapsedBody?: ServiceElapsedBody;
  readonly id: string;
  readonly engagementId: string;
  readonly at: number;
  readonly from: number;
  readonly until: number;
  readonly previousProgressMs: number;
  readonly progressMs: number;
  readonly providerBefore: ServiceParticipantCondition;
  readonly providerAfter: ServiceParticipantCondition;
  readonly recipientBefore: ServiceParticipantCondition;
  readonly recipientAfter: ServiceParticipantCondition;
  readonly consumed: Inventory;
  readonly charge: number;
  readonly providerPay: number;
  readonly revenuePay: number;
};
export type ServiceEngagementEvent =
  | {
      readonly type: 'ServicePublicFundingEnabled';
      readonly policy: typeof SERVICE_PUBLIC_FUNDING_POLICY;
    }
  | { readonly type: 'ServiceEngagementsEnabled'; readonly policy: ServiceEngagementPolicy }
  | { readonly type: 'ServiceEngagementChanged'; readonly engagement: ServiceEngagement }
  | { readonly type: 'ServiceEngagementSettled'; readonly settlement: EngagementSettlement };
export type ServiceEngagementsState = {
  readonly policy: ServiceEngagementPolicy;
  readonly publicFunding?: typeof SERVICE_PUBLIC_FUNDING_POLICY;
  readonly engagements: Readonly<Record<string, ServiceEngagement>>;
  readonly settlements: Readonly<Record<string, EngagementSettlement>>;
};
export type ServiceEngagementCommand =
  | ({ readonly type: 'offer' } & ServiceEngagementTerms)
  | {
      readonly type: 'accept' | 'fund' | 'leave' | 'cancel';
      readonly id: string;
      readonly expectedRevision: number;
    }
  | {
      readonly type: 'start';
      readonly expectedEmploymentRevision?: number;
      readonly id: string;
      readonly expectedRevision: number;
      readonly until: number;
    };
export type ServiceMaterialInstruction = {
  readonly reservationId: string;
  readonly expectedRevision: number;
  readonly engagementId: string;
  readonly controller: Controller;
  readonly evidenceId: string;
  readonly consumed: Inventory;
  readonly finish: boolean;
};
export type ServiceEngagementDecision =
  | {
      readonly accepted: true;
      readonly events: readonly ServiceEngagementEvent[];
      readonly transactions: readonly AccountingTransaction[];
      readonly materialInstructions: readonly ServiceMaterialInstruction[];
      readonly reserve?: ServicePresence;
      readonly releases: readonly ServicePresence[];
      readonly elapsedBody?: ServiceElapsedBody;
      readonly elapsedAttendance?: ServiceAttendanceBody;
    }
  | { readonly accepted: false; readonly reason: string };
export type ServiceEngagementPorts = {
  readonly enterpriseAccountingVersion?: 'resident-service-employment-v1';
  readonly elapsedInterval?: ServiceElapsedInterval;
  readonly publicFunding?: {
    readonly balance: number;
    readonly authorize: (
      engagement: ServiceEngagement,
      actorId: string,
    ) => { readonly decisionId: string } | undefined;
  };
  readonly exists: (id: string) => boolean;
  readonly controllerAvailable: (controller: Controller) => boolean;
  readonly authorize: ControlAuthorizationPort;
  readonly account: (
    account: ServiceAccount,
  ) => { balance: number; controller: Controller; status: 'open' | 'settling' } | undefined;
  readonly presentAndIdle: (actorId: string, locationId: string) => boolean;
  readonly present: (actorId: string, locationId: string) => boolean;
  readonly condition: (actorId: string) => ServiceParticipantCondition | undefined;
  readonly mayOperate: (actorId: string, locationId: string) => boolean;
  readonly mayOperateDuring?: (
    engagement: ServiceEngagement,
    from: number,
    until: number,
  ) => boolean;
  readonly locationAvailable: (locationId: string) => boolean;
  readonly facilityAvailable: (engagement: ServiceEngagement, at: number) => boolean;
  readonly sessionReserved: (engagementId: string, presence: ServicePresence) => boolean;
  readonly material: (id: string) =>
    | {
        revision: number;
        status: 'offered' | 'bound' | 'settled';
        expiresAt: number;
        beneficiary: Controller;
        consumerDomain: string;
        consumerId: string;
        locationId: string;
        held: Inventory;
      }
    | undefined;
};
export function assertServiceEngagementPolicy(policy: ServiceEngagementPolicy) {
  if (
    Object.keys(policy).length !== Object.keys(SERVICE_ENGAGEMENTS_POLICY).length ||
    Object.entries(SERVICE_ENGAGEMENTS_POLICY).some(
      ([key, value]) => policy[key as keyof ServiceEngagementPolicy] !== value,
    )
  )
    throw new Error('unsupported-service-engagement-policy');
}
export const emptyServiceEngagementsState = (
  policy: ServiceEngagementPolicy = SERVICE_ENGAGEMENTS_POLICY,
): ServiceEngagementsState => {
  assertServiceEngagementPolicy(policy);
  return { policy, engagements: {}, settlements: {} };
};
export const engagementRejected = (reason: string): ServiceEngagementDecision => ({
  accepted: false,
  reason,
});
export const engagementAccepted = (
  events: readonly ServiceEngagementEvent[],
  extra: Partial<
    Omit<Extract<ServiceEngagementDecision, { accepted: true }>, 'accepted' | 'events'>
  > = {},
): ServiceEngagementDecision => ({
  accepted: true,
  events,
  transactions: [],
  materialInstructions: [],
  releases: [],
  ...extra,
});
export const engagementEscrowBalance = (s: ServiceEngagementsState | undefined) =>
  Object.values(s?.engagements ?? {}).reduce((sum, e) => sum + e.escrow, 0);
export const engagementAccountObligations = (
  s: ServiceEngagementsState | undefined,
  accountId: string,
) =>
  Object.values(s?.engagements ?? {}).some(
    (e) =>
      e.status === 'funded' &&
      [e.payer, e.revenue].some((a) => a.sector === 'collective' && a.id === accountId),
  );
