/**
 * Legacy balance-floor transfer. This is intentionally separate from the paper-aligned
 * physiological safety net because currency eligibility does not prove persistent physiological
 * distress and currency is not an essential-good grant.
 */
export type SafetyNetSubsidyPolicy = {
  readonly minimumBalance: number;
  readonly maxSubsidy: number;
};

export type PhysiologicalAxis = 'satiety' | 'energy' | 'health';

export type PhysiologicalSafetyNetInventory = Readonly<Record<string, number>>;

export type PhysiologicalSafetyNetPolicy = {
  readonly policyVersion: string;
  readonly criticalThresholds: Readonly<Record<PhysiologicalAxis, number>>;
  readonly persistenceDurationMs: number;
  readonly grantCooldownMs: number;
  readonly essentialInventoryTargets: PhysiologicalSafetyNetInventory;
};

export type PhysiologicalDistressState = {
  readonly policyVersion: string;
  readonly distressStartedAt: number;
  readonly lowAxes: readonly PhysiologicalAxis[];
  readonly lastGrantedAt: number | null;
};

export type PhysiologicalSafetyNetGrant = {
  readonly grantedAt: number;
  readonly distressDurationMs: number;
  readonly lowAxes: readonly PhysiologicalAxis[];
  readonly inventory: PhysiologicalSafetyNetInventory;
};

export type PhysiologicalSafetyNetDecision = {
  readonly transition: 'started' | 'updated' | 'cleared' | 'unchanged';
  readonly distressState: PhysiologicalDistressState | null;
  readonly grant: PhysiologicalSafetyNetGrant | null;
};

export type SafetyNetSubsidyDecision =
  | {
      readonly status: 'eligible';
      readonly amount: number;
      readonly previousBalance: number;
      readonly nextBalance: number;
    }
  | {
      readonly status: 'ineligible';
      readonly reason: 'balance-at-or-above-minimum';
    };

export function evaluateSafetyNetSubsidy(
  input: SafetyNetSubsidyPolicy & {
    readonly balance: number;
  },
): SafetyNetSubsidyDecision {
  assertNonNegativeFinite(input.balance, 'balance');
  assertNonNegativeFinite(input.minimumBalance, 'minimumBalance');
  assertNonNegativeFinite(input.maxSubsidy, 'maxSubsidy');

  const gap = input.minimumBalance - input.balance;
  if (gap <= 0 || input.maxSubsidy === 0) {
    return { status: 'ineligible', reason: 'balance-at-or-above-minimum' };
  }

  const amount = Math.min(gap, input.maxSubsidy);
  return {
    status: 'eligible',
    amount,
    previousBalance: input.balance,
    nextBalance: input.balance + amount,
  };
}

export function evaluatePhysiologicalSafetyNet(input: {
  readonly previousPhysiology: Readonly<Record<PhysiologicalAxis, number>>;
  readonly currentPhysiology: Readonly<Record<PhysiologicalAxis, number>>;
  readonly inventory: PhysiologicalSafetyNetInventory;
  readonly previousDistressState?: PhysiologicalDistressState;
  readonly previousSimulationTime: number;
  readonly currentSimulationTime: number;
  readonly policy: PhysiologicalSafetyNetPolicy;
}): PhysiologicalSafetyNetDecision {
  validatePhysiologicalSafetyNetInput(input);

  const previousLowAxes = collectLowPhysiologicalAxes(
    input.previousPhysiology,
    input.policy.criticalThresholds,
  );
  const currentLowAxes = collectLowPhysiologicalAxes(
    input.currentPhysiology,
    input.policy.criticalThresholds,
  );
  const storedState = input.previousDistressState;
  const previousState =
    storedState?.policyVersion === input.policy.policyVersion
      ? input.previousDistressState
      : undefined;

  if (currentLowAxes.length === 0) {
    return {
      transition: storedState === undefined ? 'unchanged' : 'cleared',
      distressState: null,
      grant: null,
    };
  }

  const distressState: PhysiologicalDistressState =
    previousState === undefined
      ? {
          policyVersion: input.policy.policyVersion,
          distressStartedAt:
            previousLowAxes.length > 0 ? input.previousSimulationTime : input.currentSimulationTime,
          lowAxes: currentLowAxes,
          lastGrantedAt: null,
        }
      : {
          ...previousState,
          lowAxes: currentLowAxes,
        };
  const transition = resolveDistressTransition(previousState, distressState);
  const distressDurationMs = input.currentSimulationTime - distressState.distressStartedAt;
  if (distressDurationMs < input.policy.persistenceDurationMs) {
    return { transition, distressState, grant: null };
  }
  if (
    distressState.lastGrantedAt !== null &&
    input.currentSimulationTime - distressState.lastGrantedAt < input.policy.grantCooldownMs
  ) {
    return { transition, distressState, grant: null };
  }

  const inventory = calculateEssentialInventoryGrant({
    currentInventory: input.inventory,
    targets: input.policy.essentialInventoryTargets,
  });
  if (Object.keys(inventory).length === 0) {
    return { transition, distressState, grant: null };
  }

  return {
    transition,
    distressState,
    grant: {
      grantedAt: input.currentSimulationTime,
      distressDurationMs,
      lowAxes: currentLowAxes,
      inventory,
    },
  };
}

