import { getInventoryQuantity, resolveInventoryRequest } from '@aivilization/economy';
import type { WorldEvent } from './events';
import type { WorldProjection } from './projection';

/** Validate new source facts without changing legacy event arithmetic or rounding inventory. */
export function assertInventoryQuantityEvidence(w: WorldProjection, event: WorldEvent): void {
  let available: number | undefined, settled: number;
  if (event.type === 'InventoryChanged') {
    if (!event.payload.quantityResolution) return;
    available = getInventoryQuantity(
      w.agents[event.payload.agentId]!.inventory,
      event.payload.itemName,
    );
    settled = -event.payload.delta;
  } else if (event.type === 'CommodityConsumed') {
    if (!event.payload.quantityResolution) return;
    available = getInventoryQuantity(
      w.agents[event.payload.agentId]!.inventory,
      event.payload.commodityName,
    );
    settled = event.payload.quantity;
  } else if (event.type === 'ResourceTransferred') {
    if (!event.payload.quantityResolution) return;
    const source = w.agents[event.payload.sourceAgentId];
    // A destination partition can only verify recorded source facts; the source validates its stock.
    available = source && getInventoryQuantity(source.inventory, event.payload.commodityName);
    settled = event.payload.quantity;
  } else if (event.type === 'TradeExecuted') {
    if (!event.payload.quantityResolution) return;
    if (event.payload.side !== 'sell') throw Error('quantity-resolution-requires-stock-outflow');
    const source = event.payload.enterpriseId
      ? w.enterprises[event.payload.enterpriseId]
      : w.agents[event.payload.agentId];
    available = getInventoryQuantity(source!.inventory, event.payload.commodityName);
    settled = event.payload.commodityQuantity;
  } else if (event.type === 'ExternalTradeExecuted') {
    if (!event.payload.quantityResolution) return;
    if (event.payload.direction !== 'export')
      throw Error('quantity-resolution-requires-stock-outflow');
    const source =
      'enterpriseId' in event.payload.trader
        ? w.enterprises[event.payload.trader.enterpriseId]
        : w.agents[event.payload.trader.agentId];
    available = getInventoryQuantity(source!.inventory, event.payload.commodityName);
    settled = event.payload.quantity;
  } else return;
  const p = event.payload.quantityResolution;
  const expected = resolveInventoryRequest(p.available, p.requested)?.quantityResolution;
  if (
    !expected ||
    expected.policyVersion !== p.policyVersion ||
    p.settled !== settled ||
    expected.settled !== settled ||
    (available !== undefined && available !== p.available)
  )
    throw Error('inventory-quantity-resolution-mismatch');
}
