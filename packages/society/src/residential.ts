export type ResidentialTierUpgradeInventory = Readonly<Record<string, number>>;

export type ResidentialTierUpgradeCost = {
  readonly targetResidentialTier: number;
  readonly currencyCost?: number;
  readonly inventoryCosts?: ResidentialTierUpgradeInventory;
  readonly minEducationScore?: number;
};

export type ResidentialTierUpgradePolicy = {
  readonly maxResidentialTier?: number;
  readonly costs: readonly ResidentialTierUpgradeCost[];
};

export type ResidentialUpkeepCost = {
  readonly residentialTier: number;
  readonly currencyCostPerHour: number;
};

export type ResidentialUpkeepPolicy = {
  /**
   * Optional policy version, recorded in the manifest when the pricing
   * semantics include the land value term. Absent marks a legacy v1 policy.
   */
  readonly policyVersion?: string;
  readonly costs: readonly ResidentialUpkeepCost[];
  /**
   * Hours of unpaid upkeep (priced at the agent's current tier rate) that may
   * accumulate before the household is forcibly downgraded one tier. Optional;
   * when omitted, arrears never trigger a downgrade (legacy behavior).
   */
  readonly arrearsDowngradeThresholdHours?: number;
  /**
   * Optional coefficient converting the agent's regional land value index
   * into an additional per-hour upkeep charge:
   * effectiveRate = tierCost + landValueIndex * landValueCoefficientPerHour.
   * Absent (or a missing land value index) keeps the flat per-tier v1 pricing.
   */
  readonly landValueCoefficientPerHour?: number;
};

export type ResidentialArrearsDecision =
  | {
      readonly status: 'downgrade';
      readonly previousResidentialTier: number;
      readonly nextResidentialTier: number;
      readonly arrearsCleared: number;
    }
  | {
      readonly status: 'carry';
      readonly reason: 'below-threshold' | 'lowest-tier' | 'threshold-disabled' | 'zero-cost';
    };

/**
 * Evaluates whether accumulated upkeep arrears force a one-tier downgrade.
 * Mirrors the real-world mechanic that persistent unpaid housing costs lead to
 * losing the current home (Cities: Skylines II: households whose rent exceeds
 * income move away; here the population policy keeps agents in town, so the
 * consequence is a forced downgrade instead).
 */
export function evaluateResidentialArrears(input: {
  readonly residentialTier: number;
  readonly nextArrears: number;
  readonly policy: ResidentialUpkeepPolicy;
  /**
   * Effective per-hour upkeep rate (base tier cost plus land value term) as
   * resolved by the caller via resolveResidentialUpkeepRate. When omitted the
   * flat per-tier v1 rate is used.
   */
  readonly effectiveCostPerHour?: number;
}): ResidentialArrearsDecision {
  if (!isPositiveInteger(input.residentialTier)) {
    throw new Error('residentialTier must be a positive integer');
  }
  if (!isNonNegativeFinite(input.nextArrears)) {
    throw new Error('nextArrears must be non-negative');
  }
  const thresholdHours = input.policy.arrearsDowngradeThresholdHours;
  if (thresholdHours === undefined) {
    return { status: 'carry', reason: 'threshold-disabled' };
  }
  if (!isNonNegativeFinite(thresholdHours)) {
    throw new Error('arrearsDowngradeThresholdHours must be non-negative');
  }
  if (
    input.effectiveCostPerHour !== undefined &&
    !isNonNegativeFinite(input.effectiveCostPerHour)
  ) {
    throw new Error('effectiveCostPerHour must be non-negative');
  }
  const cost = input.policy.costs.find(
    (candidate) => candidate.residentialTier === input.residentialTier,
  );
  const costPerHour =
    input.effectiveCostPerHour ?? (cost === undefined ? undefined : cost.currencyCostPerHour);
  if (costPerHour === undefined || costPerHour === 0) {
    return { status: 'carry', reason: 'zero-cost' };
  }
  if (input.nextArrears < costPerHour * thresholdHours) {
    return { status: 'carry', reason: 'below-threshold' };
  }
  if (input.residentialTier <= 1) {
    return { status: 'carry', reason: 'lowest-tier' };
  }
  return {
    status: 'downgrade',
    previousResidentialTier: input.residentialTier,
    nextResidentialTier: input.residentialTier - 1,
    arrearsCleared: input.nextArrears,
  };
}

export type ResidentialTierUpgradeAgentState = {
  readonly residentialTier: number;
  readonly balance: number;
  readonly educationScore: number;
  readonly inventory: ResidentialTierUpgradeInventory;
};

