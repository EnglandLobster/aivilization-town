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
  readonly costs: readonly ResidentialUpkeepCost[];
};

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

export function evaluateResidentialUpkeep(input: {
  readonly residentialTier: number;
  readonly balance: number;
  readonly durationSeconds: number;
  readonly policy: ResidentialUpkeepPolicy;
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

  const dueAmount = cost.currencyCostPerHour * (input.durationSeconds / 3600);
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

function rejectUpkeep(detail: string): ResidentialUpkeepDecision {
  return { status: 'rejected', reason: 'policy-invalid', detail };
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
