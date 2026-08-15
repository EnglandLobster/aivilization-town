import {
  aivilizationHealthcarePolicyDefaults,
  aivilizationCreditPolicyDefaults,
  aivilizationEducationPolicyDefaults,
  aivilizationEducationSystemPolicyDefaults,
  aivilizationExternalTradePolicyDefaults,
  aivilizationJobApplicationPolicyDefaults,
  aivilizationLifestylePolicyDefaults,
  aivilizationProductionPolicyDefaults,
  aivilizationResidentialPhysiologyCaps,
  aivilizationScenarioDefaults,
  aivilizationSurvivalTimePolicyDefaults,
  aivilizationTaxPolicyDefaults,
  aivilizationWagePolicyDefaults,
  commodities,
  jobTiers,
  occupations,
} from '@aivilization/content';
import {
  createDeterministicStrategicPlanningPolicyManifest,
  createDeterministicGlobalSynthesisPolicyManifest,
  createSocialDialoguePolicyManifest,
  DETERMINISTIC_GLOBAL_SYNTHESIS_POLICY_VERSION,
  DETERMINISTIC_STRATEGIC_PLANNING_POLICY_VERSION,
  SOCIAL_DIALOGUE_POLICY_VERSION,
} from '@aivilization/agent-runtime';
import {
  createSocialOutcomePolicyManifest,
  SOCIAL_OUTCOME_POLICY_VERSION,
  SOCIAL_RELATION_DECAY_POLICY_VERSION,
  validateEducationSystemPolicy,
  type EducationSystemPolicy,
} from '@aivilization/society';
import {
  createRuntimeAgentRegistrationPolicyManifest,
  createTownSpatialGraphPolicyManifest,
  createWorldProjectionMemoryRetentionPolicyManifest,
  EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
  RUNTIME_AGENT_REGISTRATION_POLICY_VERSION,
  TOWN_SPATIAL_GRAPH_POLICY_VERSION,
  WORLD_PROJECTION_MEMORY_RETENTION_POLICY_VERSION,
  type RuntimeAgentCreatorIdentityRule,
  type WorldCommandPolicies,
} from '@aivilization/world';
import {
  CANONICAL_EDUCATION_ACCUMULATION_POLICY_VERSION,
  EDUCATION_OPPORTUNITY_COST_POLICY_VERSION,
  CANONICAL_TRADE_ACTIVITY_DURATION_SECONDS,
  createCanonicalAgentAllocationPolicyManifest,
} from './educationOpportunityCost';
import {
  CANONICAL_MEMORY_CONSOLIDATION_POLICY_ID,
  createCanonicalMemoryConsolidationPolicyManifest,
} from './canonicalMemoryConsolidation';
import {
  AIVILIZATION_EXPERIMENTAL_FEATURE_SPECS,
  type AivilizationExperimentalFeatureKey,
} from './experimentalFeatures';
import type { WorldCommandPolicyResolver } from './worldCommandPolicySource';
import { createProjectionBackedWorldCommandPolicies } from './wagePolicy';
import {
  createStrategicPlanRenewalPolicyManifest,
  STRATEGIC_PLAN_RENEWAL_POLICY_VERSION,
} from './strategicPlanRenewal';
import {
  createSocialPlanningPolicyManifest,
  SOCIAL_PLANNING_POLICY_VERSION,
} from './socialPlanning';
import {
  AUTONOMOUS_OBJECTIVE_SELECTION_POLICY_VERSION,
  createAutonomousObjectiveSelectionPolicyManifest,
} from './objectiveRenewal';

export const AIVILIZATION_WORLD_POLICY_MANIFEST_SCHEMA_VERSION =
  'aivilization-world-policy-manifest-v2';

export type AivilizationAgentRegistrationPolicyInput = {
  readonly maxAgentsPerCreator?: number;
  readonly creatorIdentityRule?: RuntimeAgentCreatorIdentityRule;
};

/**
 * Opt-in experimental feature switches. All default to off so a run without
 * them keeps policies, settlement, and manifests identical to legacy runs.
 */
export type AivilizationExperimentalPolicySwitches = {
  /** Authority-scoped: accepted for symmetry but injected by the authority, not this factory. */
  readonly townWeather?: boolean;
  readonly townConditions?: boolean;
  readonly townBulletin?: boolean;
  readonly socialMatters?: boolean;
  readonly townConflict?: boolean;
  readonly townWellbeing?: boolean;
  readonly townCalendar?: boolean;
  readonly townLifecycle?: boolean;
  readonly townDiscourse?: boolean;
  readonly townCollectiveAction?: boolean;
  readonly townMigration?: boolean;
};

const canonicalLaborCost = {
  energyCostPerHour: 10,
  satietyCostPerHour: 10,
} as const;

const canonicalCriticalThresholds = {
  energy: 1,
  health: 1,
} as const;

const canonicalSleepPolicy = {
  energyRecoveryPerSecond: 1,
  maxEnergy: aivilizationScenarioDefaults.maxPhysiology.energy,
} as const;

const canonicalResidentialUpgradePolicy = {
  maxResidentialTier: 6,
  currencyCostPerTargetTier: 100,
} as const;

const canonicalEnterprisePolicy = {
  policyVersion: 'agent-enterprise-v3',
  minimumInitialCapital: 100,
  maximumInitialCapital: 1_000_000,
  maximumEmployees: 100,
  solvency: {
    evaluationCadenceMs: 3_600_000,
    minimumCashBalance: 1,
    gracePeriodMs: 21_600_000,
  },
  dividend: {
    paymentCadenceMs: 86_400_000,
    minimumCashReserve: 100,
    payoutRatio: 0.25,
  },
} as const;