export type ResidentialTierUpgradeRejectionReason =
  | 'invalid-target'
  | 'policy-invalid'
  | 'insufficient-education'
  | 'insufficient-balance'
  | 'insufficient-inventory';

export type ResidentialTierUpgradeDecision =
  | {
      readonly status: 'accepted';
      readonly previousResidentialTier: number;
      readonly nextResidentialTier: number;
      readonly currencyCost: number;
      readonly consumedInventory: ResidentialTierUpgradeInventory;
    }
  | {
      readonly status: 'rejected';
      readonly reason: ResidentialTierUpgradeRejectionReason;
      readonly detail: string;
    };

export type ResidentialUpkeepDecision =
  | {
      readonly status: 'charged';
      readonly residentialTier: number;
      readonly amount: number;
      readonly unpaidAmount: number;
      readonly previousBalance: number;
      readonly nextBalance: number;
    }
  | {
      readonly status: 'uncharged';
      readonly reason: 'no-upkeep-cost' | 'zero-cost';
    }
  | {
      readonly status: 'rejected';
      readonly reason: 'policy-invalid';
      readonly detail: string;
    };

export function evaluateResidentialTierUpgrade(input: {
  readonly agent: ResidentialTierUpgradeAgentState;
  readonly targetResidentialTier: number;
  readonly policy: ResidentialTierUpgradePolicy;
}): ResidentialTierUpgradeDecision {
  if (!isPositiveInteger(input.agent.residentialTier)) {
    return reject('policy-invalid', 'agent residentialTier must be a positive integer');
  }
  if (!isPositiveInteger(input.targetResidentialTier)) {
    return reject('invalid-target', 'targetResidentialTier must be a positive integer');
  }
  if (input.targetResidentialTier !== input.agent.residentialTier + 1) {
    return reject('invalid-target', 'targetResidentialTier must equal current residentialTier + 1');
  }
  if (input.policy.maxResidentialTier !== undefined) {
    if (!isPositiveInteger(input.policy.maxResidentialTier)) {
      return reject('policy-invalid', 'maxResidentialTier must be a positive integer');
    }
    if (input.targetResidentialTier > input.policy.maxResidentialTier) {
      return reject(
        'invalid-target',
        `targetResidentialTier exceeds maxResidentialTier ${input.policy.maxResidentialTier}`,
      );
    }
  }

  const cost = input.policy.costs.find(
    (candidate) => candidate.targetResidentialTier === input.targetResidentialTier,
  );
  if (cost === undefined) {
    return reject(
      'invalid-target',
      `missing upgrade cost for residential tier ${input.targetResidentialTier}`,
    );
  }

  const currencyCost = cost.currencyCost ?? 0;
  if (!isNonNegativeFinite(currencyCost)) {
    return reject('policy-invalid', 'currencyCost must be non-negative');
  }

  const minEducationScore = cost.minEducationScore ?? 0;
  if (!isNonNegativeFinite(minEducationScore)) {
    return reject('policy-invalid', 'minEducationScore must be non-negative');
  }
  if (input.agent.educationScore < minEducationScore) {
    return reject(
      'insufficient-education',
      `educationScore requires ${minEducationScore}, available ${input.agent.educationScore}`,
    );
  }

  if (input.agent.balance < currencyCost) {
    return reject(
      'insufficient-balance',
      `balance requires ${currencyCost}, available ${input.agent.balance}`,
    );
  }

  const consumedInventory = cost.inventoryCosts ?? {};
  for (const [itemName, requiredQuantity] of Object.entries(consumedInventory)) {
    if (!isNonNegativeFinite(requiredQuantity)) {
      return reject('policy-invalid', `inventory cost for ${itemName} must be non-negative`);
    }
    const availableQuantity = input.agent.inventory[itemName] ?? 0;
    if (availableQuantity < requiredQuantity) {
      return reject(
        'insufficient-inventory',
        `${itemName} requires ${requiredQuantity}, available ${availableQuantity}`,
      );
    }
  }

  return {
    status: 'accepted',
    previousResidentialTier: input.agent.residentialTier,
    nextResidentialTier: input.targetResidentialTier,
    currencyCost,
    consumedInventory,
  };
}

/**
 * Resolves the effective per-hour upkeep rate for a tier: the flat tier cost
 * plus the regional land value term when both the policy coefficient and a
 * land value index are available. Returns undefined when the tier has no
 * configured cost (which v1 semantics treat as "no upkeep").
 */
