import { createEventEnvelope } from '@aivilization/sim-core';
import {
  PUBLIC_GOODS_PROCUREMENT_GRANT,
  enablePublicGoodsProcurementAuthority,
  type PublicProposal,
} from '@aivilization/governance';
import { TRADE_PUBLIC_FUNDING_POLICY } from '@aivilization/commerce';
import type { Controller } from '@aivilization/authority';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import { residentEvidenceTradeEvent } from './residentEvidenceTrade';
export type PublicGoodsFundingProof = {
  readonly proposalId: string;
  readonly orderId: string;
  readonly expectedRevision: number;
  readonly amount: number;
  readonly actorId: string;
};
type Context = {
  projection: WorldProjection;
  requestId: string;
  simulationId: string;
  nextSequence: number;
};
export function enableResidentPublicGoodsProcurementEvent(input: Context): WorldEvent {
  const w = input.projection;
  if (!w.publicGovernance || !w.residentTrade || !w.logistics || w.residentTrade.publicFunding)
    throw Error('public-goods-procurement-requires-governance-trade-and-logistics');
  enablePublicGoodsProcurementAuthority(w.publicGovernance.authority);
  return createEventEnvelope({
    id: `${input.requestId}:public-goods`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: w.clock.now,
    type: 'ResidentPublicGoodsProcurementEnabled',
    payload: {
      policyVersion: PUBLIC_GOODS_PROCUREMENT_GRANT.version,
      tradeFunding: {
        type: 'TradePublicFundingEnabled' as const,
        policy: TRADE_PUBLIC_FUNDING_POLICY,
      },
    },
  });
}
export function publicGoodsFundingFailure(w: WorldProjection, p: PublicProposal) {
  const a = p.action;
  if (
    a.kind !== 'fund-goods' ||
    !w.publicGovernance?.authority.grant.goodsProcurement ||
    !w.residentTrade?.publicFunding
  )
    return 'public-goods-procurement-not-enabled';
  const order = w.residentTrade.orders[a.orderId];
  if (!order || order.revision !== a.expectedRevision) return 'public-goods-revision-conflict';
  if (
    order.payer.sector !== 'treasury' ||
    order.source.kind !== 'freight' ||
    order.status !== 'accepted' ||
    order.amount !== a.amount
  )
    return 'public-goods-terms-or-consent-mismatch';
  return undefined;
}
export function fundPublicGoods(
  input: Context & {
    proposal: PublicProposal;
    actorId: string;
    controllerAvailable?: (controller: Controller) => boolean;
  },
) {
  const reason = publicGoodsFundingFailure(input.projection, input.proposal),
    a = input.proposal.action;
  if (reason || a.kind !== 'fund-goods')
    return { accepted: false as const, reason: reason ?? 'invalid-public-goods-action' };
  return residentEvidenceTradeEvent({
    ...input,
    command: { type: 'fund', id: a.orderId, expectedRevision: a.expectedRevision },
    authorization: {
      authorize: () => undefined,
      controllerAvailable:
        input.controllerAvailable ??
        ((c) => c.kind === 'resident' && !!input.projection.agents[c.id]),
      authorizePublicFunding: (o, actorId) =>
        o.id === a.orderId &&
        o.revision === a.expectedRevision &&
        o.amount === a.amount &&
        actorId === input.actorId
          ? { decisionId: input.proposal.id }
          : undefined,
    },
  });
}
