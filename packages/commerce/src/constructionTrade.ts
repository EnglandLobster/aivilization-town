import {
  principalId,
  samePrincipal,
  validResourcePrincipal,
  assertPrincipalAuthorization,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import {
  createMoneyTransfer,
  economicAccount,
  type AccountingTransaction,
} from '@aivilization/economy';
import { EVIDENCE_TRADE_ESCROW } from './tradeEscrow';
import { tradeFactsEqual, tradeMoneyMicros } from './tradeFacts';
import { validResourceSaleAccount } from './resourceSaleFacts';
import { observeConstructionTradeFacts } from './constructionTradeFacts';
import {
  CONSTRUCTION_TRADE_POLICY as POLICY,
  type ConstructionTradeState,
  type ConstructionTradeCommand,
  type ConstructionTradeOrder,
  type ConstructionTradeEvent,
  type ConstructionTradePorts,
  type ConstructionTradeDecision,
} from './constructionTradeModel';
import type { PrincipalTradeAccount } from './principalTradeModel';
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
const no = (reason: string): ConstructionTradeDecision => ({ accepted: false, reason });
const terminal = (o: ConstructionTradeOrder) =>
  ['completed', 'settled', 'cancelled'].includes(o.status);
function constructionTransfer(
  receiptId: string,
  purpose: 'fund' | 'pay' | 'refund',
  a: PrincipalTradeAccount,
  micros: number,
) {
  return createMoneyTransfer({
    transactionId: `${receiptId}-${purpose}`,
    reason: `construction-trade-${purpose}`,
    from: purpose === 'fund' ? economicAccount(a.sector, a.id) : EVIDENCE_TRADE_ESCROW,
    to: purpose === 'fund' ? EVIDENCE_TRADE_ESCROW : economicAccount(a.sector, a.id),
    amount: micros / 1e6,
  });
}
export function emptyConstructionTradeState(): ConstructionTradeState {
  return { policy: POLICY, orders: {}, receipts: {} };
}
export function constructionTradeRequest(c: ConstructionTradeCommand): PrincipalOperationRequest {
  return {
    resourceKind: c.type === 'offer' ? 'construction-project' : 'construction-order',
    resourceId: c.type === 'offer' ? c.terms.projectId : c.id,
    resourceRevision: c.type === 'offer' ? c.terms.sourceRevision : c.expectedRevision,
    controlVersion: 1,
    operation: { capability: `construction-trades.${c.type}`, arguments: structuredClone(c) },
  };
}
export function constructionTradeAccountObligations(
  s: ConstructionTradeState | undefined,
  a: PrincipalTradeAccount,
) {
  return Object.values(s?.orders ?? {}).some(
    (o) =>
      o.fundedMicros > 0 && !terminal(o) && [o.payer, o.revenue].some((x) => tradeFactsEqual(x, a)),
  );
}
export function constructionTradeIncomingMicros(
  s: ConstructionTradeState | undefined,
  a: PrincipalTradeAccount,
) {
  return Object.values(s?.orders ?? {}).reduce(
    (n, o) => n + ([o.payer, o.revenue].some((x) => tradeFactsEqual(x, a)) ? o.escrowMicros : 0),
    0,
  );
}
export function constructionTradeEscrowMicros(s: ConstructionTradeState | undefined) {
  return Object.values(s?.orders ?? {}).reduce((n, o) => n + o.escrowMicros, 0);
}
export function decideConstructionTrade(
  s: ConstructionTradeState,
  actorId: string,
  at: number,
  receiptId: string,
  c: ConstructionTradeCommand,
  ports: ConstructionTradePorts,
): ConstructionTradeDecision {
  try {
    if (!tradeFactsEqual(s.policy, POLICY)) return no('unsupported-construction-trade-policy');
    if (
      !time(at) ||
      !principalId(actorId) ||
      !principalId(receiptId) ||
      receiptId.startsWith('construction-expiry:') ||
      !ports.exists(actorId)
    )
      return no('invalid-construction-trade-context');
    const retry = s.receipts[receiptId];
    if (retry)
      return retry.actorId === actorId && tradeFactsEqual(retry.command, c)
        ? { accepted: true, events: [], transactions: [] }
        : no('construction-trade-receipt-conflict');
    const previous = c.type === 'offer' ? undefined : s.orders[c.id];
    if (
      c.type !== 'offer' &&
      (!previous || previous.revision !== c.expectedRevision || at < previous.at)
    )
      return no('construction-trade-stale-order');
    if (previous && terminal(previous)) return no('construction-trade-closed');
    const terms = c.type === 'offer' ? c.terms : previous!;
    if (
      !principalId(terms.id) ||
      !principalId(terms.projectId) ||
      !validResourcePrincipal(terms.seller) ||
      !validResourcePrincipal(terms.buyer) ||
      samePrincipal(terms.seller, terms.buyer) ||
      !validResourceSaleAccount(terms.payer) ||
      !validResourceSaleAccount(terms.revenue) ||
      tradeFactsEqual(terms.payer, terms.revenue)
    )
      return no('invalid-construction-trade-parties');
    const payer = ports.account(terms.payer),
      revenue = ports.account(terms.revenue);
    if (
      !payer ||
      !revenue ||
      !samePrincipal(payer.principal, terms.buyer) ||
      !samePrincipal(revenue.principal, terms.seller)
    )
      return no('construction-trade-account-subject-mismatch');
    const side = c.type === 'offer' ? 'seller' : c.side;
    if (!['seller', 'buyer'].includes(side) || (c.type === 'accept' && side !== 'buyer'))
      return no('construction-trade-independent-buyer-required');
    const request = constructionTradeRequest(c),
      authorization = ports.authorize(terms[side], request);
    if (!authorization) return no('construction-trade-unauthorized');
    assertPrincipalAuthorization(authorization, terms[side], request, actorId);
    const raw = ports.evidence(terms.projectId);
    const basis = previous?.basis ?? raw?.basis;
    if (!basis) return no('construction-trade-source-unavailable');
    const observed = observeConstructionTradeFacts(basis, previous?.evidence, raw, at);
    if (!observed.accepted) return no(observed.reason);
    const evidence = observed.observation.evidence;
    if (!samePrincipal(basis.beneficiary, terms.buyer) || basis.projectId !== terms.projectId)
      return no('construction-trade-beneficiary-mismatch');
    const total = tradeMoneyMicros(terms.amount);
    if (total <= 0 || terms.amount > POLICY.maxAmount)
      return no('invalid-construction-trade-amount');
    let order: ConstructionTradeOrder;
    const transactions: AccountingTransaction[] = [];
    const transfer = (
      purpose: 'fund' | 'pay' | 'refund',
      a: PrincipalTradeAccount,
      micros: number,
    ) => {
      if (micros) transactions.push(constructionTransfer(receiptId, purpose, a, micros));
    };
    const settle = (
      o: ConstructionTradeOrder,
      pay: number,
      status: 'completed' | 'settled',
    ): ConstructionTradeOrder => {
      const refund = o.escrowMicros - pay;
      if (
        pay < 0 ||
        refund < 0 ||
        tradeMoneyMicros(revenue.incomingCapacity) < pay ||
        tradeMoneyMicros(payer.incomingCapacity) < refund
      )
        throw Error('construction-trade-receiving-capacity');
      transfer('pay', o.revenue, pay);
      transfer('refund', o.payer, refund);
      return {
        ...o,
        status,
        escrowMicros: 0,
        paidMicros: o.paidMicros + pay,
        refundedMicros: o.refundedMicros + refund,
      };
    };
    if (c.type === 'offer') {
      if (
        s.orders[terms.id] ||
        Object.values(s.orders).some(
          (o) => o.projectId === terms.projectId && !['offered', 'cancelled'].includes(o.status),
        )
      )
        return no('construction-trade-project-already-bound');
      if (Object.keys(s.orders).length >= POLICY.maxOrders)
        return no('construction-trade-capacity');
      if (
        evidence.revision !== terms.sourceRevision ||
        evidence.status !== 'open' ||
        evidence.progressMs !== 0
      )
        return no('construction-trade-unstarted-source-required');
      if (
        !time(terms.acceptBy) ||
        terms.acceptBy <= at ||
        terms.acceptBy - at > POLICY.maxWindowMs ||
        !terms.title.trim() ||
        terms.title.length > 160 ||
        !terms.terms.trim() ||
        terms.terms.length > POLICY.maxTermsChars
      )
        return no('invalid-construction-trade-terms');
      if (payer.status !== 'open' || revenue.status !== 'open')
        return no('construction-trade-account-not-open');
      order = {
        ...structuredClone(terms),
        basis: structuredClone(basis),
        evidence,
        revision: 1,
        createdAt: at,
        at,
        status: 'offered',
        fundedMicros: 0,
        escrowMicros: 0,
        paidMicros: 0,
        refundedMicros: 0,
      };
    } else {
      order = { ...previous!, evidence, revision: previous!.revision + 1, at };
      if (c.type === 'accept') {
        if (
          Object.values(s.orders).some(
            (o) =>
              o.id !== order.id &&
              o.projectId === order.projectId &&
              !['offered', 'cancelled'].includes(o.status),
          )
        )
          return no('construction-trade-project-already-bound');
        if (
          order.status !== 'offered' ||
          at >= order.acceptBy ||
          evidence.revision !== order.sourceRevision ||
          evidence.status !== 'open' ||
          evidence.progressMs !== 0
        )
          return no('construction-trade-offer-not-acceptable');
        if (
          payer.status !== 'open' ||
          revenue.status !== 'open' ||
          tradeMoneyMicros(payer.balance) < total ||
          tradeMoneyMicros(revenue.incomingCapacity) < total ||
          !Number.isSafeInteger(constructionTradeEscrowMicros(s) + total)
        )
          return no('construction-trade-funding-unavailable');
        transfer('fund', order.payer, total);
        order = { ...order, status: 'funded', fundedMicros: total, escrowMicros: total };
      } else if (c.type === 'withdraw') {
        order = { ...order, status: order.status === 'offered' ? 'cancelled' : 'disputed' };
      } else if (c.type === 'observe') {
        if (order.status === 'offered') return no('construction-trade-not-funded');
        if (evidence.status === 'completed') order = settle(order, order.escrowMicros, 'completed');
        else if (evidence.status === 'cancelled') order = { ...order, status: 'disputed' };
      } else if (c.type === 'propose-settlement') {
        if (
          !['funded', 'disputed'].includes(order.status) ||
          !principalId(c.proposalId) ||
          !c.text.trim() ||
          c.text.length > POLICY.maxTermsChars
        )
          return no('invalid-construction-trade-settlement');
        const pay = tradeMoneyMicros(c.paySeller);
        if (pay > order.escrowMicros) return no('invalid-construction-trade-settlement-amount');
        order = {
          ...order,
          settlement: { id: c.proposalId, actorId, side, paySellerMicros: pay, text: c.text },
        };
      } else if (c.type === 'accept-settlement') {
        const proposal = order.settlement;
        if (!proposal || proposal.id !== c.proposalId || proposal.side === side)
          return no('construction-trade-independent-settlement-required');
        order = settle(order, proposal.paySellerMicros, 'settled');
      } else return no('unknown-construction-trade-command');
    }
    const event: ConstructionTradeEvent = {
      type: 'ConstructionTradeCommitted',
      receiptId,
      actorId,
      command: structuredClone(c),
      authorization: structuredClone(authorization),
      previousRevision: previous?.revision ?? 0,
      order,
      transactions,
    };
    return { accepted: true, events: [event], transactions };
  } catch (e) {
    return no(e instanceof Error ? e.message : 'invalid-construction-trade');
  }
}
/** Only an unpaid offer expires; elapsed time never erases funded performance or escrow. */
export function expireConstructionTradeOffers(
  s: ConstructionTradeState,
  at: number,
): ConstructionTradeDecision {
  if (!time(at) || !tradeFactsEqual(s.policy, POLICY))
    return no('invalid-construction-trade-expiry');
  const events: ConstructionTradeEvent[] = Object.values(s.orders)
    .filter((o) => o.status === 'offered' && o.acceptBy <= at)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((o) => ({
      type: 'ConstructionTradeOfferExpired',
      receiptId: `construction-expiry:${o.id}:${o.revision}`,
      actorId: 'system',
      command: { type: 'expire', id: o.id, expectedRevision: o.revision },
      previousRevision: o.revision,
      order: { ...structuredClone(o), revision: o.revision + 1, at, status: 'cancelled' },
      transactions: [],
    }));
  return { accepted: true, events, transactions: [] };
}
/** Validate the recorded transition without executing a command or querying current policy/ports. */
function assertRecordedConstructionTransition(
  old: ConstructionTradeOrder | undefined,
  e: ConstructionTradeEvent,
) {
  if (e.type !== 'ConstructionTradeCommitted') return;
  const c = e.command,
    o = e.order;
  const observed = observeConstructionTradeFacts(o.basis, old?.evidence, o.evidence, o.at);
  if (!observed.accepted) throw Error(observed.reason);
  let expected: ConstructionTradeOrder;
  if (c.type === 'offer') {
    if (
      old ||
      o.createdAt !== o.at ||
      o.evidence.progressMs !== 0 ||
      o.evidence.status !== 'open' ||
      o.evidence.revision !== c.terms.sourceRevision ||
      !samePrincipal(o.basis.beneficiary, c.terms.buyer) ||
      !time(c.terms.acceptBy) ||
      c.terms.acceptBy <= o.at
    )
      throw Error('construction-trade-invalid-recorded-offer');
    expected = {
      ...structuredClone(c.terms),
      basis: o.basis,
      evidence: o.evidence,
      revision: 1,
      at: o.at,
      createdAt: o.at,
      status: 'offered',
      fundedMicros: 0,
      escrowMicros: 0,
      paidMicros: 0,
      refundedMicros: 0,
    };
  } else {
    if (!old || c.expectedRevision !== old.revision)
      throw Error('construction-trade-invalid-recorded-revision');
    expected = { ...old, evidence: o.evidence, revision: old.revision + 1, at: o.at };
    if (c.type === 'accept') {
      if (
        c.side !== 'buyer' ||
        old.status !== 'offered' ||
        o.at >= old.acceptBy ||
        o.evidence.status !== 'open' ||
        o.evidence.progressMs !== 0 ||
        o.evidence.revision !== old.sourceRevision
      )
        throw Error('construction-trade-invalid-recorded-acceptance');
      expected = {
        ...expected,
        status: 'funded',
        fundedMicros: tradeMoneyMicros(old.amount),
        escrowMicros: tradeMoneyMicros(old.amount),
      };
    } else if (c.type === 'withdraw')
      expected = { ...expected, status: old.status === 'offered' ? 'cancelled' : 'disputed' };
    else if (c.type === 'observe') {
      if (old.status === 'offered') throw Error('construction-trade-recorded-unfunded-observation');
      if (o.evidence.status === 'completed')
        expected = {
          ...expected,
          status: 'completed',
          paidMicros: old.paidMicros + old.escrowMicros,
          escrowMicros: 0,
        };
      else if (o.evidence.status === 'cancelled') expected = { ...expected, status: 'disputed' };
    } else if (c.type === 'propose-settlement') {
      if (
        !['funded', 'disputed'].includes(old.status) ||
        tradeMoneyMicros(c.paySeller) > old.escrowMicros
      )
        throw Error('construction-trade-invalid-recorded-split');
      expected = {
        ...expected,
        settlement: {
          id: c.proposalId,
          side: c.side,
          actorId: e.actorId,
          paySellerMicros: tradeMoneyMicros(c.paySeller),
          text: c.text,
        },
      };
    } else if (c.type === 'accept-settlement') {
      const p = old.settlement;
      if (!p || p.id !== c.proposalId || p.side === c.side)
        throw Error('construction-trade-invalid-recorded-settlement');
      expected = {
        ...expected,
        status: 'settled',
        escrowMicros: 0,
        paidMicros: old.paidMicros + p.paySellerMicros,
        refundedMicros: old.refundedMicros + old.escrowMicros - p.paySellerMicros,
      };
    } else throw Error('unknown-construction-trade-command');
  }
  if (!tradeFactsEqual(expected, o)) throw Error('construction-trade-recorded-effect-mismatch');
}
export function applyConstructionTradeEvent(
  s: ConstructionTradeState,
  e: ConstructionTradeEvent,
): ConstructionTradeState {
  const prior = s.receipts[e.receiptId];
  if (prior) {
    if (!tradeFactsEqual(prior, e)) throw Error('construction-trade-replay-conflict');
    return s;
  }
  const old = s.orders[e.order.id];
  if ((old?.revision ?? 0) !== e.previousRevision || e.order.revision !== e.previousRevision + 1)
    throw Error('construction-trade-replay-revision');
  const o = e.order;
  assertRecordedConstructionTransition(old, e);
  if (
    e.type === 'ConstructionTradeCommitted' &&
    e.command.type === 'accept' &&
    Object.values(s.orders).some(
      (other) =>
        other.id !== o.id &&
        other.projectId === o.projectId &&
        !['offered', 'cancelled'].includes(other.status),
    )
  )
    throw Error('construction-trade-project-already-bound');
  if (old && terminal(old)) throw Error('construction-trade-replay-closed');
  if (!time(o.at) || (old && o.at < old.at)) throw Error('construction-trade-replay-time');
  if (e.type === 'ConstructionTradeOfferExpired') {
    if (
      !old ||
      e.actorId !== 'system' ||
      e.command.id !== o.id ||
      e.command.expectedRevision !== e.previousRevision ||
      e.receiptId !== `construction-expiry:${o.id}:${e.previousRevision}` ||
      old.status !== 'offered' ||
      o.at < old.acceptBy ||
      !tradeFactsEqual(o, { ...old, revision: old.revision + 1, at: o.at, status: 'cancelled' }) ||
      e.transactions.length
    )
      throw Error('invalid-construction-trade-expiry-event');
  } else {
    const c = e.command;
    if ((c.type === 'offer' ? c.terms.id : c.id) !== o.id)
      throw Error('construction-trade-replay-order');
    assertPrincipalAuthorization(
      e.authorization,
      c.type === 'offer' ? o.seller : o[c.side],
      constructionTradeRequest(c),
      e.actorId,
    );
  }
  if (old) {
    for (const key of [
      'id',
      'projectId',
      'sourceRevision',
      'seller',
      'buyer',
      'payer',
      'revenue',
      'amount',
      'acceptBy',
      'title',
      'terms',
      'basis',
      'createdAt',
    ] as const)
      if (!tradeFactsEqual(old[key], o[key]))
        throw Error('construction-trade-replay-terms-changed');
  }
  const expected: AccountingTransaction[] = [];
  for (const [purpose, key, account] of [
    ['fund', 'fundedMicros', o.payer],
    ['pay', 'paidMicros', o.revenue],
    ['refund', 'refundedMicros', o.payer],
  ] as const) {
    const delta = o[key] - (old?.[key] ?? 0);
    if (!time(delta)) throw Error('construction-trade-replay-money-regressed');
    if (delta) expected.push(constructionTransfer(e.receiptId, purpose, account, delta));
  }
  if (!tradeFactsEqual(expected, e.transactions))
    throw Error('construction-trade-replay-transactions');
  if (
    ![o.fundedMicros, o.escrowMicros, o.paidMicros, o.refundedMicros].every(time) ||
    o.fundedMicros !== o.escrowMicros + o.paidMicros + o.refundedMicros
  )
    throw Error('construction-trade-unbalanced-state');
  return {
    ...s,
    orders: { ...s.orders, [o.id]: structuredClone(o) },
    receipts: { ...s.receipts, [e.receiptId]: structuredClone(e) },
  };
}

/** Earliest unpaid acceptance deadline only; funded responsibilities do not expire with time. */
export function nextConstructionTradeBoundary(
  s: ConstructionTradeState | undefined,
  after: number,
): number | undefined {
  const times = Object.values(s?.orders ?? {})
    .filter((o) => o.status === 'offered' && o.acceptBy > after)
    .map((o) => o.acceptBy);
  return times.length ? Math.min(...times) : undefined;
}
