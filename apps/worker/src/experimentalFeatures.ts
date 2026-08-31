import {
  aivilizationSocialMattersPolicyDefaults,
  aivilizationTownBulletinPolicyDefaults,
  aivilizationTownCalendarPolicyDefaults,
  aivilizationTownConditionsPolicyDefaults,
  aivilizationCollectiveActionPolicyDefaults,
  aivilizationOutMigrationPolicyDefaults,
  aivilizationRenewableResourcePolicyDefaults,
  aivilizationTownConflictPolicyDefaults,
  aivilizationTownDiscoursePolicyDefaults,
  aivilizationTownLifecyclePolicyDefaults,
  aivilizationTownWeatherPolicyDefaults,
  aivilizationTownServiceQualityPolicyDefaults,
  aivilizationTownGovernancePolicyDefaults,
  aivilizationSurvivalTimePolicyDefaults,
  aivilizationTownWellbeingPolicyDefaults,
  aivilizationHousingConstructionPolicyDefaults,
  aivilizationResidentialAssignmentPolicyDefaults,
} from '@aivilization/content';
import {
  assertValidRenewableResourcePolicy,
  type RenewableResourcePolicy,
} from '@aivilization/economy';
import {
  assertTownConditionsPolicy,
  assertValidCollectiveActionPolicy,
  assertValidLifecyclePolicy,
  assertValidOutMigrationPolicy,
  assertValidTownCalendarPolicy,
  assertValidTownDiscoursePolicy,
  assertValidWellbeingPolicy,
  assertValidServiceQualityPolicy,
  assertValidTownGovernancePolicy,
  assertValidStarvationHealthDecayPolicy,
  type CollectiveActionPolicy,
  type LifecyclePolicy,
  type OutMigrationPolicy,
  type TownDiscoursePolicy,
  type TownCalendarPolicy,
  type TownConditionsPolicy,
  type WellbeingPolicy,
  type ServiceQualityPolicy,
  type TownGovernancePolicy,
  type StarvationHealthDecayPolicy,
  assertValidHousingConstructionPolicy,
  type HousingConstructionPolicy,
  assertValidResidentialAssignmentPolicy,
  type ResidentialAssignmentPolicy,
} from '@aivilization/society';
import {
  assertTownWeatherPolicy,
  type SocialMattersPolicy,
  type TownBulletinPolicy,
  type TownConflictPolicy,
  type TownWeatherPolicy,
  type WorldCommandPolicies,
} from '@aivilization/world';

export type AivilizationExperimentalFeatureKey =
  | 'townWeather'
  | 'townConditions'
  | 'townBulletin'
  | 'socialMatters'
  | 'townConflict'
  | 'townWellbeing'
  | 'townCalendar'
  | 'townLifecycle'
  | 'townDiscourse'
  | 'townCollectiveAction'
  | 'townMigration'
  | 'townServiceQuality'
  | 'townGovernance'
  | 'townSurvivalPressure'
  | 'townCarryingCapacity'
  | 'townConstruction';

/**
 * One registration row per opt-in experimental feature. CLI flag/env parsing,
 * the resolved-run-manifest policy declaration, the provenance registry, and
 * the command-policies factory are all driven from this table — adding a
 * feature means adding one row here (plus its policy defaults in content, its
 * settlement wiring, and a runtime.env.example comment).
 */
export type AivilizationExperimentalFeatureSpec = {
  /** camelCase key shared by the CLI option, manifest input, and switches. */
  readonly key: AivilizationExperimentalFeatureKey;
  readonly policyVersion: string;
  readonly cliFlag: string;
  readonly envVar: string;
  /** One-line help label for the flag row. */
  readonly helpTitle: string;
  /** Help paragraph lines, verbatim. */
  readonly helpLines: readonly string[];
  /** Provenance registry source blurb. */
  readonly registrySource: string;
  /** Deep-copied manifest parameters chunk for this feature. */
  readonly createManifestParameters: () => Record<string, unknown>;
  /**
   * Adds the feature's policy to the world command policies. Undefined for
   * authority-scoped features (town weather settles only on the
   * simulation-wide authority so partition-local advances never run divergent
   * weather chains) — those are injected by the authority instead.
   */
  readonly withCommandPolicy?: (policies: WorldCommandPolicies) => WorldCommandPolicies;
};

export function createAivilizationTownWeatherPolicy(): TownWeatherPolicy {
  const policy: TownWeatherPolicy = {
    policyVersion: aivilizationTownWeatherPolicyDefaults.policyVersion,
    initialWeather: aivilizationTownWeatherPolicyDefaults.initialWeather,
    transitionCadenceMs: aivilizationTownWeatherPolicyDefaults.transitionCadenceMs,
    transitions: aivilizationTownWeatherPolicyDefaults.transitions,
  };
  assertTownWeatherPolicy(policy);
  return policy;
}

