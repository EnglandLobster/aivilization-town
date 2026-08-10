import { describe, expect, test } from 'vitest';
import {
  accumulateEducation,
  calculateEducationInvestmentRequirements,
  evaluateEducationInvestment,
} from './index';

describe('accumulateEducation', () => {
  test('applies H(t + dt) = H(t) + eta * dt', () => {
    expect(
      accumulateEducation({
        currentEducationScore: 70,
        educationRatePerSecond: 0.5,
        studyDurationSeconds: 120,
      }),
    ).toBe(130);
  });

  test('rejects negative study duration and education rate', () => {
    expect(() =>
      accumulateEducation({
        currentEducationScore: 0,
        educationRatePerSecond: 1,
        studyDurationSeconds: -1,
      }),
    ).toThrow('studyDurationSeconds must be non-negative');

    expect(() =>
      accumulateEducation({
        currentEducationScore: 0,
        educationRatePerSecond: -1,
        studyDurationSeconds: 1,
      }),
    ).toThrow('educationRatePerSecond must be non-negative');
  });
});

describe('evaluateEducationInvestment', () => {
  test('prorates currency and inventory costs by study duration', () => {
    expect(
      evaluateEducationInvestment({
        agent: {
          balance: 100,
          inventory: { Books: 3 },
        },
        studyDurationSeconds: 1800,
        policy: {
          currencyCostPerHour: 20,
          inventoryCostsPerHour: { Books: 2 },
        },
      }),
    ).toEqual({
      status: 'accepted',
      currencyCost: 10,
      previousBalance: 100,
      nextBalance: 90,
      consumedInventory: { Books: 1 },
    });
  });

  test('rejects investment when balance is insufficient', () => {
    expect(
      evaluateEducationInvestment({
        agent: { balance: 9, inventory: { Books: 3 } },
        studyDurationSeconds: 1800,
        policy: {
          currencyCostPerHour: 20,
          inventoryCostsPerHour: { Books: 2 },
        },
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'insufficient-balance',
      detail: 'balance requires 10, available 9',
    });
  });

  test('rejects investment when a required resource is insufficient', () => {
    expect(
      evaluateEducationInvestment({
        agent: { balance: 100, inventory: { Books: 0.5 } },
        studyDurationSeconds: 1800,
        policy: {
          currencyCostPerHour: 20,
          inventoryCostsPerHour: { Books: 2 },
        },
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'insufficient-inventory',
      detail: 'Books requires 1, available 0.5',
    });
  });

  test('rejects invalid policy values and empty resource names', () => {
    expect(
      evaluateEducationInvestment({
        agent: { balance: 100, inventory: {} },
        studyDurationSeconds: 3600,
        policy: { currencyCostPerHour: -1, inventoryCostsPerHour: {} },
      }),
    ).toMatchObject({ status: 'rejected', reason: 'policy-invalid' });

    expect(
      evaluateEducationInvestment({
        agent: { balance: 100, inventory: {} },
        studyDurationSeconds: 3600,
        policy: { currencyCostPerHour: 0, inventoryCostsPerHour: { '': 1 } },
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'policy-invalid',
      detail: 'inventory cost item name must not be empty',
    });
  });
});

describe('calculateEducationInvestmentRequirements', () => {
  test('exposes duration-prorated direct costs for planning without mutating agent state', () => {
    expect(
      calculateEducationInvestmentRequirements({
        studyDurationSeconds: 1800,
        policy: {
          currencyCostPerHour: 20,
          inventoryCostsPerHour: { Books: 2 },
        },
      }),
    ).toEqual({ currencyCost: 10, inventoryCosts: { Books: 1 } });
  });
});
