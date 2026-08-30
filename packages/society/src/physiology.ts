export type PhysiologicalState = {
  readonly energy: number;
  readonly satiety: number;
  readonly health: number;
};

export type ResidentialPhysiologyCap = {
  readonly residentialTier: number;
  readonly maxEnergy: number;
  readonly maxSatiety: number;
  readonly maxHealth: number;
};

export type ResidentialPhysiologyCapPolicy = {
  readonly caps: readonly ResidentialPhysiologyCap[];
};

export type ResidentialPhysiologyCapDecision =
  | {
      readonly status: 'accepted';
      readonly cap: ResidentialPhysiologyCap;
    }
  | {
      readonly status: 'rejected';
      readonly reason: 'cap-missing' | 'policy-invalid';
      readonly detail: string;
    };

export type LaborPhysiologyCostInput = PhysiologicalState & {
  readonly laborSeconds: number;
  readonly energyCostPerHour: number;
  readonly satietyCostPerHour: number;
};

export type EnergyRecoveryInput = PhysiologicalState & {
  readonly durationSeconds: number;
  readonly energyRecoveryPerSecond: number;
  readonly maxEnergy: number;
};

export type HealthRecoveryInput = PhysiologicalState & {
  readonly durationSeconds: number;
  readonly healthRecoveryPerSecond: number;
  readonly maxHealth: number;
};

export type SleepDeprivationHealthDecayPolicy = {
  readonly energyThreshold: number;
  readonly healthDecayPerSecond: number;
  readonly minHealth: number;
};

/**
 * Passive per-hour physiological decay rates applied while time advances
 * (town-calendar-v1 sub-configuration). Linear and clamped at zero, hence
 * strictly additive across settlement intervals: decaying by a merged window
 * equals decaying interval by interval exactly, even across the zero floor.
 * Health is never touched by passive decay.
 */
export type PassivePhysiologicalDecayPolicy = {
  readonly energyPerHour: number;
  readonly satietyPerHour: number;
};

export function applyPassivePhysiologicalDecay(input: {
  readonly previous: PhysiologicalState;
  readonly elapsedMs: number;
  readonly decay: PassivePhysiologicalDecayPolicy;
}): PhysiologicalState {
  assertNonNegativeFinite(input.previous.energy, 'energy');
  assertNonNegativeFinite(input.previous.satiety, 'satiety');
  assertNonNegativeFinite(input.previous.health, 'health');
  assertNonNegativeFinite(input.elapsedMs, 'elapsedMs');
  assertNonNegativeFinite(input.decay.energyPerHour, 'decay.energyPerHour');
  assertNonNegativeFinite(input.decay.satietyPerHour, 'decay.satietyPerHour');

  const elapsedHours = input.elapsedMs / 3_600_000;
  return {
    energy: Math.max(0, input.previous.energy - input.decay.energyPerHour * elapsedHours),
    satiety: Math.max(0, input.previous.satiety - input.decay.satietyPerHour * elapsedHours),
    health: input.previous.health,
  };
}

export type SleepDeprivationHealthDecayInput = PhysiologicalState &
  SleepDeprivationHealthDecayPolicy & {
    readonly durationSeconds: number;
  };

type StochasticIllnessPolicyParameters = {
  readonly illnessProbabilityPercentPerHour: number;
  readonly healthDamage: number;
  readonly minHealth: number;
};

/**
 * v2 policies declare a fixed simulation-time roll grid. The second branch is
 * the public compatibility shape for pre-versioned manifests; it deliberately
 * retains their command-scoped settlement semantics.
 */
export type StochasticIllnessPolicy = StochasticIllnessPolicyParameters &
  (
    | {
        readonly policyVersion: string;
        readonly settlementCadenceMs: number;
      }
    | {
        readonly policyVersion?: never;
        readonly settlementCadenceMs?: never;
      }
  );

export function assertValidStochasticIllnessPolicy(policy: StochasticIllnessPolicy): void {
  if (policy.policyVersion !== undefined && policy.policyVersion.trim().length === 0) {
    throw new Error('stochastic illness policyVersion must not be empty when provided');
  }
  if (policy.settlementCadenceMs !== undefined) {
    assertPositiveInteger(policy.settlementCadenceMs, 'stochastic illness settlementCadenceMs');
  }
  assertNonNegativeFinite(
    policy.illnessProbabilityPercentPerHour,
    'illnessProbabilityPercentPerHour',
  );
  if (policy.illnessProbabilityPercentPerHour > 100) {
    throw new Error('illnessProbabilityPercentPerHour must not exceed 100');
  }
  assertNonNegativeFinite(policy.healthDamage, 'healthDamage');
  assertNonNegativeFinite(policy.minHealth, 'minHealth');
}

/**
 * Versioned starvation pressure. The health loss is proportional to the
 * normalized satiety deficit below `satietyThreshold` and linear in elapsed
 * time. World settles it once per `settlementCadenceMs`, after passive
 * satiety decay, so merged advances replay identically to stepped advances.
 */