export function collectLowPhysiologicalAxes(
  physiology: Readonly<Record<PhysiologicalAxis, number>>,
  thresholds: Readonly<Record<PhysiologicalAxis, number>>,
): readonly PhysiologicalAxis[] {
  return (['satiety', 'energy', 'health'] as const).filter(
    (axis) => physiology[axis] < thresholds[axis],
  );
}

function calculateEssentialInventoryGrant(input: {
  readonly currentInventory: PhysiologicalSafetyNetInventory;
  readonly targets: PhysiologicalSafetyNetInventory;
}): PhysiologicalSafetyNetInventory {
  const grant: Record<string, number> = {};
  for (const [itemName, targetQuantity] of Object.entries(input.targets).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const currentQuantity = input.currentInventory[itemName] ?? 0;
    const quantity = Math.max(0, targetQuantity - currentQuantity);
    if (quantity > 0) {
      grant[itemName] = quantity;
    }
  }
  return grant;
}

function resolveDistressTransition(
  previous: PhysiologicalDistressState | undefined,
  next: PhysiologicalDistressState,
): PhysiologicalSafetyNetDecision['transition'] {
  if (previous === undefined) {
    return 'started';
  }
  return areAxesEqual(previous.lowAxes, next.lowAxes) ? 'unchanged' : 'updated';
}

function areAxesEqual(
  left: readonly PhysiologicalAxis[],
  right: readonly PhysiologicalAxis[],
): boolean {
  return left.length === right.length && left.every((axis, index) => axis === right[index]);
}

function validatePhysiologicalSafetyNetInput(input: {
  readonly previousPhysiology: Readonly<Record<PhysiologicalAxis, number>>;
  readonly currentPhysiology: Readonly<Record<PhysiologicalAxis, number>>;
  readonly inventory: PhysiologicalSafetyNetInventory;
  readonly previousDistressState?: PhysiologicalDistressState;
  readonly previousSimulationTime: number;
  readonly currentSimulationTime: number;
  readonly policy: PhysiologicalSafetyNetPolicy;
}): void {
  if (input.policy.policyVersion.trim().length === 0) {
    throw new Error('physiological safety-net policyVersion must not be empty');
  }
  assertNonNegativeFinite(input.previousSimulationTime, 'previousSimulationTime');
  assertNonNegativeFinite(input.currentSimulationTime, 'currentSimulationTime');
  if (input.currentSimulationTime < input.previousSimulationTime) {
    throw new Error(
      'currentSimulationTime must be greater than or equal to previousSimulationTime',
    );
  }
  assertNonNegativeFinite(input.policy.persistenceDurationMs, 'persistenceDurationMs');
  assertNonNegativeFinite(input.policy.grantCooldownMs, 'grantCooldownMs');
  for (const axis of ['satiety', 'energy', 'health'] as const) {
    assertNonNegativeFinite(input.previousPhysiology[axis], `previousPhysiology.${axis}`);
    assertNonNegativeFinite(input.currentPhysiology[axis], `currentPhysiology.${axis}`);
    assertNonNegativeFinite(input.policy.criticalThresholds[axis], `criticalThresholds.${axis}`);
  }
  let hasPositiveTarget = false;
  for (const [itemName, quantity] of Object.entries(input.policy.essentialInventoryTargets)) {
    if (itemName.trim().length === 0) {
      throw new Error('essential inventory target item name must not be empty');
    }
    assertNonNegativeFinite(quantity, `essential inventory target for ${itemName}`);
    hasPositiveTarget ||= quantity > 0;
  }
  if (!hasPositiveTarget) {
    throw new Error('essentialInventoryTargets must contain at least one positive target');
  }
  for (const [itemName, quantity] of Object.entries(input.inventory)) {
    assertNonNegativeFinite(quantity, `inventory quantity for ${itemName}`);
  }
  if (input.previousDistressState !== undefined) {
    assertNonNegativeFinite(input.previousDistressState.distressStartedAt, 'distressStartedAt');
    if (input.previousDistressState.distressStartedAt > input.previousSimulationTime) {
      throw new Error('distressStartedAt must not be after previousSimulationTime');
    }
    if (
      input.previousDistressState.lastGrantedAt !== null &&
      (input.previousDistressState.lastGrantedAt < input.previousDistressState.distressStartedAt ||
        input.previousDistressState.lastGrantedAt > input.previousSimulationTime)
    ) {
      throw new Error('lastGrantedAt must be within the active distress interval');
    }
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}
