import {
  decideRecordEnterpriseTradeAccounting,
  applyEnterpriseDomainEvent,
  type EnterpriseTradeAccountingEvent,
} from '@aivilization/enterprise';
import type { PrincipalTradeOrder } from '@aivilization/commerce';
import type { WorldProjection } from './projection';
export type PrincipalTradeEnterpriseEffect = {
  readonly enterpriseId: string;
  readonly event: EnterpriseTradeAccountingEvent;
};
/** Maps immutable commerce totals into the enterprise's own accounting decision, never into a balance setter. */
export function preparePrincipalTradeEnterpriseEffects(
  w: WorldProjection,
  order: PrincipalTradeOrder,
): readonly PrincipalTradeEnterpriseEffect[] {
  if (!['funded', 'settled'].includes(order.status)) return [];
  let enterprises = w.enterprises;
  const effects: PrincipalTradeEnterpriseEffect[] = [];
  for (const side of ['payer', 'revenue'] as const) {
    const a = order[side];
    if (a.sector !== 'enterprise') continue;
    const e = enterprises[a.id],
      proof = side === 'payer' ? order.acceptedAuthorization : order.offeredAuthorization;
    if (!e || !proof) throw Error('principal-trade-enterprise-source-required');
    const d = decideRecordEnterpriseTradeAccounting(e, {
      orderId: order.id,
      sourceId: order.source.id,
      side,
      authorization: proof,
      revision: (e.tradeAccounting?.contracts[order.id]?.revision ?? 0) + 1,
      sourceRevision: order.revision,
      at: order.at,
      phase: order.status === 'settled' ? 'settled' : 'funded',
      fundedMicros: side === 'payer' ? order.fundedMicros : 0,
      costMicros: side === 'payer' ? order.earnedMicros : 0,
      refundedMicros: side === 'payer' ? order.refundedMicros : 0,
      revenueMicros: side === 'revenue' ? order.paidMicros : 0,
    });
    if (!d.accepted) throw Error(d.reason);
    effects.push({ enterpriseId: a.id, event: d.event });
    enterprises = { ...enterprises, [a.id]: applyEnterpriseDomainEvent(e, d.event) };
  }
  return effects;
}