export function createAivilizationTownServiceQualityPolicy(): ServiceQualityPolicy {
  const policy: ServiceQualityPolicy = {
    policyVersion: aivilizationTownServiceQualityPolicyDefaults.policyVersion,
    cadenceMs: aivilizationTownServiceQualityPolicyDefaults.cadenceMs,
    services: {
      education: { ...aivilizationTownServiceQualityPolicyDefaults.services.education },
      healthcare: { ...aivilizationTownServiceQualityPolicyDefaults.services.healthcare },
    },
    landValueWeight: aivilizationTownServiceQualityPolicyDefaults.landValueWeight,
    wellbeingPenaltyAtZeroQuality:
      aivilizationTownServiceQualityPolicyDefaults.wellbeingPenaltyAtZeroQuality,
  };
  assertValidServiceQualityPolicy(policy);
  return policy;
}

export function createAivilizationTownGovernancePolicy(): TownGovernancePolicy {
  const policy: TownGovernancePolicy = {
    policyVersion: aivilizationTownGovernancePolicyDefaults.policyVersion,
    allowedBudgetServices: [...aivilizationTownGovernancePolicyDefaults.allowedBudgetServices],
    maximumAllocationPerCadence:
      aivilizationTownGovernancePolicyDefaults.maximumAllocationPerCadence,
    maximumTreasuryReserve: aivilizationTownGovernancePolicyDefaults.maximumTreasuryReserve,
    maximumSubsidyBalanceFloor: aivilizationTownGovernancePolicyDefaults.maximumSubsidyBalanceFloor,
    maximumSubsidyPerCadence: aivilizationTownGovernancePolicyDefaults.maximumSubsidyPerCadence,
    source: aivilizationTownGovernancePolicyDefaults.source,
  };
  assertValidTownGovernancePolicy(policy);
  return policy;
}

export function createAivilizationStarvationHealthDecayPolicy(): StarvationHealthDecayPolicy {
  const policy: StarvationHealthDecayPolicy = {
    ...aivilizationSurvivalTimePolicyDefaults.starvation,
  };
  assertValidStarvationHealthDecayPolicy(policy);
  return policy;
}

export function createAivilizationRenewableResourcePolicy(): RenewableResourcePolicy {
  const policy: RenewableResourcePolicy = {
    policyVersion: aivilizationRenewableResourcePolicyDefaults.policyVersion,
    regenerationCadenceMs: aivilizationRenewableResourcePolicyDefaults.regenerationCadenceMs,
    resources: aivilizationRenewableResourcePolicyDefaults.resources.map((resource) => ({
      ...resource,
    })),
    source: aivilizationRenewableResourcePolicyDefaults.source,
  };
  assertValidRenewableResourcePolicy(policy);
  return policy;
}

export function createAivilizationTownConditionsPolicy(): TownConditionsPolicy {
  const policy: TownConditionsPolicy = {
    policyVersion: aivilizationTownConditionsPolicyDefaults.policyVersion,
    soaked: {
      outdoorSeverityByWeather: {
        ...aivilizationTownConditionsPolicyDefaults.soaked.outdoorSeverityByWeather,
      },
      need: aivilizationTownConditionsPolicyDefaults.soaked.need,
    },
    cold: {
      outdoorSeverityByWeather: {
        ...aivilizationTownConditionsPolicyDefaults.cold.outdoorSeverityByWeather,
      },
      shelteredSeverity: aivilizationTownConditionsPolicyDefaults.cold.shelteredSeverity,
      shelteredMaxResidentialTier:
        aivilizationTownConditionsPolicyDefaults.cold.shelteredMaxResidentialTier,
      need: aivilizationTownConditionsPolicyDefaults.cold.need,
    },
    overtired: { ...aivilizationTownConditionsPolicyDefaults.overtired },
    hungry: { ...aivilizationTownConditionsPolicyDefaults.hungry },
    stressed: { ...aivilizationTownConditionsPolicyDefaults.stressed },
  };
  assertTownConditionsPolicy(policy);
  return policy;
}

export function createAivilizationTownBulletinPolicy(): TownBulletinPolicy {
  return {
    policyVersion: aivilizationTownBulletinPolicyDefaults.policyVersion,
    highPriorityIntentionPriority:
      aivilizationTownBulletinPolicyDefaults.highPriorityIntentionPriority,
    highPriorityReactionWindowMs:
      aivilizationTownBulletinPolicyDefaults.highPriorityReactionWindowMs,
  };
}

