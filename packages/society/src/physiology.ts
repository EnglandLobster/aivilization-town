export type PhysiologicalState = {
  readonly energy: number;
  readonly satiety: number;
  readonly health: number;
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

export type SleepDeprivationHealthDecayInput = PhysiologicalState &
  SleepDeprivationHealthDecayPolicy & {
    readonly durationSeconds: number;
  };

export type StochasticIllnessPolicy = {
  readonly illnessProbabilityPercentPerHour: number;
  readonly healthDamage: number;
  readonly minHealth: number;
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
