import {
  assertPrincipalAuthorization,
  principalId,
  type PrincipalAuthorization,
  type PrincipalOperationRequest,
  type PrincipalValue,
} from '@aivilization/authority';
import type { EnterpriseState } from './model';
/** Existing enterprise cash-surplus accounting, explicitly versioned; not a fixed-asset valuation ledger. */
export const ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY = {
  version: 'enterprise-resource-sales-cash-accounting-v1',
  moneyScale: 1000000,
  maxReceipts: 10000,
  maxAmountMicros: 1000000000000,
} as const;
export const ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY_V2 = {
  ...ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY,
  version: 'enterprise-resource-sales-cash-accounting-v2',
} as const;
export type EnterpriseResourceSalesAccountingVersion =
  | typeof ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY.version
  | typeof ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY_V2.version;
export type EnterpriseResourceSaleReceipt = {
  readonly saleId: string;
  readonly resourceId: string;
  readonly side: 'payer' | 'revenue';
  readonly at: number;
  readonly amountMicros: number;
  readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
};
export type EnterpriseResourceSalesAccounting = {
  readonly policyVersion: EnterpriseResourceSalesAccountingVersion;
  readonly receipts: Readonly<Record<string, EnterpriseResourceSaleReceipt>>;
};
export type EnterpriseResourceSaleAccountingEvent = {
  readonly type: 'EnterpriseResourceSaleAccountingRecorded';
  readonly policyVersion: EnterpriseResourceSalesAccountingVersion;
  readonly receipt: EnterpriseResourceSaleReceipt;
};
function object(
  v: PrincipalValue | undefined,
): Readonly<Record<string, PrincipalValue>> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Readonly<Record<string, PrincipalValue>>)
    : undefined;
}
function assertReceipt(
  r: EnterpriseResourceSaleReceipt,
  enterpriseId: string,
  version: EnterpriseResourceSalesAccountingVersion,
) {
  const policy = ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY;
  if (
    !principalId(r.saleId) ||
    !principalId(r.resourceId) ||
    !['payer', 'revenue'].includes(r.side) ||
    !Number.isSafeInteger(r.at) ||
    r.at < 0 ||
    !Number.isSafeInteger(r.amountMicros) ||
    r.amountMicros <= 0 ||
    r.amountMicros > policy.maxAmountMicros
  )
    throw Error('invalid-enterprise-resource-sale-receipt');
  const a = r.authorization,
    q = a.request,
    args = q.operation.arguments;
  assertPrincipalAuthorization(a, { kind: 'enterprise', id: enterpriseId }, q, a.actorId);
  const payer = r.side === 'payer',
    terms = payer ? args : object(args.command),
    source = object(payer ? args.quotedSource : args.source),
    account = object(terms?.[r.side]),
    party = object(payer ? object(source?.offer)?.target : source?.seller),
    command = object(args.command);
  if (
    q.resourceKind !== 'resource-sale' ||
    q.resourceId !== r.saleId ||
    q.operation.capability !== (payer ? 'resource-sales.accept' : 'resource-sales.offer') ||
    !source ||
    source.id !== r.resourceId ||
    !terms ||
    terms.amount !== r.amountMicros / policy.moneyScale ||
    command?.type !== (payer ? 'accept' : 'offer') ||
    command.id !== r.saleId ||
    !(version === ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY_V2.version
      ? typeof source.kind === 'string' && ['premises', 'stock', 'vehicle'].includes(source.kind)
      : source.kind === 'premises') ||
    party?.kind !== 'enterprise' ||
    party.id !== enterpriseId ||
    account?.sector !== 'enterprise' ||
    account.id !== enterpriseId
  )
    throw Error('enterprise-resource-sale-exact-source-required');
}
export function assertEnterpriseResourceSalesAccounting(
  s: EnterpriseResourceSalesAccounting,
  id: string,
) {
  if (
    ![
      ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY.version,
      ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY_V2.version,
    ].includes(s.policyVersion) ||
    Object.keys(s.receipts).length > ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY.maxReceipts
  )
    throw Error('invalid-enterprise-resource-sales-accounting');
  for (const [key, receipt] of Object.entries(s.receipts)) {
    if (key !== receipt.saleId) throw Error('enterprise-resource-sale-receipt-id-mismatch');
    assertReceipt(receipt, id, s.policyVersion);
  }
}
export function applyEnterpriseResourceSaleAccounting(
  e: EnterpriseState,
  event: EnterpriseResourceSaleAccountingEvent,
): EnterpriseState {
  const r = event.receipt,
    policy = ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY;
  if (
    ![policy.version, ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY_V2.version].includes(
      event.policyVersion,
    ) ||
    (e.resourceSalesAccounting?.policyVersion ===
      ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY_V2.version &&
      event.policyVersion !== ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY_V2.version) ||
    e.status !== 'active' ||
    r.at < e.foundedAt
  )
    throw Error('enterprise-resource-sales-unavailable');
  assertReceipt(r, e.enterpriseId, event.policyVersion);
  if (e.resourceSalesAccounting?.receipts[r.saleId])
    throw Error('enterprise-resource-sale-already-recorded');
  if (Object.keys(e.resourceSalesAccounting?.receipts ?? {}).length >= policy.maxReceipts)
    throw Error('enterprise-resource-sale-receipt-limit');
  const amount = r.amountMicros / policy.moneyScale,
    revenue = r.side === 'revenue' ? amount : 0,
    cost = r.side === 'payer' ? amount : 0;
  const balance = e.balance + revenue - cost,
    retainedEarnings =
      (e.retainedEarnings ??
        e.cumulativeSales -
          e.cumulativePurchases -
          e.cumulativeWages -
          (e.cumulativeDividends ?? 0)) +
      revenue -
      cost;
  if (
    !Number.isFinite(balance) ||
    balance < 0 ||
    !Number.isFinite(retainedEarnings) ||
    !Number.isFinite(e.cumulativeSales + revenue) ||
    !Number.isFinite(e.cumulativePurchases + cost)
  )
    throw Error('enterprise-resource-sale-insufficient-cash-or-range');
  const resourceSalesAccounting: EnterpriseResourceSalesAccounting = {
    policyVersion: event.policyVersion,
    receipts: { ...e.resourceSalesAccounting?.receipts, [r.saleId]: structuredClone(r) },
  };
  assertEnterpriseResourceSalesAccounting(resourceSalesAccounting, e.enterpriseId);
  return {
    ...e,
    balance,
    retainedEarnings,
    cumulativeSales: e.cumulativeSales + revenue,
    cumulativePurchases: e.cumulativePurchases + cost,
    resourceSalesAccounting,
  };
}
export function decideRecordEnterpriseResourceSaleAccounting(
  e: EnterpriseState,
  receipt: EnterpriseResourceSaleReceipt,
  policyVersion: EnterpriseResourceSalesAccountingVersion = e.resourceSalesAccounting
    ?.policyVersion ?? ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY.version,
) {
  const event: EnterpriseResourceSaleAccountingEvent = {
    type: 'EnterpriseResourceSaleAccountingRecorded',
    policyVersion,
    receipt: structuredClone(receipt),
  };
  try {
    applyEnterpriseResourceSaleAccounting(e, event);
    return { accepted: true as const, event };
  } catch (error) {
    return {
      accepted: false as const,
      reason:
        error instanceof Error ? error.message : 'invalid-enterprise-resource-sale-accounting',
    };
  }
}
