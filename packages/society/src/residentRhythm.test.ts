import { expect, test } from 'vitest';
import { RESIDENT_RHYTHM_POLICY, assertResidentRhythmPolicy } from './residentRhythm';
import { calculateLaborPay } from './wage';
import { applyEnergyRecovery, applyLaborPhysiologyCost } from './physiology';
test('natural-day calibration makes recovery take hours and proportional gross pay independent of work splitting', () => {
  const p = RESIDENT_RHYTHM_POLICY;
  assertResidentRhythmPolicy(p);
  const afterWork = applyLaborPhysiologyCost({
    energy: 100,
    satiety: 100,
    health: 100,
    laborSeconds: 28800,
    energyCostPerHour: p.laborEnergyPerHour,
    satietyCostPerHour: p.laborSatietyPerHour,
  });
  expect(afterWork.energy).toBe(60);
  expect(
    applyEnergyRecovery({
      ...afterWork,
      durationSeconds: 10,
      energyRecoveryPerSecond: p.sleepRecoveryPerSecond,
      maxEnergy: 100,
    }).energy,
  ).toBeLessThan(61);
  expect(
    applyEnergyRecovery({
      ...afterWork,
      durationSeconds: 28800,
      energyRecoveryPerSecond: p.sleepRecoveryPerSecond,
      maxEnergy: 100,
    }).energy,
  ).toBe(100);
  const policy = { version: 'labor-proportional-pay-v1' as const, referenceSeconds: 28800 };
  expect(calculateLaborPay(250, 28800, policy)).toBe(250);
  expect(calculateLaborPay(250, 3600, policy) * 8).toBe(250);
  expect(calculateLaborPay(250, 1, policy)).toBeLessThan(0.01);
  expect(() => calculateLaborPay(250, 1, { ...policy, referenceSeconds: 0 })).toThrow();
  expect(() => assertResidentRhythmPolicy({ ...p, sleepRecoveryPerSecond: NaN })).toThrow();
});
