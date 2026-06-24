import { asAgentId } from '@aivilization/sim-core';
import { createWorldProjection } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { createAivilizationWorldCommandPolicies } from './index';

describe('AIvilization default world command policies', () => {
  test('resolves source-backed physiology, labor, job, and recovery policies from projection state', () => {
    const resolvePolicies = createAivilizationWorldCommandPolicies();
    const policies = resolvePolicies(
      createWorldProjection({
        agents: [
          createAgent({ index: 1, educationScore: 0 }),
          createAgent({ index: 2, educationScore: 120 }),
          createAgent({ index: 3, educationScore: 240 }),
        ],
      }),
    );

    expect(policies.maxSatiety).toBe(500);
    expect(policies.sleep).toEqual({ energyRecoveryPerSecond: 1, maxEnergy: 500 });
    expect(policies.seeDoctor).toEqual({ healthRecoveryPerSecond: 1, maxHealth: 500 });
    expect(policies.satietyRecoveryByCommodity).toMatchObject({
      Apple: 25,
      Wheat: 25,
      Bread: 50,
      Sushi: 50,
    });
    expect(policies.satietyRecoveryByCommodity).not.toHaveProperty('Gold Apple');
    expect(policies.residentialPhysiologyCaps?.caps).toEqual([
      { residentialTier: 1, maxEnergy: 100, maxSatiety: 100, maxHealth: 100 },
      { residentialTier: 2, maxEnergy: 200, maxSatiety: 200, maxHealth: 200 },
      { residentialTier: 3, maxEnergy: 300, maxSatiety: 300, maxHealth: 300 },
      { residentialTier: 4, maxEnergy: 400, maxSatiety: 400, maxHealth: 400 },
      { residentialTier: 5, maxEnergy: 500, maxSatiety: 500, maxHealth: 500 },
      { residentialTier: 6, maxEnergy: 500, maxSatiety: 500, maxHealth: 500 },
    ]);
    expect(policies.jobApplication).toEqual({
      populationEducationScores: [0, 120, 240],
      quotaByResidentialTier: [1000, 1000, 1000, 1000, 1000, 1000],
    });
    expect(policies.residentialTierUpgrade?.maxResidentialTier).toBe(6);
    expect(policies.residentialTierUpgrade?.costs).toContainEqual({
      targetResidentialTier: 5,
      currencyCost: 500,
      minEducationScore: 180,
      inventoryCosts: { Transistor: 1 },
    });
    expect(policies.sleepDeprivation).toEqual({
      energyThreshold: 20,
      healthDecayPerSecond: 0.005,
      minHealth: 10,
    });
    expect(policies.stochasticIllness).toEqual({
      illnessProbabilityPercentPerHour: 1,
      healthDamage: 5,
      minHealth: 10,
    });
    expect(policies.residentialUpkeep).toEqual({
      costs: [
        { residentialTier: 1, currencyCostPerHour: 0 },
        { residentialTier: 2, currencyCostPerHour: 20 },
        { residentialTier: 3, currencyCostPerHour: 40 },
        { residentialTier: 4, currencyCostPerHour: 80 },
        { residentialTier: 5, currencyCostPerHour: 160 },
        { residentialTier: 6, currencyCostPerHour: 320 },
      ],
    });
    expect(policies.safetyNetSubsidy).toEqual({
      minimumBalance: 50,
      maxSubsidy: 25,
    });
    expect(policies.wageCalculator('CEO')).toBe(1411);
  });
});

function createAgent(input: { readonly index: number; readonly educationScore: number }) {
  return {
    agentId: asAgentId(`agent-${input.index}`),
    physiology: { energy: 500, satiety: 500, health: 500 },
    educationScore: input.educationScore,
    balance: 100,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}
