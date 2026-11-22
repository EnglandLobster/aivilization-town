import type { AccountingTransaction } from './accounting';
/** Cash preservation is distinct from a body, inheritance rights or a public budget. */
export const ESTATE_CASH_POLICY = {
  version: 'resident-estate-cash-v1',
  maxAccounts: 2000,
  maxSourceReferences: 10000,
  populationSemantics: 'preserve-personal-cash-without-default-heir-or-burn',
} as const;
/** Explicit v2 adds only the fixed town-bank consumer; v1 never inherits this permission. */
export const ESTATE_CASH_BANK_POLICY = {
  ...ESTATE_CASH_POLICY,
  version: 'resident-estate-cash-v2',
  bankSettlement: 'resident-estate-credit-settlement-v1',
} as const;
export type EstateCashPolicy = typeof ESTATE_CASH_POLICY | typeof ESTATE_CASH_BANK_POLICY;
export const ESTATE_CASH_SETTLEMENT_SOURCES = {
  'earned-wages': {
    policyVersion: 'resident-earned-wage-estate-v1',
    accountId: 'public-service:resident-earned-wages',
  },
  credit: {
    policyVersion: 'resident-estate-credit-settlement-v1',
    accountId: 'bank:town-bank',
  },
} as const;
export const ESTATE_RESPONSIBILITY_DOMAINS = [
  'credit',
  'enterprise',
  'commerce',
  'society',
  'materials',
  'premises',
  'information',
  'collaboration',
] as const;
export type EstateResponsibilityDomain = (typeof ESTATE_RESPONSIBILITY_DOMAINS)[number];
export type EstateResponsibilityRead = {
  readonly domain: EstateResponsibilityDomain;
  readonly status: 'observed' | 'unavailable';
  readonly references: readonly { readonly id: string; readonly revision: number }[];
};
export type EstateCashCaptureSource = {
  readonly populationEventId: string;
  readonly ownerId: string;
  readonly cause: 'death' | 'emigration';
  readonly populationPolicyVersion: string;
  readonly at: number;
  readonly personalBalance: number;
};
export type EstateCashSourceReference = {
  readonly context: keyof typeof ESTATE_CASH_SETTLEMENT_SOURCES;
  readonly id: string;
  readonly revision: number;
  readonly policyVersion: string;
};
export type EstateCashAccount = {
  readonly id: string;
  readonly ownerId: string;
  readonly revision: number;
  readonly status: 'held' | 'closed';
  readonly balance: number;
  readonly at: number;
  readonly capture: EstateCashCaptureSource;
  readonly settledSources: Readonly<
    Record<string, { readonly revision: number; readonly transactionId: string }>
  >;
};
export type EstateCashState = {
  readonly policy: EstateCashPolicy;
  readonly accounts: Readonly<Record<string, EstateCashAccount>>;
};
export type EstateCashEvent =
  | { readonly type: 'EstateCashEnabled'; readonly policy: EstateCashPolicy }
  | {
      readonly type: 'EstateCashCaptured';
      readonly id: string;
      readonly source: EstateCashCaptureSource;
      readonly transaction?: AccountingTransaction;
    }
  | {
      readonly type: 'EstateCashSettled';
      readonly id: string;
      readonly previousRevision: number;
      readonly at: number;
      readonly source: EstateCashSourceReference;
      readonly transaction: AccountingTransaction;
    }
  | {
      readonly type: 'EstateCashClosed';
      readonly id: string;
      readonly previousRevision: number;
      readonly at: number;
      readonly responsibilityReads: readonly EstateResponsibilityRead[];
    };
export type EstateCashDecision =
  | {
      readonly accepted: true;
      readonly events: readonly EstateCashEvent[];
      readonly transactions: readonly AccountingTransaction[];
    }
  | { readonly accepted: false; readonly reason: string };