const canonicalConsumptionPolicy = {
  policyVersion: 'final-consumption-v1',
  rules: {
    Book: { kind: 'consumable', utilityPoints: 5 },
    Chip: { kind: 'durable', utilityPoints: 25, lifetimeSeconds: 86_400 },
  },
} as const;

const canonicalExternalMarketPolicy = {
  policyVersion: 'external-market-liquidity-v1',
  cadenceMs: 3_600_000,
  commodityReserveFloor: 25,
  commodityReserveCeiling: 100_000,
  currencyReserveFloor: 250,
  currencyReserveCeiling: 1_000_000,
  maxAdjustmentRatioPerCadence: 0.1,
} as const;

const canonicalPublicBudgetPolicy = {
  policyVersion: 'public-budget-v1',
  cadenceMs: 3_600_000,
  minimumTreasuryReserve: 100,
  allocations: [
    { service: 'education', amountPerCadence: 10 },
    { service: 'healthcare', amountPerCadence: 10 },
    { service: 'infrastructure', amountPerCadence: 10 },
  ],
} as const;

const canonicalCreditPolicy = aivilizationCreditPolicyDefaults;

const canonicalExternalTradePolicy = aivilizationExternalTradePolicyDefaults;

const canonicalEducationSystemPolicy: EducationSystemPolicy = {
  policyVersion: aivilizationEducationSystemPolicyDefaults.policyVersion,
  enabled: aivilizationEducationSystemPolicyDefaults.enabled,
  levelScoreThresholds: [...aivilizationEducationSystemPolicyDefaults.levelScoreThresholds] as [
    number,
    number,
    number,
    number,
    number,
  ],
  compulsoryLevels: [...aivilizationEducationSystemPolicyDefaults.compulsoryLevels] as (
    | 0
    | 1
    | 2
    | 3
    | 4
    | 5
  )[],
  levelTuitionPerHour: { ...aivilizationEducationSystemPolicyDefaults.levelTuitionPerHour },
  employedStudyEfficiencyRatio:
    aivilizationEducationSystemPolicyDefaults.employedStudyEfficiencyRatio,
  examCycleDurationMs: aivilizationEducationSystemPolicyDefaults.examCycleDurationMs,
  admissionQuotaByLevel: { ...aivilizationEducationSystemPolicyDefaults.admissionQuotaByLevel },
  vocationalTrackShare: aivilizationEducationSystemPolicyDefaults.vocationalTrackShare,
  vocationalTrackJobTierBonus: {
    ...aivilizationEducationSystemPolicyDefaults.vocationalTrackJobTierBonus,
  },
  ...(aivilizationEducationSystemPolicyDefaults.wellbeingExamScoreBonus === undefined
    ? {}
    : {
        wellbeingExamScoreBonus: {
          ...aivilizationEducationSystemPolicyDefaults.wellbeingExamScoreBonus,
        },
      }),
  source: aivilizationEducationSystemPolicyDefaults.source,
};
validateEducationSystemPolicy(canonicalEducationSystemPolicy);

export type AivilizationWorldCommandPolicyOptions = {
  /**
   * When set, per-agent time effects (upkeep, safety nets, deprivation, illness)
   * settle in `hash(agentId) % buckets` rotation, charging elapsed time since
   * each agent's previous settlement. Total settlement per agent is unchanged;
   * per-tick load is divided by the bucket count. Opt-in; omitted keeps the
   * canonical settle-every-agent-every-tick cadence byte-for-byte.
   */
  readonly timeSettlementAmortizationBuckets?: number;
  /**
   * Optional education-system policy override (e.g. the paper-ablation profile
   * pins `enabled: false` to keep the legacy continuous-score semantics).
   * Omitted uses the canonical education-system-v4 defaults.
   */
  readonly educationSystem?: EducationSystemPolicy;
};

export function createAivilizationWorldCommandPolicies(
  randomSeed?: string,
  agentRegistration?: AivilizationAgentRegistrationPolicyInput,
  experimental?: AivilizationExperimentalPolicySwitches,
  options?: AivilizationWorldCommandPolicyOptions,
): WorldCommandPolicyResolver {
  return (projection) => {
    const basePolicies = createAivilizationWorldCommandPoliciesSnapshot(
      Object.values(projection.agents).map((agent) => agent.educationScore),
      randomSeed,
      agentRegistration,
      experimental,
      options,
    );
    return createProjectionBackedWorldCommandPolicies({
      basePolicies,
      projection,
      knowledgePremium: (effectiveKnowledgeThreshold) =>
        1 +
        effectiveKnowledgeThreshold *
          aivilizationWagePolicyDefaults.knowledgePremiumPerEducationPoint,
      shortTermAdjustment: aivilizationWagePolicyDefaults.shortTermAdjustment,
      maxShortTermAdjustment: aivilizationWagePolicyDefaults.maxShortTermAdjustment,
      missingMarketPriceIndexStrategy:
        aivilizationWagePolicyDefaults.missingMarketPriceIndexStrategy,
    });
  };
}

