import type {
  PrincipalAuthorization,
  PrincipalOperationRequest,
  ResourcePrincipal,
  PrincipalAuthorizationPort,
} from '@aivilization/authority';
import type { AccountingTransaction } from '@aivilization/economy';
/** A bounded financial promise, not a lease, loan, service, membership or program created by its title. */
export const PERIODIC_OBLIGATIONS_POLICY = {
  version: 'resident-periodic-obligations-v1',
  moneyScale: 1000000,
  maxContracts: 2000,
  maxPerPayer: 100,
  maxPeriods: 128,
  maxTotalMicros: 1000000000000,
  minPeriodMs: 60000,
  maxHorizonMs: 365 * 86400000,
  maxOfferMs: 30 * 86400000,
  maxTermsChars: 4000,
  termination: 'either-party-future-only',
  missedPayment: 'record-once-no-automatic-retry-or-interest',
} as const;
export type PeriodicAccount = {
  readonly sector: 'agent' | 'enterprise' | 'collective' | 'treasury';
  readonly id: string;
};
export type PeriodicAccountFacts = {
  readonly account: PeriodicAccount;
  readonly principal: ResourcePrincipal;
  readonly status: 'open' | 'settling' | 'closed' | 'unavailable';
  readonly balance: number;
  readonly maximumBalance: number;
};
export type PeriodicTerms = {
  readonly id: string;
  readonly title: string;
  readonly terms: string;
  readonly payer: PeriodicAccount;
  readonly revenue: PeriodicAccount;
  readonly amount: number;
  readonly firstDueAt: number;
  readonly periodMs: number;
  readonly periods: number;
  readonly acceptBy: number;
};
export type PeriodicProof = PrincipalAuthorization<PrincipalOperationRequest>;
export type PeriodicInstallment = {
  readonly period: number;
  readonly dueAt: number;
  readonly amountMicros: number;
  readonly status: 'paid' | 'unpaid' | 'waived';
  readonly recordedAt: number;
  readonly unpaidReason?: PeriodicFailure;
  readonly paidAt?: number;
  readonly waivedAt?: number;
};
export type PeriodicFailure =
  | 'periodic-payer-unavailable'
  | 'periodic-revenue-unavailable'
  | 'periodic-account-principal-changed'
  | 'periodic-insufficient-funds'
  | 'periodic-revenue-capacity'
  | 'periodic-money-range';
export type PeriodicObligation = PeriodicTerms & {
  readonly payerPrincipal: ResourcePrincipal;
  readonly revenuePrincipal: ResourcePrincipal;
  readonly offeredAuthorization: PeriodicProof;
  readonly acceptedAuthorization?: PeriodicProof;
  readonly acceptedAt?: number;
  readonly futureStoppedAt?: number;
  readonly createdAt: number;
  readonly at: number;
  readonly revision: number;
  readonly status:
    | 'offered'
    | 'active'
    | 'ended'
    | 'terminated'
    | 'withdrawn'
    | 'declined'
    | 'expired';
  readonly cursor: number;
  readonly installments: Readonly<Record<string, PeriodicInstallment>>;
};
type PeriodicRevisionOperation = 'accept' | 'withdraw' | 'decline' | 'terminate';
type PeriodicInstallmentOperation = 'settle' | 'waive';
export type PeriodicCommand =
  | ({ readonly type: 'offer' } & PeriodicTerms)
  | {
      [Operation in PeriodicRevisionOperation]: {
        readonly type: Operation;
        readonly id: string;
        readonly expectedRevision: number;
      };
    }[PeriodicRevisionOperation]
  | {
      [Operation in PeriodicInstallmentOperation]: {
        readonly type: Operation;
        readonly id: string;
        readonly expectedRevision: number;
        readonly period: number;
      };
    }[PeriodicInstallmentOperation];
export type PeriodicSourceRead = {
  readonly payer: PeriodicAccountFacts | null;
  readonly revenue: PeriodicAccountFacts | null;
};
export type PeriodicObligationsState = {
  readonly policy: typeof PERIODIC_OBLIGATIONS_POLICY;
  readonly contracts: Readonly<Record<string, PeriodicObligation>>;
};
export type PeriodicEvent =
  | {
      readonly type: 'PeriodicObligationsEnabled';
      readonly policy: typeof PERIODIC_OBLIGATIONS_POLICY;
    }
  | {
      readonly type: 'PeriodicObligationOffered';
      readonly obligation: PeriodicObligation;
      readonly actorId: string;
      readonly sourceRead: PeriodicSourceRead;
    }
  | {
      readonly type: 'PeriodicObligationChanged';
      readonly id: string;
      readonly previousRevision: number;
      readonly actorId: string;
      readonly at: number;
      readonly command: Exclude<PeriodicCommand, { type: 'offer' }>;
      readonly authorization: PeriodicProof;
      readonly status: PeriodicObligation['status'];
      readonly sourceRead?: PeriodicSourceRead;
      readonly installment?: PeriodicInstallment;
    }
  | {
      readonly type: 'PeriodicObligationExpired';
      readonly id: string;
      readonly previousRevision: number;
      readonly at: number;
    }
  | {
      readonly type: 'PeriodicInstallmentRecorded';
      readonly id: string;
      readonly previousRevision: number;
      readonly at: number;
      readonly sourceRead: PeriodicSourceRead;
      readonly installment: PeriodicInstallment;
    };
export type PeriodicDecision =
  | {
      readonly accepted: true;
      readonly events: readonly PeriodicEvent[];
      readonly transactions: readonly AccountingTransaction[];
    }
  | { readonly accepted: false; readonly reason: string };
export type PeriodicPorts = {
  readonly exists: (actorId: string) => boolean;
  readonly account: (account: PeriodicAccount) => PeriodicAccountFacts | undefined;
  readonly authorize: PrincipalAuthorizationPort<PrincipalOperationRequest>;
};
