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
