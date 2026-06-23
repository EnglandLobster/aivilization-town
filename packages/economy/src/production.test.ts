import { createSeededRandom } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { planProduction, type ProductionAgentState } from './index';

const chipReadyAgent: ProductionAgentState = {
  residentialTier: 5,
  energy: 100,
  satiety: 25,
  availableLaborSeconds: 5,
  inventory: {
    Transistor: 1,
    'Circuit Board': 1,
  },
};

describe('planProduction', () => {
  test('accepts chip production with exact non-substitutable inputs and physiological costs', () => {
    const plan = planProduction({
      commodityName: 'Chip',
      quantity: 1,
      agent: chipReadyAgent,
    });

    expect(plan).toMatchObject({
      status: 'accepted',
      produced: { Chip: 1 },
      consumedInputs: { Transistor: 1, 'Circuit Board': 1 },
      energyCost: 100,
      satietyCost: 25,
      laborSeconds: 5,
    });
  });

  test('rejects production when any required material input is missing', () => {
    const plan = planProduction({
      commodityName: 'Chip',
      quantity: 1,
      agent: {
        ...chipReadyAgent,
        inventory: { Transistor: 1 },
      },
    });

    expect(plan).toMatchObject({
      status: 'rejected',
      reason: 'insufficient-input',
    });
    if (plan.status !== 'rejected') {
      throw new Error('expected production to be rejected');
    }
    expect(plan.detail).toContain('Circuit Board');
  });

  test('rejects production below the commodity residential tier gate', () => {
    const plan = planProduction({
      commodityName: 'Chip',
      quantity: 1,
      agent: {
        ...chipReadyAgent,
        residentialTier: 4,
      },
    });

    expect(plan).toMatchObject({
      status: 'rejected',
      reason: 'residential-tier-too-low',
    });
  });

  test.each([
    ['energy', { energy: 99 }, 'insufficient-energy'],
    ['satiety', { satiety: 24 }, 'insufficient-satiety'],
    ['labor', { availableLaborSeconds: 4.9 }, 'insufficient-labor'],
  ] as const)('rejects chip production with insufficient %s', (_label, patch, reason) => {
    const plan = planProduction({
      commodityName: 'Chip',
      quantity: 1,
      agent: {
        ...chipReadyAgent,
        ...patch,
      },
    });

    expect(plan).toMatchObject({
      status: 'rejected',
      reason,
    });
  });

  test('uses deterministic reward rolls for special production rewards', () => {
    const plan = planProduction({
      commodityName: 'Chip',
      quantity: 1,
      agent: chipReadyAgent,
      rng: createSeededRandom('chip:reward'),
      recipeOverrides: [{ output: 'Chip', rewardProbabilityPercent: 100 }],
    });

    expect(plan).toMatchObject({
      status: 'accepted',
      produced: { Chip: 1, 'Gold Apple': 1 },
    });
  });
});
