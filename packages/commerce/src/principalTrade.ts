import {
  assertPrincipalAuthorization,
  samePrincipal,
  validResourcePrincipal,
  principalId,
  type PrincipalOperationRequest,
  type ResourcePrincipal,
} from '@aivilization/authority';
import {
  cumulativeUnitAllocation,
  createMoneyTransfer,
  economicAccount,
  type AccountingTransaction,
} from '@aivilization/economy';
import { EVIDENCE_TRADE_ESCROW } from './tradeEscrow';
import { tradeFactsEqual, tradeMoneyMicros } from './tradeFacts';
import { validPermitTradeBasis, validPermitTradeEvidence } from './tradePermitFacts';
import {
  PRINCIPAL_EVIDENCE_TRADE_POLICY as POLICY,
  type PrincipalTradeAccount,
  type PrincipalTradeCommand,
  type PrincipalTradeDecision,
  type PrincipalTradeEvent,
  type PrincipalTradeOrder,
  type PrincipalTradeParent,
  type PrincipalTradePorts,
  type PrincipalTradeReceipt,
  type PrincipalPermitTradeEvidence,
} from './principalTradeModel';
import type { EvidenceTradeState } from './tradeModel';
const no = (reason: string): PrincipalTradeDecision => ({ accepted: false, reason });
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
const sameAccount = (a: PrincipalTradeAccount, b: PrincipalTradeAccount) =>
  a.sector === b.sector && a.id === b.id;
