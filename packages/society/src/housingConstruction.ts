export type HousingConstructionInventory = Readonly<Record<string, number>>;

/**
 * Versioned supply-response rule for finite residential locations. The policy
 * deliberately models only physical capacity creation; ownership, rent and
 * developer finance remain separate future capabilities rather than being
 * guessed into this first construction slice.
 */
export type HousingConstructionPolicy = {
  readonly policyVersion: string;
  readonly minimumOccupancyRatio: number;
  readonly capacityPerProject: number;
  readonly maximumLocationCapacity: number;
  readonly inventoryCosts: HousingConstructionInventory;
  readonly builderSelection: 'lowest-agent-id-with-materials-per-partition';
  readonly locationSelection: 'lowest-capacity-then-id';
};

export type HousingConstructionDecision =
  | {
      readonly status: 'accepted';
      readonly previousCapacity: number;
      readonly nextCapacity: number;
      readonly addedCapacity: number;
      readonly population: number;
      readonly totalResidentialCapacity: number;
      readonly occupancyRatio: number;
      readonly consumedInventory: HousingConstructionInventory;
      readonly policyVersion: string;
    }
  | {
      readonly status: 'rejected';
      readonly reason:
        | 'policy-invalid'
        | 'demand-too-low'
        | 'capacity-limit-reached'
        | 'insufficient-inventory';
      readonly detail: string;
    };

export function evaluateHousingConstruction(input: {
  readonly locationCapacity: number;
  readonly totalResidentialCapacity: number;
  readonly population: number;
  readonly builderInventory: HousingConstructionInventory;
  readonly policy: HousingConstructionPolicy;
}): HousingConstructionDecision {
  try {
    assertValidHousingConstructionPolicy(input.policy);
  } catch (error) {
    return reject('policy-invalid', error instanceof Error ? error.message : String(error));
  }
  if (!isPositiveInteger(input.locationCapacity)) {
    return reject('policy-invalid', 'locationCapacity must be a positive integer');
  }
  if (!isPositiveInteger(input.totalResidentialCapacity)) {
    return reject('policy-invalid', 'totalResidentialCapacity must be a positive integer');
  }
  if (!isNonNegativeInteger(input.population)) {
    return reject('policy-invalid', 'population must be a non-negative integer');
  }
  if (input.locationCapacity > input.totalResidentialCapacity) {
    return reject('policy-invalid', 'locationCapacity must not exceed totalResidentialCapacity');
  }

  const occupancyRatio = Math.min(1, input.population / input.totalResidentialCapacity);
  if (occupancyRatio < input.policy.minimumOccupancyRatio) {
    return reject(
      'demand-too-low',
      `occupancy ratio requires ${input.policy.minimumOccupancyRatio}, available ${occupancyRatio}`,
    );
  }
  if (input.locationCapacity >= input.policy.maximumLocationCapacity) {
    return reject(
      'capacity-limit-reached',
      `capacity has reached maximum ${input.policy.maximumLocationCapacity}`,
    );
  }

  for (const [itemName, requiredQuantity] of sortedEntries(input.policy.inventoryCosts)) {
    const availableQuantity = input.builderInventory[itemName] ?? 0;
    if (availableQuantity < requiredQuantity) {
      return reject(
        'insufficient-inventory',
        `${itemName} requires ${requiredQuantity}, available ${availableQuantity}`,
      );
    }
  }

  const addedCapacity = Math.min(
    input.policy.capacityPerProject,
    input.policy.maximumLocationCapacity - input.locationCapacity,
  );
  return {
    status: 'accepted',
    previousCapacity: input.locationCapacity,
    nextCapacity: input.locationCapacity + addedCapacity,
    addedCapacity,
    population: input.population,
    totalResidentialCapacity: input.totalResidentialCapacity,
    occupancyRatio,
    consumedInventory: Object.fromEntries(sortedEntries(input.policy.inventoryCosts)),
    policyVersion: input.policy.policyVersion,
  };
}

export function assertValidHousingConstructionPolicy(policy: HousingConstructionPolicy): void {
  if (typeof policy.policyVersion !== 'string' || policy.policyVersion.trim().length === 0) {
    throw new Error('housing construction policyVersion must not be empty');
  }
  if (
    !Number.isFinite(policy.minimumOccupancyRatio) ||
    policy.minimumOccupancyRatio < 0 ||
    policy.minimumOccupancyRatio > 1
  ) {
    throw new Error('housing construction minimumOccupancyRatio must be between 0 and 1');
  }
  if (!isPositiveInteger(policy.capacityPerProject)) {
    throw new Error('housing construction capacityPerProject must be a positive integer');
  }
  if (!isPositiveInteger(policy.maximumLocationCapacity)) {
    throw new Error('housing construction maximumLocationCapacity must be a positive integer');
  }
  const inventoryEntries = sortedEntries(policy.inventoryCosts);
  if (inventoryEntries.length === 0) {
    throw new Error('housing construction inventoryCosts must not be empty');
  }
  for (const [itemName, quantity] of inventoryEntries) {
    if (itemName.trim().length === 0) {
      throw new Error('housing construction inventory item name must not be empty');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(
        `housing construction inventory cost for ${itemName} must be positive finite`,
      );
    }
  }
  if (policy.builderSelection !== 'lowest-agent-id-with-materials-per-partition') {
    throw new Error('unsupported housing construction builderSelection');
  }
  if (policy.locationSelection !== 'lowest-capacity-then-id') {
    throw new Error('unsupported housing construction locationSelection');
  }
}

function reject(
  reason: Extract<HousingConstructionDecision, { readonly status: 'rejected' }>['reason'],
  detail: string,
): HousingConstructionDecision {
  return { status: 'rejected', reason, detail };
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function sortedEntries(record: HousingConstructionInventory): readonly [string, number][] {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}
