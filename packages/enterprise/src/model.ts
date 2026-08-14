import type { Inventory } from '@aivilization/economy';
import type { AgentId } from '@aivilization/sim-core';

export type EnterpriseStatus = 'active' | 'insolvent' | 'bankrupt' | 'closed';

/**
 * A published hiring offer: the contracted wage each new hire is promised and
 * the headcount the owner is willing to employ. Hiring is only possible while
 * a posting is published and `openSlots` exceeds the current employee count.
 */
export type EnterpriseJobPosting = {
  readonly wageOffer: number;
  readonly openSlots: number;
};

/**
 * Enterprise is the aggregate root for business-owned money, inventory,
 * employment, ownership and lifecycle state. Agent physiology and household
 * money deliberately remain outside this boundary.
 */
export type EnterpriseState = {
  readonly enterpriseId: string;
  readonly name: string;
  readonly ownerAgentId: AgentId;
  readonly occupationName: string;
  readonly balance: number;
  readonly inventory: Inventory;
  readonly maxEmployees: number;
  readonly employeeAgentIds: readonly AgentId[];
  readonly status: EnterpriseStatus;
  readonly foundedAt: number;
  readonly closedAt?: number;
  readonly cumulativeSales: number;
  readonly cumulativePurchases: number;
  readonly cumulativeWages: number;
  /** Optional on legacy snapshots; the aggregate normalizes it to owner=1. */
  readonly ownershipShares?: Readonly<Record<string, number>>;
  readonly cumulativeDividends?: number;
  readonly retainedEarnings?: number;
  readonly insolvencyStartedAt?: number;
  readonly lastSolvencyEvaluatedAt?: number;
  readonly lastDividendPaidAt?: number;
  /**
   * Optional on legacy snapshots; absent means the enterprise has not
   * published a job posting and therefore cannot hire.
   */
  readonly jobPosting?: EnterpriseJobPosting;
  /**
   * Optional contracted wage per employee, recorded when the employee joins.
   * Normalized to current employees only; a missing entry falls back to the
   * world wage regime when payroll settles (legacy members stay compatible).
   */
  readonly employeeWageOffers?: Readonly<Record<string, number>>;
  /**
   * Optional accumulated unpaid wages owed to employees; absent means zero.
   * Arrears are an enterprise obligation memo — they become a household
   * balance change only when a later payroll actually repays them.
   */
  readonly wageArrears?: number;
};

export function isEnterpriseOperational(state: EnterpriseState): boolean {
  return state.status === 'active' || state.status === 'insolvent';
}

export function normalizeEnterpriseState(state: EnterpriseState): EnterpriseState {
  const employeeAgentIds = [...new Set(state.employeeAgentIds)].sort((left, right) =>
    left.localeCompare(right),
  );
  return {
    ...state,
    inventory: { ...state.inventory },
    employeeAgentIds,
    ownershipShares:
      state.ownershipShares === undefined
        ? { [state.ownerAgentId]: 1 }
        : normalizeOwnershipShares(state.ownershipShares),
    cumulativeDividends: state.cumulativeDividends ?? 0,
    retainedEarnings:
      state.retainedEarnings ??
      state.cumulativeSales -
        state.cumulativePurchases -
        state.cumulativeWages -
        (state.cumulativeDividends ?? 0),
    ...(state.jobPosting === undefined ? {} : { jobPosting: { ...state.jobPosting } }),
    employeeWageOffers: normalizeEmployeeWageOffers(state.employeeWageOffers, employeeAgentIds),
    wageArrears: state.wageArrears ?? 0,
  };
}

export function assertValidEnterpriseState(state: EnterpriseState): void {
  if (state.enterpriseId.trim().length === 0) {
    throw new Error('enterpriseId must not be empty');
  }
  if (state.name.trim().length === 0) {
    throw new Error('enterprise name must not be empty');
  }
  if (!Number.isFinite(state.balance) || state.balance < 0) {
    throw new Error('enterprise balance must be non-negative finite');
  }
  if (!Number.isInteger(state.maxEmployees) || state.maxEmployees < 1) {
    throw new Error('enterprise maxEmployees must be a positive integer');
  }
  if (new Set(state.employeeAgentIds).size !== state.employeeAgentIds.length) {
    throw new Error('enterprise employeeAgentIds must be unique');
  }
  if (state.employeeAgentIds.length > state.maxEmployees) {
    throw new Error('enterprise employee count exceeds maxEmployees');
  }
  if (state.jobPosting !== undefined) {
    if (!Number.isFinite(state.jobPosting.wageOffer) || state.jobPosting.wageOffer <= 0) {
      throw new Error('enterprise job posting wageOffer must be positive finite');
    }
    if (
      !Number.isInteger(state.jobPosting.openSlots) ||
      state.jobPosting.openSlots < 0 ||
      state.jobPosting.openSlots > state.maxEmployees
    ) {
      throw new Error(
        'enterprise job posting openSlots must be an integer within [0, maxEmployees]',
      );
    }
  }
  for (const offer of Object.values(state.employeeWageOffers ?? {})) {
    if (!Number.isFinite(offer) || offer <= 0) {
      throw new Error('enterprise employee wage offers must be positive finite values');
    }
  }
  if (
    state.wageArrears !== undefined &&
    (!Number.isFinite(state.wageArrears) || state.wageArrears < 0)
  ) {
    throw new Error('enterprise wageArrears must be non-negative finite');
  }
  normalizeOwnershipShares(state.ownershipShares ?? { [state.ownerAgentId]: 1 });
}

function normalizeOwnershipShares(
  shares: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const entries = Object.entries(shares)
    .filter(([, share]) => share > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    throw new Error('enterprise requires at least one positive ownership share');
  }
  for (const [agentId, share] of entries) {
    if (agentId.trim().length === 0 || !Number.isFinite(share) || share <= 0) {
      throw new Error('enterprise ownership shares must be positive finite values');
    }
  }
  const total = entries.reduce((sum, [, share]) => sum + share, 0);
  return Object.fromEntries(entries.map(([agentId, share]) => [agentId, share / total]));
}

/**
 * Wage offers are memo entries keyed by employee: normalization keeps only
 * current employees with valid offers so departures and closures cannot leave
 * dangling contracts behind.
 */
function normalizeEmployeeWageOffers(
  offers: Readonly<Record<string, number>> | undefined,
  employeeAgentIds: readonly AgentId[],
): Readonly<Record<string, number>> {
  const members = new Set<string>(employeeAgentIds);
  return Object.fromEntries(
    Object.entries(offers ?? {})
      .filter(([agentId, offer]) => members.has(agentId) && Number.isFinite(offer) && offer > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
