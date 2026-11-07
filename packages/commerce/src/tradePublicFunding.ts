import { sameController } from '@aivilization/authority';
import type {
  EvidenceTradePorts,
  EvidenceTradeState,
  EvidenceTradeDecision,
  TradeOrder,
} from './tradeModel';
import { tradeRejected } from './tradeModel';
import { transitionTradeOrder, tradeReceiptId } from './tradeTransitions';

/** Treasury authorization is supplied by an exact public decision, never buyer/controller impersonation. */
export function fundPublicTrade(
  s: EvidenceTradeState,
  o: TradeOrder,
  actorId: string,
  at: number,
  p: EvidenceTradePorts,
): EvidenceTradeDecision {
  if (
    !s.publicFunding ||
    !p.publicFunding ||
    o.payer.sector !== 'treasury' ||
    o.source.kind !== 'freight'
  )
    return tradeRejected('public-goods-funding-not-enabled');
  if (o.status !== 'accepted') return tradeRejected('public-trade-buyer-consent-required');
  const authorization = p.publicFunding.authorize(o, actorId);
  if (!authorization) return tradeRejected('public-trade-funding-authority-required');
  const revenue = p.account(o.revenue);
  if (
    !revenue ||
    revenue.status !== 'open' ||
    !sameController(revenue.controller, o.source.seller) ||
    ![o.source.seller, o.source.buyer].every(p.controllerAvailable)
  )
    return tradeRejected('trade-party-accounts-required');
  if (!Number.isFinite(p.publicFunding.balance) || p.publicFunding.balance < o.amount)
    return tradeRejected('insufficient-public-trade-balance');
  return transitionTradeOrder(
    o,
    {
      id: tradeReceiptId(o.id, o.revision + 1),
      orderId: o.id,
      orderRevision: o.revision + 1,
      actorId,
      role: 'public-funder',
      operation: 'fund',
      at,
      decisionId: authorization.decisionId,
    },
    p.evidence(o.source),
  );
}
