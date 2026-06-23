import type { ActionResourceEstimate, AtomicActionProposal } from './actions';

export type ActionSynthesisBudget = {
  readonly availableActionSeconds?: number;
  readonly energyBudget?: number;
  readonly satietyBudget?: number;
  readonly currencyBudget?: number;
  readonly inventoryBudget?: Readonly<Record<string, number>>;
};

export type ActionSynthesisPolicy = {
  readonly maxActions?: number;
  readonly budget?: ActionSynthesisBudget;
};

export type RejectedSynthesizedAction = {
  readonly action: AtomicActionProposal;
  readonly reason: string;
};

export type ActionSynthesisResult = {
  readonly acceptedActions: readonly AtomicActionProposal[];
  readonly rejectedActions: readonly RejectedSynthesizedAction[];
};

type NormalizedResourceEstimate = {
  readonly actionSeconds: number;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly currencyCost: number;
  readonly inventoryCosts: Readonly<Record<string, number>>;
};

type ResourceLedger = {
  actionSeconds: number;
  energyCost: number;
  satietyCost: number;
  currencyCost: number;
  inventoryCosts: Record<string, number>;
};

export function synthesizeActionCandidates(input: {
  readonly actions: readonly AtomicActionProposal[];
  readonly policy?: ActionSynthesisPolicy;
}): ActionSynthesisResult {
  const policy = normalizePolicy(input.policy);
  const ledger: ResourceLedger = {
    actionSeconds: 0,
    energyCost: 0,
    satietyCost: 0,
    currencyCost: 0,
    inventoryCosts: {},
  };
  const acceptedActions: AtomicActionProposal[] = [];
  const rejectedActions: RejectedSynthesizedAction[] = [];

  for (const action of rankActions(input.actions)) {
    if (policy.maxActions !== undefined && acceptedActions.length >= policy.maxActions) {
      rejectedActions.push({ action, reason: 'maxActions exhausted' });
      continue;
    }

    const estimate = normalizeResourceEstimate(action.resourceEstimate, action.id);
    const rejectionReason = firstBudgetRejection({
      estimate,
      ledger,
      budget: policy.budget,
    });
    if (rejectionReason !== undefined) {
      rejectedActions.push({ action, reason: rejectionReason });
      continue;
    }

    acceptedActions.push(action);
    applyEstimateToLedger(ledger, estimate);
  }

  return {
    acceptedActions,
    rejectedActions,
  };
}

