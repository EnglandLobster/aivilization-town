import {
  decideRecordEnterpriseTradeAccounting,
  type EnterpriseTradePosition,
} from '@aivilization/enterprise';
import {
  tradeFactsEqual,
  type ConstructionTradeState,
  type ConstructionTradeOrder,
} from '@aivilization/commerce';
import type { WorldProjection } from './projection';
import type { PrincipalTradeEnterpriseEffect } from './principalTradeEnterpriseAccounting';
/** Maps immutable commerce facts, not cash formulas. Original consent survives representative changes. */
function positions(
  w: WorldProjection,
  state: ConstructionTradeState,
  order: ConstructionTradeOrder,
) {
  const result: { enterpriseId: string; position: EnterpriseTradePosition }[] = [];
  if (!order.fundedMicros) return result;
  for (const side of ['payer', 'revenue'] as const) {
    const a = order[side];
    if (a.sector !== 'enterprise') continue;
    const receipt = Object.values(state.receipts).find(
      (e) =>
        e.type === 'ConstructionTradeCommitted' &&
        e.order.id === order.id &&
        e.command.type === (side === 'payer' ? 'accept' : 'offer'),
    );
    if (!receipt || receipt.type !== 'ConstructionTradeCommitted')
      throw Error('construction-original-enterprise-proof-required');
    const e = w.enterprises[a.id];
    if (!e) throw Error('construction-enterprise-required');
    result.push({
      enterpriseId: a.id,
      position: {
        sourceKind: 'construction',
        orderId: order.id,
        sourceId: order.projectId,
        side,
        authorization: receipt.authorization,
        revision: (e.tradeAccounting?.contracts[order.id]?.revision ?? 0) + 1,
        sourceRevision: order.revision,
        at: order.at,
        phase: order.escrowMicros === 0 ? 'settled' : 'funded',
        fundedMicros: side === 'payer' ? order.fundedMicros : 0,
        costMicros: side === 'payer' ? order.paidMicros : 0,
        refundedMicros: side === 'payer' ? order.refundedMicros : 0,
        revenueMicros: side === 'revenue' ? order.paidMicros : 0,
      },
    });
  }
  return result;
}
export function prepareConstructionTradeEnterpriseEffects(
  w: WorldProjection,
  state: ConstructionTradeState,
  order: ConstructionTradeOrder,
): readonly PrincipalTradeEnterpriseEffect[] {
  return positions(w, state, order).map(({ enterpriseId, position }) => {
    const d = decideRecordEnterpriseTradeAccounting(w.enterprises[enterpriseId]!, position);
    if (!d.accepted) throw Error(d.reason);
    return { enterpriseId, event: d.event };
  });
}
/** Replay compares recorded inputs and then the enterprise reducer verifies/applies its own event. */
export function assertConstructionTradeEnterpriseEffects(
  w: WorldProjection,
  state: ConstructionTradeState,
  order: ConstructionTradeOrder,
  effects: readonly PrincipalTradeEnterpriseEffect[],
) {
  if (
    !tradeFactsEqual(
      positions(w, state, order),
      effects.map((e) => ({ enterpriseId: e.enterpriseId, position: e.event.position })),
    )
  )
    throw Error('construction-trade-enterprise-facts-mismatch');
}
