import { describe, expect, test } from 'vitest';
import {
  activities,
  aivilizationAblationScenarioPreset,
  aivilizationScenarioDefaults,
  commodities,
  createAivilizationAblationAgentSeeds,
  createCommodityMarketPoolSeeds,
  jobTiers,
  occupations,
  productionRecipes,
} from './index';

describe('AIvilization source content', () => {
  test('includes the full paper commodity and production catalog anchors', () => {
    expect(commodities).toHaveLength(25);
    expect(productionRecipes).toHaveLength(24);
    expect(commodities.map((commodity) => commodity.name)).toContain('Apple');
    expect(commodities.map((commodity) => commodity.name)).toContain('Gold Apple');
    expect(commodities.map((commodity) => commodity.name)).toContain('Chip');
    expect(productionRecipes.find((recipe) => recipe.output === 'Chip')).toMatchObject({
      output: 'Chip',
      inputs: { Transistor: 1, 'Circuit Board': 1 },
      energyCost: 100,
      satietyCost: 25,
      timeCostSeconds: 5,
      rewardProbabilityPercent: 5,
    });
  });

  test('includes the full paper activity, job tier, and occupation anchors', () => {
    expect(activities).toHaveLength(7);
    expect(jobTiers).toHaveLength(6);
    expect(occupations).toHaveLength(17);
    expect(activities.map((activity) => activity.type)).toContain('Trade');
    expect(jobTiers.find((tier) => tier.tier === 6)).toMatchObject({
      tierName: 'Leadership',
      minResidentialTier: 6,
      minEducationScore: 320,
      prerequisiteCommodity: 'Circuit Board',
      wageType: 'dynamic',
    });
    expect(occupations.find((occupation) => occupation.name === 'CEO')).toMatchObject({
      jobTier: 6,
      educationFloor: 604,
      eligibilityShare: 0.065,
      baseWage: 1411,
    });
  });

  test('captures paper-backed scenario defaults for initial cohorts', () => {
    expect(aivilizationScenarioDefaults).toMatchObject({
      maxPhysiology: { energy: 500, satiety: 500, health: 500 },
      ablationInitialPhysiology: { energy: 60, satiety: 60, health: 60 },
      publicTimeScale: 7,
      ablationTimeScale: 35,
      ablationCohortSize: 80,
      agentsPerMbtiType: 5,
    });
    expect(aivilizationScenarioDefaults.mbtiTypes).toHaveLength(16);
  });

  test('generates deterministic ablation agent seeds from Section 5.1 assumptions', () => {
    const agents = createAivilizationAblationAgentSeeds();
    const uniqueAgentIds = new Set(agents.map((agent) => agent.agentId));
    const mbtiCounts = agents.reduce<Record<string, number>>((counts, agent) => {
      const mbti = agent.profile.personality.mbti;
      counts[mbti] = (counts[mbti] ?? 0) + 1;
      return counts;
    }, {});

    expect(agents).toHaveLength(80);
    expect(uniqueAgentIds.size).toBe(80);
    expect(Object.values(mbtiCounts)).toEqual(Array.from({ length: 16 }, () => 5));
    expect(agents[0]).toMatchObject({
      agentId: 'ablation-agent-001',
      physiology: { energy: 60, satiety: 60, health: 60 },
      educationScore: 0,
      balance: 0,
      residentialTier: 1,
      job: null,
      inventory: {},
      locationId: null,
    });
    expect(aivilizationAblationScenarioPreset.agentSeeds).toHaveLength(80);
    expect(aivilizationAblationScenarioPreset.timeScale).toBe(35);
    expect(aivilizationAblationScenarioPreset.locations).toHaveLength(7);
  });

  test('derives tradable market pool seeds while keeping reserves explicit', () => {
    const marketPoolSeeds = createCommodityMarketPoolSeeds({
      commodityReserve: 100,
      currencyReserve: 1000,
    });

    expect(marketPoolSeeds).toHaveLength(commodities.length - 1);
    expect(marketPoolSeeds.map((pool) => pool.commodity)).not.toContain('Gold Apple');
    expect(marketPoolSeeds.find((pool) => pool.commodity === 'Fish')).toEqual({
      commodity: 'Fish',
      commodityReserve: 100,
      currencyReserve: 1000,
      source:
        'AIvilization v0 Appendix B Table 8 trade excludes Gold Apple; reserves supplied by scenario caller',
    });
  });
});
