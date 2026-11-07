import { principalTradeForSource } from './principalTrade';
import { authorizeController, sameController, validControllerId } from '@aivilization/authority';
import { tradeFactsEqual, validTradeTerms } from './tradeFacts';
import { fundPublicTrade } from './tradePublicFunding';
import {
  assertEvidenceTradePolicy,
  tradeRejected as no,
  type EvidenceTradeCommand,
  type EvidenceTradeDecision,
  type EvidenceTradePorts,
  type EvidenceTradeState,
  type TradeOrder,
  type TradeReceipt,
  type TradeRole,
  type TradeSourceRef,
} from './tradeModel';
import {
  createTradeOrder,
  terminalTrade,
  tradeReceiptId,
  transitionTradeOrder,
} from './tradeTransitions';

export function tradeForSource(
  s: EvidenceTradeState | undefined,
  ref: TradeSourceRef,
): TradeOrder | undefined {
  return Object.values(s?.orders ?? {}).find(
    (o) => o.source.kind === ref.kind && o.source.id === ref.id,
  );
}
/** No timer removes a hold silently. Explicit expiry/withdrawal first records that this offer ended. */
export function tradeSourceStartFailure(s: EvidenceTradeState | undefined, ref: TradeSourceRef) {
  return (ref.kind === 'permit' && principalTradeForSource(s, ref.id)?.status === 'offered') ||
    ['offered', 'accepted'].includes(tradeForSource(s, ref)?.status ?? '')
    ? 'trade-payment-or-offer-release-required'
    : undefined;
}
export function decideEvidenceTrade(
  s: EvidenceTradeState,
  actorId: string,
  at: number,
  c: EvidenceTradeCommand,
  ports: EvidenceTradePorts,
): EvidenceTradeDecision {
  assertEvidenceTradePolicy(s.policy);
  if (
    !validControllerId(actorId) ||
    !ports.exists(actorId) ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    !validControllerId(c.id)
  )
    return no('invalid-trade-actor-id-or-time');
  if (c.type === 'offer') {
    if (
      c.payer.sector === 'treasury' &&
      (!s.publicFunding || !ports.publicFunding || c.source.kind !== 'freight')
    )
      return no('public-goods-funding-not-enabled');
    if (c.source.kind === 'permit' && s.policy.version !== 'resident-evidence-trade-v2')
      return no('trade-permit-requires-v2');
    if (
      s.orders[c.id] ||
      s.principalOrders?.orders[c.id] ||
      Object.keys(s.orders).length >= s.policy.maxOrders ||
      tradeForSource(s, c.source) ||
      (c.source.kind === 'permit' && principalTradeForSource(s, c.source.id))
    )
      return no('trade-id-or-source-already-used-or-limit');
    const evidence = ports.evidence(c.source);
    if (
      !evidence ||
      evidence.basis.kind !== c.source.kind ||
      evidence.basis.id !== c.source.id ||
      evidence.revision !== c.source.expectedRevision
    )
      return no('trade-source-unavailable-or-revised');
    const terms = {
      id: c.id,
      title: c.title,
      terms: c.terms,
      source: evidence.basis,
      payer: c.payer,
      revenue: c.revenue,
      amount: c.amount,
      acceptBy: c.acceptBy,
    };
    if (
      !validTradeTerms(terms, at) ||
      ![terms.source.seller, terms.source.buyer].every(ports.controllerAvailable)
    )
      return no('invalid-trade-terms-or-parties');
    if (ports.actingFor && !sameController(ports.actingFor, terms.source.seller))
      return no('trade-seller-authority-required');
    const authorization = authorizeController(terms.source.seller, actorId, ports.authorize);
    if (!authorization) return no('trade-seller-authority-required');
    if (
      Object.values(s.orders).filter((o) => sameController(o.source.seller, terms.source.seller))
        .length >= s.policy.maxPerSeller
    )
      return no('trade-seller-order-limit');
    const payer = c.payer.sector === 'treasury' ? undefined : ports.account(c.payer),
      revenue = ports.account(c.revenue);
    if (
      (c.payer.sector !== 'treasury' &&
        (!payer ||
          payer.status !== 'open' ||
          !sameController(payer.controller, terms.source.buyer))) ||
      !revenue ||
      revenue.status !== 'open' ||
      !sameController(revenue.controller, terms.source.seller)
    )
      return no('trade-party-accounts-required');
    const receipt: TradeReceipt = {
      id: tradeReceiptId(c.id, 1),
      orderRevision: 1,
      orderId: c.id,
      actorId,
      role: 'seller',
      operation: 'offer',
      at,
      ...(authorization.decisionId ? { decisionId: authorization.decisionId } : {}),
    };
    return createTradeOrder(terms, receipt, evidence);
  }
  const o = s.orders[c.id];
  if (!o) return no('trade-order-not-found');
  if (o.revision !== c.expectedRevision) return no('trade-revision-conflict');
  if (c.type === 'fund') return fundPublicTrade(s, o, actorId, at, ports);
  const needed: readonly TradeRole[] =
    c.type === 'accept' || c.type === 'confirm'
      ? ['buyer']
      : c.type === 'waive'
        ? ['seller']
        : ['seller', 'buyer'];
  const authorized = needed
    .filter((role) => !ports.actingFor || sameController(ports.actingFor, o.source[role]))
    .map((role) => ({ role, grant: authorizeController(o.source[role], actorId, ports.authorize) }))
    .find((r) => r.grant);
  if (!authorized?.grant) return no('trade-party-authority-required');
  if (c.type === 'accept') {
    const payer = o.payer.sector === 'treasury' ? undefined : ports.account(o.payer),
      revenue = ports.account(o.revenue);
    if (
      (o.payer.sector !== 'treasury' &&
        (!payer || payer.status !== 'open' || !sameController(payer.controller, o.source.buyer))) ||
      !revenue ||
      revenue.status !== 'open' ||
      !sameController(revenue.controller, o.source.seller)
    )
      return no('trade-party-accounts-required');
    if (payer && payer.balance < o.amount) return no('insufficient-trade-balance');
    if (![o.source.seller, o.source.buyer].every(ports.controllerAvailable))
      return no('trade-party-unavailable');
  }
  const receipt: TradeReceipt = {
    id: tradeReceiptId(o.id, o.revision + 1),
    orderRevision: o.revision + 1,
    orderId: o.id,
    actorId,
    role: authorized.role,
    operation: c.type,
    at,
    ...(authorized.grant.decisionId ? { decisionId: authorized.grant.decisionId } : {}),
    ...('content' in c ? { content: c.content } : {}),
    ...('refund' in c ? { refund: c.refund } : {}),
    ...('accept' in c ? { accept: c.accept } : {}),
  };
  const evidence =
    c.type === 'accept' || c.type === 'observe' ? ports.evidence(o.source) : undefined;
  return transitionTradeOrder(o, receipt, evidence);
}
/** Reads terminal effects without accepting quality or inventing consent. */
export function advanceEvidenceTrade(
  s: EvidenceTradeState,
  id: string,
  at: number,
  ports: Pick<EvidenceTradePorts, 'evidence'>,
): EvidenceTradeDecision {
  const o = s.orders[id];
  const unchanged: EvidenceTradeDecision = {
    accepted: true,
    events: [],
    transactions: [],
    evidenceReads: [],
  };
  if (!o || terminalTrade(o) || o.resolved) return unchanged;
  const operation =
    ['offered', 'accepted'].includes(o.status) && at >= o.acceptBy
      ? 'expire'
      : ['funded', 'disputed'].includes(o.status)
        ? 'observe'
        : undefined;
  if (!operation) return unchanged;
  const evidence = operation === 'observe' ? ports.evidence(o.source) : undefined;
  if (operation === 'observe' && (!evidence || tradeFactsEqual(evidence, o.evidence)))
    return unchanged;
  const result = transitionTradeOrder(
    o,
    {
      id: tradeReceiptId(o.id, o.revision + 1),
      orderRevision: o.revision + 1,
      orderId: o.id,
      actorId: 'system',
      role: 'system',
      operation,
      at,
    },
    evidence,
  );
  return !result.accepted && result.reason === 'trade-source-not-terminal' ? unchanged : result;
}

export function nextEvidenceTradeBoundary(
  s: EvidenceTradeState | undefined,
  now: number,
): number | undefined {
  const times = Object.values(s?.orders ?? {})
    .filter((o) => ['offered', 'accepted'].includes(o.status) && o.acceptBy > now)
    .map((o) => o.acceptBy);
  return times.length ? Math.min(...times) : undefined;
}
