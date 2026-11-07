import type { AccountingTransaction } from './accounting';
/** Closed integration sectors. A caller cannot nominate an arbitrary escrow or policy. */
export const COMMON_ACCOUNT_SETTLEMENT_SOURCES = {
  'periodic-obligations': {
    policyVersion: 'resident-periodic-obligations-v1',
    accountId: 'public-service:resident-periodic-obligations',
  },
  'resource-sales-v2': {
    policyVersion: 'resident-resource-sales-v2',
    accountId: 'public-service:resident-resource-sales',
  },
  'resource-sales': {
    policyVersion: 'resident-resource-sales-v1',
    accountId: 'public-service:resident-resource-sales',
  },
  capital: {
    policyVersion: 'enterprise-capital-agreements-v1',
    accountId: 'public-service:resident-capital',
  },
  services: {
    policyVersion: 'resident-service-engagements-v1',
    accountId: 'public-service:resident-service-engagements',
  },
  logistics: {
    policyVersion: 'resident-logistics-v1',
    accountId: 'public-service:resident-logistics',
  },
  trade: {
    policyVersion: 'resident-evidence-trade-v1',
    accountId: 'public-service:resident-evidence-trade',
  },
  'trade-v2': {
    policyVersion: 'resident-evidence-trade-v2',
    accountId: 'public-service:resident-evidence-trade',
  },
  'construction-trade': {
    policyVersion: 'construction-trade-v1',
    accountId: 'public-service:resident-evidence-trade',
  },
  'trade-v3': {
    policyVersion: 'resident-principal-evidence-trade-v3',
    accountId: 'public-service:resident-evidence-trade',
  },
} as const;
export type CommonAccountSettlementContext = keyof typeof COMMON_ACCOUNT_SETTLEMENT_SOURCES;
export type CommonAccountSettlementVersion =
  (typeof COMMON_ACCOUNT_SETTLEMENT_SOURCES)[CommonAccountSettlementContext]['policyVersion'];
export const COMMON_ACCOUNTS_POLICY = {
  version: 'resident-common-accounts-v1',
  maxAccountsPerCollective: 20,
  maxBalance: 1_000_000_000,
  maxTransfer: 1_000_000,
  maxFundingReceiptsPerAccount: 10000,
  maxNoteChars: 2000,
} as const;
export type CommonAccountsPolicy = { readonly version: 'resident-common-accounts-v1' } & {
  readonly [K in Exclude<keyof typeof COMMON_ACCOUNTS_POLICY, 'version'>]: number;
};
export type CommonAccount = {
  readonly id: string;
  readonly collectiveId: string;
  readonly title: string;
  readonly balance: number;
  readonly revision: number;
  readonly controlVersion: number;
  readonly status: 'open' | 'settling' | 'closed';
  readonly createdBy: string;
  readonly at: number;
};
export type CommonAccountRecipient = {
  readonly sector: 'agent' | 'collective' | 'enterprise' | 'treasury';
  readonly id: string;
};
/** Issued by an internal exact decision port, never accepted as resident CLI arguments. */
export type CommonAccountAuthority = {
  readonly collectiveId: string;
  readonly decisionId: string;
  readonly decisionRevision: number;
  readonly charterVersion: number;
};
export type CommonAccountReceipt = {
  readonly id: string;
  readonly actorId: string;
  readonly accountIds: readonly string[];
  readonly accountRevisions: Readonly<Record<string, number>>;
  readonly at: number;
  readonly operation:
    | 'open'
    | 'contribute'
    | 'transfer'
    | 'beginSettlement'
    | 'close'
    | 'externalSettlement';
  readonly source?: {
    readonly context: CommonAccountSettlementContext;
    readonly referenceId: string;
    readonly policyVersion: CommonAccountSettlementVersion;
  };
  readonly note: string;
  readonly authority?: CommonAccountAuthority;
  readonly transaction?: AccountingTransaction;
};
export type CommonAccountsState = {
  readonly policy: CommonAccountsPolicy;
  readonly accounts: Readonly<Record<string, CommonAccount>>;
  readonly receipts: Readonly<Record<string, CommonAccountReceipt>>;
};
export type CommonAccountEvent =
  | { readonly type: 'CommonAccountsEnabled'; readonly policy: CommonAccountsPolicy }
  | { readonly type: 'CommonAccountChanged'; readonly account: CommonAccount }
  | { readonly type: 'CommonAccountReceiptRecorded'; readonly receipt: CommonAccountReceipt };
