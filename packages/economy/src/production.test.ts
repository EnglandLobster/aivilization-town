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

const educationEfficiencyPolicy = {
  minEfficiency: 0.5,
  educationScoreForMaxEfficiency: 500,
};

const fullEfficiencyPolicy = {
  minEfficiency: 0.5,
  educationScoreForMaxEfficiency: 500,
  physiologyCaps: {
    caps: [{ residentialTier: 5, maxEnergy: 100, maxSatiety: 100, maxHealth: 100 }],
  },
  residentialTierForMaxEfficiency: 5,
};

const bookReadyAgent = {
  residentialTier: 5,
  educationScore: 500,
  energy: 50,
  satiety: 100,
  health: 100,
  availableLaborSeconds: 10,
  inventory: { Wood: 1 },
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

  test('keeps recipe costs unchanged when no production efficiency policy is present', () => {
    const plan = planProduction({
      commodityName: 'Chip',
      quantity: 1,
      agent: {
        ...chipReadyAgent,
        educationScore: 0,
      },
    });

    expect(plan).toMatchObject({
      status: 'accepted',
      energyCost: 100,
      satietyCost: 25,
      laborSeconds: 5,
    });
  });

  test('scales production costs by education-driven efficiency policy', () => {
    const plan = planProduction({
      commodityName: 'Chip',
      quantity: 1,
      agent: {
        ...chipReadyAgent,
        energy: 200,
        satiety: 50,
        availableLaborSeconds: 10,
        educationScore: 0,
      },
      productionEfficiency: educationEfficiencyPolicy,
    });

    expect(plan).toMatchObject({
      status: 'accepted',
      energyCost: 200,
      satietyCost: 50,
      laborSeconds: 10,
      productionEfficiency: 0.5,
    });
  });

  test('keeps base recipe costs once education reaches maximum efficiency', () => {
    const plan = planProduction({
      commodityName: 'Chip',
      quantity: 1,
      agent: {
        ...chipReadyAgent,
        educationScore: 500,
      },
      productionEfficiency: educationEfficiencyPolicy,
    });

    expect(plan).toMatchObject({
      status: 'accepted',
      energyCost: 100,
      satietyCost: 25,
      laborSeconds: 5,
      productionEfficiency: 1,
    });
  });

  test('combines physiology, residential tier, and education into production efficiency', () => {
    const plan = planProduction({
      commodityName: 'Book',
      quantity: 1,
      agent: bookReadyAgent,
      productionEfficiency: fullEfficiencyPolicy,
    });

    expect(plan.status).toBe('accepted');
    if (plan.status !== 'accepted') {
      throw new Error(`expected accepted production plan, got ${plan.reason}: ${plan.detail}`);
    }
    expect(plan.productionEfficiency).toBeCloseTo(0.95);
    expect(plan.energyCost).toBeCloseTo(32 / 0.95);
    expect(plan.satietyCost).toBeCloseTo(8 / 0.95);
    expect(plan.laborSeconds).toBeCloseTo(1.6 / 0.95);
  });

  test('rejects production efficiency policies missing a physiology cap for the agent tier', () => {
    const plan = planProduction({
      commodityName: 'Book',
      quantity: 1,
      agent: bookReadyAgent,
      productionEfficiency: {
        ...fullEfficiencyPolicy,
        physiologyCaps: {
          caps: [{ residentialTier: 1, maxEnergy: 100, maxSatiety: 100, maxHealth: 100 }],
        },
      },
    });

    expect(plan).toEqual({
      status: 'rejected',
      reason: 'policy-invalid',
      detail: 'physiology cap missing for residentialTier 5',
    });
  });

  test('rejects invalid production efficiency policy values', () => {
    const plan = planProduction({
      commodityName: 'Chip',
      quantity: 1,
      agent: chipReadyAgent,
      productionEfficiency: {
        minEfficiency: 0,
        educationScoreForMaxEfficiency: 500,
      },
    });

    expect(plan).toEqual({
      status: 'rejected',
      reason: 'policy-invalid',
      detail: 'minEfficiency must be within (0, 1]',
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