function rankActions(actions: readonly AtomicActionProposal[]): readonly AtomicActionProposal[] {
  return actions
    .map((action, index) => ({
      action,
      index,
      priority: normalizePriority(action.priority, action.id),
    }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map(({ action }) => action);
}

function normalizePolicy(policy: ActionSynthesisPolicy | undefined): ActionSynthesisPolicy {
  const maxActions = policy?.maxActions;
  if (maxActions !== undefined) {
    if (!Number.isInteger(maxActions) || maxActions < 0) {
      throw new Error('action synthesis maxActions must be a non-negative integer');
    }
  }

  const budget = policy?.budget;
  if (budget !== undefined) {
    assertNonNegativeFiniteIfPresent(
      budget.availableActionSeconds,
      'action synthesis availableActionSeconds',
    );
    assertNonNegativeFiniteIfPresent(budget.energyBudget, 'action synthesis energyBudget');
    assertNonNegativeFiniteIfPresent(budget.satietyBudget, 'action synthesis satietyBudget');
    assertNonNegativeFiniteIfPresent(budget.currencyBudget, 'action synthesis currencyBudget');
    if (budget.inventoryBudget !== undefined) {
      for (const [itemName, quantity] of Object.entries(budget.inventoryBudget)) {
        assertNonEmptyName(itemName, 'action synthesis inventoryBudget item name');
        assertNonNegativeFinite(quantity, `action synthesis inventoryBudget ${itemName}`);
      }
    }
  }

  return policy ?? {};
}

function normalizePriority(priority: number | undefined, actionId: string): number {
  if (priority === undefined) {
    return 0;
  }
  if (!Number.isFinite(priority)) {
    throw new Error(`action ${actionId} priority must be finite`);
  }
  return priority;
}

function normalizeResourceEstimate(
  estimate: ActionResourceEstimate | undefined,
  actionId: string,
): NormalizedResourceEstimate {
  const inventoryCosts = estimate?.inventoryCosts ?? {};
  for (const [itemName, quantity] of Object.entries(inventoryCosts)) {
    assertNonEmptyName(itemName, `action ${actionId} inventory cost item name`);
    assertNonNegativeFinite(quantity, `action ${actionId} inventory cost ${itemName}`);
  }

  assertNonNegativeFiniteIfPresent(
    estimate?.actionSeconds,
    `action ${actionId} resourceEstimate.actionSeconds`,
  );
  assertNonNegativeFiniteIfPresent(
    estimate?.energyCost,
    `action ${actionId} resourceEstimate.energyCost`,
  );
  assertNonNegativeFiniteIfPresent(
    estimate?.satietyCost,
    `action ${actionId} resourceEstimate.satietyCost`,
  );
  assertNonNegativeFiniteIfPresent(
    estimate?.currencyCost,
    `action ${actionId} resourceEstimate.currencyCost`,
  );

  return {
    actionSeconds: estimate?.actionSeconds ?? 0,
    energyCost: estimate?.energyCost ?? 0,
    satietyCost: estimate?.satietyCost ?? 0,
    currencyCost: estimate?.currencyCost ?? 0,
    inventoryCosts,
  };
}

function firstBudgetRejection(input: {
  readonly estimate: NormalizedResourceEstimate;
  readonly ledger: ResourceLedger;
  readonly budget: ActionSynthesisBudget | undefined;
}): string | undefined {
  const budget = input.budget;
  if (budget === undefined) {
    return undefined;
  }

  const inventoryRejection = firstInventoryBudgetRejection({
    inventoryCosts: input.estimate.inventoryCosts,
    spentInventory: input.ledger.inventoryCosts,
    inventoryBudget: budget.inventoryBudget,
  });
  if (inventoryRejection !== undefined) {
    return inventoryRejection;
  }

  if (
    budget.availableActionSeconds !== undefined &&
    input.ledger.actionSeconds + input.estimate.actionSeconds > budget.availableActionSeconds
  ) {
    return 'action seconds budget exceeded';
  }
  if (
    budget.energyBudget !== undefined &&
    input.ledger.energyCost + input.estimate.energyCost > budget.energyBudget
  ) {
    return 'energy budget exceeded';
  }
  if (
    budget.satietyBudget !== undefined &&
    input.ledger.satietyCost + input.estimate.satietyCost > budget.satietyBudget
  ) {
    return 'satiety budget exceeded';
  }
  if (
    budget.currencyBudget !== undefined &&
    input.ledger.currencyCost + input.estimate.currencyCost > budget.currencyBudget
  ) {
    return 'currency budget exceeded';
  }

  return undefined;
}

function firstInventoryBudgetRejection(input: {
  readonly inventoryCosts: Readonly<Record<string, number>>;
  readonly spentInventory: Readonly<Record<string, number>>;
  readonly inventoryBudget: Readonly<Record<string, number>> | undefined;
}): string | undefined {
  if (input.inventoryBudget === undefined) {
    return undefined;
  }

  for (const itemName of Object.keys(input.inventoryCosts).sort((left, right) =>
    left.localeCompare(right),
  )) {
    const nextSpent = (input.spentInventory[itemName] ?? 0) + (input.inventoryCosts[itemName] ?? 0);
    const available = input.inventoryBudget[itemName] ?? 0;
    if (nextSpent > available) {
      return `inventory budget exceeded for ${itemName}`;
    }
  }

  return undefined;
}

function applyEstimateToLedger(
  ledger: ResourceLedger,
  estimate: NormalizedResourceEstimate,
): void {
  ledger.actionSeconds += estimate.actionSeconds;
  ledger.energyCost += estimate.energyCost;
  ledger.satietyCost += estimate.satietyCost;
  ledger.currencyCost += estimate.currencyCost;

  for (const [itemName, quantity] of Object.entries(estimate.inventoryCosts)) {
    ledger.inventoryCosts[itemName] = (ledger.inventoryCosts[itemName] ?? 0) + quantity;
  }
}

function assertNonNegativeFiniteIfPresent(value: number | undefined, name: string): void {
  if (value !== undefined) {
    assertNonNegativeFinite(value, name);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative finite`);
  }
}

function assertNonEmptyName(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
