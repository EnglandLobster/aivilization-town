export type RenewableResourceDefinition = {
  readonly commodityName: string;
  readonly initialStock: number;
  readonly carryingCapacity: number;
  readonly regenerationPerCadence: number;
  readonly extractionPerOutputUnit: number;
};

/**
 * Versioned renewable-resource policy. The economy package owns the stock
 * arithmetic; persistence, regional ownership and cadence scheduling remain
 * world application concerns.
 */
export type RenewableResourcePolicy = {
  readonly policyVersion: string;
  readonly regenerationCadenceMs: number;
  readonly resources: readonly RenewableResourceDefinition[];
  readonly source?: string;
};

export type RenewableResourceExtractionDecision =
  | {
      readonly status: 'unmanaged';
    }
  | {
      readonly status: 'rejected';
      readonly reason: 'insufficient-renewable-resource';
      readonly commodityName: string;
      readonly requiredStock: number;
      readonly availableStock: number;
    }
  | {
      readonly status: 'accepted';
      readonly commodityName: string;
      readonly outputQuantity: number;
      readonly extractedStock: number;
      readonly previousStock: number;
      readonly nextStock: number;
      readonly carryingCapacity: number;
      readonly policyVersion: string;
    };

export type RenewableResourceRegenerationDecision = {
  readonly commodityName: string;
  readonly regeneratedStock: number;
  readonly previousStock: number;
  readonly nextStock: number;
  readonly carryingCapacity: number;
  readonly policyVersion: string;
};

export function assertValidRenewableResourcePolicy(policy: RenewableResourcePolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('renewable resource policyVersion must be non-empty');
  }
  if (!Number.isInteger(policy.regenerationCadenceMs) || policy.regenerationCadenceMs <= 0) {
    throw new Error('renewable resource regenerationCadenceMs must be a positive integer');
  }
  if (policy.resources.length === 0) {
    throw new Error('renewable resource policy must define at least one resource');
  }

  const commodityNames = new Set<string>();
  for (const resource of policy.resources) {
    if (resource.commodityName.trim().length === 0) {
      throw new Error('renewable resource commodityName must be non-empty');
    }
    if (commodityNames.has(resource.commodityName)) {
      throw new Error(`duplicate renewable resource ${resource.commodityName}`);
    }
    commodityNames.add(resource.commodityName);
    assertFiniteNonNegative(resource.initialStock, `${resource.commodityName} initialStock`);
    assertFinitePositive(resource.carryingCapacity, `${resource.commodityName} carryingCapacity`);
    if (resource.initialStock > resource.carryingCapacity) {
      throw new Error(
        `${resource.commodityName} initialStock must not exceed carryingCapacity`,
      );
    }
    assertFiniteNonNegative(
      resource.regenerationPerCadence,
      `${resource.commodityName} regenerationPerCadence`,
    );
    assertFinitePositive(
      resource.extractionPerOutputUnit,
      `${resource.commodityName} extractionPerOutputUnit`,
    );
  }
}

export function evaluateRenewableResourceExtraction(input: {
  readonly commodityName: string;
  readonly outputQuantity: number;
  readonly currentStock?: number;
  readonly policy: RenewableResourcePolicy;
}): RenewableResourceExtractionDecision {
  assertValidRenewableResourcePolicy(input.policy);
  assertFinitePositive(input.outputQuantity, 'renewable resource outputQuantity');
  const resource = input.policy.resources.find(
    (candidate) => candidate.commodityName === input.commodityName,
  );
  if (resource === undefined) {
    return { status: 'unmanaged' };
  }

  const previousStock = input.currentStock ?? resource.initialStock;
  assertResourceStock(previousStock, resource);
  const extractedStock = input.outputQuantity * resource.extractionPerOutputUnit;
  if (previousStock < extractedStock) {
    return {
      status: 'rejected',
      reason: 'insufficient-renewable-resource',
      commodityName: input.commodityName,
      requiredStock: extractedStock,
      availableStock: previousStock,
    };
  }
  return {
    status: 'accepted',
    commodityName: input.commodityName,
    outputQuantity: input.outputQuantity,
    extractedStock,
    previousStock,
    nextStock: previousStock - extractedStock,
    carryingCapacity: resource.carryingCapacity,
    policyVersion: input.policy.policyVersion,
  };
}

/** Applies exactly one regeneration cadence; callers enumerate boundaries. */
export function evaluateRenewableResourceRegeneration(input: {
  readonly resource: RenewableResourceDefinition;
  readonly currentStock?: number;
  readonly policyVersion: string;
}): RenewableResourceRegenerationDecision {
  if (input.policyVersion.trim().length === 0) {
    throw new Error('renewable resource policyVersion must be non-empty');
  }
  const previousStock = input.currentStock ?? input.resource.initialStock;
  assertResourceStock(previousStock, input.resource);
  const nextStock = Math.min(
    input.resource.carryingCapacity,
    previousStock + input.resource.regenerationPerCadence,
  );
  return {
    commodityName: input.resource.commodityName,
    regeneratedStock: nextStock - previousStock,
    previousStock,
    nextStock,
    carryingCapacity: input.resource.carryingCapacity,
    policyVersion: input.policyVersion,
  };
}

function assertResourceStock(stock: number, resource: RenewableResourceDefinition): void {
  assertFiniteNonNegative(stock, `${resource.commodityName} currentStock`);
  if (stock > resource.carryingCapacity) {
    throw new Error(`${resource.commodityName} currentStock must not exceed carryingCapacity`);
  }
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be finite and non-negative`);
  }
}

function assertFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be finite and positive`);
  }
}
