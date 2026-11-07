import { decodeResourceSaleCommand } from './resourceSaleCommand';
import { assertPrincipalAuthorization, samePrincipal } from '@aivilization/authority';
import {
  createMoneyTransfer,
  economicAccount,
  type AccountingTransaction,
} from '@aivilization/economy';
import { tradeFactsEqual, tradeMoneyMicros } from './tradeFacts';
import {
  RESOURCE_SALES_POLICY as POLICY,
  RESOURCE_SALES_POLICY_V2,
  RESOURCE_SALES_CLEARING,
  type ResourceSalesState,
  type ResourceSaleCommand,
  type ResourceSaleDecision,
  type ResourceSalePorts,
  type ResourceSale,
  type ResourceSaleEvent,
} from './resourceSaleModel';
import {
  assertResourceSaleSource,
  assertResourceSalesPolicy,
  assertResourceSale,
  resourceSaleRequest,
  resourceSaleSubject,
  resourceSaleSourceDeliverable,
} from './resourceSaleFacts';
const no = (reason: string): ResourceSaleDecision => ({ accepted: false, reason });
export function emptyResourceSalesState(): ResourceSalesState {
  return { policy: POLICY, sales: {} };
}
export function resourceSaleTransactions(sale: ResourceSale): readonly AccountingTransaction[] {
  if (sale.status !== 'settled') return [];
  return [
    createMoneyTransfer({
      transactionId: `resource-sale-${sale.id}-${sale.revision}-pay`,
      reason: 'resource-sale-exchanged',
      from: economicAccount(sale.payer.sector, sale.payer.id),
      to: RESOURCE_SALES_CLEARING,
      amount: sale.amount,
    }),
    createMoneyTransfer({
      transactionId: `resource-sale-${sale.id}-${sale.revision}-receive`,
      reason: 'resource-sale-exchanged',
      from: RESOURCE_SALES_CLEARING,
      to: economicAccount(sale.revenue.sector, sale.revenue.id),
      amount: sale.amount,
    }),
  ];
}
/** Pure decision; the application independently verifies source reads and actual money/control before one commit. */
export function decideResourceSale(
  state: ResourceSalesState,
  actorId: string,
  at: number,
  c: ResourceSaleCommand,
  p: ResourceSalePorts,
): ResourceSaleDecision {
  try {
    c = decodeResourceSaleCommand(c);
    assertResourceSalesPolicy(state.policy);
    if (!p.exists(actorId) || !Number.isSafeInteger(at) || at < 0)
      return no('invalid-resource-sale-actor-or-time');
    const previous = state.sales[c.id],
      source = p.source(
        c.type === 'offer' ? c.resource.kind : (previous?.source.kind ?? 'premises'),
        c.type === 'offer' ? c.resource.id : (previous?.source.id ?? ''),
      );
    if (c.type === 'offer') {
      if (previous) return no('resource-sale-id-exists');
      if (!source) return no('resource-sale-source-required');
      assertResourceSaleSource(source, at);
      if (source.kind !== c.resource.kind || source.id !== c.resource.id)
        return no('resource-sale-source-target-mismatch');
      if (source.revision !== c.resource.expectedRevision)
        return no('resource-sale-resource-revision-conflict');
      if (!state.policy.resourceKinds.some((k) => k === source.kind))
        return no('resource-sale-kind-not-enabled');
      if (!resourceSaleSourceDeliverable(source))
        return no('resource-sale-resource-not-deliverable');
      if (at >= source.offer.expiresAt) return no('resource-sale-offer-expired');
      if (
        Object.values(state.sales).some(
          (s) =>
            s.source.id === source.id &&
            s.source.kind === source.kind &&
            s.source.controlVersion === source.controlVersion,
        )
      )
        return no('resource-sale-control-already-bound');
      if (
        Object.keys(state.sales).length >= POLICY.maxSales ||
        Object.values(state.sales).filter((s) => samePrincipal(s.source.seller, source.seller))
          .length >= POLICY.maxPerSeller
      )
        return no('resource-sale-limit');
    } else if (!previous || previous.status !== 'offered') return no('resource-sale-not-offered');
    else if (previous.revision !== c.expectedRevision) return no('resource-sale-revision-conflict');
    else if (at < previous.at || at >= previous.acceptBy)
      return no('resource-sale-expired-or-invalid-time');
    const subject = resourceSaleSubject(state, c, source),
      request = resourceSaleRequest(state, c, source),
      authorization = p.authorize(subject, request);
    if (!authorization) return no('resource-sale-authority-required');
    assertPrincipalAuthorization(authorization, subject, request, actorId);
    let sale: ResourceSale;
    if (c.type === 'offer') {
      if (!source) throw Error('resource-sale-source-required');
      const payer = p.account(c.payer),
        revenue = p.account(c.revenue);
      if (
        !p.available(source.seller) ||
        !p.available(source.offer.target) ||
        !payer ||
        !revenue ||
        payer.status !== 'open' ||
        revenue.status !== 'open' ||
        !samePrincipal(payer.principal, source.offer.target) ||
        !samePrincipal(revenue.principal, source.seller)
      )
        return no('resource-sale-account-or-party-mismatch');
      sale = {
        id: c.id,
        title: c.title,
        terms: c.terms,
        source: structuredClone(source),
        payer: { ...c.payer },
        revenue: { ...c.revenue },
        amount: c.amount,
        acceptBy: c.acceptBy,
        revision: 1,
        createdAt: at,
        at,
        status: 'offered',
        offeredAuthorization: structuredClone(authorization),
        paidMicros: 0,
      };
    } else {
      if (!previous) throw Error('resource-sale-not-found');
      sale = {
        ...previous,
        revision: previous.revision + 1,
        at,
        status: c.type === 'accept' ? 'settled' : c.type === 'withdraw' ? 'withdrawn' : 'declined',
        paidMicros: c.type === 'accept' ? tradeMoneyMicros(previous.amount) : 0,
        ...(c.type === 'accept' ? { acceptedAuthorization: structuredClone(authorization) } : {}),
      };
      if (c.type === 'accept') {
        if (!source || !tradeFactsEqual(source, previous.source))
          return no('resource-sale-owning-source-changed');
        if (!p.available(previous.source.seller) || !p.available(previous.source.offer.target))
          return no('resource-sale-party-unavailable');
        const payer = p.account(previous.payer),
          revenue = p.account(previous.revenue);
        if (
          !payer ||
          !revenue ||
          payer.status !== 'open' ||
          revenue.status !== 'open' ||
          !samePrincipal(payer.principal, previous.source.offer.target) ||
          !samePrincipal(revenue.principal, previous.source.seller)
        )
          return no('resource-sale-account-or-party-mismatch');
        if (!Number.isFinite(payer.balance) || payer.balance < previous.amount)
          return no('insufficient-resource-sale-funds');
        if (
          !Number.isFinite(revenue.balance) ||
          !Number.isFinite(revenue.maximumBalance) ||
          revenue.balance < 0 ||
          revenue.balance + previous.amount > revenue.maximumBalance
        )
          return no('resource-sale-revenue-capacity');
      }
    }
    assertResourceSale(sale);
    const event: ResourceSaleEvent = {
      type: 'ResourceSaleCommitted',
      previousRevision: previous?.revision ?? 0,
      sale,
      actorId,
      operation: c.type,
      command: structuredClone(c),
      authorization: structuredClone(authorization),
      ...(source ? { sourceRead: structuredClone(source) } : {}),
      transactions: resourceSaleTransactions(sale),
    };
    applyResourceSaleEvent(state, event);
    return { accepted: true, events: [event] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-resource-sale');
  }
}
export function expireResourceSale(
  state: ResourceSalesState,
  id: string,
  at: number,
): ResourceSaleDecision {
  const s = state.sales[id];
  if (!s || s.status !== 'offered' || at < s.acceptBy) return { accepted: true, events: [] };
  if (!Number.isSafeInteger(at) || at < 0) return no('invalid-resource-sale-expiry-time');
  const event: ResourceSaleEvent = {
    type: 'ResourceSaleCommitted',
    previousRevision: s.revision,
    sale: { ...s, revision: s.revision + 1, at, status: 'expired' },
    actorId: 'system',
    operation: 'expire',
    transactions: [],
  };
  try {
    applyResourceSaleEvent(state, event);
    return { accepted: true, events: [event] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-resource-sale-expiry');
  }
}
/** Replay verifies recorded immutable facts and authority scope, not current financial or physical decisions. */
export function applyResourceSaleEvent(
  state: ResourceSalesState | undefined,
  event: ResourceSaleEvent,
): ResourceSalesState {
  if (event.type === 'ResourceSalesEnabled') {
    if (state) throw Error('resource-sales-already-enabled');
    assertResourceSalesPolicy(event.policy);
    if (event.policy.version !== POLICY.version)
      throw Error('resource-sales-explicit-extension-required');
    return emptyResourceSalesState();
  }
  if (!state) throw Error('resource-sales-not-enabled');
  if (event.type === 'ResourceSalesPolicyExtended') {
    assertResourceSalesPolicy(state.policy);
    assertResourceSalesPolicy(event.policy);
    if (
      state.policy.version !== event.previousPolicyVersion ||
      state.policy.version !== POLICY.version ||
      event.policy.version !== RESOURCE_SALES_POLICY_V2.version
    )
      throw Error('invalid-resource-sales-extension');
    return { ...state, policy: structuredClone(event.policy) };
  }
  assertResourceSalesPolicy(state.policy);
  const s = event.sale,
    old = state.sales[s.id];
  assertResourceSale(s);
  if (!state.policy.resourceKinds.some((k) => k === s.source.kind))
    throw Error('resource-sale-kind-not-enabled');
  if (
    event.previousRevision !== (old?.revision ?? 0) ||
    s.revision !== event.previousRevision + 1 ||
    s.at < (old?.at ?? 0) ||
    !tradeFactsEqual(event.transactions, resourceSaleTransactions(s))
  )
    throw Error('resource-sale-revision-time-or-accounts-mismatch');
  if (event.operation === 'expire') {
    if (
      !old ||
      old.status !== 'offered' ||
      s.status !== 'expired' ||
      s.at < old.acceptBy ||
      event.actorId !== 'system' ||
      event.authorization ||
      event.command ||
      event.sourceRead
    )
      throw Error('invalid-resource-sale-expiry');
  } else {
    const c = event.command ? decodeResourceSaleCommand(event.command) : undefined,
      a = event.authorization;
    if (!c || !a || c.type !== event.operation || c.id !== s.id)
      throw Error('resource-sale-command-and-authority-required');
    const request = resourceSaleRequest(state, c, event.sourceRead),
      subject = resourceSaleSubject(state, c, event.sourceRead);
    assertPrincipalAuthorization(a, subject, request, event.actorId);
    if (c.type === 'offer') {
      if (
        old ||
        !event.sourceRead ||
        !tradeFactsEqual(event.sourceRead, s.source) ||
        !tradeFactsEqual(a, s.offeredAuthorization) ||
        s.status !== 'offered' ||
        s.createdAt !== s.at ||
        s.source.kind !== c.resource.kind ||
        s.source.id !== c.resource.id ||
        s.source.revision !== c.resource.expectedRevision ||
        !tradeFactsEqual(
          {
            id: s.id,
            title: s.title,
            terms: s.terms,
            resource: c.resource,
            payer: s.payer,
            revenue: s.revenue,
            amount: s.amount,
            acceptBy: s.acceptBy,
            type: 'offer',
          },
          c,
        )
      )
        throw Error('invalid-resource-sale-offer');
    } else if (
      !old ||
      old.status !== 'offered' ||
      c.expectedRevision !== old.revision ||
      s.at >= old.acceptBy ||
      s.status !==
        (c.type === 'accept' ? 'settled' : c.type === 'withdraw' ? 'withdrawn' : 'declined') ||
      (c.type === 'accept' &&
        (!event.sourceRead ||
          !tradeFactsEqual(event.sourceRead, old.source) ||
          !tradeFactsEqual(a, s.acceptedAuthorization)))
    )
      throw Error('invalid-resource-sale-transition');
  }
  if (old) {
    const {
      revision: nextRevision,
      at: nextAt,
      status: nextStatus,
      paidMicros: nextPaid,
      acceptedAuthorization: nextAcceptance,
      ...nextTerms
    } = s;
    const {
      revision: oldRevision,
      at: oldAt,
      status: oldStatus,
      paidMicros: oldPaid,
      acceptedAuthorization: oldAcceptance,
      ...oldTerms
    } = old;
    void [
      nextRevision,
      nextAt,
      nextStatus,
      nextPaid,
      nextAcceptance,
      oldRevision,
      oldAt,
      oldStatus,
      oldPaid,
      oldAcceptance,
    ];
    if (!tradeFactsEqual(nextTerms, oldTerms))
      throw Error('resource-sale-terms-or-original-source-changed');
  }
  return { ...state, sales: { ...state.sales, [s.id]: structuredClone(s) } };
}

export function extendResourceSalesPolicy(state: ResourceSalesState): ResourceSaleDecision {
  const event: ResourceSaleEvent = {
    type: 'ResourceSalesPolicyExtended',
    previousPolicyVersion: POLICY.version,
    policy: RESOURCE_SALES_POLICY_V2,
  };
  try {
    applyResourceSaleEvent(state, event);
    return { accepted: true, events: [event] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-resource-sales-extension');
  }
}
