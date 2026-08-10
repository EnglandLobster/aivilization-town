export type EducationAccumulationInput = {
  readonly currentEducationScore: number;
  readonly educationRatePerSecond: number;
  readonly studyDurationSeconds: number;
};

export type EducationInvestmentInventory = Readonly<Record<string, number>>;

export type EducationInvestmentPolicy = {
  readonly currencyCostPerHour: number;
  readonly inventoryCostsPerHour: EducationInvestmentInventory;
};

export type EducationInvestmentRequirements = {
  readonly currencyCost: number;
  readonly inventoryCosts: EducationInvestmentInventory;
};

export type EducationInvestmentDecision =
  | {
      readonly status: 'accepted';
      readonly currencyCost: number;
      readonly previousBalance: number;
      readonly nextBalance: number;
      readonly consumedInventory: EducationInvestmentInventory;
    }
  | {
      readonly status: 'rejected';
      readonly reason: 'insufficient-balance' | 'insufficient-inventory' | 'policy-invalid';
      readonly detail: string;
    };

export function accumulateEducation(input: EducationAccumulationInput): number {
  assertNonNegativeFinite(input.currentEducationScore, 'currentEducationScore');
  assertNonNegativeFinite(input.educationRatePerSecond, 'educationRatePerSecond');
  assertNonNegativeFinite(input.studyDurationSeconds, 'studyDurationSeconds');

  return input.currentEducationScore + input.educationRatePerSecond * input.studyDurationSeconds;
}

export function calculateEducationInvestmentRequirements(input: {
  readonly studyDurationSeconds: number;
  readonly policy: EducationInvestmentPolicy;
}): EducationInvestmentRequirements {
  assertNonNegativeFinite(input.studyDurationSeconds, 'studyDurationSeconds');
  assertNonNegativeFinite(input.policy.currencyCostPerHour, 'currencyCostPerHour');
  const durationHours = input.studyDurationSeconds / 3600;
  const inventoryCosts: Record<string, number> = {};
  for (const [itemName, quantityPerHour] of Object.entries(
    input.policy.inventoryCostsPerHour,
  ).sort(([left], [right]) => left.localeCompare(right))) {
    if (itemName.trim().length === 0) {
      throw new Error('inventory cost item name must not be empty');
    }
    assertNonNegativeFinite(quantityPerHour, `inventory cost per hour for ${itemName}`);
    const requiredQuantity = quantityPerHour * durationHours;
    if (requiredQuantity > 0) {
      inventoryCosts[itemName] = requiredQuantity;
    }
  }
  return {
    currencyCost: input.policy.currencyCostPerHour * durationHours,
    inventoryCosts,
  };
}

export function evaluateEducationInvestment(input: {
  readonly agent: {
    readonly balance: number;
    readonly inventory: EducationInvestmentInventory;
  };
  readonly studyDurationSeconds: number;
  readonly policy: EducationInvestmentPolicy;
}): EducationInvestmentDecision {
  if (!isNonNegativeFinite(input.agent.balance)) {
    return rejectInvestment('policy-invalid', 'balance must be non-negative');
  }
  let requirements: EducationInvestmentRequirements;
  try {
    requirements = calculateEducationInvestmentRequirements({
      studyDurationSeconds: input.studyDurationSeconds,
      policy: input.policy,
    });
  } catch (error) {
    return rejectInvestment(
      'policy-invalid',
      error instanceof Error ? error.message : 'education investment policy is invalid',
    );
  }
  if (input.agent.balance < requirements.currencyCost) {
    return rejectInvestment(
      'insufficient-balance',
      `balance requires ${requirements.currencyCost}, available ${input.agent.balance}`,
    );
  }

  const consumedInventory: Record<string, number> = {};
  for (const [itemName, requiredQuantity] of Object.entries(requirements.inventoryCosts)) {
    const availableQuantity = input.agent.inventory[itemName] ?? 0;
    if (!isNonNegativeFinite(availableQuantity)) {
      return rejectInvestment(
        'policy-invalid',
        `inventory quantity for ${itemName} must be non-negative`,
      );
    }
    if (availableQuantity < requiredQuantity) {
      return rejectInvestment(
        'insufficient-inventory',
        `${itemName} requires ${requiredQuantity}, available ${availableQuantity}`,
      );
    }
    if (requiredQuantity > 0) {
      consumedInventory[itemName] = requiredQuantity;
    }
  }

  return {
    status: 'accepted',
    currencyCost: requirements.currencyCost,
    previousBalance: input.agent.balance,
    nextBalance: input.agent.balance - requirements.currencyCost,
    consumedInventory,
  };
}

function rejectInvestment(
  reason: Extract<EducationInvestmentDecision, { status: 'rejected' }>['reason'],
  detail: string,
): EducationInvestmentDecision {
  return { status: 'rejected', reason, detail };
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