export function createAivilizationWorldCommandPoliciesSnapshot(
  populationEducationScores: readonly number[],
  randomSeed?: string,
  agentRegistration?: AivilizationAgentRegistrationPolicyInput,
  experimental?: AivilizationExperimentalPolicySwitches,
  options?: AivilizationWorldCommandPolicyOptions,
): WorldCommandPolicies {
  const experimentalPolicies = AIVILIZATION_EXPERIMENTAL_FEATURE_SPECS.reduce(
    (policies, spec) =>
      spec.withCommandPolicy !== undefined && experimental?.[spec.key] === true
        ? spec.withCommandPolicy(policies)
        : policies,
    {} as WorldCommandPolicies,
  );
  return {
    ...(randomSeed === undefined ? {} : { randomSeed }),
    ...experimentalPolicies,
    ...(agentRegistration?.maxAgentsPerCreator === undefined
      ? {}
      : {
          agentRegistration: {
            maxAgentsPerCreator: agentRegistration.maxAgentsPerCreator,
          },
        }),
    satietyRecoveryByCommodity: createSatietyRecoveryByCommodity(),
    maxSatiety: aivilizationScenarioDefaults.maxPhysiology.satiety,
    educationInvestment: {
      currencyCostPerHour: aivilizationEducationPolicyDefaults.studyInvestment.currencyCostPerHour,
      inventoryCostsPerHour: {
        ...aivilizationEducationPolicyDefaults.studyInvestment.inventoryCostsPerHour,
      },
    },
    educationSystem: options?.educationSystem ?? canonicalEducationSystemPolicy,
    wageCalculator: calculateOccupationWage,
    laborCost: { ...canonicalLaborCost },
    criticalThresholds: { ...canonicalCriticalThresholds },
    residentialPhysiologyCaps: {
      caps: aivilizationResidentialPhysiologyCaps.map((cap) => ({
        residentialTier: cap.residentialTier,
        maxEnergy: cap.maxEnergy,
        maxSatiety: cap.maxSatiety,
        maxHealth: cap.maxHealth,
      })),
    },
    sleep: { ...canonicalSleepPolicy },
    seeDoctor: {
      healthRecoveryPerSecond: 1,
      maxHealth: aivilizationScenarioDefaults.maxPhysiology.health,
      treatmentCost: {
        currencyCostPerSecond:
          aivilizationHealthcarePolicyDefaults.seeDoctorTreatmentCost.currencyCostPerSecond,
      },
    },
    production: {
      efficiency: {
        minEfficiency: aivilizationProductionPolicyDefaults.productionEfficiency.minEfficiency,
        educationScoreForMaxEfficiency:
          aivilizationProductionPolicyDefaults.productionEfficiency.educationScoreForMaxEfficiency,
        educationLevelMultipliers: [
          ...aivilizationProductionPolicyDefaults.productionEfficiency.educationLevelMultipliers,
        ],
        physiologyCaps: {
          caps: aivilizationProductionPolicyDefaults.productionEfficiency.physiologyCaps.caps.map(
            (cap) => ({
              residentialTier: cap.residentialTier,
              maxEnergy: cap.maxEnergy,
              maxSatiety: cap.maxSatiety,
              maxHealth: cap.maxHealth,
            }),
          ),
        },
        residentialTierForMaxEfficiency:
          aivilizationProductionPolicyDefaults.productionEfficiency.residentialTierForMaxEfficiency,
      },
    },
    tradeActivity: {
      durationSeconds: CANONICAL_TRADE_ACTIVITY_DURATION_SECONDS,
    },
    tax: {
      policyVersion: aivilizationTaxPolicyDefaults.policyVersion,
      neutralRate: aivilizationTaxPolicyDefaults.neutralRate,
      incomeTaxBrackets: aivilizationTaxPolicyDefaults.incomeTaxBrackets.map((bracket) => ({
        ...bracket,
      })),
      tradeTaxRate: aivilizationTaxPolicyDefaults.tradeTaxRate,
      dividendTaxRate: aivilizationTaxPolicyDefaults.dividendTaxRate,
      source: aivilizationTaxPolicyDefaults.source,
    },
    lifestyle: {
      policyVersion: aivilizationLifestylePolicyDefaults.policyVersion,
      netWorthBoundaries: [...aivilizationLifestylePolicyDefaults.netWorthBoundaries] as [
        number,
        number,
        number,
      ],
      strugglingNonSurvivalSpendCapRatio:
        aivilizationLifestylePolicyDefaults.strugglingNonSurvivalSpendCapRatio,
      ...(aivilizationLifestylePolicyDefaults.wellbeingSpendCapMultiplierRange === undefined
        ? {}
        : {
            wellbeingSpendCapMultiplierRange: [
              ...aivilizationLifestylePolicyDefaults.wellbeingSpendCapMultiplierRange,
            ] as [number, number],
          }),
      source: aivilizationLifestylePolicyDefaults.source,
    },
    consumption: { ...canonicalConsumptionPolicy, rules: { ...canonicalConsumptionPolicy.rules } },
    externalMarket: { ...canonicalExternalMarketPolicy },
    publicBudget: {
      ...canonicalPublicBudgetPolicy,
      allocations: canonicalPublicBudgetPolicy.allocations.map((allocation) => ({ ...allocation })),
    },
    credit: { ...canonicalCreditPolicy },
    externalTrade: { ...canonicalExternalTradePolicy },
    enterprise: {
      ...canonicalEnterprisePolicy,
      solvency: { ...canonicalEnterprisePolicy.solvency },
      dividend: { ...canonicalEnterprisePolicy.dividend },
    },
    jobApplication: {
      populationEducationScores,
      quotaByResidentialTier: [
        ...aivilizationJobApplicationPolicyDefaults.applicationQuota.quotaByResidentialTier,
      ],
      recruitmentCycle: {
        policyVersion: aivilizationJobApplicationPolicyDefaults.recruitmentCycle.policyVersion,
        cycleDurationMs: aivilizationJobApplicationPolicyDefaults.recruitmentCycle.cycleDurationMs,
        defaultOccupationCapacity:
          aivilizationJobApplicationPolicyDefaults.recruitmentCycle.defaultOccupationCapacity,
        occupationCapacityOverrides: {
          ...aivilizationJobApplicationPolicyDefaults.recruitmentCycle.occupationCapacityOverrides,
        },
      },
    },
    residentialTierUpgrade: {
      maxResidentialTier: canonicalResidentialUpgradePolicy.maxResidentialTier,
      costs: jobTiers
        .filter((tier) => tier.tier > 1)
        .map((tier) => ({
          targetResidentialTier: tier.tier,
          currencyCost: tier.tier * canonicalResidentialUpgradePolicy.currencyCostPerTargetTier,
          minEducationScore: tier.minEducationScore,
          ...(tier.prerequisiteCommodity === null
            ? {}
            : { inventoryCosts: { [tier.prerequisiteCommodity]: 1 } }),
        })),
    },
    sleepDeprivation: {
      energyThreshold: aivilizationSurvivalTimePolicyDefaults.sleepDeprivation.energyThreshold,
      healthDecayPerSecond:
        aivilizationSurvivalTimePolicyDefaults.sleepDeprivation.healthDecayPerSecond,
      minHealth: aivilizationSurvivalTimePolicyDefaults.sleepDeprivation.minHealth,
    },
    stochasticIllness: {
      illnessProbabilityPercentPerHour:
        aivilizationSurvivalTimePolicyDefaults.stochasticIllness.illnessProbabilityPercentPerHour,
      healthDamage: aivilizationSurvivalTimePolicyDefaults.stochasticIllness.healthDamage,
      minHealth: aivilizationSurvivalTimePolicyDefaults.stochasticIllness.minHealth,
    },
    residentialUpkeep: {
      policyVersion: aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.policyVersion,
      costs: aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.costs.map((cost) => ({
        residentialTier: cost.residentialTier,
        currencyCostPerHour: cost.currencyCostPerHour,
      })),
      arrearsDowngradeThresholdHours:
        aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.arrearsDowngradeThresholdHours,
      landValueCoefficientPerHour:
        aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.landValueCoefficientPerHour,
    },
    landValue: {
      policyVersion: aivilizationSurvivalTimePolicyDefaults.landValue.policyVersion,
      updateCadenceMs: aivilizationSurvivalTimePolicyDefaults.landValue.updateCadenceMs,
      baseline: aivilizationSurvivalTimePolicyDefaults.landValue.baseline,
      populationWeight: aivilizationSurvivalTimePolicyDefaults.landValue.populationWeight,
      liquidityWeight: aivilizationSurvivalTimePolicyDefaults.landValue.liquidityWeight,
      smoothingFactor: aivilizationSurvivalTimePolicyDefaults.landValue.smoothingFactor,
      minIndex: aivilizationSurvivalTimePolicyDefaults.landValue.minIndex,
      maxIndex: aivilizationSurvivalTimePolicyDefaults.landValue.maxIndex,
    },
    ...(options?.timeSettlementAmortizationBuckets === undefined
      ? {}
      : {
          timeSettlementAmortization: {
            buckets: options.timeSettlementAmortizationBuckets,
          },
        }),
    physiologicalSafetyNet: {
      policyVersion: aivilizationSurvivalTimePolicyDefaults.physiologicalSafetyNet.policyVersion,
      criticalThresholds: {
        ...aivilizationSurvivalTimePolicyDefaults.physiologicalSafetyNet.criticalThresholds,
      },
      persistenceDurationMs:
        aivilizationSurvivalTimePolicyDefaults.physiologicalSafetyNet.persistenceDurationMs,
      grantCooldownMs:
        aivilizationSurvivalTimePolicyDefaults.physiologicalSafetyNet.grantCooldownMs,
      essentialInventoryTargets: {
        ...aivilizationSurvivalTimePolicyDefaults.physiologicalSafetyNet.essentialInventoryTargets,
      },
    },
  };
}

