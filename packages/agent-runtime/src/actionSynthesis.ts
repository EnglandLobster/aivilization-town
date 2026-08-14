import type { LifestyleTier } from '@aivilization/society';
import type { ActionResourceEstimate, AtomicActionProposal } from './actions';

export type ActionSynthesisBudget = {
  readonly availableActionSeconds?: number;
  readonly energyBudget?: number;
  readonly satietyBudget?: number;
  readonly currencyBudget?: number;
  readonly inventoryBudget?: Readonly<Record<string, number>>;
};

/**
 * Optional wealth-tier budget constraint. When the agent's lifestyle tier is
 * `struggling`, cumulative non-survival currency spending (buy-side trades of
 * non-food commodities, residential upgrades, education investment) is capped
 * at `currencyBudget * nonSurvivalSpendCapRatio`; survival spending (medical
 * treatment, purchases of `survivalCommodities`) stays exempt. Requires the
 * currency budget to be set; other tiers impose no extra cap.
 */
export type ActionSynthesisLifestyleConstraint = {
  readonly tier: LifestyleTier;
  readonly nonSurvivalSpendCapRatio: number;
  readonly survivalCommodities?: readonly string[];
};

export type ActionSynthesisPolicy = {
  readonly maxActions?: number;
  readonly budget?: ActionSynthesisBudget;
  readonly lifestyle?: ActionSynthesisLifestyleConstraint;
  readonly scoring?: {
    readonly priorityWeight?: number;
    readonly strategicAlignmentWeight?: number;
    readonly branchUrgencyWeight?: number;
    readonly subtaskScoreWeight?: number;
  };
  readonly branchLimits?: {
    readonly maxAcceptedActionsPerBranch?: number;
  };
  readonly candidateSubtasks?: {
    readonly maxSubtasks?: number;
  };
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
  nonSurvivalCurrencyCost: number;
  inventoryCosts: Record<string, number>;
  acceptedActionCountByBranch: Record<string, number>;
};

type NormalizedScoringPolicy = {
  readonly priorityWeight: number;
  readonly strategicAlignmentWeight: number;
  readonly branchUrgencyWeight: number;
  readonly subtaskScoreWeight: number;
};

type NormalizedBranchLimits = {
  readonly maxAcceptedActionsPerBranch?: number;
};

type NormalizedLifestyleConstraint = {
  readonly tier: LifestyleTier;
  readonly nonSurvivalSpendCapRatio: number;
  readonly survivalCommodities: ReadonlySet<string>;
};

type NormalizedActionSynthesisPolicy = {
  readonly maxActions?: number;
  readonly budget?: ActionSynthesisBudget;
  readonly lifestyle?: NormalizedLifestyleConstraint;
  readonly scoring: NormalizedScoringPolicy;
  readonly branchLimits: NormalizedBranchLimits;
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
    nonSurvivalCurrencyCost: 0,
    inventoryCosts: {},
    acceptedActionCountByBranch: {},
  };
  const acceptedActions: AtomicActionProposal[] = [];
  const rejectedActions: RejectedSynthesizedAction[] = [];

  for (const action of rankActions(input.actions, policy.scoring)) {
    if (policy.maxActions !== undefined && acceptedActions.length >= policy.maxActions) {
      rejectedActions.push({ action, reason: 'maxActions exhausted' });
      continue;
    }

    const estimate = normalizeResourceEstimate(action.resourceEstimate, action.id);
    const rejectionReason = firstBudgetRejection({
      action,
      estimate,
      ledger,
      policy,
    });
    if (rejectionReason !== undefined) {
      rejectedActions.push({ action, reason: rejectionReason });
      continue;
    }

    acceptedActions.push(action);
    applyAcceptedActionToLedger(ledger, action, estimate, policy.lifestyle);
  }

  return {
    acceptedActions,
    rejectedActions,
  };
}

function rankActions(
  actions: readonly AtomicActionProposal[],
  scoring: NormalizedScoringPolicy,
): readonly AtomicActionProposal[] {
  return actions
    .map((action, index) => ({
      action,
      index,
      score: scoreActionForSynthesis(action, scoring),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ action }) => action);
}

function normalizePolicy(
  policy: ActionSynthesisPolicy | undefined,
): NormalizedActionSynthesisPolicy {
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

  const scoring = normalizeScoringPolicy(policy?.scoring);
  const branchLimits = normalizeBranchLimits(policy?.branchLimits);
  validateCandidateSubtaskPolicy(policy?.candidateSubtasks);

  const lifestyle = normalizeLifestyleConstraint(policy?.lifestyle);

  return {
    ...(maxActions === undefined ? {} : { maxActions }),
    ...(budget === undefined ? {} : { budget }),
    ...(lifestyle === undefined ? {} : { lifestyle }),
    scoring,
    branchLimits,
  };
}

