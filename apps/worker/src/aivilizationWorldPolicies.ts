import {
  aivilizationHealthcarePolicyDefaults,
  aivilizationEducationPolicyDefaults,
  aivilizationJobApplicationPolicyDefaults,
  aivilizationProductionPolicyDefaults,
  aivilizationResidentialPhysiologyCaps,
  aivilizationScenarioDefaults,
  aivilizationSurvivalTimePolicyDefaults,
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

export function createAivilizationWorldCommandPolicies(
  randomSeed?: string,
  agentRegistration?: AivilizationAgentRegistrationPolicyInput,
): WorldCommandPolicyResolver {
  return (projection) => {
    const basePolicies = createAivilizationWorldCommandPoliciesSnapshot(
      Object.values(projection.agents).map((agent) => agent.educationScore),
      randomSeed,
      agentRegistration,
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
): WorldCommandPolicies {
  return {
    ...(randomSeed === undefined ? {} : { randomSeed }),
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
      costs: aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.costs.map((cost) => ({
        residentialTier: cost.residentialTier,
        currencyCostPerHour: cost.currencyCostPerHour,
      })),
    },
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

export function createAivilizationWorldPolicyManifest(
  input: {
    readonly agentRegistration?: AivilizationAgentRegistrationPolicyInput;
  } = {},
) {
  const manifest = {
    schemaVersion: AIVILIZATION_WORLD_POLICY_MANIFEST_SCHEMA_VERSION,
    policyVersions: {
      educationInvestment: aivilizationEducationPolicyDefaults.studyInvestment.policyVersion,
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
      applicationQuota: aivilizationJobApplicationPolicyDefaults.applicationQuota.policyVersion,
      recruitmentCycle: aivilizationJobApplicationPolicyDefaults.recruitmentCycle.policyVersion,
      physiologicalSafetyNet:
        aivilizationSurvivalTimePolicyDefaults.physiologicalSafetyNet.policyVersion,
      memoryConsolidation: CANONICAL_MEMORY_CONSOLIDATION_POLICY_ID,
      worldProjectionMemoryRetention: WORLD_PROJECTION_MEMORY_RETENTION_POLICY_VERSION,
    },
    formulas: {
      travelDuration: 'ceil(shortestPathBaseDuration*(1+min(1,destinationOccupancy/capacity)*0.5))',
      educationAccumulation: 'H(t+dt)=H(t)+educationRatePerSecond*durationSeconds',
      lowerTierWage: 'baseWage*overallPriceIndex',
      higherTierWage:
        'baseWage*knowledgePremium(effectiveKnowledgeThreshold)*overallPriceIndex*(1+boundedShortTermAdjustment)',
      knowledgePremium: '1+effectiveKnowledgeThreshold*knowledgePremiumPerEducationPoint',
      productionEfficiency:
        'clamp(minEfficiency,1,educationFactor*energyFactor*satietyFactor*healthFactor*jobFactor*residentialFactor)',
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
          costs: aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.costs.map((cost) => ({
            ...cost,
          })),
        },
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
      'production-efficiency-v1',
      [],
      'repository-defined',
      'Paper defines monotone G(S,E,J,R,H) but not its exact functional form.',
    ),
    registryEntry(
      'survival',
      'canonical-survival-time-v1',
      ['physiologicalSafetyNet'],
      'repository-defined',
      'Paper requires physiology and safety-net behavior; illness, upkeep and timing parameters are repository-defined.',
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
