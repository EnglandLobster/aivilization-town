import { asAgentId } from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldCommandPolicies,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { createProjectionBackedEconomicRuntimeConfig } from './index';

const educationScores = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450];

const basePolicies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Bread: 15 },
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
  jobApplication: {
    populationEducationScores: [0],
    quotaByResidentialTier: [1, 1, 1, 1, 1],
  },
};

describe('projection-backed economic runtime config', () => {
  test('bundles dynamic world policies and market metric baseline config', () => {
    const baselineProjection = createProjection();
    const runtime = createProjectionBackedEconomicRuntimeConfig({
      basePolicies,
      baselineProjection,
      baselineAt: 0,
      marketMetricAppendIdempotencyKey: 'market-index:custom',
      shortTermAdjustment: 0.05,
      maxShortTermAdjustment: 0.1,
      knowledgePremium: (effectiveKnowledgeThreshold) => 1 + effectiveKnowledgeThreshold / 1000,
    });

    const resolved = runtime.policies(createProjection());

    expect(resolved.wageCalculator('Doctor')).toBeCloseTo(1824.3225);
    expect(resolved.jobApplication?.populationEducationScores).toEqual(educationScores);
    expect(runtime.marketMetrics).toEqual({
      baselineProjection,
      baselineAt: 0,
      appendIdempotencyKey: 'market-index:custom',
    });
  });
});

function createProjection() {
  return createWorldProjection({
    agents: educationScores.map((educationScore, index) => ({
      agentId: asAgentId(`agent-${index + 1}`),
      physiology: { energy: 90, satiety: 80, health: 100 },
      educationScore,
      balance: 100,
      residentialTier: 5,
      job: index === 7 ? 'Doctor' : null,
      inventory: {},
    })),
    marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
    marketPriceIndices: [
      {
        baselineAt: 0,
        recordedAt: 200,
        food: 4,
        nonFood: 2,
        overall: 3,
        foodCount: 1,
        nonFoodCount: 1,
        ratios: { Bread: 4, Book: 2 },
      },
    ],
  });
}
