import { describe, expect, test } from 'vitest';
import {
  applyEnergyRecovery,
  applyHealthRecovery,
  applyLaborPhysiologyCost,
  applySleepDeprivationHealthDecay,
  isIncapacitated,
} from './index';

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
});
