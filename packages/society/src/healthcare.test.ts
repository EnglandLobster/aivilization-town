import { describe, expect, test } from 'vitest';
import { evaluateMedicalTreatmentCost } from './index';

describe('medical treatment cost', () => {
  test('charges duration-scaled treatment cost when balance is sufficient', () => {
    expect(
      evaluateMedicalTreatmentCost({
        balance: 100,
        durationSeconds: 1800,
        policy: { currencyCostPerSecond: 0.02 },
      }),
    ).toEqual({
      status: 'charged',
      amount: 36,
      previousBalance: 100,
      nextBalance: 64,
    });
  });

  test('skips charging when treatment policy has zero cost', () => {
    expect(
      evaluateMedicalTreatmentCost({
        balance: 100,
        durationSeconds: 1800,
        policy: { currencyCostPerSecond: 0 },
      }),
    ).toEqual({
      status: 'uncharged',
      reason: 'zero-cost',
    });
  });

  test('rejects treatment when balance cannot cover the service cost', () => {
    expect(
      evaluateMedicalTreatmentCost({
        balance: 10,
        durationSeconds: 1800,
        policy: { currencyCostPerSecond: 0.02 },
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'insufficient-balance',
      detail: 'balance requires 36, available 10',
    });
  });

  test('rejects invalid treatment cost policies', () => {
    expect(
      evaluateMedicalTreatmentCost({
        balance: 100,
        durationSeconds: 1800,
        policy: { currencyCostPerSecond: -1 },
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'policy-invalid',
      detail: 'currencyCostPerSecond must be non-negative',
    });
  });
});
