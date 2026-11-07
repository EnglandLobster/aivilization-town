import {
  assertPrincipalAuthorization,
  principalId,
  principalOperationKey,
  type PrincipalAuthorization,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import type { EnterpriseState } from './model';
export const ENTERPRISE_TRADE_ACCOUNTING_POLICY = {
  version: 'enterprise-principal-trade-accounting-v1',
  moneyScale: 1000000,
  maxContracts: 10000,
  maxAmountMicros: 1000000000000,
} as const;
export const ENTERPRISE_TRADE_ACCOUNTING_V2 = 'enterprise-principal-trade-accounting-v2' as const;
type TradeAccountingVersion =
  | typeof ENTERPRISE_TRADE_ACCOUNTING_POLICY.version
  | typeof ENTERPRISE_TRADE_ACCOUNTING_V2;
export type EnterpriseTradePosition = {
  readonly sourceKind?: 'construction';
  readonly orderId: string;
  readonly sourceId: string;
  readonly side: 'payer' | 'revenue';
  readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
  readonly revision: number;
  readonly sourceRevision: number;
  readonly at: number;
  readonly phase: 'funded' | 'settled';
  readonly fundedMicros: number;
  readonly costMicros: number;
  readonly refundedMicros: number;
  readonly revenueMicros: number;
};
export type EnterpriseTradeAccounting = {
  readonly policyVersion: TradeAccountingVersion;
  readonly contracts: Readonly<Record<string, EnterpriseTradePosition>>;
};
export type EnterpriseTradeAccountingEvent = {
  readonly type: 'EnterpriseTradeAccountingRecorded';
  readonly policyVersion: TradeAccountingVersion;
  readonly previousRevision: number;
  readonly position: EnterpriseTradePosition;
};
const units = (n: number) =>
  Number.isSafeInteger(n) && n >= 0 && n <= ENTERPRISE_TRADE_ACCOUNTING_POLICY.maxAmountMicros;
function assertPosition(
  p: EnterpriseTradePosition,
  enterpriseId: string,
  version: TradeAccountingVersion,
) {
  if (
    !principalId(p.orderId) ||
    !principalId(p.sourceId) ||
    !['payer', 'revenue'].includes(p.side) ||
    !['funded', 'settled'].includes(p.phase) ||
    !Number.isSafeInteger(p.revision) ||
    p.revision < 1 ||
    !Number.isSafeInteger(p.sourceRevision) ||
    p.sourceRevision < 1 ||
    !Number.isSafeInteger(p.at) ||
    p.at < 0 ||
    ![p.fundedMicros, p.costMicros, p.refundedMicros, p.revenueMicros].every(units) ||
    p.costMicros + p.refundedMicros > p.fundedMicros ||
    (p.side === 'payer' &&
      p.phase === 'settled' &&
      p.costMicros + p.refundedMicros !== p.fundedMicros) ||
    (p.side === 'payer'
      ? p.revenueMicros !== 0
      : p.fundedMicros !== 0 || p.costMicros !== 0 || p.refundedMicros !== 0)
  )
    throw Error('invalid-enterprise-trade-position');
  const a = p.authorization;
  assertPrincipalAuthorization(a, { kind: 'enterprise', id: enterpriseId }, a.request, a.actorId);
  if (p.sourceKind === 'construction') {
    const terms = a.request.operation.arguments.terms;
    if (
      version !== ENTERPRISE_TRADE_ACCOUNTING_V2 ||
      (p.side === 'payer'
        ? a.request.resourceKind !== 'construction-order' ||
          a.request.resourceId !== p.orderId ||
          a.request.operation.capability !== 'construction-trades.accept'
        : a.request.resourceKind !== 'construction-project' ||
          a.request.resourceId !== p.sourceId ||
          a.request.operation.capability !== 'construction-trades.offer' ||
          !terms ||
          typeof terms !== 'object' ||
          Array.isArray(terms) ||
          !('id' in terms) ||
          terms.id !== p.orderId)
    )
      throw Error('enterprise-construction-original-authority-required');
  } else if (
    p.sourceKind !== undefined ||
    (p.side === 'payer'
      ? a.request.resourceKind !== 'evidence-order' ||
        a.request.resourceId !== p.orderId ||
        a.request.operation.capability !== 'trades.accept'
      : a.request.resourceKind !== 'premises-permit' ||
        a.request.resourceId !== p.sourceId ||
        a.request.operation.capability !== 'trades.offer' ||
        a.request.operation.arguments.id !== p.orderId)
  )
    throw Error('enterprise-trade-original-authority-required');
}
export function assertEnterpriseTradeAccounting(
  s: EnterpriseTradeAccounting,
  enterpriseId: string,
) {
  if (
    ![ENTERPRISE_TRADE_ACCOUNTING_POLICY.version, ENTERPRISE_TRADE_ACCOUNTING_V2].includes(
      s.policyVersion,
    ) ||
    Object.keys(s.contracts).length > ENTERPRISE_TRADE_ACCOUNTING_POLICY.maxContracts
  )
    throw Error('invalid-enterprise-trade-accounting');
  for (const [id, p] of Object.entries(s.contracts)) {
    if (id !== p.orderId) throw Error('enterprise-trade-contract-id-mismatch');
    assertPosition(p, enterpriseId, s.policyVersion);
  }
}
export function applyEnterpriseTradeAccounting(
  e: EnterpriseState,
  event: EnterpriseTradeAccountingEvent,
): EnterpriseState {
  if (
    e.status === 'closed' ||
    ![ENTERPRISE_TRADE_ACCOUNTING_POLICY.version, ENTERPRISE_TRADE_ACCOUNTING_V2].includes(
      event.policyVersion,
    )
  )
    throw Error('enterprise-trade-accounting-unavailable');
  const p = event.position,
    old = e.tradeAccounting?.contracts[p.orderId];
  assertPosition(p, e.enterpriseId, event.policyVersion);
  if (
    event.previousRevision !== (old?.revision ?? 0) ||
    p.revision !== event.previousRevision + 1 ||
    p.at < (old?.at ?? e.foundedAt) ||
    p.sourceRevision <= (old?.sourceRevision ?? 0) ||
    old?.phase === 'settled'
  )
    throw Error('enterprise-trade-revision-or-time-conflict');
  if (old && old.fundedMicros > 0 && p.fundedMicros !== old.fundedMicros)
    throw Error('enterprise-trade-funding-already-fixed');
  if (
    old &&
    (p.side !== old.side ||
      p.sourceKind !== old.sourceKind ||
      p.sourceId !== old.sourceId ||
      principalOperationKey(p.authorization) !== principalOperationKey(old.authorization))
  )
    throw Error('enterprise-trade-contract-source-changed');
  if (
    !old &&
    Object.keys(e.tradeAccounting?.contracts ?? {}).length >=
      ENTERPRISE_TRADE_ACCOUNTING_POLICY.maxContracts
  )
    throw Error('enterprise-trade-contract-limit');
  for (const field of ['fundedMicros', 'costMicros', 'refundedMicros', 'revenueMicros'] as const)
    if (p[field] < (old?.[field] ?? 0)) throw Error('enterprise-trade-accounting-regressed');
  const funded = p.fundedMicros - (old?.fundedMicros ?? 0),
    cost = p.costMicros - (old?.costMicros ?? 0),
    refund = p.refundedMicros - (old?.refundedMicros ?? 0),
    revenue = p.revenueMicros - (old?.revenueMicros ?? 0);
  if (funded > 0 && !['active', 'insolvent'].includes(e.status))
    throw Error('enterprise-trade-funding-unavailable');
  const balance =
    e.balance + (refund + revenue - funded) / ENTERPRISE_TRADE_ACCOUNTING_POLICY.moneyScale;
  const retainedEarnings =
    (e.retainedEarnings ??
      e.cumulativeSales -
        e.cumulativePurchases -
        e.cumulativeWages -
        (e.cumulativeDividends ?? 0)) +
    (revenue - cost) / ENTERPRISE_TRADE_ACCOUNTING_POLICY.moneyScale;
  if (!Number.isFinite(balance) || balance < 0 || !Number.isFinite(retainedEarnings))
    throw Error('enterprise-trade-insufficient-cash');
  const tradeAccounting: EnterpriseTradeAccounting = {
    policyVersion:
      e.tradeAccounting?.policyVersion === ENTERPRISE_TRADE_ACCOUNTING_V2
        ? ENTERPRISE_TRADE_ACCOUNTING_V2
        : event.policyVersion,
    contracts: { ...e.tradeAccounting?.contracts, [p.orderId]: structuredClone(p) },
  };
  assertEnterpriseTradeAccounting(tradeAccounting, e.enterpriseId);
  return {
    ...e,
    balance,
    retainedEarnings,
    cumulativeSales: e.cumulativeSales + revenue / 1000000,
    cumulativePurchases: e.cumulativePurchases + cost / 1000000,
    tradeAccounting,
  };
}
export function decideRecordEnterpriseTradeAccounting(
  e: EnterpriseState,
  position: EnterpriseTradePosition,
) {
  const event: EnterpriseTradeAccountingEvent = {
    type: 'EnterpriseTradeAccountingRecorded',
    policyVersion:
      position.sourceKind === 'construction'
        ? ENTERPRISE_TRADE_ACCOUNTING_V2
        : ENTERPRISE_TRADE_ACCOUNTING_POLICY.version,
    previousRevision: e.tradeAccounting?.contracts[position.orderId]?.revision ?? 0,
    position: structuredClone(position),
  };
  try {
    applyEnterpriseTradeAccounting(e, event);
    return { accepted: true as const, event };
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-enterprise-trade-accounting',
    };
  }
}

export function hasOpenTradeAccounting(e: EnterpriseState): boolean {
  return Object.values(e.tradeAccounting?.contracts ?? {}).some((p) => p.phase === 'funded');
}
