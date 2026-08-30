import { describe, expect, test } from 'vitest';
import {
  applyEnergyRecovery,
  applyHealthRecovery,
  applyLaborPhysiologyCost,
  applyPassivePhysiologicalDecay,
  applySleepDeprivationHealthDecay,
  applyStarvationHealthDecay,
  applyStochasticIllnessHealthDecay,
  assertValidStochasticIllnessPolicy,
  assertValidStarvationHealthDecayPolicy,
  calculateStochasticIllnessProbabilityPercent,
  isIncapacitated,
  resolveResidentialPhysiologyCap,
  type ResidentialPhysiologyCapPolicy,
  type StarvationHealthDecayPolicy,
} from './index';

const residentialPhysiologyCapPolicy: ResidentialPhysiologyCapPolicy = {
  caps: [
    { residentialTier: 1, maxEnergy: 80, maxSatiety: 70, maxHealth: 90 },
    { residentialTier: 2, maxEnergy: 120, maxSatiety: 90, maxHealth: 110 },
  ],
};

const starvationPolicy: StarvationHealthDecayPolicy = {
  policyVersion: 'starvation-health-decay-v1',
  settlementCadenceMs: 3_600_000,
  dayLengthMs: 86_400_000,
  satietyThreshold: 20,
  healthDecayPerHourAtZeroSatiety: 4,
  minHealth: 0,
  deathHealthThreshold: 0,
};

