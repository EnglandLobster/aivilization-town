import { describe, expect, test } from 'vitest';
import { evaluateSafetyNetSubsidy } from './index';

describe('welfare safety net', () => {
  test('caps subsidy payments while moving agents toward the minimum balance', () => {
    expect(
      evaluateSafetyNetSubsidy({
        balance: 10,
        minimumBalance: 50,
        maxSubsidy: 25,
      }),
    ).toEqual({
      status: 'eligible',
      amount: 25,
      previousBalance: 10,
      nextBalance: 35,
    });

    expect(
      evaluateSafetyNetSubsidy({
        balance: 40,
        minimumBalance: 50,
        maxSubsidy: 25,
      }),
    ).toEqual({
      status: 'eligible',
      amount: 10,
      previousBalance: 40,
      nextBalance: 50,
    });
  });

  test('does not pay agents at or above the minimum balance', () => {
    expect(
      evaluateSafetyNetSubsidy({
        balance: 50,
        minimumBalance: 50,
        maxSubsidy: 25,
      }),
    ).toEqual({
      status: 'ineligible',
      reason: 'balance-at-or-above-minimum',
    });
  });

  test('rejects invalid subsidy policy values', () => {
    expect(() =>
      evaluateSafetyNetSubsidy({
        balance: 10,
        minimumBalance: -1,
        maxSubsidy: 25,
      }),
    ).toThrow(/minimumBalance must be non-negative/);

    expect(() =>
      evaluateSafetyNetSubsidy({
        balance: 10,
        minimumBalance: 50,
        maxSubsidy: -1,
      }),
    ).toThrow(/maxSubsidy must be non-negative/);
  });
});
