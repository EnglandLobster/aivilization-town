import { describe, expect, test } from 'vitest';
import { evaluateResidentialTierUpgrade, type ResidentialTierUpgradePolicy } from './index';

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