function accountValid(a: PrincipalTradeAccount) {
  return (
    !!a &&
    Object.keys(a).length === 2 &&
    ['agent', 'collective', 'enterprise', 'treasury'].includes(a.sector) &&
    principalId(a.id) &&
    (a.sector !== 'treasury' || a.id === 'public-treasury')
  );
}
export function assertPrincipalTradePolicy(p: typeof POLICY) {
  if (!tradeFactsEqual(p, POLICY)) throw Error('unsupported-principal-trade-policy');
}
export function validPrincipalTradeEvidence(e: PrincipalPermitTradeEvidence, at: number) {
  return (
    e.sourceVersion === 'principal-premises-provision-v2' &&
    e.basis.principalVersion === 'resident-premises-principal-permits-v2' &&
    validResourcePrincipal(e.basis.seller) &&
    validResourcePrincipal(e.basis.buyer) &&
    !samePrincipal(e.basis.seller, e.basis.buyer) &&
    validPermitTradeBasis(e.basis) &&
    validPermitTradeEvidence(e) &&
    time(e.at) &&
    e.at >= e.basis.createdAt &&
    e.at <= at
  );
}
export function principalTradeForSource(parent: PrincipalTradeParent | undefined, id: string) {
  return Object.values(parent?.principalOrders?.orders ?? {}).find((o) => o.source.id === id);
}
export function principalTradeRequest(
  parent: PrincipalTradeParent,
  c: PrincipalTradeCommand,
  evidence?: PrincipalPermitTradeEvidence,
): PrincipalOperationRequest {
  if (c.type === 'offer') {
    if (!evidence) throw Error('principal-trade-source-required');
    return {
      resourceKind: 'premises-permit',
      resourceId: c.source.id,
      resourceRevision: c.source.expectedRevision,
      controlVersion: evidence.basis.issuerVersion,
      operation: { capability: 'trades.offer', arguments: structuredClone(c) },
    };
  }
  const o = parent.principalOrders?.orders[c.id];
  if (!o) throw Error('principal-trade-order-not-found');
  return {
    resourceKind: 'evidence-order',
    resourceId: o.id,
    resourceRevision: c.expectedRevision,
    controlVersion: 1,
    operation: { capability: `trades.${c.type}`, arguments: structuredClone(c) },
  };
}
export function principalTradeSubject(
  parent: PrincipalTradeParent,
  c: PrincipalTradeCommand,
  evidence?: PrincipalPermitTradeEvidence,
): ResourcePrincipal {
  if (c.type === 'offer') {
    if (!evidence) throw Error('principal-trade-source-required');
    return evidence.basis.seller;
  }
  const o = parent.principalOrders?.orders[c.id];
  if (!o) throw Error('principal-trade-order-not-found');
  return c.type === 'accept' ? o.source.buyer : o.source[c.side];
}
function transfer(
  receiptId: string,
  purpose: 'fund' | 'pay' | 'refund',
  account: PrincipalTradeAccount,
  micros: number,
): AccountingTransaction {
  return createMoneyTransfer({
    transactionId: `${receiptId}-${purpose}`,
    reason: `principal-evidence-trade-${purpose}`,
    from: purpose === 'fund' ? economicAccount(account.sector, account.id) : EVIDENCE_TRADE_ESCROW,
    to: purpose === 'fund' ? EVIDENCE_TRADE_ESCROW : economicAccount(account.sector, account.id),
    amount: micros / POLICY.moneyScale,
  });
}
function receiptId(id: string, revision: number) {
  return `principal-trade-${id}-${revision}`;
}
function unstarted(e: PrincipalPermitTradeEvidence) {
  return e.status === 'offered' && e.acceptedAt === undefined && !e.provision;
}
function transition(
  parent: PrincipalTradeParent,
  r: PrincipalTradeReceipt,
  e: PrincipalPermitTradeEvidence,
): PrincipalTradeDecision {
  if (!validPrincipalTradeEvidence(e, r.at) || !time(r.at) || !principalId(r.actorId))
    return no('invalid-principal-trade-evidence-or-receipt');
  const old = parent.principalOrders?.orders[r.orderId],
    c = r.command,
    transactions: AccountingTransaction[] = [];
  let order: PrincipalTradeOrder;
  if (r.operation === 'offer') {
    if (
      !c ||
      c.type !== 'offer' ||
      old ||
      parent.orders[c.id] ||
      c.id !== r.orderId ||
      r.previousRevision !== 0 ||
      r.side !== 'seller' ||
      Object.keys(parent.principalOrders?.orders ?? {}).length >= POLICY.maxOrders ||
      principalTradeForSource(parent, e.basis.id) ||
      Object.values(parent.orders).some(
        (o) => o.source.kind === 'permit' && o.source.id === e.basis.id,
      ) ||
      !principalId(c.id) ||
      c.id.length > 60 ||
      !c.title.trim() ||
      c.title.length > 120 ||
      !c.terms.trim() ||
      c.terms.length > POLICY.maxTermsChars ||
      !accountValid(c.payer) ||
      !accountValid(c.revenue) ||
      sameAccount(c.payer, c.revenue) ||
      c.source.kind !== 'permit' ||
      c.source.id !== e.basis.id ||
      c.source.expectedRevision !== e.revision ||
      !unstarted(e) ||
      !time(c.acceptBy) ||
      c.acceptBy <= r.at ||
      c.acceptBy > e.basis.acceptBy ||
      c.acceptBy - r.at > POLICY.maxWindowMs ||
      c.amount <= 0 ||
      c.amount > POLICY.maxAmount
    )
      return no('invalid-principal-trade-offer-or-used-source');
    const amount = tradeMoneyMicros(c.amount);
    if (amount <= 0) return no('invalid-principal-trade-amount');
    if (
      Object.values(parent.principalOrders?.orders ?? {}).filter((o) =>
        samePrincipal(o.source.seller, e.basis.seller),
      ).length >= POLICY.maxPerSeller
    )
      return no('principal-trade-seller-order-limit');
    if (!r.authorization) return no('principal-trade-authorization-required');
    assertPrincipalAuthorization(
      r.authorization,
      e.basis.seller,
      principalTradeRequest(parent, c, e),
      r.actorId,
    );
    order = {
      id: c.id,
      title: c.title,
      terms: c.terms,
      source: structuredClone(e.basis),
      payer: { ...c.payer },
      revenue: { ...c.revenue },
      amount: c.amount,
      acceptBy: c.acceptBy,
      offeredAuthorization: structuredClone(r.authorization),
      createdAt: r.at,
      at: r.at,
      revision: 1,
      status: 'offered',
      fundedMicros: 0,
      earnedMicros: 0,
      escrowMicros: 0,
      paidMicros: 0,
      refundedMicros: 0,
      evidence: structuredClone(e),
    };
  } else {
    if (
      !old ||
      ['settled', 'cancelled', 'expired'].includes(old.status) ||
      r.previousRevision !== old.revision ||
      old.revision >= Number.MAX_SAFE_INTEGER ||
      r.at < old.at ||
      !tradeFactsEqual(old.source, e.basis) ||
      e.revision < old.evidence.revision ||
      (e.revision === old.evidence.revision && !tradeFactsEqual(e, old.evidence))
    )
      return no('principal-trade-ended-or-source-revised');
    if (r.side === 'system') {
      if (
        r.actorId !== 'system' ||
        r.authorization ||
        c ||
        !['observe', 'expire'].includes(r.operation)
      )
        return no('invalid-principal-trade-system-receipt');
    } else {
      if (
        !c ||
        c.type === 'offer' ||
        c.type !== r.operation ||
        c.id !== old.id ||
        c.expectedRevision !== old.revision ||
        !r.authorization ||
        r.side !== (c.type === 'accept' ? 'buyer' : c.side)
      )
        return no('principal-trade-command-receipt-mismatch');
      assertPrincipalAuthorization(
        r.authorization,
        old.source[r.side],
        principalTradeRequest(parent, c),
        r.actorId,
      );
    }
    order = { ...old, revision: old.revision + 1, at: r.at, evidence: structuredClone(e) };
    if (r.operation === 'accept') {
      if (
        old.status !== 'offered' ||
        r.side !== 'buyer' ||
        r.at >= old.acceptBy ||
        !unstarted(e) ||
        !r.authorization
      )
        return no('principal-trade-unstarted-buyer-offer-required');
      const amount = tradeMoneyMicros(old.amount);
      if (!Number.isSafeInteger(principalTradeEscrowMicros(parent) + amount))
        return no('principal-trade-total-escrow-limit');
      transactions.push(transfer(receiptId(old.id, order.revision), 'fund', old.payer, amount));
      order = {
        ...order,
        status: 'funded',
        fundedMicros: amount,
        escrowMicros: amount,
        acceptedAuthorization: structuredClone(r.authorization),
      };
    } else if (r.operation === 'withdraw' || r.operation === 'expire') {
      if (
        old.status !== 'offered' ||
        (r.operation === 'expire' && (r.side !== 'system' || r.at < old.acceptBy))
      )
        return no('principal-trade-unfunded-offer-required');
      order = { ...order, status: r.operation === 'expire' ? 'expired' : 'cancelled' };
    } else if (r.operation === 'observe') {
      const q = e.provision;
      if (old.status !== 'funded' || !q || q.orderId !== old.id || e.acceptedAt === undefined)
        return no('principal-trade-recorded-provision-required');
      const duration = old.source.endAt - old.source.startAt;
      const earned = cumulativeUnitAllocation(old.fundedMicros, q.availableMs, duration),
        elapsedShare = cumulativeUnitAllocation(
          old.fundedMicros,
          q.availableMs + q.unavailableMs,
          duration,
        );
      const terminal =
        ['released', 'expired'].includes(e.status) || q.settledAt >= old.source.endAt;
      const refunded = terminal ? old.fundedMicros - earned : elapsedShare - earned;
      if (earned < old.earnedMicros || refunded < old.refundedMicros)
        return no('principal-trade-provision-regressed');
      const pay = earned - old.paidMicros,
        refund = refunded - old.refundedMicros;
      if (pay < 0 || refund < 0) return no('principal-trade-ledger-regressed');
      if (pay)
        transactions.push(transfer(receiptId(old.id, order.revision), 'pay', old.revenue, pay));
      if (refund)
        transactions.push(transfer(receiptId(old.id, order.revision), 'refund', old.payer, refund));
      order = {
        ...order,
        earnedMicros: earned,
        paidMicros: earned,
        refundedMicros: refunded,
        escrowMicros: old.fundedMicros - earned - refunded,
        status: terminal ? 'settled' : 'funded',
      };
    } else return no('unsupported-principal-trade-operation');
  }
  if (
    r.id !== receiptId(order.id, order.revision) ||
    !time(order.escrowMicros) ||
    order.fundedMicros !== order.paidMicros + order.refundedMicros + order.escrowMicros
  )
    return no('principal-trade-ledger-or-receipt-mismatch');
  return {
    accepted: true,
    events: [
      {
        type: 'PrincipalTradeCommitted',
        order,
        receipt: structuredClone(r),
        evidence: structuredClone(e),
      },
    ],
    transactions,
  };
}
export function decidePrincipalEvidenceTrade(
  parent: PrincipalTradeParent,
  actorId: string,
  at: number,
  c: PrincipalTradeCommand,
  ports: PrincipalTradePorts,
): PrincipalTradeDecision {
  const s = parent.principalOrders;
  if (!s) return no('principal-trade-not-enabled');
  if (!time(at) || !ports.exists(actorId)) return no('invalid-principal-trade-actor-or-time');
  try {
    assertPrincipalTradePolicy(s.policy);
    const old = c.type === 'offer' ? undefined : s.orders[c.id];
    if (c.type !== 'offer' && (!old || old.revision !== c.expectedRevision))
      return no('principal-trade-version-conflict');
    const evidence = ports.evidence(c.type === 'offer' ? c.source.id : old!.source.id);
    if (!evidence) return no('principal-trade-source-unavailable');
    const subject = principalTradeSubject(parent, c, evidence),
      request = principalTradeRequest(parent, c, evidence);
    if (!ports.available(subject)) return no('principal-trade-party-unavailable');
    const authorization = ports.authorize(subject, request);
    if (!authorization) return no('principal-trade-authority-required');
    assertPrincipalAuthorization(authorization, subject, request, actorId);
    const payer = ports.account(c.type === 'offer' ? c.payer : old!.payer),
      revenue = ports.account(c.type === 'offer' ? c.revenue : old!.revenue);
    if (
      !payer ||
      !revenue ||
      ![payer.balance, revenue.balance].every((n) => Number.isFinite(n) && n >= 0) ||
      !samePrincipal(payer.principal, evidence.basis.buyer) ||
      !samePrincipal(revenue.principal, evidence.basis.seller)
    )
      return no('principal-trade-party-accounts-required');
    if (
      ['offer', 'accept'].includes(c.type) &&
      (payer.status !== 'open' ||
        revenue.status !== 'open' ||
        ![evidence.basis.seller, evidence.basis.buyer].every(ports.available))
    )
      return no('principal-trade-party-accounts-unavailable');
    if (c.type === 'accept' && payer.balance < old!.amount)
      return no('insufficient-principal-trade-balance');
    const revision = (old?.revision ?? 0) + 1;
    return transition(
      parent,
      {
        id: receiptId(c.id, revision),
        orderId: c.id,
        previousRevision: old?.revision ?? 0,
        actorId,
        at,
        operation: c.type,
        side: c.type === 'offer' ? 'seller' : c.type === 'accept' ? 'buyer' : c.side,
        authorization,
        command: structuredClone(c),
      },
      evidence,
    );
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-principal-trade-command');
  }
}
export function applyPrincipalEvidenceTradeCommit(
  parent: EvidenceTradeState,
  events: readonly PrincipalTradeEvent[],
  transactions: readonly AccountingTransaction[] = [],
): EvidenceTradeState {
  if (events.length !== 1) throw Error('invalid-principal-trade-packet');
  const event = events[0]!;
  if (event.type === 'PrincipalEvidenceTradeEnabled') {
    if (
      parent.principalOrders ||
      parent.policy.version !== 'resident-evidence-trade-v2' ||
      transactions.length
    )
      throw Error('invalid-principal-trade-activation');
    assertPrincipalTradePolicy(event.policy);
    return {
      ...parent,
      principalOrders: { policy: structuredClone(event.policy), orders: {}, receipts: {} },
    };
  }
  const s = parent.principalOrders;
  if (!s) throw Error('principal-trade-not-enabled');
  assertPrincipalTradePolicy(s.policy);
  if (s.receipts[event.receipt.id]) throw Error('duplicate-principal-trade-receipt');
  const d = transition(parent, event.receipt, event.evidence);
  if (
    !d.accepted ||
    !tradeFactsEqual(d.events, events) ||
    !tradeFactsEqual(d.transactions, transactions)
  )
    throw Error('principal-trade-facts-or-accounting-mismatch');
  return {
    ...parent,
    principalOrders: {
      ...s,
      orders: { ...s.orders, [event.order.id]: structuredClone(event.order) },
      receipts: { ...s.receipts, [event.receipt.id]: structuredClone(event.receipt) },
    },
  };
}
export function advancePrincipalEvidenceTrade(
  parent: PrincipalTradeParent,
  id: string,
  at: number,
  ports: Pick<PrincipalTradePorts, 'evidence'>,
): PrincipalTradeDecision {
  const o = parent.principalOrders?.orders[id],
    unchanged: PrincipalTradeDecision = { accepted: true, events: [], transactions: [] };
  if (!o || ['settled', 'cancelled', 'expired'].includes(o.status)) return unchanged;
  const operation =
    o.status === 'offered' && at >= o.acceptBy
      ? 'expire'
      : o.status === 'funded'
        ? 'observe'
        : undefined;
  if (!operation) return unchanged;
  const evidence = ports.evidence(o.source.id);
  if (!evidence) return no('principal-trade-source-unavailable');
  if (operation === 'observe' && tradeFactsEqual(evidence, o.evidence)) return unchanged;
  return transition(
    parent,
    {
      id: receiptId(o.id, o.revision + 1),
      orderId: o.id,
      previousRevision: o.revision,
      actorId: 'system',
      at,
      operation,
      side: 'system',
    },
    evidence,
  );
}