export type StarvationHealthDecayPolicy = {
  readonly policyVersion: string;
  readonly settlementCadenceMs: number;
  readonly dayLengthMs: number;
  readonly satietyThreshold: number;
  readonly healthDecayPerHourAtZeroSatiety: number;
  readonly minHealth: number;
  readonly deathHealthThreshold: number;
  readonly source?: string;
};

export type StarvationHealthDecayInput = PhysiologicalState & {
  readonly elapsedMs: number;
  readonly policy: StarvationHealthDecayPolicy;
};

export type StochasticIllnessProbabilityInput = Pick<
  StochasticIllnessPolicy,
  'illnessProbabilityPercentPerHour'
> & {
  readonly durationSeconds: number;
};

export type StochasticIllnessHealthDecayInput = PhysiologicalState &
  Pick<StochasticIllnessPolicy, 'healthDamage' | 'minHealth'> & {
    readonly illnessOccurs: boolean;
  };

export function applyLaborPhysiologyCost(input: LaborPhysiologyCostInput): PhysiologicalState {
  assertNonNegativeFinite(input.energy, 'energy');
  assertNonNegativeFinite(input.satiety, 'satiety');
  assertNonNegativeFinite(input.health, 'health');
  assertNonNegativeFinite(input.laborSeconds, 'laborSeconds');
  assertNonNegativeFinite(input.energyCostPerHour, 'energyCostPerHour');
  assertNonNegativeFinite(input.satietyCostPerHour, 'satietyCostPerHour');

  const laborHours = input.laborSeconds / 3600;
  return {
    energy: Math.max(0, input.energy - input.energyCostPerHour * laborHours),
    satiety: Math.max(0, input.satiety - input.satietyCostPerHour * laborHours),
    health: input.health,
  };
}

export function applyEnergyRecovery(input: EnergyRecoveryInput): PhysiologicalState {
  assertNonNegativeFinite(input.energy, 'energy');
  assertNonNegativeFinite(input.satiety, 'satiety');
  assertNonNegativeFinite(input.health, 'health');
  assertNonNegativeFinite(input.durationSeconds, 'durationSeconds');
  assertNonNegativeFinite(input.energyRecoveryPerSecond, 'energyRecoveryPerSecond');
  assertPositiveFinite(input.maxEnergy, 'maxEnergy');

  return {
    energy: Math.min(
      input.maxEnergy,
      input.energy + input.durationSeconds * input.energyRecoveryPerSecond,
    ),
    satiety: input.satiety,
    health: input.health,
  };
}

export function applyHealthRecovery(input: HealthRecoveryInput): PhysiologicalState {
  assertNonNegativeFinite(input.energy, 'energy');
  assertNonNegativeFinite(input.satiety, 'satiety');
  assertNonNegativeFinite(input.health, 'health');
  assertNonNegativeFinite(input.durationSeconds, 'durationSeconds');
  assertNonNegativeFinite(input.healthRecoveryPerSecond, 'healthRecoveryPerSecond');
  assertPositiveFinite(input.maxHealth, 'maxHealth');

  return {
    energy: input.energy,
    satiety: input.satiety,
    health: Math.min(
      input.maxHealth,
      input.health + input.durationSeconds * input.healthRecoveryPerSecond,
    ),
  };
}

export function applySleepDeprivationHealthDecay(
  input: SleepDeprivationHealthDecayInput,
): PhysiologicalState {
  assertNonNegativeFinite(input.energy, 'energy');
  assertNonNegativeFinite(input.satiety, 'satiety');
  assertNonNegativeFinite(input.health, 'health');
  assertNonNegativeFinite(input.durationSeconds, 'durationSeconds');
  assertNonNegativeFinite(input.energyThreshold, 'energyThreshold');
  assertNonNegativeFinite(input.healthDecayPerSecond, 'healthDecayPerSecond');
  assertNonNegativeFinite(input.minHealth, 'minHealth');

  if (input.energy > input.energyThreshold || input.health <= input.minHealth) {
    return {
      energy: input.energy,
      satiety: input.satiety,
      health: input.health,
    };
  }

  return {
    energy: input.energy,
    satiety: input.satiety,
    health: Math.max(
      input.minHealth,
      input.health - input.durationSeconds * input.healthDecayPerSecond,
    ),
  };
}

export function calculateStochasticIllnessProbabilityPercent(
  input: StochasticIllnessProbabilityInput,
): number {
  assertNonNegativeFinite(
    input.illnessProbabilityPercentPerHour,
    'illnessProbabilityPercentPerHour',
  );
  assertNonNegativeFinite(input.durationSeconds, 'durationSeconds');

  return Math.min(100, input.illnessProbabilityPercentPerHour * (input.durationSeconds / 3600));
}

export function applyStochasticIllnessHealthDecay(
  input: StochasticIllnessHealthDecayInput,
): PhysiologicalState {
  assertNonNegativeFinite(input.energy, 'energy');
  assertNonNegativeFinite(input.satiety, 'satiety');
  assertNonNegativeFinite(input.health, 'health');
  assertNonNegativeFinite(input.healthDamage, 'healthDamage');
  assertNonNegativeFinite(input.minHealth, 'minHealth');

  if (!input.illnessOccurs || input.health <= input.minHealth) {
    return {
      energy: input.energy,
      satiety: input.satiety,
      health: input.health,
    };
  }

  return {
    energy: input.energy,
    satiety: input.satiety,
    health: Math.max(input.minHealth, input.health - input.healthDamage),
  };
}

