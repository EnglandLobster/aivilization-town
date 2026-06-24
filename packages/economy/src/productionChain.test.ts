import { describe, expect, test } from 'vitest';
import { planProductionChain, type ProductionAgentState } from './index';

const baseAgent = {
  residentialTier: 5,
  energy: 1000,
  satiety: 500,
  availableLaborSeconds: 500,
  inventory: {},
} satisfies ProductionAgentState;

const educationEfficiencyPolicy = {
  minEfficiency: 0.5,
  educationScoreForMaxEfficiency: 500,
};

describe('planProductionChain', () => {
  test('plans missing upstream production before the target commodity', () => {
    const plan = planProductionChain({
      commodityName: 'Book',
      quantity: 1,
      agent: baseAgent,
    });

    expect(plan).toEqual({
      status: 'accepted',
      targetCommodityName: 'Book',
      targetQuantity: 1,
      steps: [
        {
          commodityName: 'Wood',
          quantity: 1,
          produced: { Wood: 1 },
          consumedInputs: {},
          energyCost: 8,
          satietyCost: 2,
          laborSeconds: 0.4,
        },
        {
          commodityName: 'Book',
          quantity: 1,
          produced: { Book: 1 },
          consumedInputs: { Wood: 1 },
          energyCost: 32,
          satietyCost: 8,
          laborSeconds: 1.6,
        },
      ],
      inventoryAfter: { Book: 1 },
      inventoryDelta: { Book: 1 },
      energyCost: 40,
      satietyCost: 10,
      laborSeconds: 2,
    });
  });

  test('applies education-driven efficiency to each chain step and aggregate budget', () => {
    const plan = planProductionChain({
      commodityName: 'Book',
      quantity: 1,
      agent: {
        ...baseAgent,
        educationScore: 0,
      },
      productionEfficiency: educationEfficiencyPolicy,
    });

    expect(plan).toEqual({
      status: 'accepted',
      targetCommodityName: 'Book',
      targetQuantity: 1,
      steps: [
        {
          commodityName: 'Wood',
          quantity: 1,
          produced: { Wood: 1 },
          consumedInputs: {},
          energyCost: 16,
          satietyCost: 4,
          laborSeconds: 0.8,
          productionEfficiency: 0.5,
        },
        {
          commodityName: 'Book',
          quantity: 1,
          produced: { Book: 1 },
          consumedInputs: { Wood: 1 },
          energyCost: 64,
          satietyCost: 16,
          laborSeconds: 3.2,
          productionEfficiency: 0.5,
        },
      ],
      inventoryAfter: { Book: 1 },
      inventoryDelta: { Book: 1 },
      energyCost: 80,
      satietyCost: 20,
      laborSeconds: 4,
    });
  });

  test('reuses existing upstream inventory before planning new inputs', () => {
    const plan = planProductionChain({
      commodityName: 'Book',
      quantity: 1,
      agent: {
        ...baseAgent,
        inventory: { Wood: 1 },
      },
    });

    expect(plan).toMatchObject({
      status: 'accepted',
      steps: [
        {
          commodityName: 'Book',
          quantity: 1,
          consumedInputs: { Wood: 1 },
          produced: { Book: 1 },
        },
      ],
      inventoryAfter: { Book: 1 },
      inventoryDelta: { Wood: -1, Book: 1 },
      energyCost: 32,
      satietyCost: 8,
      laborSeconds: 1.6,
    });
  });

  test('aggregates shared intermediate requirements for high-tier recipes', () => {
    const plan = planProductionChain({
      commodityName: 'Chip',
      quantity: 1,
      agent: baseAgent,
    });

    if (plan.status !== 'accepted') {
      throw new Error(`expected accepted plan, got ${plan.reason}: ${plan.detail}`);
    }

    expect(findStep(plan.steps, 'Copper Ingot')).toMatchObject({
      commodityName: 'Copper Ingot',
      quantity: 2,
      consumedInputs: { Wood: 2, 'Copper Ore': 2 },
      produced: { 'Copper Ingot': 2 },
    });
    expect(findStep(plan.steps, 'Coal')).toMatchObject({
      commodityName: 'Coal',
      quantity: 2,
      consumedInputs: { Wood: 2 },
      produced: { Coal: 2 },
    });
    expect(plan.steps.at(-1)).toMatchObject({
      commodityName: 'Chip',
      quantity: 1,
      consumedInputs: { Transistor: 1, 'Circuit Board': 1 },
      produced: { Chip: 1 },
    });
    expect(plan.inventoryAfter).toEqual({ Chip: 1 });
  });

  test('rejects chains blocked by residential tier gates', () => {
    const plan = planProductionChain({
      commodityName: 'Chip',
      quantity: 1,
      agent: {
        ...baseAgent,
        residentialTier: 4,
      },
    });

    expect(plan).toEqual({
      status: 'rejected',
      reason: 'residential-tier-too-low',
      detail: 'Chip requires residential tier 5',
      blockingCommodityName: 'Chip',
    });
  });

  test('rejects chains that exceed cumulative energy budget', () => {
    const plan = planProductionChain({
      commodityName: 'Chip',
      quantity: 1,
      agent: {
        ...baseAgent,
        energy: 499,
      },
    });

    expect(plan).toEqual({
      status: 'rejected',
      reason: 'insufficient-energy',
      detail: 'energy requires 616, available 499',
      blockingCommodityName: 'Chip',
    });
  });
});

function findStep(
  steps: readonly {
    readonly commodityName: string;
  }[],
  commodityName: string,
) {
  const step = steps.find((candidate) => candidate.commodityName === commodityName);
  if (step === undefined) {
    throw new Error(`missing production step ${commodityName}`);
  }
  return step;
}