export function principalTradeEscrowMicros(parent: PrincipalTradeParent | undefined): number {
  return Object.values(parent?.principalOrders?.orders ?? {}).reduce(
    (n, o) => n + o.escrowMicros,
    0,
  );
}
export function principalTradeAccountObligations(
  parent: PrincipalTradeParent | undefined,
  account: PrincipalTradeAccount,
): boolean {
  return Object.values(parent?.principalOrders?.orders ?? {}).some(
    (o) =>
      (o.status === 'offered' || o.status === 'funded') &&
      (sameAccount(o.payer, account) || sameAccount(o.revenue, account)),
  );
}
export function principalTradeReservedIncomingMicros(
  parent: PrincipalTradeParent | undefined,
  account: PrincipalTradeAccount,
): number {
  return Object.values(parent?.principalOrders?.orders ?? {}).reduce(
    (n, o) =>
      n +
      (o.status === 'funded' && (sameAccount(o.payer, account) || sameAccount(o.revenue, account))
        ? o.escrowMicros
        : 0),
    0,
  );
}

export function nextPrincipalTradeBoundary(
  parent: PrincipalTradeParent | undefined,
  at: number,
): number | undefined {
  const times = Object.values(parent?.principalOrders?.orders ?? {})
    .filter((o) => o.status === 'offered' && o.acceptBy > at)
    .map((o) => o.acceptBy);
  return times.length ? Math.min(...times) : undefined;
}