function normalizeLifestyleConstraint(
  lifestyle: ActionSynthesisLifestyleConstraint | undefined,
): NormalizedLifestyleConstraint | undefined {
  if (lifestyle === undefined) {
    return undefined;
  }
  const ratio = lifestyle.nonSurvivalSpendCapRatio;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error('action synthesis lifestyle nonSurvivalSpendCapRatio must be between 0 and 1');
  }
  for (const commodity of lifestyle.survivalCommodities ?? []) {
    assertNonEmptyName(commodity, 'action synthesis lifestyle survival commodity name');
  }
  return {
    tier: lifestyle.tier,
    nonSurvivalSpendCapRatio: ratio,
    survivalCommodities: new Set(lifestyle.survivalCommodities ?? []),
  };
}

function validateCandidateSubtaskPolicy(
  candidateSubtasks: ActionSynthesisPolicy['candidateSubtasks'] | undefined,
): void {
  const maxSubtasks = candidateSubtasks?.maxSubtasks;
  if (maxSubtasks !== undefined && (!Number.isInteger(maxSubtasks) || maxSubtasks <= 0)) {
    throw new Error('action synthesis candidateSubtasks.maxSubtasks must be a positive integer');
  }
}

function normalizeScoringPolicy(
  scoring: ActionSynthesisPolicy['scoring'] | undefined,
): NormalizedScoringPolicy {
  return {
    priorityWeight: normalizeScoringWeight(scoring?.priorityWeight, 'priorityWeight', 1),
    strategicAlignmentWeight: normalizeScoringWeight(
      scoring?.strategicAlignmentWeight,
      'strategicAlignmentWeight',
      0,
    ),
    branchUrgencyWeight: normalizeScoringWeight(
      scoring?.branchUrgencyWeight,
      'branchUrgencyWeight',
      0,
    ),
    subtaskScoreWeight: normalizeScoringWeight(scoring?.subtaskScoreWeight, 'subtaskScoreWeight', 0),
  };
}

function normalizeScoringWeight(
  value: number | undefined,
  name: string,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (!Number.isFinite(value)) {
    throw new Error(`action synthesis scoring ${name} must be finite`);
  }
  return value;
}

function normalizeBranchLimits(
  branchLimits: ActionSynthesisPolicy['branchLimits'] | undefined,
): NormalizedBranchLimits {
  const maxAcceptedActionsPerBranch = branchLimits?.maxAcceptedActionsPerBranch;
  if (
    maxAcceptedActionsPerBranch !== undefined &&
    (!Number.isInteger(maxAcceptedActionsPerBranch) || maxAcceptedActionsPerBranch < 0)
  ) {
    throw new Error('action synthesis maxAcceptedActionsPerBranch must be a non-negative integer');
  }
  return {
    ...(maxAcceptedActionsPerBranch === undefined ? {} : { maxAcceptedActionsPerBranch }),
  };
}

function scoreActionForSynthesis(
  action: AtomicActionProposal,
  scoring: NormalizedScoringPolicy,
): number {
  const context = action.synthesisContext;
  assertSynthesisContext(action);
  return (
    normalizePriority(action.priority, action.id) * scoring.priorityWeight +
    normalizeOptionalFinite(
      context?.strategicAlignment,
      `action ${action.id} synthesisContext.strategicAlignment`,
    ) *
      scoring.strategicAlignmentWeight +
    normalizeOptionalFinite(
      context?.branchUrgency,
      `action ${action.id} synthesisContext.branchUrgency`,
    ) *
      scoring.branchUrgencyWeight +
    normalizeOptionalFinite(
      context?.subtaskScore,
      `action ${action.id} synthesisContext.subtaskScore`,
    ) *
      scoring.subtaskScoreWeight
  );
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
  readonly action: AtomicActionProposal;
  readonly estimate: NormalizedResourceEstimate;
  readonly ledger: ResourceLedger;
  readonly policy: NormalizedActionSynthesisPolicy;
}): string | undefined {
  const branchLimitRejection = branchLimitRejectionReason({
    action: input.action,
    ledger: input.ledger,
    branchLimits: input.policy.branchLimits,
  });
  if (branchLimitRejection !== undefined) {
    return branchLimitRejection;
  }

  const budget = input.policy.budget;
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

  const lifestyleRejection = strugglingLifestyleRejectionReason({
    action: input.action,
    estimate: input.estimate,
    ledger: input.ledger,
    currencyBudget: budget.currencyBudget,
    lifestyle: input.policy.lifestyle,
  });
  if (lifestyleRejection !== undefined) {
    return lifestyleRejection;
  }

  return undefined;
}

