import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createMemorySynthesisWorldDecisionContextTrace,
  type MemorySynthesisWorldDecisionContext,
} from './worldContext';

describe('memory synthesis world decision context', () => {
  test('summarizes occupation and production rules in memory synthesis context traces', () => {
    const context: MemorySynthesisWorldDecisionContext = {
      agent: {
        agentId: asAgentId('agent-1'),
        locationId: 'market',
        physiology: { energy: 72, satiety: 41, health: 93 },
        educationScore: 31,
        balance: 191696904,
        residentialTier: 5,
        job: 'stock-clerk',
        inventory: { Fish: 46, Transistor: 12 },
      },
      market: {
        spotPrices: [{ commodity: 'Fish', spotPrice: 304.5 }],
      },
      rules: {
        criticalThresholds: { energy: 1, health: 1 },
        occupations: [
          {
            occupationName: 'Stock Clerk',
            jobTier: 1,
            baseWage: 10,
            effectiveEducationThreshold: 20,
            requiredResidentialTier: 1,
            prerequisiteCommodity: null,
            eligible: true,
            rejectionReasons: [],
            applicationQuota: {
              residentialTier: 5,
              limit: 5,
              currentApplications: 1,
              remaining: 4,
            },
          },
        ],
        production: [
          {
            commodity: 'Transistor',
            minResidentialTier: 2,
            inputs: { Fish: 1 },
            energyCost: 10,
            satietyCost: 5,
            timeCostSeconds: 60,
            producible: true,
            rejectionReasons: [],
          },
        ],
      },
    };

    expect(createMemorySynthesisWorldDecisionContextTrace(context)).toMatchObject({
      agentId: asAgentId('agent-1'),
      hasLocationId: true,
      hasJob: true,
      hasInventory: true,
      occupationRuleCount: 1,
      eligibleOccupationRuleCount: 1,
      productionRuleCount: 1,
      producibleCommodityRuleCount: 1,
    });
  });
});