export function createAivilizationSocialMattersPolicy(): SocialMattersPolicy {
  return {
    policyVersion: aivilizationSocialMattersPolicyDefaults.policyVersion,
    defaultExpiryMs: aivilizationSocialMattersPolicyDefaults.defaultExpiryMs,
  };
}

export function createAivilizationTownConflictPolicy(): TownConflictPolicy {
  return {
    policyVersion: aivilizationTownConflictPolicyDefaults.policyVersion,
    grievanceRelationThreshold: aivilizationTownConflictPolicyDefaults.grievanceRelationThreshold,
    baseDamage: aivilizationTownConflictPolicyDefaults.baseDamage,
    attackerEnergyDamageFactor: aivilizationTownConflictPolicyDefaults.attackerEnergyDamageFactor,
    targetEnergyDefenseFactor: aivilizationTownConflictPolicyDefaults.targetEnergyDefenseFactor,
    minDamage: aivilizationTownConflictPolicyDefaults.minDamage,
    maxDamage: aivilizationTownConflictPolicyDefaults.maxDamage,
    attackerEnergyCost: aivilizationTownConflictPolicyDefaults.attackerEnergyCost,
    minHealthAfterAttack: aivilizationTownConflictPolicyDefaults.minHealthAfterAttack,
    witnessAttitudePenaltyScale: aivilizationTownConflictPolicyDefaults.witnessAttitudePenaltyScale,
    ...(aivilizationTownConflictPolicyDefaults.wellbeingGrievanceShift === undefined
      ? {}
      : {
          wellbeingGrievanceShift: {
            ...aivilizationTownConflictPolicyDefaults.wellbeingGrievanceShift,
          },
        }),
  };
}

export function createAivilizationTownWellbeingPolicy(): WellbeingPolicy {
  const policy: WellbeingPolicy = {
    policyVersion: aivilizationTownWellbeingPolicyDefaults.policyVersion,
    initialValue: aivilizationTownWellbeingPolicyDefaults.initialValue,
    minValue: aivilizationTownWellbeingPolicyDefaults.minValue,
    maxValue: aivilizationTownWellbeingPolicyDefaults.maxValue,
    baseline: aivilizationTownWellbeingPolicyDefaults.baseline,
    convergencePerHour: aivilizationTownWellbeingPolicyDefaults.convergencePerHour,
    coefficients: {
      ...aivilizationTownWellbeingPolicyDefaults.coefficients,
      residentialTier: [...aivilizationTownWellbeingPolicyDefaults.coefficients.residentialTier],
      lifestyleTier: [...aivilizationTownWellbeingPolicyDefaults.coefficients.lifestyleTier],
    },
  };
  assertValidWellbeingPolicy(policy);
  return policy;
}

export function createAivilizationHousingConstructionPolicy(): HousingConstructionPolicy {
  const policy: HousingConstructionPolicy = {
    policyVersion: aivilizationHousingConstructionPolicyDefaults.policyVersion,
    minimumOccupancyRatio: aivilizationHousingConstructionPolicyDefaults.minimumOccupancyRatio,
    capacityPerProject: aivilizationHousingConstructionPolicyDefaults.capacityPerProject,
    maximumLocationCapacity: aivilizationHousingConstructionPolicyDefaults.maximumLocationCapacity,
    inventoryCosts: { ...aivilizationHousingConstructionPolicyDefaults.inventoryCosts },
    builderSelection: aivilizationHousingConstructionPolicyDefaults.builderSelection,
    locationSelection: aivilizationHousingConstructionPolicyDefaults.locationSelection,
  };
  assertValidHousingConstructionPolicy(policy);
  return policy;
}

export function createAivilizationResidentialAssignmentPolicy(): ResidentialAssignmentPolicy {
  const policy: ResidentialAssignmentPolicy = {
    policyVersion: aivilizationResidentialAssignmentPolicyDefaults.policyVersion,
    arrivalSelection: aivilizationResidentialAssignmentPolicyDefaults.arrivalSelection,
  };
  assertValidResidentialAssignmentPolicy(policy);
  return policy;
}

export function createAivilizationTownCalendarPolicy(): TownCalendarPolicy {
  const policy: TownCalendarPolicy = {
    policyVersion: aivilizationTownCalendarPolicyDefaults.policyVersion,
    dayLengthMs: aivilizationTownCalendarPolicyDefaults.dayLengthMs,
    phases: aivilizationTownCalendarPolicyDefaults.phases.map((phase) => ({ ...phase })),
    physiologicalDecay: { ...aivilizationTownCalendarPolicyDefaults.physiologicalDecay },
  };
  assertValidTownCalendarPolicy(policy);
  return policy;
}

