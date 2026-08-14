import { describe, expect, test } from 'vitest';
import { evaluateLifestyleTier, type LifestylePolicy } from './index';

const policy: LifestylePolicy = {
  policyVersion: 'lifestyle-test',
  netWorthBoundaries: [500, 2000, 10000],
  strugglingNonSurvivalSpendCapRatio: 0.3,
  source: 'test',
};

describe('lifestyle tier evaluation', () => {
  test('maps net worth onto the four tiers around each boundary', () => {
    expect(evaluateLifestyleTier({ netWorth: 0, policy })).toBe('struggling');
    expect(evaluateLifestyleTier({ netWorth: 499.99, policy })).toBe('struggling');
    expect(evaluateLifestyleTier({ netWorth: 500, policy })).toBe('stable');
    expect(evaluateLifestyleTier({ netWorth: 1999, policy })).toBe('stable');
    expect(evaluateLifestyleTier({ netWorth: 2000, policy })).toBe('comfortable');
    expect(evaluateLifestyleTier({ netWorth: 9999, policy })).toBe('comfortable');
    expect(evaluateLifestyleTier({ netWorth: 10000, policy })).toBe('affluent');
    expect(evaluateLifestyleTier({ netWorth: 1_000_000, policy })).toBe('affluent');
  });

  test('rejects a non-finite net worth', () => {
    expect(() => evaluateLifestyleTier({ netWorth: Number.NaN, policy })).toThrow(
      /netWorth must be finite/,
    );
    expect(() => evaluateLifestyleTier({ netWorth: Number.POSITIVE_INFINITY, policy })).toThrow(
      /netWorth must be finite/,
    );
  });

  test('rejects boundaries that are not strictly increasing', () => {
    expect(() =>
      evaluateLifestyleTier({
        netWorth: 100,
        policy: { ...policy, netWorthBoundaries: [500, 500, 10000] },
      }),
    ).toThrow(/netWorthBoundaries must be strictly increasing/);
    expect(() =>
      evaluateLifestyleTier({
        netWorth: 100,
        policy: { ...policy, netWorthBoundaries: [2000, 500, 10000] },
      }),
    ).toThrow(/netWorthBoundaries must be strictly increasing/);
    expect(() =>
      evaluateLifestyleTier({
        netWorth: 100,
        policy: { ...policy, netWorthBoundaries: [500, Number.NaN, 10000] },
      }),
    ).toThrow(/netWorthBoundaries must be finite/);
  });

  test('rejects a boundary list of the wrong length', () => {
    expect(() =>
      evaluateLifestyleTier({
        netWorth: 100,
        policy: {
          ...policy,
          netWorthBoundaries: [500, 2000] as unknown as [number, number, number],
        },
      }),
    ).toThrow(/netWorthBoundaries must contain exactly 3 boundaries/);
  });

  test('rejects a spend cap ratio outside 0..1 and an empty policy version', () => {
    expect(() =>
      evaluateLifestyleTier({
        netWorth: 100,
        policy: { ...policy, strugglingNonSurvivalSpendCapRatio: -0.1 },
      }),
    ).toThrow(/strugglingNonSurvivalSpendCapRatio must be between 0 and 1/);
    expect(() =>
      evaluateLifestyleTier({
        netWorth: 100,
        policy: { ...policy, strugglingNonSurvivalSpendCapRatio: 1.1 },
      }),
    ).toThrow(/strugglingNonSurvivalSpendCapRatio must be between 0 and 1/);
    expect(() =>
      evaluateLifestyleTier({ netWorth: 100, policy: { ...policy, policyVersion: ' ' } }),
    ).toThrow(/policyVersion must not be empty/);
  });
});
