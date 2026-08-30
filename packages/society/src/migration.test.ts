import { describe, expect, it } from 'vitest';
import {
  assertValidInMigrationPolicy,
  assertValidOutMigrationPolicy,
  evaluateInMigrationDemand,
  evaluateOutMigrationDecision,
  evaluateOutMigrationProbabilityPercent,
  type InMigrationPolicy,
  type OutMigrationPolicy,
} from './migration';

const policy: OutMigrationPolicy = {
  policyVersion: 'town-migration-v1',
  maxProbabilityPerHour: 10,
  fallbackWellbeing: 50,
  settlementCadenceMs: 86_400_000,
};

const inMigrationPolicy: InMigrationPolicy = {
  settlementCadenceMs: 86_400_000,
  maximumArrivalsPerCadence: 4,
  minimumAttractiveWellbeing: 20,
  housingDemandWeight: 0.75,
  jobDemandWeight: 0.25,
};

describe('evaluateInMigrationDemand', () => {
  it('combines housing, jobs and wellbeing into a bounded arrival decision', () => {
    const decision = evaluateInMigrationDemand({
      population: 50,
      residentialCapacity: 100,
      openJobSlots: 25,
      averageWellbeing: 60,
      roll: 0.9,
      policy: inMigrationPolicy,
    });

    expect(decision).toMatchObject({
      arrivalCount: 1,
      housingVacancies: 50,
      housingPressure: 0.5,
      laborPressure: 0.5,
      wellbeingAttractiveness: 0.5,
      demandScore: 0.25,
      fractionalArrivalProbability: 0,
    });
  });

  it('uses the supplied roll for a fractional arrival and keeps housing as a hard cap', () => {
    const fractional = {
      population: 75,
      residentialCapacity: 100,
      openJobSlots: 0,
      averageWellbeing: 60,
      policy: inMigrationPolicy,
    } as const;
    expect(evaluateInMigrationDemand({ ...fractional, roll: 0 }).arrivalCount).toBe(1);
    expect(evaluateInMigrationDemand({ ...fractional, roll: 0.99 }).arrivalCount).toBe(0);

    const full = evaluateInMigrationDemand({
      ...fractional,
      population: 100,
      openJobSlots: 100,
      averageWellbeing: 100,
      roll: 0,
    });
    expect(full.arrivalCount).toBe(0);
    expect(full.housingVacancies).toBe(0);
  });

  it('rejects invalid policy weights and decision inputs', () => {
    expect(() =>
      assertValidInMigrationPolicy({ ...inMigrationPolicy, housingDemandWeight: 0.5 }),
    ).toThrow('sum to 1');
    expect(() =>
      evaluateInMigrationDemand({
        population: -1,
        residentialCapacity: 100,
        openJobSlots: 0,
        averageWellbeing: 50,
        roll: 0,
        policy: inMigrationPolicy,
      }),
    ).toThrow('non-negative integer');
  });
});

describe('evaluateOutMigrationProbabilityPercent', () => {
  it('follows the CS2 NotHappy shape: zero at the neutral point, steep at zero', () => {
    const at = (wellbeing: number) =>
      evaluateOutMigrationProbabilityPercent({ wellbeing, elapsedMs: 3_600_000, policy });
    // Content citizens never leave: the polynomial crosses zero near 48.
    expect(at(50)).toBe(0);
    expect(at(100)).toBe(0);
    // Desperate ones: uncapped shape ≈ 14%/h at wellbeing 0 (capped at 10).
    expect(at(0)).toBe(10);
    // Uncapped cap check via a higher policy cap.
    const uncapped = { ...policy, maxProbabilityPerHour: 100 };
    expect(
      evaluateOutMigrationProbabilityPercent({
        wellbeing: 0,
        elapsedMs: 3_600_000,
        policy: uncapped,
      }),
    ).toBeCloseTo(14.0, 1);
    // Monotone gradient between the extremes.
    expect(at(10)).toBeGreaterThan(at(30));
    expect(at(30)).toBeGreaterThan(0);
  });

  it('is linear in elapsed time and capped at 100 percent', () => {
    const one = evaluateOutMigrationProbabilityPercent({
      wellbeing: 0,
      elapsedMs: 3_600_000,
      policy,
    });
    const three = evaluateOutMigrationProbabilityPercent({
      wellbeing: 0,
      elapsedMs: 10_800_000,
      policy,
    });
    expect(three).toBeCloseTo(one * 3, 10);
    expect(
      evaluateOutMigrationProbabilityPercent({
        wellbeing: 0,
        elapsedMs: 1000 * 3_600_000,
        policy,
      }),
    ).toBe(100);
  });

  it('rejects invalid inputs', () => {
    expect(() =>
      evaluateOutMigrationProbabilityPercent({
        wellbeing: Number.NaN,
        elapsedMs: 1,
        policy,
      }),
    ).toThrow('finite wellbeing');
    expect(() =>
      evaluateOutMigrationProbabilityPercent({ wellbeing: 0, elapsedMs: -1, policy }),
    ).toThrow();
  });
});

describe('evaluateOutMigrationDecision', () => {
  it('departs when the roll falls under the probability', () => {
    // wellbeing 0, 1h: probability is the 10% cap.
    expect(
      evaluateOutMigrationDecision({ wellbeing: 0, elapsedMs: 3_600_000, roll: 0.099, policy }),
    ).toBe(true);
    expect(
      evaluateOutMigrationDecision({ wellbeing: 0, elapsedMs: 3_600_000, roll: 0.101, policy }),
    ).toBe(false);
    expect(
      evaluateOutMigrationDecision({ wellbeing: 50, elapsedMs: 3_600_000, roll: 0, policy }),
    ).toBe(false);
  });

  it('rejects rolls outside [0, 1)', () => {
    expect(() =>
      evaluateOutMigrationDecision({ wellbeing: 0, elapsedMs: 1, roll: 1, policy }),
    ).toThrow('[0, 1)');
  });
});

describe('assertValidOutMigrationPolicy', () => {
  it('accepts the canonical policy and rejects invalid fields', () => {
    expect(() => assertValidOutMigrationPolicy(policy)).not.toThrow();
    expect(() => assertValidOutMigrationPolicy({ ...policy, policyVersion: ' ' })).toThrow(
      'policyVersion must not be empty',
    );
    expect(() => assertValidOutMigrationPolicy({ ...policy, maxProbabilityPerHour: 0 })).toThrow(
      '(0, 100]',
    );
    expect(() => assertValidOutMigrationPolicy({ ...policy, fallbackWellbeing: 101 })).toThrow(
      '[0, 100]',
    );
    expect(() => assertValidOutMigrationPolicy({ ...policy, settlementCadenceMs: 0 })).toThrow(
      'positive finite',
    );
  });
});