export function applyStarvationHealthDecay(input: StarvationHealthDecayInput): PhysiologicalState {
  assertValidStarvationHealthDecayPolicy(input.policy);
  assertNonNegativeFinite(input.energy, 'energy');
  assertNonNegativeFinite(input.satiety, 'satiety');
  assertNonNegativeFinite(input.health, 'health');
  assertNonNegativeFinite(input.elapsedMs, 'elapsedMs');

  if (
    input.satiety >= input.policy.satietyThreshold ||
    input.health <= input.policy.minHealth ||
    input.elapsedMs === 0
  ) {
    return { energy: input.energy, satiety: input.satiety, health: input.health };
  }

  const deficitRatio =
    (input.policy.satietyThreshold - input.satiety) / input.policy.satietyThreshold;
  const elapsedHours = input.elapsedMs / 3_600_000;
  const healthDamage = input.policy.healthDecayPerHourAtZeroSatiety * deficitRatio * elapsedHours;
  return {
    energy: input.energy,
    satiety: input.satiety,
    health: Math.max(input.policy.minHealth, input.health - healthDamage),
  };
}

export function assertValidStarvationHealthDecayPolicy(policy: StarvationHealthDecayPolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('starvation policyVersion must not be empty');
  }
  assertPositiveInteger(policy.settlementCadenceMs, 'starvation settlementCadenceMs');
  assertPositiveInteger(policy.dayLengthMs, 'starvation dayLengthMs');
  assertPositiveFinite(policy.satietyThreshold, 'starvation satietyThreshold');
  assertNonNegativeFinite(
    policy.healthDecayPerHourAtZeroSatiety,
    'starvation healthDecayPerHourAtZeroSatiety',
  );
  assertNonNegativeFinite(policy.minHealth, 'starvation minHealth');
  assertNonNegativeFinite(policy.deathHealthThreshold, 'starvation deathHealthThreshold');
  if (policy.deathHealthThreshold < policy.minHealth) {
    throw new Error('starvation deathHealthThreshold must be at least minHealth');
  }
}

export function resolveResidentialPhysiologyCap(input: {
  readonly residentialTier: number;
  readonly policy: ResidentialPhysiologyCapPolicy;
}): ResidentialPhysiologyCapDecision {
  if (!Number.isInteger(input.residentialTier) || input.residentialTier <= 0) {
    return rejectResidentialPhysiologyCap(
      'policy-invalid',
      'residentialTier must be a positive integer',
    );
  }

  const cap = input.policy.caps.find(
    (candidate) => candidate.residentialTier === input.residentialTier,
  );
  if (cap === undefined) {
    return rejectResidentialPhysiologyCap(
      'cap-missing',
      `missing physiology cap for residential tier ${input.residentialTier}`,
    );
  }

  if (!Number.isInteger(cap.residentialTier) || cap.residentialTier <= 0) {
    return rejectResidentialPhysiologyCap(
      'policy-invalid',
      'residentialTier must be a positive integer',
    );
  }
  const invalidMax = findInvalidResidentialPhysiologyCapMax(cap);
  if (invalidMax !== undefined) {
    return rejectResidentialPhysiologyCap('policy-invalid', `${invalidMax} must be positive`);
  }

  return { status: 'accepted', cap };
}

export function isIncapacitated(input: {
  readonly energy: number;
  readonly health: number;
  readonly energyCriticalThreshold: number;
  readonly healthCriticalThreshold: number;
}): boolean {
  assertNonNegativeFinite(input.energy, 'energy');
  assertNonNegativeFinite(input.health, 'health');
  assertNonNegativeFinite(input.energyCriticalThreshold, 'energyCriticalThreshold');
  assertNonNegativeFinite(input.healthCriticalThreshold, 'healthCriticalThreshold');

  return (
    input.energy < input.energyCriticalThreshold || input.health < input.healthCriticalThreshold
  );
}

function rejectResidentialPhysiologyCap(
  reason: 'cap-missing' | 'policy-invalid',
  detail: string,
): ResidentialPhysiologyCapDecision {
  return { status: 'rejected', reason, detail };
}

function findInvalidResidentialPhysiologyCapMax(
  cap: ResidentialPhysiologyCap,
): 'maxEnergy' | 'maxSatiety' | 'maxHealth' | undefined {
  if (!Number.isFinite(cap.maxEnergy) || cap.maxEnergy <= 0) {
    return 'maxEnergy';
  }
  if (!Number.isFinite(cap.maxSatiety) || cap.maxSatiety <= 0) {
    return 'maxSatiety';
  }
  if (!Number.isFinite(cap.maxHealth) || cap.maxHealth <= 0) {
    return 'maxHealth';
  }
  return undefined;
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}
