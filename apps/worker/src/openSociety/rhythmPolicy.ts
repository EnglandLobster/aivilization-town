import { assertResidentRhythmPolicy, type ResidentRhythmPolicy } from '@aivilization/society';
import type { WorldCommandPolicies } from '@aivilization/world';
/** Explicit experiment adapter; canonical defaults and historical manifests keep their own rates. */
export function applyResidentRhythm(
  base: WorldCommandPolicies,
  rhythm?: ResidentRhythmPolicy,
): WorldCommandPolicies {
  if (!rhythm) return base;
  assertResidentRhythmPolicy(rhythm);
  return {
    ...base,
    laborPay: { version: 'labor-proportional-pay-v1', referenceSeconds: rhythm.wagePeriodSeconds },
    laborCost: {
      energyCostPerHour: rhythm.laborEnergyPerHour,
      satietyCostPerHour: rhythm.laborSatietyPerHour,
    },
    maxSatiety: rhythm.physiologyMaximum,
    residentialPhysiologyCaps: {
      caps: (base.residentialPhysiologyCaps?.caps ?? []).map((c) => ({
        ...c,
        maxEnergy: rhythm.physiologyMaximum,
        maxSatiety: rhythm.physiologyMaximum,
        maxHealth: rhythm.physiologyMaximum,
      })),
    },
    sleep: {
      energyRecoveryPerSecond: rhythm.sleepRecoveryPerSecond,
      maxEnergy: rhythm.physiologyMaximum,
    },
    seeDoctor: {
      healthRecoveryPerSecond: rhythm.healthRecoveryPerSecond,
      maxHealth: rhythm.physiologyMaximum,
      treatmentCost: { currencyCostPerSecond: rhythm.treatmentCurrencyPerSecond },
    },
    sleepDeprivation: {
      energyThreshold: 20,
      healthDecayPerSecond: rhythm.sleepDeprivationHealthPerSecond,
      minHealth: 10,
    },
    calendar: {
      policyVersion: rhythm.version,
      dayLengthMs: rhythm.dayLengthMs,
      phases: [
        { phase: 'night', startFraction: 0 },
        { phase: 'morning', startFraction: 0.25 },
        { phase: 'afternoon', startFraction: 0.5 },
        { phase: 'evening', startFraction: 0.75 },
      ],
      physiologicalDecay: {
        energyPerHour: rhythm.passiveEnergyPerHour,
        satietyPerHour: rhythm.passiveSatietyPerHour,
      },
    },
  };
}
