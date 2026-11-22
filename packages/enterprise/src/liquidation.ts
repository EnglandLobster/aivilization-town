import { asAgentId, type AgentId } from '@aivilization/sim-core';
import type { Inventory } from '@aivilization/economy';
import {
  assertValidEnterpriseState,
  normalizeEnterpriseState,
  type EnterpriseState,
} from './model';
export type EnterpriseCapitalDistribution = {
  readonly agentId: AgentId;
  readonly balance: number;
  readonly inventory: Inventory;
};
/** Residual allocation preserves the actual account/stock totals; management has no claim on them. */
export function enterpriseCapitalDistributions(
  state: EnterpriseState,
): readonly EnterpriseCapitalDistribution[] {
  const rawShares = Object.values(state.ownershipShares ?? { [state.ownerAgentId]: 1 });
  const total = rawShares.reduce((sum, share) => sum + share, 0);
  if (
    rawShares.some((share) => !Number.isFinite(share) || share < 0) ||
    !Number.isFinite(total) ||
    total <= 0
  )
    throw Error('enterprise-capital-shares-not-distributable');
  assertValidEnterpriseState(state);
  const e = normalizeEnterpriseState(state),
    shares = Object.entries(e.ownershipShares!);
  let remainingBalance = e.balance,
    remainingShare = shares.reduce((sum, [, s]) => sum + s, 0);
  const remainingInventory = { ...e.inventory };
  return shares.map(([agentId, share], i) => {
    const last = i === shares.length - 1,
      ratio = last ? 1 : Math.min(1, share / remainingShare);
    const balance = last ? remainingBalance : remainingBalance * ratio,
      inventory: Record<string, number> = {};
    remainingBalance -= balance;
    remainingShare -= share;
    for (const [name, quantity] of Object.entries(remainingInventory)) {
      const amount = last ? quantity : quantity * ratio;
      if (amount > 0) inventory[name] = amount;
      remainingInventory[name] = quantity - amount;
    }
    return { agentId: asAgentId(agentId), balance, inventory };
  });
}
