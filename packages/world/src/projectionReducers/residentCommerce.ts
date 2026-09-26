import {
  applyCommerceEvent,
  commerceEscrowBalance,
  type CommerceState,
} from '@aivilization/commerce';
import { addInventory, removeInventory, assertMoneySupplyDelta } from '@aivilization/economy';
import type { WorldProjection } from '../projection';
import type { WorldEvent } from '../events';
export function applyResidentCommerceProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentCommerceCommitted') return undefined;
  if (e.payload.policyVersion !== 'resident-commerce-v1')
    throw new Error('unsupported-commerce-policy');
  let state: CommerceState | undefined = w.residentCommerce;
  for (const event of e.payload.events) state = applyCommerceEvent(state, event);
  if (!state) throw new Error('missing-commerce-state');
  const agents = { ...w.agents };
  let escrowDelta = 0;
  for (const t of e.payload.transactions) {
    assertMoneySupplyDelta({ transaction: t, moneySupplyDelta: 0 });
    for (const entry of t.entries) {
      if (entry.account.accountId === 'public-service:resident-commerce') {
        escrowDelta += entry.amount;
        continue;
      }
      if (entry.account.sector !== 'agent' || !entry.account.accountId.startsWith('agent:'))
        throw new Error('invalid-commerce-account');
      const id = entry.account.accountId.slice(6),
        agent = agents[id];
      if (!agent || agent.balance + entry.amount < 0) throw new Error('invalid-commerce-balance');
      agents[id] = { ...agent, balance: agent.balance + entry.amount };
    }
  }
  const before = w.residentCommerce ? commerceEscrowBalance(w.residentCommerce) : 0;
  if (Math.abs(commerceEscrowBalance(state) - before - escrowDelta) > 1e-8)
    throw new Error('commerce-escrow-mismatch');
  const stockDelta: Record<string, number> = {};
  for (const t of e.payload.stockTransfers) {
    if (!Number.isFinite(t.quantity) || t.quantity <= 0 || t.from === t.to)
      throw new Error('invalid-stock-transfer');
    for (const [id, sign] of [
      [t.from, -1],
      [t.to, 1],
    ] as const) {
      if (id === 'escrow') {
        stockDelta[t.commodity] = (stockDelta[t.commodity] ?? 0) + sign * t.quantity;
        continue;
      }
      const agent = agents[id];
      if (!agent) throw new Error('unknown-stock-owner');
      agents[id] = {
        ...agent,
        inventory:
          sign < 0
            ? removeInventory(agent.inventory, t.commodity, t.quantity)
            : addInventory(agent.inventory, t.commodity, t.quantity),
      };
    }
  }
  const quantities = (s: CommerceState | undefined) =>
    Object.values(s?.orders ?? {}).reduce<Record<string, number>>(
      (r, o) => ({ ...r, [o.commodity]: (r[o.commodity] ?? 0) + o.stockHeld }),
      {},
    );
  const previous = quantities(w.residentCommerce),
    next = quantities(state);
  for (const item of new Set([
    ...Object.keys(previous),
    ...Object.keys(next),
    ...Object.keys(stockDelta),
  ]))
    if (Math.abs((next[item] ?? 0) - (previous[item] ?? 0) - (stockDelta[item] ?? 0)) > 1e-8)
      throw new Error('commerce-stock-mismatch');
  return { ...w, agents, residentCommerce: state };
}