// The experimental feature policy builders live in experimentalFeatures.ts
// next to the feature registry; re-exported here for API compatibility.
export {
  createAivilizationSocialMattersPolicy,
  createAivilizationTownBulletinPolicy,
  createAivilizationTownCalendarPolicy,
  createAivilizationTownConditionsPolicy,
  createAivilizationTownConflictPolicy,
  createAivilizationCollectiveActionPolicy,
  createAivilizationOutMigrationPolicy,
  createAivilizationTownDiscoursePolicy,
  createAivilizationTownLifecyclePolicy,
  createAivilizationTownWeatherPolicy,
  createAivilizationTownWellbeingPolicy,
} from './experimentalFeatures';

export function createAivilizationWorldPolicyManifest(
  input: {
    readonly agentRegistration?: AivilizationAgentRegistrationPolicyInput;
    /**
     * Opt-in town-weather switch. When
     * true the manifest declares the town-weather policy version and matrix;
     * omitted/false keeps the manifest weather-free, matching legacy runs.
     */
    readonly townWeather?: boolean;
    /**
     * Opt-in town-conditions switch.
     * When true the manifest declares the town-conditions policy version and
     * catalog; omitted/false keeps the manifest condition-free.
     */
    readonly townConditions?: boolean;
    /**
     * Opt-in town-bulletin switch. When
     * true the manifest declares the town-bulletin policy version and
     * parameters; omitted/false keeps the manifest bulletin-free.
     */
    readonly townBulletin?: boolean;
    /**
     * Opt-in social-matters switch. When
     * true the manifest declares the social-matters policy version and
     * parameters; omitted/false keeps the manifest matter-free.
     */
    readonly socialMatters?: boolean;
    /**
     * Opt-in town-conflict switch. When
     * true the manifest declares the town-conflict policy version and
     * parameters; omitted/false keeps the manifest conflict-free.
     */
    readonly townConflict?: boolean;
    /**
     * Opt-in town-wellbeing switch. When
     * true the manifest declares the town-wellbeing policy version and
     * parameters; omitted/false keeps the manifest wellbeing-free.
     */
    readonly townWellbeing?: boolean;
    /**
     * Opt-in town-calendar switch. When
     * true the manifest declares the town-calendar policy version and
     * parameters; omitted/false keeps the manifest calendar-free.
     */
    readonly townCalendar?: boolean;
    /**
     * Opt-in town-lifecycle switch. When
     * true the manifest declares the town-lifecycle policy version and
     * parameters; omitted/false keeps the manifest lifecycle-free.
     */
    readonly townLifecycle?: boolean;
    /**
     * Opt-in town-discourse switch. When
     * true the manifest declares the town-discourse policy version and
     * parameters; omitted/false keeps the manifest discourse-free.
     */
    readonly townDiscourse?: boolean;
    /**
     * Opt-in town-collective-action switch. When
     * true the manifest declares the collective-action policy version and
     * parameters; omitted/false keeps the manifest petition-free.
     */
    readonly townCollectiveAction?: boolean;
    /**
     * Opt-in town-migration switch. When
     * true the manifest declares the town-migration policy version and
     * parameters; omitted/false keeps the manifest migration-free.
     */
    readonly townMigration?: boolean;
    /**
     * Optional education-system policy override recorded verbatim in the
     * manifest parameters (e.g. the paper-ablation profile pins
     * `enabled: false`). Must match the runtime command-policy override so the
     * manifest provenance reflects the actual runtime semantics; omitted
     * records the canonical defaults.
     */
    readonly educationSystem?: EducationSystemPolicy;
  } = {},
) {
  const educationSystemPolicy = input.educationSystem ?? aivilizationEducationSystemPolicyDefaults;
  const experimentalPolicyVersions: Partial<Record<AivilizationExperimentalFeatureKey, string>> =
    {};
  const experimentalParameters: Partial<Record<AivilizationExperimentalFeatureKey, unknown>> = {};
  for (const spec of AIVILIZATION_EXPERIMENTAL_FEATURE_SPECS) {
    if (input[spec.key] === true) {
      experimentalPolicyVersions[spec.key] = spec.policyVersion;
      experimentalParameters[spec.key] = spec.createManifestParameters();
    }
  }
  const manifest = {
    schemaVersion: AIVILIZATION_WORLD_POLICY_MANIFEST_SCHEMA_VERSION,
    policyVersions: {
      educationInvestment: aivilizationEducationPolicyDefaults.studyInvestment.policyVersion,
      educationSystem: educationSystemPolicy.policyVersion,
      educationAccumulation: CANONICAL_EDUCATION_ACCUMULATION_POLICY_VERSION,
      educationOpportunityCost: EDUCATION_OPPORTUNITY_COST_POLICY_VERSION,
      agentActivityTimeAllocation: EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
      globalSynthesis: DETERMINISTIC_GLOBAL_SYNTHESIS_POLICY_VERSION,
      autonomousObjectiveSelection: AUTONOMOUS_OBJECTIVE_SELECTION_POLICY_VERSION,
      strategicPlanning: DETERMINISTIC_STRATEGIC_PLANNING_POLICY_VERSION,
      agentRegistration: RUNTIME_AGENT_REGISTRATION_POLICY_VERSION,
      strategicPlanRenewal: STRATEGIC_PLAN_RENEWAL_POLICY_VERSION,
      socialPlanning: SOCIAL_PLANNING_POLICY_VERSION,
      socialDialogue: SOCIAL_DIALOGUE_POLICY_VERSION,
      socialOutcome: SOCIAL_OUTCOME_POLICY_VERSION,
      socialRelationDecay: SOCIAL_RELATION_DECAY_POLICY_VERSION,
      townSpatialGraph: TOWN_SPATIAL_GRAPH_POLICY_VERSION,
      wageRegime: aivilizationWagePolicyDefaults.policyVersion,
      tax: aivilizationTaxPolicyDefaults.policyVersion,
      lifestyle: aivilizationLifestylePolicyDefaults.policyVersion,
      consumption: canonicalConsumptionPolicy.policyVersion,
      externalMarket: canonicalExternalMarketPolicy.policyVersion,
      publicBudget: canonicalPublicBudgetPolicy.policyVersion,
      credit: canonicalCreditPolicy.policyVersion,
      externalTrade: canonicalExternalTradePolicy.policyVersion,
      enterprise: canonicalEnterprisePolicy.policyVersion,
      applicationQuota: aivilizationJobApplicationPolicyDefaults.applicationQuota.policyVersion,
      recruitmentCycle: aivilizationJobApplicationPolicyDefaults.recruitmentCycle.policyVersion,
      physiologicalSafetyNet:
        aivilizationSurvivalTimePolicyDefaults.physiologicalSafetyNet.policyVersion,
      residentialUpkeep: aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.policyVersion,
      landValue: aivilizationSurvivalTimePolicyDefaults.landValue.policyVersion,
      memoryConsolidation: CANONICAL_MEMORY_CONSOLIDATION_POLICY_ID,
      worldProjectionMemoryRetention: WORLD_PROJECTION_MEMORY_RETENTION_POLICY_VERSION,
      ...experimentalPolicyVersions,
    },
    formulas: {
      travelDuration: 'ceil(shortestPathBaseDuration*(1+min(1,destinationOccupancy/capacity)*0.5))',
      educationAccumulation: 'H(t+dt)=H(t)+educationRatePerSecond*durationSeconds',
      lowerTierWage: 'baseWage*overallPriceIndex',
      higherTierWage:
        'baseWage*knowledgePremium(effectiveKnowledgeThreshold)*overallPriceIndex*(1+boundedShortTermAdjustment)',
      knowledgePremium: '1+effectiveKnowledgeThreshold*knowledgePremiumPerEducationPoint',
      productionEfficiency:
        'clamp(minEfficiency,1,educationFactor*energyFactor*satietyFactor*healthFactor*jobFactor*residentialFactor); educationFactor=min(1,score/educationScoreForMaxEfficiency*educationLevelMultipliers[level])',
    },
    parameters: {
      townSpatialGraph: createTownSpatialGraphPolicyManifest(),
      maxPhysiology: { ...aivilizationScenarioDefaults.maxPhysiology },
      satietyRecoveryByCommodity: createSatietyRecoveryByCommodity(),
      laborCost: { ...canonicalLaborCost },
      criticalThresholds: { ...canonicalCriticalThresholds },
      educationInvestment: {
        ...aivilizationEducationPolicyDefaults.studyInvestment,
        inventoryCostsPerHour: {
          ...aivilizationEducationPolicyDefaults.studyInvestment.inventoryCostsPerHour,
        },
      },
      educationSystem: {
        ...educationSystemPolicy,
        levelScoreThresholds: [...educationSystemPolicy.levelScoreThresholds] as [
          number,
          number,
          number,
          number,
          number,
        ],
        compulsoryLevels: [...educationSystemPolicy.compulsoryLevels],
        levelTuitionPerHour: {
          ...educationSystemPolicy.levelTuitionPerHour,
        },
      },
      agentAllocation: createCanonicalAgentAllocationPolicyManifest(),
      agentRegistration: createRuntimeAgentRegistrationPolicyManifest(
        input.agentRegistration ?? {},
      ),
      planning: {
        autonomousObjectiveSelection: createAutonomousObjectiveSelectionPolicyManifest(),
        globalSynthesis: createDeterministicGlobalSynthesisPolicyManifest(),
        strategicPlanning: createDeterministicStrategicPlanningPolicyManifest(),
        strategicPlanRenewal: createStrategicPlanRenewalPolicyManifest(),
      },
      memoryConsolidation: createCanonicalMemoryConsolidationPolicyManifest(),
      worldProjectionMemoryRetention: createWorldProjectionMemoryRetentionPolicyManifest(),
      socialInteraction: {
        planning: createSocialPlanningPolicyManifest(),
        dialogue: createSocialDialoguePolicyManifest(),
        outcome: createSocialOutcomePolicyManifest(),
      },
      wageRegime: { ...aivilizationWagePolicyDefaults },
      tax: {
        ...aivilizationTaxPolicyDefaults,
        incomeTaxBrackets: aivilizationTaxPolicyDefaults.incomeTaxBrackets.map((bracket) => ({
          ...bracket,
        })),
      },
      lifestyle: {
        ...aivilizationLifestylePolicyDefaults,
        netWorthBoundaries: [...aivilizationLifestylePolicyDefaults.netWorthBoundaries],
      },
      consumption: {
        ...canonicalConsumptionPolicy,
        rules: { ...canonicalConsumptionPolicy.rules },
      },
      externalMarket: { ...canonicalExternalMarketPolicy },
      publicBudget: {
        ...canonicalPublicBudgetPolicy,
        allocations: canonicalPublicBudgetPolicy.allocations.map((allocation) => ({
          ...allocation,
        })),
      },
      credit: { ...canonicalCreditPolicy },
      externalTrade: { ...canonicalExternalTradePolicy },
      enterprise: {
        ...canonicalEnterprisePolicy,
        solvency: { ...canonicalEnterprisePolicy.solvency },
        dividend: { ...canonicalEnterprisePolicy.dividend },
      },
      applicationQuota: {
        ...aivilizationJobApplicationPolicyDefaults.applicationQuota,
        quotaByResidentialTier: [
          ...aivilizationJobApplicationPolicyDefaults.applicationQuota.quotaByResidentialTier,
        ],
      },
      recruitmentCycle: {
        ...aivilizationJobApplicationPolicyDefaults.recruitmentCycle,
        occupationCapacityOverrides: {
          ...aivilizationJobApplicationPolicyDefaults.recruitmentCycle.occupationCapacityOverrides,
        },
      },
      residentialPhysiologyCaps: aivilizationResidentialPhysiologyCaps.map((cap) => ({ ...cap })),
      sleep: { ...canonicalSleepPolicy },
      healthcare: {
        healthRecoveryPerSecond: 1,
        maxHealth: aivilizationScenarioDefaults.maxPhysiology.health,
        treatmentCost: {
          ...aivilizationHealthcarePolicyDefaults.seeDoctorTreatmentCost,
        },
      },
      production: {
        ...aivilizationProductionPolicyDefaults.productionEfficiency,
        physiologyCaps: {
          caps: aivilizationProductionPolicyDefaults.productionEfficiency.physiologyCaps.caps.map(
            (cap) => ({ ...cap }),
          ),
        },
      },
      survival: {
        sleepDeprivation: { ...aivilizationSurvivalTimePolicyDefaults.sleepDeprivation },
        stochasticIllness: { ...aivilizationSurvivalTimePolicyDefaults.stochasticIllness },
        residentialUpkeep: {
          policyVersion: aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.policyVersion,
          costs: aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.costs.map((cost) => ({
            ...cost,
          })),
          arrearsDowngradeThresholdHours:
            aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.arrearsDowngradeThresholdHours,
          landValueCoefficientPerHour:
            aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.landValueCoefficientPerHour,
        },
        landValue: { ...aivilizationSurvivalTimePolicyDefaults.landValue },
        physiologicalSafetyNet: {
          ...aivilizationSurvivalTimePolicyDefaults.physiologicalSafetyNet,
          criticalThresholds: {
            ...aivilizationSurvivalTimePolicyDefaults.physiologicalSafetyNet.criticalThresholds,
          },
          essentialInventoryTargets: {
            ...aivilizationSurvivalTimePolicyDefaults.physiologicalSafetyNet
              .essentialInventoryTargets,
          },
        },
      },
      residentialUpgrade: {
        ...canonicalResidentialUpgradePolicy,
        costs: jobTiers
          .filter((tier) => tier.tier > 1)
          .map((tier) => ({
            targetResidentialTier: tier.tier,
            currencyCost: tier.tier * canonicalResidentialUpgradePolicy.currencyCostPerTargetTier,
            minEducationScore: tier.minEducationScore,
            prerequisiteCommodity: tier.prerequisiteCommodity,
          })),
      },
      occupations: occupations.map((occupation) => ({ ...occupation })),
      ...experimentalParameters,
    },
  } as const;
  return {
    ...manifest,
    policyRegistry: createCanonicalPolicyRegistry(manifest),
  } as const;
}

