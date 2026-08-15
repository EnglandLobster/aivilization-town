import { describe, expect, it } from 'vitest';
import {
  assertValidOutMigrationPolicy,
  evaluateOutMigrationDecision,
  evaluateOutMigrationProbabilityPercent,
  type OutMigrationPolicy,
} from './migration';

const policy: OutMigrationPolicy = {
  policyVersion: 'town-migration-v1',
  maxProbabilityPerHour: 10,
  fallbackWellbeing: 50,
  settlementCadenceMs: 86_400_000,
};

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