describe('physiology', () => {
  test('applies per-hour labor costs to energy and satiety', () => {
    expect(
      applyLaborPhysiologyCost({
        energy: 100,
        satiety: 80,
        health: 90,
        laborSeconds: 5400,
        energyCostPerHour: 12,
        satietyCostPerHour: 8,
      }),
    ).toEqual({
      energy: 82,
      satiety: 68,
      health: 90,
    });
  });

  test('does not reduce physiology below zero', () => {
    expect(
      applyLaborPhysiologyCost({
        energy: 5,
        satiety: 3,
        health: 90,
        laborSeconds: 3600,
        energyCostPerHour: 12,
        satietyCostPerHour: 8,
      }),
    ).toEqual({
      energy: 0,
      satiety: 0,
      health: 90,
    });
  });

  test('marks agents incapacitated below energy or health thresholds', () => {
    expect(
      isIncapacitated({
        energy: 19,
        health: 90,
        energyCriticalThreshold: 20,
        healthCriticalThreshold: 30,
      }),
    ).toBe(true);
    expect(
      isIncapacitated({
        energy: 40,
        health: 29,
        energyCriticalThreshold: 20,
        healthCriticalThreshold: 30,
      }),
    ).toBe(true);
    expect(
      isIncapacitated({
        energy: 40,
        health: 90,
        energyCriticalThreshold: 20,
        healthCriticalThreshold: 30,
      }),
    ).toBe(false);
  });

  test('recovers energy over time without exceeding the configured maximum', () => {
    expect(
      applyEnergyRecovery({
        energy: 40,
        satiety: 70,
        health: 90,
        durationSeconds: 1800,
        energyRecoveryPerSecond: 0.05,
        maxEnergy: 100,
      }),
    ).toEqual({
      energy: 100,
      satiety: 70,
      health: 90,
    });
  });

  test('rejects invalid energy recovery policies', () => {
    expect(() =>
      applyEnergyRecovery({
        energy: 40,
        satiety: 70,
        health: 90,
        durationSeconds: 10,
        energyRecoveryPerSecond: -1,
        maxEnergy: 100,
      }),
    ).toThrow(/energyRecoveryPerSecond must be non-negative/);

    expect(() =>
      applyEnergyRecovery({
        energy: 40,
        satiety: 70,
        health: 90,
        durationSeconds: 10,
        energyRecoveryPerSecond: 1,
        maxEnergy: 0,
      }),
    ).toThrow(/maxEnergy must be positive/);
  });

  test('recovers health over time without exceeding the configured maximum', () => {
    expect(
      applyHealthRecovery({
        energy: 40,
        satiety: 70,
        health: 30,
        durationSeconds: 1800,
        healthRecoveryPerSecond: 0.05,
        maxHealth: 100,
      }),
    ).toEqual({
      energy: 40,
      satiety: 70,
      health: 100,
    });
  });

  test('decays health during low-energy sleep deprivation without crossing the floor', () => {
    expect(
      applySleepDeprivationHealthDecay({
        energy: 10,
        satiety: 70,
        health: 90,
        durationSeconds: 60,
        energyThreshold: 20,
        healthDecayPerSecond: 0.5,
        minHealth: 10,
      }),
    ).toEqual({
      energy: 10,
      satiety: 70,
      health: 60,
    });

    expect(
      applySleepDeprivationHealthDecay({
        energy: 30,
        satiety: 70,
        health: 90,
        durationSeconds: 60,
        energyThreshold: 20,
        healthDecayPerSecond: 0.5,
        minHealth: 10,
      }),
    ).toEqual({
      energy: 30,
      satiety: 70,
      health: 90,
    });

    expect(
      applySleepDeprivationHealthDecay({
        energy: 0,
        satiety: 70,
        health: 15,
        durationSeconds: 60,
        energyThreshold: 20,
        healthDecayPerSecond: 0.5,
        minHealth: 10,
      }),
    ).toEqual({
      energy: 0,
      satiety: 70,
      health: 10,
    });
  });

  test('scales stochastic illness probability by elapsed time with a 100 percent cap', () => {
    expect(
      calculateStochasticIllnessProbabilityPercent({
        illnessProbabilityPercentPerHour: 30,
        durationSeconds: 1800,
      }),
    ).toBe(15);

    expect(
      calculateStochasticIllnessProbabilityPercent({
        illnessProbabilityPercentPerHour: 80,
        durationSeconds: 7200,
      }),
    ).toBe(100);
  });

  test('validates the versioned stochastic illness cadence and probability boundary', () => {
    expect(() =>
      assertValidStochasticIllnessPolicy({
        policyVersion: 'stochastic-illness-v2',
        settlementCadenceMs: 3_600_000,
        illnessProbabilityPercentPerHour: 100,
        healthDamage: 5,
        minHealth: 0,
      }),
    ).not.toThrow();
    expect(() =>
      assertValidStochasticIllnessPolicy({
        illnessProbabilityPercentPerHour: 1,
        healthDamage: 5,
        minHealth: 0,
      }),
    ).not.toThrow();
    expect(() =>
      assertValidStochasticIllnessPolicy({
        policyVersion: 'stochastic-illness-v2',
        settlementCadenceMs: 0,
        illnessProbabilityPercentPerHour: 1,
        healthDamage: 5,
        minHealth: 0,
      }),
    ).toThrow('settlementCadenceMs');
    expect(() =>
      assertValidStochasticIllnessPolicy({
        policyVersion: 'stochastic-illness-v2',
        settlementCadenceMs: 3_600_000,
        illnessProbabilityPercentPerHour: 101,
        healthDamage: 5,
        minHealth: 0,
      }),
    ).toThrow('must not exceed 100');
  });

  test('decays health when stochastic illness occurs without crossing the floor', () => {
    expect(
      applyStochasticIllnessHealthDecay({
        energy: 80,
        satiety: 70,
        health: 90,
        illnessOccurs: true,
        healthDamage: 12,
        minHealth: 10,
      }),
    ).toEqual({
      energy: 80,
      satiety: 70,
      health: 78,
    });

    expect(
      applyStochasticIllnessHealthDecay({
        energy: 80,
        satiety: 70,
        health: 90,
        illnessOccurs: false,
        healthDamage: 12,
        minHealth: 10,
      }),
    ).toEqual({
      energy: 80,
      satiety: 70,
      health: 90,
    });

    expect(
      applyStochasticIllnessHealthDecay({
        energy: 80,
        satiety: 70,
        health: 15,
        illnessOccurs: true,
        healthDamage: 12,
        minHealth: 10,
      }),
    ).toEqual({
      energy: 80,
      satiety: 70,
      health: 10,
    });
  });

  test('scales starvation damage by satiety deficit and elapsed time', () => {
    expect(
      applyStarvationHealthDecay({
        energy: 40,
        satiety: 10,
        health: 90,
        elapsedMs: 1_800_000,
        policy: starvationPolicy,
      }),
    ).toEqual({ energy: 40, satiety: 10, health: 89 });
    expect(
      applyStarvationHealthDecay({
        energy: 40,
        satiety: 0,
        health: 3,
        elapsedMs: 3_600_000,
        policy: starvationPolicy,
      }),
    ).toEqual({ energy: 40, satiety: 0, health: 0 });
  });

  test('does not damage health at or above the starvation threshold', () => {
    expect(
      applyStarvationHealthDecay({
        energy: 40,
        satiety: 20,
        health: 90,
        elapsedMs: 86_400_000,
        policy: starvationPolicy,
      }),
    ).toEqual({ energy: 40, satiety: 20, health: 90 });
  });

  test('is additive while satiety remains fixed and validates policy boundaries', () => {
    const previous = { energy: 40, satiety: 5, health: 90 };
    const merged = applyStarvationHealthDecay({
      ...previous,
      elapsedMs: 7_200_000,
      policy: starvationPolicy,
    });
    const first = applyStarvationHealthDecay({
      ...previous,
      elapsedMs: 3_600_000,
      policy: starvationPolicy,
    });
    const stepped = applyStarvationHealthDecay({
      ...first,
      elapsedMs: 3_600_000,
      policy: starvationPolicy,
    });
    expect(stepped).toEqual(merged);
    expect(() =>
      assertValidStarvationHealthDecayPolicy({
        ...starvationPolicy,
        deathHealthThreshold: -1,
      }),
    ).toThrow('starvation deathHealthThreshold must be non-negative');
    expect(() =>
      assertValidStarvationHealthDecayPolicy({
        ...starvationPolicy,
        minHealth: 2,
        deathHealthThreshold: 1,
      }),
    ).toThrow('starvation deathHealthThreshold must be at least minHealth');
  });

  test('rejects invalid health recovery policies', () => {
    expect(() =>
      applyHealthRecovery({
        energy: 40,
        satiety: 70,
        health: 30,
        durationSeconds: 10,
        healthRecoveryPerSecond: -1,
        maxHealth: 100,
      }),
    ).toThrow(/healthRecoveryPerSecond must be non-negative/);

    expect(() =>
      applyHealthRecovery({
        energy: 40,
        satiety: 70,
        health: 30,
        durationSeconds: 10,
        healthRecoveryPerSecond: 1,
        maxHealth: 0,
      }),
    ).toThrow(/maxHealth must be positive/);
  });

  test('resolves residential-tier physiology caps', () => {
    expect(
      resolveResidentialPhysiologyCap({
        residentialTier: 2,
        policy: residentialPhysiologyCapPolicy,
      }),
    ).toEqual({
      status: 'accepted',
      cap: { residentialTier: 2, maxEnergy: 120, maxSatiety: 90, maxHealth: 110 },
    });
  });

  test('rejects missing residential-tier physiology caps', () => {
    expect(
      resolveResidentialPhysiologyCap({
        residentialTier: 3,
        policy: residentialPhysiologyCapPolicy,
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'cap-missing',
      detail: 'missing physiology cap for residential tier 3',
    });
  });

  test('rejects invalid residential-tier physiology cap policies', () => {
    expect(
      resolveResidentialPhysiologyCap({
        residentialTier: 1,
        policy: { caps: [{ residentialTier: 1, maxEnergy: -1, maxSatiety: 70, maxHealth: 90 }] },
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'policy-invalid',
      detail: 'maxEnergy must be positive',
    });
  });
});

describe('passive physiological decay', () => {
  const decay = { energyPerHour: 6.25, satietyPerHour: 12.5 } as const;

  test('decays energy and satiety linearly without touching health', () => {
    expect(
      applyPassivePhysiologicalDecay({
        previous: { energy: 100, satiety: 80, health: 90 },
        elapsedMs: 3_600_000,
        decay,
      }),
    ).toEqual({ energy: 93.75, satiety: 67.5, health: 90 });
  });

  test('is a no-op for zero elapsed time', () => {
    expect(
      applyPassivePhysiologicalDecay({
        previous: { energy: 40, satiety: 30, health: 20 },
        elapsedMs: 0,
        decay,
      }),
    ).toEqual({ energy: 40, satiety: 30, health: 20 });
  });

  test('floors at zero instead of going negative', () => {
    expect(
      applyPassivePhysiologicalDecay({
        previous: { energy: 5, satiety: 5, health: 90 },
        elapsedMs: 3_600_000,
        decay,
      }),
    ).toEqual({ energy: 0, satiety: 0, health: 90 });
  });

  test('is strictly additive across interval splits, including across the zero floor', () => {
    const previous = { energy: 10, satiety: 3, health: 90 };
    const merged = applyPassivePhysiologicalDecay({
      previous,
      elapsedMs: 7_200_000,
      decay,
    });
    const stepped = applyPassivePhysiologicalDecay({
      previous: applyPassivePhysiologicalDecay({ previous, elapsedMs: 3_600_000, decay }),
      elapsedMs: 3_600_000,
      decay,
    });
    expect(stepped).toEqual(merged);
  });

  test('rejects non-finite or negative inputs', () => {
    expect(() =>
      applyPassivePhysiologicalDecay({
        previous: { energy: Number.NaN, satiety: 0, health: 0 },
        elapsedMs: 1,
        decay,
      }),
    ).toThrow('energy must be non-negative');
    expect(() =>
      applyPassivePhysiologicalDecay({
        previous: { energy: 0, satiety: 0, health: 0 },
        elapsedMs: -1,
        decay,
      }),
    ).toThrow('elapsedMs must be non-negative');
    expect(() =>
      applyPassivePhysiologicalDecay({
        previous: { energy: 0, satiety: 0, health: 0 },
        elapsedMs: 1,
        decay: { energyPerHour: -1, satietyPerHour: 0 },
      }),
    ).toThrow('decay.energyPerHour must be non-negative');
  });
});