function strugglingLifestyleRejectionReason(input: {
  readonly action: AtomicActionProposal;
  readonly estimate: NormalizedResourceEstimate;
  readonly ledger: ResourceLedger;
  readonly currencyBudget: number | undefined;
  readonly lifestyle: NormalizedLifestyleConstraint | undefined;
}): string | undefined {
  if (
    input.lifestyle === undefined ||
    input.lifestyle.tier !== 'struggling' ||
    input.currencyBudget === undefined ||
    input.estimate.currencyCost <= 0 ||
    isSurvivalCurrencySpend(input.action, input.lifestyle)
  ) {
    return undefined;
  }
  const cap = input.currencyBudget * input.lifestyle.nonSurvivalSpendCapRatio;
  if (input.ledger.nonSurvivalCurrencyCost + input.estimate.currencyCost > cap) {
    return 'struggling lifestyle non-survival currency budget exceeded';
  }
  return undefined;
}

function isSurvivalCurrencySpend(
  action: AtomicActionProposal,
  lifestyle: NormalizedLifestyleConstraint,
): boolean {
  // Medical treatment is survival spending.
  if (action.commandType === 'AgentSeeDoctor') {
    return true;
  }
  if (action.commandType === 'AgentTrade') {
    const payload = action.payload as
      | { readonly side?: unknown; readonly commodityName?: unknown }
      | undefined;
    // Sell-side trades spend no currency; buy-side food purchases are survival
    // spending, everything else (plus upgrades and study, which fall through to
    // the default) counts against the non-survival cap.
    if (payload?.side !== 'buy') {
      return true;
    }
    return (
      typeof payload.commodityName === 'string' &&
      lifestyle.survivalCommodities.has(payload.commodityName)
    );
  }
  return false;
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

function applyAcceptedActionToLedger(
  ledger: ResourceLedger,
  action: AtomicActionProposal,
  estimate: NormalizedResourceEstimate,
  lifestyle: NormalizedLifestyleConstraint | undefined,
): void {
  applyEstimateToLedger(ledger, estimate);
  if (lifestyle !== undefined && !isSurvivalCurrencySpend(action, lifestyle)) {
    ledger.nonSurvivalCurrencyCost += estimate.currencyCost;
  }
  const branchId = action.synthesisContext?.branchId;
  if (branchId !== undefined) {
    ledger.acceptedActionCountByBranch[branchId] =
      (ledger.acceptedActionCountByBranch[branchId] ?? 0) + 1;
  }
}

function branchLimitRejectionReason(input: {
  readonly action: AtomicActionProposal;
  readonly ledger: ResourceLedger;
  readonly branchLimits: NormalizedBranchLimits;
}): string | undefined {
  const maxAcceptedActionsPerBranch = input.branchLimits.maxAcceptedActionsPerBranch;
  const branchId = input.action.synthesisContext?.branchId;
  if (maxAcceptedActionsPerBranch === undefined || branchId === undefined) {
    return undefined;
  }
  if ((input.ledger.acceptedActionCountByBranch[branchId] ?? 0) >= maxAcceptedActionsPerBranch) {
    return `branch action budget exhausted for ${branchId}`;
  }
  return undefined;
}

function assertSynthesisContext(action: AtomicActionProposal): void {
  const context = action.synthesisContext;
  if (context === undefined) {
    return;
  }
  assertNonEmptyNameIfPresent(context.branchId, `action ${action.id} synthesisContext.branchId`);
  assertNonEmptyNameIfPresent(context.subtaskId, `action ${action.id} synthesisContext.subtaskId`);
  assertFiniteIfPresent(context.subtaskScore, `action ${action.id} synthesisContext.subtaskScore`);
  assertFiniteIfPresent(
    context.strategicAlignment,
    `action ${action.id} synthesisContext.strategicAlignment`,
  );
  assertFiniteIfPresent(context.branchUrgency, `action ${action.id} synthesisContext.branchUrgency`);
}

function normalizeOptionalFinite(value: number | undefined, name: string): number {
  assertFiniteIfPresent(value, name);
  return value ?? 0;
}

function assertNonNegativeFiniteIfPresent(value: number | undefined, name: string): void {
  if (value !== undefined) {
    assertNonNegativeFinite(value, name);
  }
}

function assertFiniteIfPresent(value: number | undefined, name: string): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
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

function assertNonEmptyNameIfPresent(value: string | undefined, name: string): void {
  if (value !== undefined) {
    assertNonEmptyName(value, name);
  }
}
