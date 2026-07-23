import { describe, expect, test } from 'vitest';
import {
  activities,
  aivilizationAblationScenarioPreset,
  aivilizationEducationPolicyDefaults,
  aivilizationHealthcarePolicyDefaults,
  aivilizationJobApplicationPolicyDefaults,
  aivilizationProductionPolicyDefaults,
  aivilizationResidentialPhysiologyCaps,
  aivilizationScenarioDefaults,
  aivilizationSurvivalTimePolicyDefaults,
  aivilizationWagePolicyDefaults,
  commodities,
  createAivilizationAblationAgentSeeds,
  createAivilizationPopulationAgentSeeds,
  createAivilizationPopulationScenarioPreset,
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

  test('captures source-backed residential physiology caps for default world policies', () => {
    expect(aivilizationResidentialPhysiologyCaps).toHaveLength(6);
    expect(aivilizationResidentialPhysiologyCaps[0]).toMatchObject({
      residentialTier: 1,
      maxEnergy: 100,
      maxSatiety: 100,
      maxHealth: 100,
    });
    expect(aivilizationResidentialPhysiologyCaps[4]).toMatchObject({
      residentialTier: 5,
      maxEnergy: 500,
      maxSatiety: 500,
      maxHealth: 500,
      source:
        'AIvilization v0 Section 3.1.1 residential-tier physiology bounds; Appendix A Table 6 shows tier 5 uses 500 caps',
    });
    expect(
      aivilizationResidentialPhysiologyCaps.every((cap, index, caps) => {
        const previous = caps[index - 1];
        return (
          previous === undefined ||
          (cap.maxEnergy >= previous.maxEnergy &&
            cap.maxSatiety >= previous.maxSatiety &&
            cap.maxHealth >= previous.maxHealth)
        );
      }),
    ).toBe(true);
  });

  test('captures source-backed survival time-effect defaults for runtime policies', () => {
    expect(aivilizationSurvivalTimePolicyDefaults.sleepDeprivation).toMatchObject({
      energyThreshold: 20,
      healthDecayPerSecond: 0.005,
      minHealth: 10,
    });
    expect(aivilizationSurvivalTimePolicyDefaults.stochasticIllness).toMatchObject({
      illnessProbabilityPercentPerHour: 1,
      healthDamage: 5,
      minHealth: 10,
    });
    expect(aivilizationSurvivalTimePolicyDefaults.physiologicalSafetyNet).toEqual({
      policyVersion: 'physiological-safety-net-v1',
      criticalThresholds: { satiety: 20, energy: 20, health: 20 },
      persistenceDurationMs: 3_600_000,
      grantCooldownMs: 21_600_000,
      essentialInventoryTargets: { Apple: 2 },
      source:
        'AIvilization v0 Section 3.1.1 requires essential subsidies after persistent low physiology; physiological-safety-net-v1 thresholds, persistence, cooldown, and inventory targets are repository policy decisions because the paper does not specify them',
    });
    expect(aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.costs).toHaveLength(6);
    expect(aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.costs[0]).toMatchObject({
      residentialTier: 1,
      currencyCostPerHour: 0,
    });
    expect(aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.costs[5]).toMatchObject({
      residentialTier: 6,
      currencyCostPerHour: 320,
      source:
        'AIvilization v0 Section 3.1.1 survival constraints and Section 3.2 labor-consumption feedback default runtime tuning',
    });
  });

  test('captures source-backed healthcare defaults for medical treatment costs', () => {
    expect(aivilizationHealthcarePolicyDefaults.seeDoctorTreatmentCost).toMatchObject({
      currencyCostPerSecond: 0.02,
      source:
        'AIvilization v0 Section 3.1.1 healthcare recovery action and resource-constrained survival default runtime tuning',
    });
  });

  test('separates paper education semantics from repository-defined investment rates', () => {
    expect(aivilizationEducationPolicyDefaults.studyInvestment).toEqual({
      policyVersion: 'education-investment-v1',
      currencyCostPerHour: 20,
      inventoryCostsPerHour: {},
      source:
        'AIvilization v0 Section 3.2.1 requires resource-consuming education; education-investment-v1 is a repository policy decision because the paper does not specify cost rates',
    });
  });

  test('versions the underspecified canonical wage premium and shock policy', () => {
    expect(aivilizationWagePolicyDefaults).toEqual({
      policyVersion: 'wage-regime-v1',
      knowledgePremiumPerEducationPoint: 0.001,
      shortTermAdjustment: 0,
      maxShortTermAdjustment: 0.1,
      missingMarketPriceIndexStrategy: 'neutral',
      source:
        'AIvilization v0 Section 3.2.4 defines static and dynamic wage regimes; wage-regime-v1 is a repository policy decision because the paper does not specify Phi or the short-term shock process',
    });
  });

  test('versions the paper-constrained but underspecified residential application quota', () => {
    expect(aivilizationJobApplicationPolicyDefaults).toEqual({
      applicationQuota: {
        policyVersion: 'application-quota-v1',
        quotaByResidentialTier: [1, 1, 2, 3, 4, 5],
        source:
          'AIvilization v0 Section 3.2.3 Equation 13 requires a non-negative, bounded, non-decreasing Nmax(R); application-quota-v1 is a repository policy decision because the paper does not specify tier values',
      },
      recruitmentCycle: {
        policyVersion: 'recruitment-cycle-v1',
        cycleDurationMs: 86_400_000,
        defaultOccupationCapacity: 1,
        occupationCapacityOverrides: {},
        matchingStrategy: 'applicant-proposing-stable',
        source:
          'AIvilization v0 Section 3.2.3 requires recruitment cycles and competitive scarcity; recruitment-cycle-v1 is a repository policy decision because the paper does not specify cadence, capacity, ranking tie-breaks, or matching strategy',
      },
    });
  });

  test('captures source-backed production efficiency defaults', () => {
    expect(aivilizationProductionPolicyDefaults.productionEfficiency).toMatchObject({
      minEfficiency: 0.5,
      educationScoreForMaxEfficiency: 500,
      physiologyCaps: {
        caps: aivilizationResidentialPhysiologyCaps.map((cap) => ({
          residentialTier: cap.residentialTier,
          maxEnergy: cap.maxEnergy,
          maxSatiety: cap.maxSatiety,
          maxHealth: cap.maxHealth,
        })),
      },
      residentialTierForMaxEfficiency: 5,
      source:
        'AIvilization v0 Section 3.1.1 productive efficiency G(S,E,J,R,H) and Section 3.2.1 education score default runtime tuning',
    });
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

  test('generates deterministic location-aware runtime population presets', () => {
    const agents = createAivilizationPopulationAgentSeeds({
      agentCount: 25,
      idPrefix: 'smoke-agent',
      displayNamePrefix: 'Smoke Agent',
      startingIndex: 1,
    });
    const uniqueAgentIds = new Set(agents.map((agent) => agent.agentId));

    expect(agents).toHaveLength(25);
    expect(uniqueAgentIds.size).toBe(25);
    expect(agents[0]).toMatchObject({
      agentId: 'smoke-agent-001',
      displayName: 'Smoke Agent 001',
      profile: { personality: { mbti: 'INTJ' } },
      physiology: { energy: 500, satiety: 500, health: 500 },
      residentialTier: 1,
      job: null,
      locationId: 'town-square',
      source: 'AIvilization v0 backend runtime scale profile for 25/100/1000 agent town modes',
      tags: ['runtime-scale', 'profile-seeded'],
    });
    expect(agents[16]?.profile.personality.mbti).toBe('INTJ');
    expect(agents.every((agent) => agent.locationId !== null)).toBe(true);

    const scenarioPreset = createAivilizationPopulationScenarioPreset({
      id: 'aivilization-smoke-25',
      name: 'AIvilization Smoke 25',
      description: 'Small runtime smoke scenario for daemon boot verification.',
      agentCount: 25,
      idPrefix: 'smoke-agent',
      displayNamePrefix: 'Smoke Agent',
    });

    expect(scenarioPreset.agentSeeds).toHaveLength(25);
    expect(scenarioPreset.timeScale).toBe(aivilizationScenarioDefaults.publicTimeScale);
    expect(scenarioPreset.locations).toHaveLength(7);
    expect(scenarioPreset.source).toBe(
      'AIvilization v0 backend runtime scale profile for 25/100/1000 agent town modes',
    );
  });
});
