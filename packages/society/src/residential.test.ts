import { describe, expect, test } from 'vitest';
import {
  assertValidResidentialUpkeepPolicy,
  evaluateResidentialArrears,
  evaluateResidentialTierUpgrade,
  evaluateResidentialUpkeep,
  resolveResidentialUpkeepRate,
  type ResidentialTierUpgradePolicy,
  type ResidentialUpkeepPolicy,
} from './index';

const policy: ResidentialTierUpgradePolicy = {
  maxResidentialTier: 4,
  costs: [
    {
      targetResidentialTier: 2,
      currencyCost: 100,
      inventoryCosts: { Wood: 2 },
      minEducationScore: 20,
    },
    {
      targetResidentialTier: 3,
      currencyCost: 250,
      inventoryCosts: { Book: 1 },
      minEducationScore: 70,
    },
  ],
};

describe('residential tier upgrades', () => {
  test('accepts a sequential upgrade when balance, inventory, and education satisfy policy', () => {
    expect(
      evaluateResidentialTierUpgrade({
        agent: {
          residentialTier: 1,
          balance: 150,
          educationScore: 30,
          inventory: { Wood: 3 },
        },
        targetResidentialTier: 2,
        policy,
      }),
    ).toEqual({
      status: 'accepted',
      previousResidentialTier: 1,
      nextResidentialTier: 2,
      currencyCost: 100,
      consumedInventory: { Wood: 2 },
    });
  });

  test('rejects non-sequential upgrade targets', () => {
    expect(
      evaluateResidentialTierUpgrade({
        agent: {
          residentialTier: 1,
          balance: 1000,
          educationScore: 100,
          inventory: { Wood: 10, Book: 10 },
        },
        targetResidentialTier: 3,
        policy,
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'invalid-target',
      detail: 'targetResidentialTier must equal current residentialTier + 1',
    });
  });

  test('rejects upgrades when any cost dimension is insufficient', () => {
    expect(
      evaluateResidentialTierUpgrade({
        agent: {
          residentialTier: 1,
          balance: 99,
          educationScore: 30,
          inventory: { Wood: 3 },
        },
        targetResidentialTier: 2,
        policy,
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'insufficient-balance',
      detail: 'balance requires 100, available 99',
    });

    expect(
      evaluateResidentialTierUpgrade({
        agent: {
          residentialTier: 1,
          balance: 150,
          educationScore: 30,
          inventory: { Wood: 1 },
        },
        targetResidentialTier: 2,
        policy,
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'insufficient-inventory',
      detail: 'Wood requires 2, available 1',
    });

    expect(
      evaluateResidentialTierUpgrade({
        agent: {
          residentialTier: 1,
          balance: 150,
          educationScore: 19,
          inventory: { Wood: 3 },
        },
        targetResidentialTier: 2,
        policy,
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'insufficient-education',
      detail: 'educationScore requires 20, available 19',
    });
  });
});

const upkeepPolicy: ResidentialUpkeepPolicy = {
  costs: [
    { residentialTier: 2, currencyCostPerHour: 20 },
    { residentialTier: 3, currencyCostPerHour: 20 },
  ],
};

describe('residential upkeep', () => {
  test('charges elapsed upkeep for the current residential tier', () => {
    expect(
      evaluateResidentialUpkeep({
        residentialTier: 2,
        balance: 100,
        durationSeconds: 1800,
        policy: upkeepPolicy,
      }),
    ).toEqual({
      status: 'charged',
      residentialTier: 2,
      amount: 10,
      unpaidAmount: 0,
      previousBalance: 100,
      nextBalance: 90,
    });
  });

  test('caps upkeep at available balance and records unpaid amount', () => {
    expect(
      evaluateResidentialUpkeep({
        residentialTier: 3,
        balance: 5,
        durationSeconds: 1800,
        policy: upkeepPolicy,
      }),
    ).toEqual({
      status: 'charged',
      residentialTier: 3,
      amount: 5,
      unpaidAmount: 5,
      previousBalance: 5,
      nextBalance: 0,
    });
  });

  test('skips tiers without configured upkeep cost', () => {
    expect(
      evaluateResidentialUpkeep({
        residentialTier: 1,
        balance: 100,
        durationSeconds: 1800,
        policy: upkeepPolicy,
      }),
    ).toEqual({
      status: 'uncharged',
      reason: 'no-upkeep-cost',
    });
  });

  test('rejects invalid upkeep policy values', () => {
    expect(
      evaluateResidentialUpkeep({
        residentialTier: 2,
        balance: 100,
        durationSeconds: 1800,
        policy: { costs: [{ residentialTier: 2, currencyCostPerHour: -1 }] },
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'policy-invalid',
      detail: 'currencyCostPerHour must be non-negative',
    });
  });
});

describe('residential upkeep arrears', () => {
  const arrearsPolicy: ResidentialUpkeepPolicy = {
    costs: [
      { residentialTier: 1, currencyCostPerHour: 0 },
      { residentialTier: 2, currencyCostPerHour: 20 },
      { residentialTier: 3, currencyCostPerHour: 40 },
    ],
    arrearsDowngradeThresholdHours: 2,
  };

  test('carries arrears below the downgrade threshold', () => {
    expect(
      evaluateResidentialArrears({ residentialTier: 3, nextArrears: 79, policy: arrearsPolicy }),
    ).toEqual({ status: 'carry', reason: 'below-threshold' });
  });

  test('downgrades one tier and clears arrears at the threshold', () => {
    expect(
      evaluateResidentialArrears({ residentialTier: 3, nextArrears: 80, policy: arrearsPolicy }),
    ).toEqual({
      status: 'downgrade',
      previousResidentialTier: 3,
      nextResidentialTier: 2,
      arrearsCleared: 80,
    });
  });

  test('never downgrades below tier 1', () => {
    expect(
      evaluateResidentialArrears({ residentialTier: 2, nextArrears: 40, policy: arrearsPolicy }),
    ).toEqual({
      status: 'downgrade',
      previousResidentialTier: 2,
      nextResidentialTier: 1,
      arrearsCleared: 40,
    });
    expect(
      evaluateResidentialArrears({ residentialTier: 1, nextArrears: 1000, policy: arrearsPolicy }),
    ).toEqual({ status: 'carry', reason: 'zero-cost' });
  });

  test('carries arrears when the threshold is disabled', () => {
    expect(
      evaluateResidentialArrears({
        residentialTier: 3,
        nextArrears: 10_000,
        policy: { costs: arrearsPolicy.costs },
      }),
    ).toEqual({ status: 'carry', reason: 'threshold-disabled' });
  });

  test('rejects invalid inputs', () => {
    expect(() =>
      evaluateResidentialArrears({ residentialTier: 0, nextArrears: 0, policy: arrearsPolicy }),
    ).toThrow(/residentialTier/);
    expect(() =>
      evaluateResidentialArrears({ residentialTier: 2, nextArrears: -1, policy: arrearsPolicy }),
    ).toThrow(/nextArrears/);
  });
});

describe('residential upkeep land value pricing (v2)', () => {
  const v2Policy: ResidentialUpkeepPolicy = {
    policyVersion: 'residential-upkeep-v2',
    costs: [
      { residentialTier: 1, currencyCostPerHour: 0 },
      { residentialTier: 2, currencyCostPerHour: 10 },
      { residentialTier: 3, currencyCostPerHour: 20 },
    ],
    arrearsDowngradeThresholdHours: 2,
    landValueCoefficientPerHour: 0.5,
  };

  test('resolves the effective rate as tier cost plus the land value term', () => {
    expect(
      resolveResidentialUpkeepRate({ residentialTier: 2, policy: v2Policy, landValueIndex: 8 }),
    ).toBe(14);
    expect(resolveResidentialUpkeepRate({ residentialTier: 2, policy: v2Policy })).toBe(10);
    expect(resolveResidentialUpkeepRate({ residentialTier: 9, policy: v2Policy })).toBeUndefined();
  });

  test('charges upkeep including the land value term', () => {
    expect(
      evaluateResidentialUpkeep({
        residentialTier: 2,
        balance: 100,
        durationSeconds: 1800,
        policy: v2Policy,
        landValueIndex: 8,
      }),
    ).toEqual({
      status: 'charged',
      residentialTier: 2,
      amount: 7,
      unpaidAmount: 0,
      previousBalance: 100,
      nextBalance: 93,
    });
  });

  test('ignores the land value index when the policy has no coefficient', () => {
    const v1Policy: ResidentialUpkeepPolicy = {
      costs: [{ residentialTier: 2, currencyCostPerHour: 10 }],
    };
    expect(
      evaluateResidentialUpkeep({
        residentialTier: 2,
        balance: 100,
        durationSeconds: 1800,
        policy: v1Policy,
        landValueIndex: 50,
      }),
    ).toEqual({
      status: 'charged',
      residentialTier: 2,
      amount: 5,
      unpaidAmount: 0,
      previousBalance: 100,
      nextBalance: 95,
    });
  });

  test('matches v1 results exactly when no land value index is provided', () => {
    const v1Decision = evaluateResidentialUpkeep({
      residentialTier: 3,
      balance: 7,
      durationSeconds: 1800,
      policy: v2Policy,
    });
    expect(v1Decision).toEqual({
      status: 'charged',
      residentialTier: 3,
      amount: 7,
      unpaidAmount: 3,
      previousBalance: 7,
      nextBalance: 0,
    });
  });

  test('rejects a negative land value index', () => {
    expect(
      evaluateResidentialUpkeep({
        residentialTier: 2,
        balance: 100,
        durationSeconds: 1800,
        policy: v2Policy,
        landValueIndex: -1,
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'policy-invalid',
      detail: 'landValueIndex must be non-negative',
    });
  });

  test('uses the effective rate for the arrears downgrade threshold', () => {
    // tier 2: base 10/h + index 8 * 0.5 = 14/h; threshold = 14 * 2 = 28
    expect(
      evaluateResidentialArrears({
        residentialTier: 2,
        nextArrears: 27,
        policy: v2Policy,
        effectiveCostPerHour: 14,
      }),
    ).toEqual({ status: 'carry', reason: 'below-threshold' });
    expect(
      evaluateResidentialArrears({
        residentialTier: 2,
        nextArrears: 28,
        policy: v2Policy,
        effectiveCostPerHour: 14,
      }),
    ).toEqual({
      status: 'downgrade',
      previousResidentialTier: 2,
      nextResidentialTier: 1,
      arrearsCleared: 28,
    });
  });
});

describe('assertValidResidentialUpkeepPolicy', () => {
  test('accepts v1 and v2 policies', () => {
    expect(() => assertValidResidentialUpkeepPolicy({ costs: [] })).not.toThrow();
    expect(() =>
      assertValidResidentialUpkeepPolicy({
        policyVersion: 'residential-upkeep-v2',
        costs: [{ residentialTier: 2, currencyCostPerHour: 10 }],
        landValueCoefficientPerHour: 0.5,
      }),
    ).not.toThrow();
  });

  test('rejects malformed policies', () => {
    expect(() => assertValidResidentialUpkeepPolicy({ policyVersion: ' ', costs: [] })).toThrow(
      /policyVersion/,
    );
    expect(() =>
      assertValidResidentialUpkeepPolicy({
        costs: [{ residentialTier: 0, currencyCostPerHour: 10 }],
      }),
    ).toThrow(/residentialTier/);
    expect(() =>
      assertValidResidentialUpkeepPolicy({
        costs: [{ residentialTier: 2, currencyCostPerHour: Number.NaN }],
      }),
    ).toThrow(/currencyCostPerHour/);
    expect(() =>
      assertValidResidentialUpkeepPolicy({
        costs: [],
        arrearsDowngradeThresholdHours: -1,
      }),
    ).toThrow(/arrearsDowngradeThresholdHours/);
    expect(() =>
      assertValidResidentialUpkeepPolicy({
        costs: [],
        landValueCoefficientPerHour: -0.1,
      }),
    ).toThrow(/landValueCoefficientPerHour/);
  });
});