type CanonicalPolicyProvenance = 'paper-derived' | 'repository-defined' | 'experimental';

type CanonicalPolicyRegistryEntry = {
  readonly parameterPath: string;
  readonly policyVersion: string;
  readonly policyVersionKeys: readonly string[];
  readonly provenance: CanonicalPolicyProvenance;
  readonly source: string;
  readonly compatibilityBoundary: string;
};

function createCanonicalPolicyRegistry(manifest: {
  readonly policyVersions: Readonly<Record<string, string>>;
  readonly parameters: Readonly<Record<string, unknown>>;
}) {
  const entries = [
    registryEntry(
      'townSpatialGraph',
      'town-spatial-graph-v1',
      ['townSpatialGraph'],
      'repository-defined',
      'Paper requires situated agents but does not specify town geometry.',
    ),
    registryEntry(
      'maxPhysiology',
      'canonical-physiology-scale-v1',
      [],
      'repository-defined',
      'Paper names physiology axes; repository calibrates their numeric scale.',
    ),
    registryEntry(
      'satietyRecoveryByCommodity',
      'canonical-food-recovery-v1',
      [],
      'repository-defined',
      'Paper defines food activities but not recovery magnitudes.',
    ),
    registryEntry(
      'laborCost',
      'canonical-labor-physiology-cost-v1',
      [],
      'repository-defined',
      'Paper requires labor-survival coupling but omits numeric depletion rates.',
    ),
    registryEntry(
      'criticalThresholds',
      'canonical-incapacitation-threshold-v1',
      [],
      'repository-defined',
      'Paper requires survival constraints but omits incapacitation thresholds.',
    ),
    registryEntry(
      'educationInvestment',
      'education-investment-v1',
      ['educationInvestment'],
      'repository-defined',
      'Paper requires education investment; repository defines its direct cost.',
    ),
    registryEntry(
      'educationSystem',
      aivilizationEducationSystemPolicyDefaults.policyVersion,
      ['educationSystem'],
      'repository-defined',
      'The paper models education as a continuous score; discrete levels, the nine-year compulsory stage, thresholds, tuition rates, the employed-study efficiency penalty, the exam-release cadence/quotas/track share, and the vocational-track job-tier bonus are repository-defined.',
    ),
    registryEntry(
      'agentAllocation',
      'canonical-agent-allocation-policy-v1',
      ['educationAccumulation', 'educationOpportunityCost', 'agentActivityTimeAllocation'],
      'repository-defined',
      'Paper defines opportunity cost and planning architecture; repository fixes action durations and scheduling semantics.',
    ),
    registryEntry(
      'agentRegistration',
      'runtime-agent-registration-v3',
      ['agentRegistration'],
      'repository-defined',
      'Public Agent participation is paper-derived; identity and replay semantics are repository-defined.',
    ),
    registryEntry(
      'planning',
      'canonical-planning-composition-v1',
      [
        'globalSynthesis',
        'autonomousObjectiveSelection',
        'strategicPlanning',
        'strategicPlanRenewal',
      ],
      'repository-defined',
      'Branch planning is paper-derived; objective scores and renewal triggers are repository-defined.',
    ),
    registryEntry(
      'memoryConsolidation',
      'dual-process-memory-consolidation-v4',
      ['memoryConsolidation'],
      'paper-derived',
      'Paper specifies dual-process short-term and long-term memory interaction.',
    ),
    registryEntry(
      'worldProjectionMemoryRetention',
      'world-projection-memory-retention-v1',
      ['worldProjectionMemoryRetention'],
      'repository-defined',
      'Projection cache bounds are an operational repository choice.',
    ),
    registryEntry(
      'socialInteraction',
      'canonical-social-interaction-v1',
      ['socialPlanning', 'socialDialogue', 'socialOutcome', 'socialRelationDecay'],
      'repository-defined',
      'Paper requires social interaction and reflection; scoring, decay and transcript evaluation are repository-defined.',
    ),
    registryEntry(
      'wageRegime',
      'wage-regime-v1',
      ['wageRegime'],
      'paper-derived',
      'Paper specifies lower-tier price indexing and higher-tier knowledge-sensitive wages.',
    ),
    registryEntry(
      'tax',
      aivilizationTaxPolicyDefaults.policyVersion,
      ['tax'],
      'repository-defined',
      'The paper does not model taxation; brackets, the neutral rate, the trade tax rate, and the dividend tax rate are repository-defined.',
    ),
    registryEntry(
      'lifestyle',
      'lifestyle-v1',
      ['lifestyle'],
      'repository-defined',
      'The paper does not model wealth-tiered consumption; tier boundaries and the struggling-tier spend cap are repository-defined, benchmarked against the CS2 consumption multiplier.',
    ),
    registryEntry(
      'consumption',
      canonicalConsumptionPolicy.policyVersion,
      ['consumption'],
      'repository-defined',
      'Final consumption, utility, and durable-good lifetimes are repository-defined extensions that close the household demand loop.',
    ),
    registryEntry(
      'externalMarket',
      canonicalExternalMarketPolicy.policyVersion,
      ['externalMarket'],
      'repository-defined',
      'External reserve rebalancing is a repository-defined liquidity backstop for thin or isolated regional markets.',
    ),
    registryEntry(
      'publicBudget',
      canonicalPublicBudgetPolicy.policyVersion,
      ['publicBudget'],
      'repository-defined',
      'Treasury reserve and public-service allocation rules are repository-defined extensions that close the fiscal spending loop.',
    ),
    registryEntry(
      'credit',
      canonicalCreditPolicy.policyVersion,
      ['credit'],
      'repository-defined',
      'The paper does not model banking; town-bank deposit/loan rates, the reserve requirement, the missed-payment grace window, and the history-scaled credit-limit schedule are repository-defined.',
    ),
    registryEntry(
      'externalTrade',
      canonicalExternalTradePolicy.policyVersion,
      ['externalTrade'],
      'repository-defined',
      'The paper does not model external trade; the rolling net-export balance, its 1% decay, and the saturating sqrt-balance price impact are repository-defined, benchmarked against the CS2 TradeSystem.',
    ),
    registryEntry(
      'enterprise',
      canonicalEnterprisePolicy.policyVersion,
      ['enterprise'],
      'repository-defined',
      'Enterprise ownership, capitalization, employment, and closure rules are repository-defined extensions to the agent economy.',
    ),
    registryEntry(
      'applicationQuota',
      'application-quota-v1',
      ['applicationQuota'],
      'paper-derived',
      'Paper specifies residential-tier application quotas.',
    ),
    registryEntry(
      'recruitmentCycle',
      'recruitment-cycle-v1',
      ['recruitmentCycle'],
      'repository-defined',
      'Paper specifies competitive hiring; repository defines cycle duration and capacities.',
    ),
    registryEntry(
      'residentialPhysiologyCaps',
      'residential-physiology-cap-v1',
      [],
      'paper-derived',
      'Paper specifies residential-tier physiological maxima.',
    ),
    registryEntry(
      'sleep',
      'canonical-sleep-recovery-v1',
      [],
      'repository-defined',
      'Paper specifies sleep recovery; repository calibrates its rate.',
    ),
    registryEntry(
      'healthcare',
      'canonical-healthcare-v1',
      [],
      'repository-defined',
      'Paper specifies healthcare activity; repository defines recovery and treatment price.',
    ),
    registryEntry(
      'production',
      'production-efficiency-v2',
      [],
      'repository-defined',
      'Paper defines monotone G(S,E,J,R,H) but not its exact functional form; v2 adds the discrete education-level multiplier on the education factor.',
    ),
    registryEntry(
      'survival',
      'canonical-survival-time-v1',
      ['physiologicalSafetyNet', 'residentialUpkeep', 'landValue'],
      'repository-defined',
      'Paper requires physiology and safety-net behavior; illness, upkeep, land value and timing parameters are repository-defined.',
    ),
    registryEntry(
      'residentialUpgrade',
      'canonical-residential-upgrade-v1',
      [],
      'repository-defined',
      'Paper specifies tier prerequisites; repository defines currency costs and atomic settlement.',
    ),
    registryEntry(
      'occupations',
      'paper-occupation-catalog-v1',
      [],
      'paper-derived',
      'AIvilization Appendix occupation and tier catalogs.',
    ),
    // The town-weather entry is appended only when the opt-in switch placed the
    // policy in the manifest, so a weather-off run keeps a manifest identical
    // to pre-weather builds.
    ...AIVILIZATION_EXPERIMENTAL_FEATURE_SPECS.filter(
      (spec) => spec.key in manifest.parameters,
    ).map((spec) =>
      registryEntry(spec.key, spec.policyVersion, [spec.key], 'experimental', spec.registrySource),
    ),
  ] as const satisfies readonly CanonicalPolicyRegistryEntry[];
  const registeredParameterPaths = new Set(entries.map((entry) => entry.parameterPath));
  const registeredPolicyVersionKeys = new Set(entries.flatMap((entry) => entry.policyVersionKeys));
  return {
    schemaVersion: 'canonical-policy-provenance-registry-v1',
    classifications: ['paper-derived', 'repository-defined', 'experimental'],
    entries,
    unregisteredParameterPaths: Object.keys(manifest.parameters)
      .filter((path) => !registeredParameterPaths.has(path))
      .sort(),
    unregisteredPolicyVersionKeys: Object.keys(manifest.policyVersions)
      .filter((key) => !registeredPolicyVersionKeys.has(key))
      .sort(),
  } as const;
}

function registryEntry(
  parameterPath: string,
  policyVersion: string,
  policyVersionKeys: readonly string[],
  provenance: CanonicalPolicyProvenance,
  source: string,
): CanonicalPolicyRegistryEntry {
  return {
    parameterPath,
    policyVersion,
    policyVersionKeys: [...policyVersionKeys],
    provenance,
    source,
    compatibilityBoundary:
      'value-or-semantics-change-requires-new-policy-version-and-replay-boundary',
  };
}

function createSatietyRecoveryByCommodity(): Record<string, number> {
  const recoveries: Record<string, number> = {};
  for (const commodity of commodities) {
    if (commodity.tier === 'Primary' && commodity.role.toLowerCase().includes('food')) {
      recoveries[commodity.name] = 25;
    }
    if (commodity.tier === 'SecondaryProcessedFood') {
      recoveries[commodity.name] = 50;
    }
  }
  return recoveries;
}

function calculateOccupationWage(occupationName: string): number {
  const occupation = occupations.find((candidate) => candidate.name === occupationName);
  if (occupation === undefined) {
    throw new Error(`unknown occupation: ${occupationName}`);
  }
  return occupation.baseWage;
}
