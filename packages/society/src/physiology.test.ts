import { describe, expect, test } from 'vitest';
import { applyLaborPhysiologyCost, isIncapacitated } from './index';

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
});