export function resolveResidentialUpkeepRate(input: {
  readonly residentialTier: number;
  readonly policy: ResidentialUpkeepPolicy;
  readonly landValueIndex?: number;
}): number | undefined {
  if (!isPositiveInteger(input.residentialTier)) {
    throw new Error('residentialTier must be a positive integer');
  }
  if (input.landValueIndex !== undefined && !isNonNegativeFinite(input.landValueIndex)) {
    throw new Error('landValueIndex must be non-negative');
  }
  const cost = input.policy.costs.find(
    (candidate) => candidate.residentialTier === input.residentialTier,
  );
  if (cost === undefined) {
    return undefined;
  }
  const coefficient = input.policy.landValueCoefficientPerHour ?? 0;
  if (!isNonNegativeFinite(coefficient)) {
    throw new Error('landValueCoefficientPerHour must be non-negative');
  }
  return cost.currencyCostPerHour + (input.landValueIndex ?? 0) * coefficient;
}

export function evaluateResidentialUpkeep(input: {
  readonly residentialTier: number;
  readonly balance: number;
  readonly durationSeconds: number;
  readonly policy: ResidentialUpkeepPolicy;
  /**
   * Regional land value index for the agent's current region. Only affects
   * pricing when the policy carries landValueCoefficientPerHour.
   */
  readonly landValueIndex?: number;
}): ResidentialUpkeepDecision {
  if (!isPositiveInteger(input.residentialTier)) {
    return rejectUpkeep('residentialTier must be a positive integer');
  }
  if (!isNonNegativeFinite(input.balance)) {
    return rejectUpkeep('balance must be non-negative');
  }
  if (!isNonNegativeFinite(input.durationSeconds)) {
    return rejectUpkeep('durationSeconds must be non-negative');
  }
  if (input.landValueIndex !== undefined && !isNonNegativeFinite(input.landValueIndex)) {
    return rejectUpkeep('landValueIndex must be non-negative');
  }

  const cost = input.policy.costs.find(
    (candidate) => candidate.residentialTier === input.residentialTier,
  );
  if (cost === undefined) {
    return { status: 'uncharged', reason: 'no-upkeep-cost' };
  }
  if (!isPositiveInteger(cost.residentialTier)) {
    return rejectUpkeep('residentialTier must be a positive integer');
  }
  if (!isNonNegativeFinite(cost.currencyCostPerHour)) {
    return rejectUpkeep('currencyCostPerHour must be non-negative');
  }

  const costPerHour = resolveResidentialUpkeepRate({
    residentialTier: input.residentialTier,
    policy: input.policy,
    ...(input.landValueIndex === undefined ? {} : { landValueIndex: input.landValueIndex }),
  });
  if (costPerHour === undefined) {
    return { status: 'uncharged', reason: 'no-upkeep-cost' };
  }

  const dueAmount = costPerHour * (input.durationSeconds / 3600);
  if (dueAmount === 0) {
    return { status: 'uncharged', reason: 'zero-cost' };
  }

  const amount = Math.min(input.balance, dueAmount);
  return {
    status: 'charged',
    residentialTier: input.residentialTier,
    amount,
    unpaidAmount: dueAmount - amount,
    previousBalance: input.balance,
    nextBalance: input.balance - amount,
  };
}

function reject(
  reason: ResidentialTierUpgradeRejectionReason,
  detail: string,
): ResidentialTierUpgradeDecision {
  return { status: 'rejected', reason, detail };
}

/**
 * Composition-root validation for ResidentialUpkeepPolicy. The evaluate
 * functions keep their inline rejection-based checks for replay safety; this
 * assert is for policy assembly (worker) to fail fast on malformed configs.
 */
export function assertValidResidentialUpkeepPolicy(policy: ResidentialUpkeepPolicy): void {
  if (policy.policyVersion !== undefined && policy.policyVersion.trim().length === 0) {
    throw new Error('residential upkeep policyVersion must not be empty when provided');
  }
  for (const cost of policy.costs) {
    if (!isPositiveInteger(cost.residentialTier)) {
      throw new Error('costs[].residentialTier must be a positive integer');
    }
    if (!isNonNegativeFinite(cost.currencyCostPerHour)) {
      throw new Error('costs[].currencyCostPerHour must be non-negative');
    }
  }
  if (
    policy.arrearsDowngradeThresholdHours !== undefined &&
    !isNonNegativeFinite(policy.arrearsDowngradeThresholdHours)
  ) {
    throw new Error('arrearsDowngradeThresholdHours must be non-negative');
  }
  if (
    policy.landValueCoefficientPerHour !== undefined &&
    !isNonNegativeFinite(policy.landValueCoefficientPerHour)
  ) {
    throw new Error('landValueCoefficientPerHour must be non-negative');
  }
}

function rejectUpkeep(detail: string): ResidentialUpkeepDecision {
  return { status: 'rejected', reason: 'policy-invalid', detail };
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