export function createAivilizationOutMigrationPolicy(): OutMigrationPolicy {
  const policy: OutMigrationPolicy = {
    policyVersion: aivilizationOutMigrationPolicyDefaults.policyVersion,
    maxProbabilityPerHour: aivilizationOutMigrationPolicyDefaults.maxProbabilityPerHour,
    fallbackWellbeing: aivilizationOutMigrationPolicyDefaults.fallbackWellbeing,
    settlementCadenceMs: aivilizationOutMigrationPolicyDefaults.settlementCadenceMs,
    inMigration: { ...aivilizationOutMigrationPolicyDefaults.inMigration },
  };
  assertValidOutMigrationPolicy(policy);
  return policy;
}

export function createAivilizationCollectiveActionPolicy(): CollectiveActionPolicy {
  const policy: CollectiveActionPolicy = {
    policyVersion: aivilizationCollectiveActionPolicyDefaults.policyVersion,
    petitionSignatureThreshold:
      aivilizationCollectiveActionPolicyDefaults.petitionSignatureThreshold,
    petitionExpiryMs: aivilizationCollectiveActionPolicyDefaults.petitionExpiryMs,
  };
  assertValidCollectiveActionPolicy(policy);
  return policy;
}

export function createAivilizationTownDiscoursePolicy(): TownDiscoursePolicy {
  const policy: TownDiscoursePolicy = {
    policyVersion: aivilizationTownDiscoursePolicyDefaults.policyVersion,
    propagationProbabilityPercent:
      aivilizationTownDiscoursePolicyDefaults.propagationProbabilityPercent,
    importanceMultiplierRange: [
      ...aivilizationTownDiscoursePolicyDefaults.importanceMultiplierRange,
    ] as [number, number],
    maxChainDepth: aivilizationTownDiscoursePolicyDefaults.maxChainDepth,
  };
  assertValidTownDiscoursePolicy(policy);
  return policy;
}

export function createAivilizationTownLifecyclePolicy(): LifecyclePolicy {
  const policy: LifecyclePolicy = {
    policyVersion: aivilizationTownLifecyclePolicyDefaults.policyVersion,
    dayLengthMs: aivilizationTownLifecyclePolicyDefaults.dayLengthMs,
    stageThresholdsDays: { ...aivilizationTownLifecyclePolicyDefaults.stageThresholdsDays },
    minLifespanDays: aivilizationTownLifecyclePolicyDefaults.minLifespanDays,
    maxLifespanDays: aivilizationTownLifecyclePolicyDefaults.maxLifespanDays,
    illnessDeathHealthThreshold:
      aivilizationTownLifecyclePolicyDefaults.illnessDeathHealthThreshold,
    illnessDeathProbabilityPerSettlementScale:
      aivilizationTownLifecyclePolicyDefaults.illnessDeathProbabilityPerSettlementScale,
    pensionPerHour: aivilizationTownLifecyclePolicyDefaults.pensionPerHour,
    settlementCadenceMs: aivilizationTownLifecyclePolicyDefaults.settlementCadenceMs,
  };
  assertValidLifecyclePolicy(policy);
  return policy;
}