export type CommonAccountResourceOperation =
  | {
      readonly type: 'transfer';
      readonly id: string;
      readonly controlVersion: number;
      readonly recipient: CommonAccountRecipient;
      readonly amount: number;
      readonly note: string;
    }
  | {
      readonly type: 'beginSettlement' | 'close';
      readonly id: string;
      readonly controlVersion: number;
    };
export type CommonAccountCommand =
  | {
      readonly type: 'open';
      readonly id: string;
      readonly collectiveId: string;
      readonly title: string;
    }
  | {
      readonly type: 'contribute';
      readonly id: string;
      readonly expectedRevision: number;
      readonly amount: number;
      readonly note: string;
    }
  | (CommonAccountResourceOperation & { readonly authority: CommonAccountAuthority });
export type CommonAccountPorts = {
  readonly reservedIncoming?: (accountId: string) => number;
  readonly isMember: (collectiveId: string, actorId: string) => boolean;
  readonly residentBalance: (id: string) => number | undefined;
  readonly recipientBalance: (recipient: CommonAccountRecipient) => number | undefined;
  readonly unresolvedObligations: (accountId: string) => boolean;
};
export type CommonAccountDecision =
  | {
      readonly accepted: true;
      readonly events: readonly CommonAccountEvent[];
      readonly transactions: readonly AccountingTransaction[];
    }
  | { readonly accepted: false; readonly reason: string };
export const commonAccountId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v) &&
  !Object.hasOwn(Object.prototype, v);
export function assertCommonAccountsPolicy(p: CommonAccountsPolicy) {
  if (
    p.version !== 'resident-common-accounts-v1' ||
    Object.keys(COMMON_ACCOUNTS_POLICY).some(
      (k) =>
        k !== 'version' &&
        (!Number.isFinite(p[k as keyof CommonAccountsPolicy]) ||
          Number(p[k as keyof CommonAccountsPolicy]) <= 0),
    ) ||
    !Number.isSafeInteger(p.maxAccountsPerCollective) ||
    !Number.isSafeInteger(p.maxFundingReceiptsPerAccount) ||
    !Number.isSafeInteger(p.maxNoteChars) ||
    p.maxTransfer > p.maxBalance
  )
    throw new Error('invalid-common-accounts-policy');
}
export function emptyCommonAccountsState(
  policy: CommonAccountsPolicy = COMMON_ACCOUNTS_POLICY,
): CommonAccountsState {
  assertCommonAccountsPolicy(policy);
  return { policy, accounts: {}, receipts: {} };
}
export function commonAccountsBalance(s: CommonAccountsState | undefined): number {
  return Object.values(s?.accounts ?? {}).reduce((sum, a) => sum + a.balance, 0);
}
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(v).length === names.length && names.every((n) => Object.hasOwn(v, n));
/** Closed schema shared by publication preflight and actual execution. */
export function parseCommonAccountOperation(
  capability: string,
  resourceId: string,
  value: unknown,
  p: CommonAccountsPolicy,
): CommonAccountResourceOperation | undefined {
  if (
    !commonAccountId(resourceId) ||
    !object(value) ||
    !Number.isSafeInteger(value.controlVersion) ||
    Number(value.controlVersion) < 1
  )
    return undefined;
  if (
    (capability === 'funds.beginSettlement' || capability === 'funds.close') &&
    keys(value, ['controlVersion'])
  )
    return {
      type: capability === 'funds.close' ? 'close' : 'beginSettlement',
      id: resourceId,
      controlVersion: Number(value.controlVersion),
    };
  if (
    capability !== 'funds.transfer' ||
    !keys(value, ['controlVersion', 'recipient', 'amount', 'note']) ||
    !object(value.recipient) ||
    !keys(value.recipient, ['sector', 'id'])
  )
    return undefined;
  const recipient = value.recipient;
  if (
    typeof recipient.sector !== 'string' ||
    !['agent', 'collective', 'enterprise', 'treasury'].includes(recipient.sector) ||
    !commonAccountId(recipient.id) ||
    typeof value.amount !== 'number' ||
    !Number.isFinite(value.amount) ||
    value.amount <= 0 ||
    value.amount > p.maxTransfer ||
    typeof value.note !== 'string' ||
    value.note.length > p.maxNoteChars
  )
    return undefined;
  if (recipient.sector === 'treasury' && recipient.id !== 'public-treasury') return undefined;
  return {
    type: 'transfer',
    id: resourceId,
    controlVersion: Number(value.controlVersion),
    recipient: { sector: recipient.sector as CommonAccountRecipient['sector'], id: recipient.id },
    amount: value.amount,
    note: value.note,
  };
}