export const AIVILIZATION_EXPERIMENTAL_FEATURE_SPECS: readonly AivilizationExperimentalFeatureSpec[] =
  [
    {
      key: 'townSurvivalPressure',
      policyVersion: aivilizationSurvivalTimePolicyDefaults.starvation.policyVersion,
      cliFlag: '--town-survival-pressure',
      envVar: 'AIVILIZATION_TOWN_SURVIVAL_PRESSURE',
      helpTitle: 'Satiety-driven starvation health pressure and death',
      helpLines: [
        'Survival pressure is a repository-specific extension: pass',
        '--town-survival-pressure or AIVILIZATION_TOWN_SURVIVAL_PRESSURE=1 to make sustained',
        'satiety deficits reduce health on a deterministic cadence and eventually cause an',
        'auditable starvation death with normal estate liquidation. Disabled by default.',
      ],
      registrySource:
        'Starvation health pressure is repository-defined to close the food-access → physiology → mortality survival loop; cadence, threshold, and damage rate are versioned.',
      createManifestParameters: () => ({
        ...aivilizationSurvivalTimePolicyDefaults.starvation,
      }),
      withCommandPolicy: (policies) => ({
        ...policies,
        starvation: createAivilizationStarvationHealthDecayPolicy(),
      }),
    },
    {
      key: 'townCarryingCapacity',
      policyVersion: aivilizationRenewableResourcePolicyDefaults.policyVersion,
      cliFlag: '--town-carrying-capacity',
      envVar: 'AIVILIZATION_TOWN_CARRYING_CAPACITY',
      helpTitle: 'Finite renewable stocks for zero-input primary production',
      helpLines: [
        'Town carrying capacity is a repository-specific survival experiment: pass',
        '--town-carrying-capacity or AIVILIZATION_TOWN_CARRYING_CAPACITY=1 to constrain',
        'primary production by finite regional stocks with deterministic regeneration.',
        'The feature disables inventory-creating physiological grants until welfare can',
        'procure real goods. It currently requires a single-partition profile.',
      ],
      registrySource:
        'Renewable stocks close the natural resource → production → food access loop; direct inventory grants are removed so every food unit has a replayable source.',
      createManifestParameters: () => ({
        ...aivilizationRenewableResourcePolicyDefaults,
        resources: aivilizationRenewableResourcePolicyDefaults.resources.map((resource) => ({
          ...resource,
        })),
        welfareInventoryRule: 'no-unfunded-inventory-grants',
        partitionScope: 'single-partition-v1',
      }),
      withCommandPolicy: (policies) => ({
        ...policies,
        renewableResources: createAivilizationRenewableResourcePolicy(),
      }),
    },
    {
      key: 'townWeather',
      policyVersion: aivilizationTownWeatherPolicyDefaults.policyVersion,
      cliFlag: '--town-weather',
      envVar: 'AIVILIZATION_TOWN_WEATHER',
      helpTitle: 'Authoritative town weather Markov chain',
      helpLines: [
        'Town weather is a repository-specific extension (not a paper mechanism): pass',
        '--town-weather on or AIVILIZATION_TOWN_WEATHER=1 to let the simulation-wide authority',
        'settle the town-weather-v2 boundary-replayable Markov chain during time advancement. Disabled by default.',
      ],
      registrySource:
        'Authoritative town weather is not a paper mechanism; states, matrix, and cadence are repository-defined.',
      createManifestParameters: () => ({
        ...aivilizationTownWeatherPolicyDefaults,
        transitions: Object.fromEntries(
          Object.entries(aivilizationTownWeatherPolicyDefaults.transitions).map(([from, row]) => [
            from,
            { ...row },
          ]),
        ),
      }),
      // Authority-scoped (no withCommandPolicy): injected by the
      // simulation-wide authority, never by the shared policies factory
      // (per-partition weather chains would diverge).
    },
    {
      key: 'townServiceQuality',
      policyVersion: aivilizationTownServiceQualityPolicyDefaults.policyVersion,
      cliFlag: '--town-service-quality',
      envVar: 'AIVILIZATION_TOWN_SERVICE_QUALITY',
      helpTitle: 'Budget- and occupancy-driven public service quality',
      helpLines: [
        'Public service quality is a repository-specific extension: pass',
        '--town-service-quality or AIVILIZATION_TOWN_SERVICE_QUALITY=1 to settle regional',
        'education/healthcare quality from actual public funding and facility occupancy.',
        'The quality affects study, treatment, wellbeing, and land value. Disabled by default.',
      ],
      registrySource:
        'Service quality is repository-defined from the CS2 budget-to-efficiency benchmark; cadence, pressure threshold, quality floor, and feedback weights are versioned.',
      createManifestParameters: () => ({
        ...aivilizationTownServiceQualityPolicyDefaults,
        services: {
          education: { ...aivilizationTownServiceQualityPolicyDefaults.services.education },
          healthcare: { ...aivilizationTownServiceQualityPolicyDefaults.services.healthcare },
        },
      }),
      // Authority-scoped: partition-local occupancy is incomplete.
    },
    {
      key: 'townGovernance',
      policyVersion: aivilizationTownGovernancePolicyDefaults.policyVersion,
      cliFlag: '--town-governance',
      envVar: 'AIVILIZATION_TOWN_GOVERNANCE',
      helpTitle: 'Town tax, public-budget, and subsidy governance commands',
      helpLines: [
        'Town governance is a repository-specific extension: pass --town-governance or',
        'AIVILIZATION_TOWN_GOVERNANCE=1 to let operators enact town policies directly and',
        'residents enact one policy through a matching threshold-reaching petition.',
        'Every change is revisioned, replayable, and bounded. Disabled by default.',
      ],
      registrySource:
        'Town governance authorization, petition consumption, revisioning, and policy bounds are repository-defined (CS2 fiscal-control benchmark).',
      createManifestParameters: () => ({
        ...aivilizationTownGovernancePolicyDefaults,
        allowedBudgetServices: [...aivilizationTownGovernancePolicyDefaults.allowedBudgetServices],
      }),
      withCommandPolicy: (policies) => ({
        ...policies,
        governance: createAivilizationTownGovernancePolicy(),
      }),
    },
    {
      key: 'townConditions',
      policyVersion: aivilizationTownConditionsPolicyDefaults.policyVersion,
      cliFlag: '--town-conditions',
      envVar: 'AIVILIZATION_TOWN_CONDITIONS',
      helpTitle: 'Derived agent condition catalog',
      helpLines: [
        'Town conditions are a repository-specific extension (not a paper mechanism): pass',
        '--town-conditions on or AIVILIZATION_TOWN_CONDITIONS=1 to derive the town-conditions-v1',
        'catalog into planning contexts and the society projection. Disabled by default.',
      ],
      registrySource:
        'The town condition catalog is not a paper mechanism; conditions, thresholds, and implied needs are repository-defined.',
      createManifestParameters: () => ({
        ...aivilizationTownConditionsPolicyDefaults,
        soaked: {
          ...aivilizationTownConditionsPolicyDefaults.soaked,
          outdoorSeverityByWeather: {
            ...aivilizationTownConditionsPolicyDefaults.soaked.outdoorSeverityByWeather,
          },
        },
        cold: {
          ...aivilizationTownConditionsPolicyDefaults.cold,
          outdoorSeverityByWeather: {
            ...aivilizationTownConditionsPolicyDefaults.cold.outdoorSeverityByWeather,
          },
        },
        overtired: { ...aivilizationTownConditionsPolicyDefaults.overtired },
        hungry: { ...aivilizationTownConditionsPolicyDefaults.hungry },
        stressed: { ...aivilizationTownConditionsPolicyDefaults.stressed },
      }),
      withCommandPolicy: (policies) => ({
        ...policies,
        conditions: createAivilizationTownConditionsPolicy(),
      }),
    },
    {
      key: 'townBulletin',
      policyVersion: aivilizationTownBulletinPolicyDefaults.policyVersion,
      cliFlag: '--town-bulletin',
      envVar: 'AIVILIZATION_TOWN_BULLETIN',
      helpTitle: 'Authoritative town bulletin board',
      helpLines: [
        'The town bulletin board is a repository-specific extension (not a paper mechanism): pass',
        '--town-bulletin on or AIVILIZATION_TOWN_BULLETIN=1 to let agents post and operators issue',
        'town bulletins against the authoritative board. Disabled by default.',
      ],
      registrySource:
        'The town bulletin board is not a paper mechanism; priority and preemption parameters are repository-defined.',
      createManifestParameters: () => ({ ...aivilizationTownBulletinPolicyDefaults }),
      withCommandPolicy: (policies) => ({
        ...policies,
        bulletin: createAivilizationTownBulletinPolicy(),
      }),
    },
    {
      key: 'socialMatters',
      policyVersion: aivilizationSocialMattersPolicyDefaults.policyVersion,
      cliFlag: '--social-matters',
      envVar: 'AIVILIZATION_SOCIAL_MATTERS',
      helpTitle: 'Social matters state machine',
      helpLines: [
        'Social matters are a repository-specific extension (not a paper mechanism): pass',
        '--social-matters on or AIVILIZATION_SOCIAL_MATTERS=1 to escalate commitments into the',
        'town-matter state machine with world-verified fulfillment. Disabled by default.',
      ],
      registrySource:
        'The social matters state machine is not a paper mechanism; lifecycle and expiry parameters are repository-defined.',
      createManifestParameters: () => ({ ...aivilizationSocialMattersPolicyDefaults }),
      withCommandPolicy: (policies) => ({
        ...policies,
        socialMatters: createAivilizationSocialMattersPolicy(),
      }),
    },
    {
      key: 'townConflict',
      policyVersion: aivilizationTownConflictPolicyDefaults.policyVersion,
      cliFlag: '--town-conflict',
      envVar: 'AIVILIZATION_TOWN_CONFLICT',
      helpTitle: 'Conflict system (confront/attack/intervene)',
      helpLines: [
        'The conflict system is a repository-specific extension (not a paper mechanism): pass',
        '--town-conflict on or AIVILIZATION_TOWN_CONFLICT=1 to enable confront/attack/intervene',
        'with world-issued grievances and deterministic damage. Disabled by default.',
      ],
      registrySource:
        'The conflict system is not a paper mechanism; grievance and damage parameters are repository-defined.',
      createManifestParameters: () => ({ ...aivilizationTownConflictPolicyDefaults }),
      withCommandPolicy: (policies) => ({
        ...policies,
        conflict: createAivilizationTownConflictPolicy(),
      }),
    },
    {
      key: 'townWellbeing',
      policyVersion: aivilizationTownWellbeingPolicyDefaults.policyVersion,
      cliFlag: '--town-wellbeing',
      envVar: 'AIVILIZATION_TOWN_WELLBEING',
      helpTitle: 'Authoritative agent wellbeing state variable',
      helpLines: [
        'Agent wellbeing is a repository-specific extension (not a paper mechanism): pass',
        '--town-wellbeing on or AIVILIZATION_TOWN_WELLBEING=1 to settle the durable per-agent',
        'town-wellbeing-v1 scalar during time advancement and expose it in planning contexts.',
        'Disabled by default.',
      ],
      registrySource:
        'The agent wellbeing state variable is not a paper mechanism; baseline, convergence, and factor coefficients are repository-defined (CS2 Happiness benchmark).',
      createManifestParameters: () => ({
        ...aivilizationTownWellbeingPolicyDefaults,
        coefficients: {
          ...aivilizationTownWellbeingPolicyDefaults.coefficients,
          residentialTier: [
            ...aivilizationTownWellbeingPolicyDefaults.coefficients.residentialTier,
          ],
          lifestyleTier: [...aivilizationTownWellbeingPolicyDefaults.coefficients.lifestyleTier],
        },
      }),
      withCommandPolicy: (policies) => ({
        ...policies,
        wellbeing: createAivilizationTownWellbeingPolicy(),
      }),
    },
    {
      key: 'townCalendar',
      policyVersion: aivilizationTownCalendarPolicyDefaults.policyVersion,
      cliFlag: '--town-calendar',
      envVar: 'AIVILIZATION_TOWN_CALENDAR',
      helpTitle: 'Town day/night calendar and passive physiological decay',
      helpLines: [
        'The town calendar is a repository-specific extension (not a paper mechanism): pass',
        '--town-calendar on or AIVILIZATION_TOWN_CALENDAR=1 to settle the town-calendar-v1',
        'day/night phase events and the passive energy/satiety decay during time advancement.',
        'Phases are a pure function of the simulation clock and policy, so every partition',
        'derives identical results. Disabled by default.',
      ],
      registrySource:
        'The town calendar is not a paper mechanism; day length, phase boundaries, and decay rates are repository-defined (CS2 daily-cycle benchmark).',
      createManifestParameters: () => ({
        ...aivilizationTownCalendarPolicyDefaults,
        phases: aivilizationTownCalendarPolicyDefaults.phases.map((phase) => ({ ...phase })),
        physiologicalDecay: { ...aivilizationTownCalendarPolicyDefaults.physiologicalDecay },
      }),
      withCommandPolicy: (policies) => ({
        ...policies,
        calendar: createAivilizationTownCalendarPolicy(),
      }),
    },
    {
      key: 'townLifecycle',
      policyVersion: aivilizationTownLifecyclePolicyDefaults.policyVersion,
      cliFlag: '--town-lifecycle',
      envVar: 'AIVILIZATION_TOWN_LIFECYCLE',
      helpTitle: 'Population lifecycle: aging, retirement, death, and pension',
      helpLines: [
        'The town lifecycle is a repository-specific extension (not a paper mechanism): pass',
        '--town-lifecycle on or AIVILIZATION_TOWN_LIFECYCLE=1 to settle the town-lifecycle-v2',
        'stage transitions, forced retirement with a treasury-funded pension, and pre-rolled',
        'lifespan or illness deaths during time advancement. Deaths liquidate the estate:',
        'enterprise jobs released, loans written off, deposits forfeited, and the circulating',
        'balance burned out of the money supply. Disabled by default.',
      ],
      registrySource:
        'The town lifecycle is not a paper mechanism; stage thresholds, lifespan window, illness-death risk, and pension rate are repository-defined (CS2 citizen-lifecycle benchmark).',
      createManifestParameters: () => ({
        ...aivilizationTownLifecyclePolicyDefaults,
        stageThresholdsDays: { ...aivilizationTownLifecyclePolicyDefaults.stageThresholdsDays },
      }),
      withCommandPolicy: (policies) => ({
        ...policies,
        lifecycle: createAivilizationTownLifecyclePolicy(),
      }),
    },
    {
      key: 'townDiscourse',
      policyVersion: aivilizationTownDiscoursePolicyDefaults.policyVersion,
      cliFlag: '--town-discourse',
      envVar: 'AIVILIZATION_TOWN_DISCOURSE',
      helpTitle: 'Hearsay memory propagation over conversations',
      helpLines: [
        'The town discourse propagation is a repository-specific extension (not a paper',
        'mechanism): pass --town-discourse on or AIVILIZATION_TOWN_DISCOURSE=1 so each',
        "conversation direction can carry one of the speaker's recent memories to the",
        'listener as a hearsay copy with a deterministically distorted importance and a',
        'bounded re-share chain depth. Rolls are seeded per command and direction, so',
        'replays derive identical copies. Disabled by default.',
      ],
      registrySource:
        'The town discourse propagation is not a paper mechanism; propagation probability, distortion range, and chain depth are repository-defined (AI-native mechanism with no CS2 counterpart).',
      createManifestParameters: () => ({
        ...aivilizationTownDiscoursePolicyDefaults,
        importanceMultiplierRange: [
          ...aivilizationTownDiscoursePolicyDefaults.importanceMultiplierRange,
        ] as [number, number],
      }),
      withCommandPolicy: (policies) => ({
        ...policies,
        discourse: createAivilizationTownDiscoursePolicy(),
      }),
    },
    {
      key: 'townCollectiveAction',
      policyVersion: aivilizationCollectiveActionPolicyDefaults.policyVersion,
      cliFlag: '--town-collective-action',
      envVar: 'AIVILIZATION_TOWN_COLLECTIVE_ACTION',
      helpTitle: 'Petition collective action: raise, sign, threshold',
      helpLines: [
        'The petition collective action is a repository-specific extension (not a paper',
        'mechanism): pass --town-collective-action on or',
        'AIVILIZATION_TOWN_COLLECTIVE_ACTION=1 to let agents raise and sign town',
        'petitions. Signatures aggregate on the simulation-wide authority; crossing the',
        'threshold (default 3, raiser included) fires a town-wide',
        'PetitionThresholdReached for observability and future governance inputs.',
        'Open petitions expire after 3 simulation days. Disabled by default.',
      ],
      registrySource:
        'The petition collective action is not a paper mechanism; threshold and expiry are repository-defined (AI-native mechanism with no CS2 counterpart).',
      createManifestParameters: () => ({
        ...aivilizationCollectiveActionPolicyDefaults,
      }),
      withCommandPolicy: (policies) => ({
        ...policies,
        collectiveAction: createAivilizationCollectiveActionPolicy(),
      }),
    },
    {
      key: 'townConstruction',
      policyVersion: aivilizationHousingConstructionPolicyDefaults.policyVersion,
      cliFlag: '--town-construction',
      envVar: 'AIVILIZATION_TOWN_CONSTRUCTION',
      helpTitle: 'Material-backed residential construction',
      helpLines: [
        'Housing construction is a repository-specific extension: pass',
        '--town-construction on or AIVILIZATION_TOWN_CONSTRUCTION=1 to let one',
        'eligible resident consume real construction inventory and expand finite',
        'residential capacity when town-wide occupancy reaches the policy threshold.',
        'Construction settles on the simulation-wide authority and is disabled by default.',
      ],
      registrySource:
        'Housing construction is not a paper mechanism; material cost, demand threshold, project size, and capacity ceiling are repository-defined (CS2 zone/building supply-loop benchmark).',
      createManifestParameters: () => ({
        ...aivilizationHousingConstructionPolicyDefaults,
        inventoryCosts: { ...aivilizationHousingConstructionPolicyDefaults.inventoryCosts },
        residentialAssignment: { ...aivilizationResidentialAssignmentPolicyDefaults },
      }),
      withCommandPolicy: (policies) => ({
        ...policies,
        housingConstruction: createAivilizationHousingConstructionPolicy(),
        residentialAssignment: createAivilizationResidentialAssignmentPolicy(),
      }),
    },
    {
      key: 'townMigration',
      policyVersion: aivilizationOutMigrationPolicyDefaults.policyVersion,
      cliFlag: '--town-migration',
      envVar: 'AIVILIZATION_TOWN_MIGRATION',
      helpTitle: 'Two-way migration: wellbeing departures and demand-driven arrivals',
      helpLines: [
        'Population flow is a repository-specific extension (not a paper mechanism): pass',
        '--town-migration on or AIVILIZATION_TOWN_MIGRATION=1 to roll the CS2 NotHappy',
        'departure rule per agent and cadence — persistently unhappy agents leave town',
        'with the full estate liquidation (jobs released, loans written off, deposits',
        'forfeited, currency burned out of the town economy). The probability follows',
        'the CS2 polynomial of happiness, zero near wellbeing 48, capped at 1%/h.',
        'Runs without --town-wellbeing keep out-migration off (fallback wellbeing 50).',
        'The authority evaluates housing vacancy, open jobs, and average wellbeing once',
        'per simulation day and admits at most two residents into real housing capacity.',
        'Disabled by default.',
      ],
      registrySource:
        'Migration is not a paper mechanism; departure shape, demand weights, housing cap, and cadence are repository-defined (CS2 population-flow benchmark).',
      createManifestParameters: () => ({
        ...aivilizationOutMigrationPolicyDefaults,
        inMigration: { ...aivilizationOutMigrationPolicyDefaults.inMigration },
        residentialAssignment: { ...aivilizationResidentialAssignmentPolicyDefaults },
      }),
      withCommandPolicy: (policies) => ({
        ...policies,
        migration: createAivilizationOutMigrationPolicy(),
        residentialAssignment: createAivilizationResidentialAssignmentPolicy(),
      }),
    },
  ];
