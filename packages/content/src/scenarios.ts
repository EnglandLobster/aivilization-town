import {
  asAgentId,
  type AgentId,
  type LocationId,
  type SimulationClock,
} from '@aivilization/sim-core';
import { commodities } from './commodities';
import { townLocations, type TownLocationConfig } from './locations';

export type MbtiType =
  | 'INTJ'
  | 'INTP'
  | 'ENTJ'
  | 'ENTP'
  | 'INFJ'
  | 'INFP'
  | 'ENFJ'
  | 'ENFP'
  | 'ISTJ'
  | 'ISFJ'
  | 'ESTJ'
  | 'ESFJ'
  | 'ISTP'
  | 'ISFP'
  | 'ESTP'
  | 'ESFP';

export type ScenarioPhysiologySeed = {
  readonly energy: number;
  readonly satiety: number;
  readonly health: number;
};

export type ScenarioResidentialPhysiologyCapConfig = {
  readonly residentialTier: number;
  readonly maxEnergy: number;
  readonly maxSatiety: number;
  readonly maxHealth: number;
  readonly source: string;
};

export type ScenarioSleepDeprivationPolicyConfig = {
  readonly energyThreshold: number;
  readonly healthDecayPerSecond: number;
  readonly minHealth: number;
  readonly source: string;
};

export type ScenarioStochasticIllnessPolicyConfig = {
  readonly illnessProbabilityPercentPerHour: number;
  readonly healthDamage: number;
  readonly minHealth: number;
  readonly source: string;
};

export type ScenarioTownWeatherKind =
  | 'sunny'
  | 'cloudy'
  | 'windy'
  | 'rainy'
  | 'stormy'
  | 'snowy'
  | 'foggy';

export type ScenarioTownWeatherTransitionMatrix = Readonly<
  Record<ScenarioTownWeatherKind, Readonly<Record<ScenarioTownWeatherKind, number>>>
>;

export type ScenarioTownWeatherPolicyConfig = {
  readonly policyVersion: string;
  readonly initialWeather: ScenarioTownWeatherKind;
  readonly transitionCadenceMs: number;
  readonly transitions: ScenarioTownWeatherTransitionMatrix;
  readonly source: string;
};

export type ScenarioTownConditionSeverity = 'mild' | 'moderate' | 'severe';

export type ScenarioTownConditionNeed = 'eat' | 'sleep' | 'shelter' | 'warm-up' | 'see-doctor';

export type ScenarioTownPhysiologyConditionConfig = {
  readonly triggerBelow: number;
  readonly severeBelow: number;
  readonly need: ScenarioTownConditionNeed;
};

export type ScenarioTownWeatherConditionConfig = {
  readonly outdoorSeverityByWeather: Readonly<
    Record<string, ScenarioTownConditionSeverity>
  >;
  readonly shelteredSeverity?: ScenarioTownConditionSeverity;
  readonly shelteredMaxResidentialTier?: number;
  readonly need: ScenarioTownConditionNeed;
};

export type ScenarioTownConditionsPolicyConfig = {
  readonly policyVersion: string;
  readonly soaked: ScenarioTownWeatherConditionConfig;
  readonly cold: ScenarioTownWeatherConditionConfig;
  readonly overtired: ScenarioTownPhysiologyConditionConfig;
  readonly hungry: ScenarioTownPhysiologyConditionConfig;
  readonly stressed: ScenarioTownPhysiologyConditionConfig;
  readonly source: string;
};

export type ScenarioResidentialUpkeepCostConfig = {
  readonly residentialTier: number;
  readonly currencyCostPerHour: number;
  readonly source: string;
};

export type ScenarioResidentialUpkeepPolicyConfig = {
  readonly costs: readonly ScenarioResidentialUpkeepCostConfig[];
};

export type ScenarioPhysiologicalSafetyNetPolicyConfig = {
  readonly policyVersion: string;
  readonly criticalThresholds: ScenarioPhysiologySeed;
  readonly persistenceDurationMs: number;
  readonly grantCooldownMs: number;
  readonly essentialInventoryTargets: ScenarioInventorySeed;
  readonly source: string;
};

export type ScenarioMedicalTreatmentCostConfig = {
  readonly currencyCostPerSecond: number;
  readonly source: string;
};

export type ScenarioEducationInvestmentPolicyConfig = {
  readonly policyVersion: string;
  readonly currencyCostPerHour: number;
  readonly inventoryCostsPerHour: ScenarioInventorySeed;
  readonly source: string;
};

export type ScenarioProductionEfficiencyPhysiologyCapConfig = {
  readonly residentialTier: number;
  readonly maxEnergy: number;
  readonly maxSatiety: number;
  readonly maxHealth: number;
};

export type ScenarioProductionEfficiencyPhysiologyCapPolicyConfig = {
  readonly caps: readonly ScenarioProductionEfficiencyPhysiologyCapConfig[];
};

export type ScenarioProductionEfficiencyPolicyConfig = {
  readonly minEfficiency: number;
  readonly educationScoreForMaxEfficiency: number;
  readonly physiologyCaps: ScenarioProductionEfficiencyPhysiologyCapPolicyConfig;
  readonly residentialTierForMaxEfficiency: number;
  readonly source: string;
};

export type ScenarioSurvivalTimePolicyDefaults = {
  readonly sleepDeprivation: ScenarioSleepDeprivationPolicyConfig;
  readonly stochasticIllness: ScenarioStochasticIllnessPolicyConfig;
  readonly residentialUpkeep: ScenarioResidentialUpkeepPolicyConfig;
  readonly physiologicalSafetyNet: ScenarioPhysiologicalSafetyNetPolicyConfig;
};

export type ScenarioHealthcarePolicyDefaults = {
  readonly seeDoctorTreatmentCost: ScenarioMedicalTreatmentCostConfig;
};

export type ScenarioEducationPolicyDefaults = {
  readonly studyInvestment: ScenarioEducationInvestmentPolicyConfig;
};

export type ScenarioWagePolicyDefaults = {
  readonly policyVersion: string;
  readonly knowledgePremiumPerEducationPoint: number;
  readonly shortTermAdjustment: number;
  readonly maxShortTermAdjustment: number;
  readonly missingMarketPriceIndexStrategy: 'neutral';
  readonly source: string;
};

export type ScenarioApplicationQuotaPolicyConfig = {
  readonly policyVersion: string;
  readonly quotaByResidentialTier: readonly number[];
  readonly source: string;
};

export type ScenarioRecruitmentCyclePolicyConfig = {
  readonly policyVersion: string;
  readonly cycleDurationMs: number;
  readonly defaultOccupationCapacity: number;
  readonly occupationCapacityOverrides: Readonly<Record<string, number>>;
  readonly matchingStrategy: 'applicant-proposing-stable';
  readonly source: string;
};

export type ScenarioJobApplicationPolicyDefaults = {
  readonly applicationQuota: ScenarioApplicationQuotaPolicyConfig;
  readonly recruitmentCycle: ScenarioRecruitmentCyclePolicyConfig;
};

export type ScenarioProductionPolicyDefaults = {
  readonly productionEfficiency: ScenarioProductionEfficiencyPolicyConfig;
};

export type ScenarioInventorySeed = Readonly<Record<string, number>>;

export type ScenarioAgentProfileSeed = {
  readonly personality: {
    readonly mbti: MbtiType;
  };
  readonly source: string;
};

export type ScenarioAgentSeed = {
  readonly agentId: AgentId;
  readonly displayName: string;
  readonly profile: ScenarioAgentProfileSeed;
  readonly physiology: ScenarioPhysiologySeed;
  readonly educationScore: number;
  readonly balance: number;
  readonly residentialTier: number;
  readonly job: string | null;
  readonly inventory: ScenarioInventorySeed;
  readonly locationId: LocationId | null;
  readonly source: string;
  readonly tags: readonly string[];
};

export type ScenarioMarketPoolSeed = {
  readonly commodity: string;
  readonly commodityReserve: number;
  readonly currencyReserve: number;
  readonly source: string;
  /**
   * Optional regional market this seed belongs to. When the regional-markets
   * switch is enabled, each region gets its own AMM pool per commodity so prices
   * can diverge across the town. Omitted means the global/single-region pool and
   * preserves the legacy seed shape.
   */
  readonly regionId?: string;
};

export type AivilizationScenarioDefaults = {
  readonly maxPhysiology: ScenarioPhysiologySeed;
  readonly ablationInitialPhysiology: ScenarioPhysiologySeed;
  readonly publicTimeScale: number;
  readonly ablationTimeScale: number;
  readonly ablationCohortSize: number;
  readonly agentsPerMbtiType: number;
  readonly mbtiTypes: readonly MbtiType[];
  readonly sources: {
    readonly profileExample: string;
    readonly ablationSetup: string;
    readonly defaultClock: string;
  };
};

export type ScenarioPreset = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly clock: SimulationClock;
  readonly timeScale: number;
  readonly locations: readonly TownLocationConfig[];
  readonly agentSeeds: readonly ScenarioAgentSeed[];
  readonly source: string;
};

export type CreateAivilizationAblationAgentSeedsInput = {
  readonly idPrefix?: string;
  readonly startingIndex?: number;
  readonly locationId?: LocationId | null;
  readonly residentialTier?: number;
  readonly source?: string;
};

export type CreateAivilizationPopulationAgentSeedsInput = {
  readonly agentCount: number;
  readonly idPrefix?: string;
  readonly displayNamePrefix?: string;
  readonly startingIndex?: number;
  readonly locationIds?: readonly LocationId[];
  readonly residentialTier?: number;
  readonly source?: string;
};

export type CreateAivilizationPopulationScenarioPresetInput = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly agentCount: number;
  readonly idPrefix?: string;
  readonly displayNamePrefix?: string;
  readonly startingIndex?: number;
  readonly residentialTier?: number;
  readonly timeScale?: number;
  readonly clock?: SimulationClock;
  readonly locations?: readonly TownLocationConfig[];
  readonly source?: string;
};

export type CreateCommodityMarketPoolSeedsInput = {
  readonly commodityReserve: number;
  readonly currencyReserve: number;
  readonly source?: string;
  /**
   * Optional region to tag every produced seed with. Omitted keeps the legacy
   * single-region seed shape. Used only when the regional-markets switch is on.
   */
  readonly regionId?: string;
};

const profileExampleSource = 'AIvilization v0 Appendix A Table 6';
const ablationSetupSource = 'AIvilization v0 Section 5.1 Experimental Setup';
const activityTradeSource =
  'AIvilization v0 Appendix B Table 8 trade excludes Gold Apple; reserves supplied by scenario caller';
const runtimeScaleProfileSource =
  'AIvilization v0 backend runtime scale profile for 25/100/1000 agent town modes';
const residentialPhysiologyCapSource =
  'AIvilization v0 Section 3.1.1 residential-tier physiology bounds; Appendix A Table 6 shows tier 5 uses 500 caps';
const survivalTimePolicySource =
  'AIvilization v0 Section 3.1.1 survival constraints and Section 3.2 labor-consumption feedback default runtime tuning';
const physiologicalSafetyNetPolicySource =
  'AIvilization v0 Section 3.1.1 requires essential subsidies after persistent low physiology; physiological-safety-net-v1 thresholds, persistence, cooldown, and inventory targets are repository policy decisions because the paper does not specify them';
const healthcarePolicySource =
  'AIvilization v0 Section 3.1.1 healthcare recovery action and resource-constrained survival default runtime tuning';
const educationInvestmentPolicySource =
  'AIvilization v0 Section 3.2.1 requires resource-consuming education; education-investment-v1 is a repository policy decision because the paper does not specify cost rates';
const wagePolicySource =
  'AIvilization v0 Section 3.2.4 defines static and dynamic wage regimes; wage-regime-v1 is a repository policy decision because the paper does not specify Phi or the short-term shock process';
const jobApplicationPolicySource =
  'AIvilization v0 Section 3.2.3 Equation 13 requires a non-negative, bounded, non-decreasing Nmax(R); application-quota-v1 is a repository policy decision because the paper does not specify tier values';
const recruitmentCyclePolicySource =
  'AIvilization v0 Section 3.2.3 requires recruitment cycles and competitive scarcity; recruitment-cycle-v1 is a repository policy decision because the paper does not specify cadence, capacity, ranking tie-breaks, or matching strategy';
const productionPolicySource =
  'AIvilization v0 Section 3.1.1 productive efficiency G(S,E,J,R,H) and Section 3.2.1 education score default runtime tuning';
const townWeatherPolicySource =
  'Borrowed mechanics adoption plan #1 authoritative town weather; town-weather-v1 states, transition matrix, and cadence are repository policy decisions because the paper does not model weather';
const townConditionsPolicySource =
  'Borrowed mechanics adoption plan #2 condition catalog; town-conditions-v1 conditions, thresholds, severities, and implied needs are repository policy decisions because the paper does not model conditions';

export const aivilizationScenarioDefaults = {
  maxPhysiology: { energy: 500, satiety: 500, health: 500 },
  ablationInitialPhysiology: { energy: 60, satiety: 60, health: 60 },
  publicTimeScale: 7,
  ablationTimeScale: 35,
  ablationCohortSize: 80,
  agentsPerMbtiType: 5,
  mbtiTypes: [
    'INTJ',
    'INTP',
    'ENTJ',
    'ENTP',
    'INFJ',
    'INFP',
    'ENFJ',
    'ENFP',
    'ISTJ',
    'ISFJ',
    'ESTJ',
    'ESFJ',
    'ISTP',
    'ISFP',
    'ESTP',
    'ESFP',
  ],
  sources: {
    profileExample: profileExampleSource,
    ablationSetup: ablationSetupSource,
    defaultClock: 'AIvilization v0 Section 4.1 and Section 5.1 accelerated clock settings',
  },
} as const satisfies AivilizationScenarioDefaults;

export const aivilizationResidentialPhysiologyCaps = [
  {
    residentialTier: 1,
    maxEnergy: 100,
    maxSatiety: 100,
    maxHealth: 100,
    source: residentialPhysiologyCapSource,
  },
  {
    residentialTier: 2,
    maxEnergy: 200,
    maxSatiety: 200,
    maxHealth: 200,
    source: residentialPhysiologyCapSource,
  },
  {
    residentialTier: 3,
    maxEnergy: 300,
    maxSatiety: 300,
    maxHealth: 300,
    source: residentialPhysiologyCapSource,
  },
  {
    residentialTier: 4,
    maxEnergy: 400,
    maxSatiety: 400,
    maxHealth: 400,
    source: residentialPhysiologyCapSource,
  },
  {
    residentialTier: 5,
    maxEnergy: 500,
    maxSatiety: 500,
    maxHealth: 500,
    source: residentialPhysiologyCapSource,
  },
  {
    residentialTier: 6,
    maxEnergy: 500,
    maxSatiety: 500,
    maxHealth: 500,
    source: residentialPhysiologyCapSource,
  },
] as const satisfies readonly ScenarioResidentialPhysiologyCapConfig[];

export const aivilizationSurvivalTimePolicyDefaults = {
  sleepDeprivation: {
    energyThreshold: 20,
    healthDecayPerSecond: 0.005,
    minHealth: 10,
    source: survivalTimePolicySource,
  },
  stochasticIllness: {
    illnessProbabilityPercentPerHour: 1,
    healthDamage: 5,
    minHealth: 10,
    source: survivalTimePolicySource,
  },
  residentialUpkeep: {
    costs: [
      { residentialTier: 1, currencyCostPerHour: 0, source: survivalTimePolicySource },
      { residentialTier: 2, currencyCostPerHour: 20, source: survivalTimePolicySource },
      { residentialTier: 3, currencyCostPerHour: 40, source: survivalTimePolicySource },
      { residentialTier: 4, currencyCostPerHour: 80, source: survivalTimePolicySource },
      { residentialTier: 5, currencyCostPerHour: 160, source: survivalTimePolicySource },
      { residentialTier: 6, currencyCostPerHour: 320, source: survivalTimePolicySource },
    ],
  },
  physiologicalSafetyNet: {
    policyVersion: 'physiological-safety-net-v1',
    criticalThresholds: { satiety: 20, energy: 20, health: 20 },
    persistenceDurationMs: 3_600_000,
    grantCooldownMs: 21_600_000,
    essentialInventoryTargets: { Apple: 2 },
    source: physiologicalSafetyNetPolicySource,
  },
} as const satisfies ScenarioSurvivalTimePolicyDefaults;

export const TOWN_WEATHER_POLICY_VERSION = 'town-weather-v1';

/**
 * Authoritative town weather (borrowed-mechanics adoption plan #1). The Markov
 * transition matrix is evaluated once per `transitionCadenceMs` of simulation
 * time; every row sums to 1 so rain can naturally persist or clear. The policy
 * is opt-in (default off) and only settles while explicitly enabled.
 */
export const aivilizationTownWeatherPolicyDefaults = {
  policyVersion: TOWN_WEATHER_POLICY_VERSION,
  initialWeather: 'sunny',
  transitionCadenceMs: 3_600_000,
  transitions: {
    sunny: { sunny: 0.55, cloudy: 0.25, windy: 0.1, rainy: 0, stormy: 0, snowy: 0, foggy: 0.1 },
    cloudy: { sunny: 0.3, cloudy: 0.35, windy: 0.1, rainy: 0.15, stormy: 0, snowy: 0, foggy: 0.1 },
    windy: { sunny: 0.15, cloudy: 0.25, windy: 0.3, rainy: 0.15, stormy: 0.1, snowy: 0.05, foggy: 0 },
    rainy: { sunny: 0, cloudy: 0.25, windy: 0.1, rainy: 0.4, stormy: 0.15, snowy: 0.05, foggy: 0.05 },
    stormy: { sunny: 0, cloudy: 0.2, windy: 0.2, rainy: 0.35, stormy: 0.25, snowy: 0, foggy: 0 },
    snowy: { sunny: 0, cloudy: 0.3, windy: 0.1, rainy: 0.1, stormy: 0, snowy: 0.35, foggy: 0.15 },
    foggy: { sunny: 0.25, cloudy: 0.3, windy: 0, rainy: 0.1, stormy: 0, snowy: 0.05, foggy: 0.3 },
  },
  source: townWeatherPolicySource,
} as const satisfies ScenarioTownWeatherPolicyConfig;

export const TOWN_CONDITIONS_POLICY_VERSION = 'town-conditions-v1';

/**
 * Condition catalog (borrowed-mechanics adoption plan #2). Conditions are
 * derived read-path state over durable physiology axes, the town weather, and
 * location exposure — never stored. Pure threshold triggers keep derivation
 * deterministic without events or RNG. Opt-in via the town-conditions switch.
 */
export const aivilizationTownConditionsPolicyDefaults = {
  policyVersion: TOWN_CONDITIONS_POLICY_VERSION,
  soaked: {
    outdoorSeverityByWeather: { rainy: 'moderate', stormy: 'severe' },
    need: 'shelter',
  },
  cold: {
    outdoorSeverityByWeather: { snowy: 'severe', foggy: 'moderate' },
    shelteredSeverity: 'mild',
    shelteredMaxResidentialTier: 1,
    need: 'warm-up',
  },
  overtired: { triggerBelow: 30, severeBelow: 10, need: 'sleep' },
  hungry: { triggerBelow: 30, severeBelow: 10, need: 'eat' },
  stressed: { triggerBelow: 40, severeBelow: 20, need: 'see-doctor' },
  source: townConditionsPolicySource,
} as const satisfies ScenarioTownConditionsPolicyConfig;

export const aivilizationHealthcarePolicyDefaults = {
  seeDoctorTreatmentCost: {
    currencyCostPerSecond: 0.02,
    source: healthcarePolicySource,
  },
} as const satisfies ScenarioHealthcarePolicyDefaults;

export const aivilizationEducationPolicyDefaults = {
  studyInvestment: {
    policyVersion: 'education-investment-v1',
    currencyCostPerHour: 20,
    inventoryCostsPerHour: {},
    source: educationInvestmentPolicySource,
  },
} as const satisfies ScenarioEducationPolicyDefaults;

export const aivilizationWagePolicyDefaults = {
  policyVersion: 'wage-regime-v1',
  knowledgePremiumPerEducationPoint: 0.001,
  shortTermAdjustment: 0,
  maxShortTermAdjustment: 0.1,
  missingMarketPriceIndexStrategy: 'neutral',
  source: wagePolicySource,
} as const satisfies ScenarioWagePolicyDefaults;

export const aivilizationJobApplicationPolicyDefaults = {
  applicationQuota: {
    policyVersion: 'application-quota-v1',
    quotaByResidentialTier: [1, 1, 2, 3, 4, 5],
    source: jobApplicationPolicySource,
  },
  recruitmentCycle: {
    policyVersion: 'recruitment-cycle-v1',
    cycleDurationMs: 86_400_000,
    defaultOccupationCapacity: 1,
    occupationCapacityOverrides: {},
    matchingStrategy: 'applicant-proposing-stable',
    source: recruitmentCyclePolicySource,
  },
} as const satisfies ScenarioJobApplicationPolicyDefaults;

export const aivilizationProductionPolicyDefaults = {
  productionEfficiency: {
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
    source: productionPolicySource,
  },
} as const satisfies ScenarioProductionPolicyDefaults;

export function createAivilizationAblationAgentSeeds(
  input: CreateAivilizationAblationAgentSeedsInput = {},
): ScenarioAgentSeed[] {
  const idPrefix = input.idPrefix ?? 'ablation-agent';
  const startingIndex = input.startingIndex ?? 1;
  const residentialTier = input.residentialTier ?? 1;
  const locationId = input.locationId === undefined ? null : input.locationId;
  const source = input.source ?? ablationSetupSource;

  assertNonEmptyString(idPrefix, 'idPrefix');
  assertPositiveInteger(startingIndex, 'startingIndex');
  assertPositiveInteger(residentialTier, 'residentialTier');
  assertNonEmptyString(source, 'source');

  return aivilizationScenarioDefaults.mbtiTypes.flatMap((mbti, typeIndex) =>
    Array.from({ length: aivilizationScenarioDefaults.agentsPerMbtiType }, (_, cohortIndex) => {
      const serial =
        startingIndex + typeIndex * aivilizationScenarioDefaults.agentsPerMbtiType + cohortIndex;
      return {
        agentId: asAgentId(`${idPrefix}-${formatAgentSerial(serial)}`),
        displayName: `Ablation Agent ${formatAgentSerial(serial)}`,
        profile: {
          personality: { mbti },
          source: profileExampleSource,
        },
        physiology: { ...aivilizationScenarioDefaults.ablationInitialPhysiology },
        educationScore: 0,
        balance: 0,
        residentialTier,
        job: null,
        inventory: {},
        locationId,
        source,
        tags: ['ablation', 'empty-profile'],
      };
    }),
  );
}

export function createCommodityMarketPoolSeeds(
  input: CreateCommodityMarketPoolSeedsInput,
): ScenarioMarketPoolSeed[] {
  assertPositiveFinite(input.commodityReserve, 'commodityReserve');
  assertPositiveFinite(input.currencyReserve, 'currencyReserve');
  const source = input.source ?? activityTradeSource;
  assertNonEmptyString(source, 'source');

  return commodities
    .filter((commodity) => commodity.name !== 'Gold Apple')
    .map((commodity) => ({
      commodity: commodity.name,
      commodityReserve: input.commodityReserve,
      currencyReserve: input.currencyReserve,
      source,
      ...(input.regionId === undefined ? {} : { regionId: input.regionId }),
    }));
}

export function createAivilizationPopulationAgentSeeds(
  input: CreateAivilizationPopulationAgentSeedsInput,
): ScenarioAgentSeed[] {
  const idPrefix = input.idPrefix ?? 'agent';
  const displayNamePrefix = input.displayNamePrefix ?? 'Agent';
  const startingIndex = input.startingIndex ?? 1;
  const residentialTier = input.residentialTier ?? 1;
  const source = input.source ?? runtimeScaleProfileSource;
  const locationIds = input.locationIds ?? townLocations.map((location) => location.locationId);

  assertPositiveInteger(input.agentCount, 'agentCount');
  assertNonEmptyString(idPrefix, 'idPrefix');
  assertNonEmptyString(displayNamePrefix, 'displayNamePrefix');
  assertPositiveInteger(startingIndex, 'startingIndex');
  assertPositiveInteger(residentialTier, 'residentialTier');
  assertNonEmptyString(source, 'source');
  assertNonEmptyArray(locationIds, 'locationIds');

  return Array.from({ length: input.agentCount }, (_, index) => {
    const serial = startingIndex + index;
    const serialLabel = formatAgentSerial(serial);
    const mbti =
      aivilizationScenarioDefaults.mbtiTypes[
        index % aivilizationScenarioDefaults.mbtiTypes.length
      ] ?? 'INTJ';
    const locationId = locationIds[index % locationIds.length];
    if (locationId === undefined) {
      throw new Error('locationIds must not be empty');
    }

    return {
      agentId: asAgentId(`${idPrefix}-${serialLabel}`),
      displayName: `${displayNamePrefix} ${serialLabel}`,
      profile: {
        personality: { mbti },
        source: profileExampleSource,
      },
      physiology: { ...aivilizationScenarioDefaults.maxPhysiology },
      educationScore: (index % 6) * 80,
      balance: 100 + (index % 20) * 25,
      residentialTier,
      job: null,
      inventory: {},
      locationId,
      source,
      tags: ['runtime-scale', 'profile-seeded'],
    };
  });
}

export function createAivilizationPopulationScenarioPreset(
  input: CreateAivilizationPopulationScenarioPresetInput,
): ScenarioPreset {
  const source = input.source ?? runtimeScaleProfileSource;
  const locations = input.locations ?? townLocations;
  const timeScale = input.timeScale ?? aivilizationScenarioDefaults.publicTimeScale;

  assertNonEmptyString(input.id, 'id');
  assertNonEmptyString(input.name, 'name');
  assertNonEmptyString(input.description, 'description');
  assertNonEmptyString(source, 'source');
  assertPositiveFinite(timeScale, 'timeScale');
  assertNonEmptyArray(locations, 'locations');

  return {
    id: input.id,
    name: input.name,
    description: input.description,
    clock: input.clock ?? { now: 0, tickDurationMs: 1000 },
    timeScale,
    locations,
    agentSeeds: createAivilizationPopulationAgentSeeds({
      agentCount: input.agentCount,
      ...(input.idPrefix === undefined ? {} : { idPrefix: input.idPrefix }),
      ...(input.displayNamePrefix === undefined
        ? {}
        : { displayNamePrefix: input.displayNamePrefix }),
      ...(input.startingIndex === undefined ? {} : { startingIndex: input.startingIndex }),
      ...(input.residentialTier === undefined ? {} : { residentialTier: input.residentialTier }),
      locationIds: locations.map((location) => location.locationId),
      source,
    }),
    source,
  };
}

export const aivilizationAblationScenarioPreset = {
  id: 'aivilization-ablation-80-agent-cohort',
  name: 'AIvilization Ablation Cohort',
  description:
    'Deterministic 80-agent cohort matching Section 5.1 initial state and MBTI distribution assumptions.',
  clock: { now: 0, tickDurationMs: 1000 },
  timeScale: aivilizationScenarioDefaults.ablationTimeScale,
  locations: townLocations,
  agentSeeds: createAivilizationAblationAgentSeeds(),
  source: ablationSetupSource,
} as const satisfies ScenarioPreset;

function formatAgentSerial(value: number): string {
  return String(value).padStart(3, '0');
}

function assertNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}

function assertNonEmptyArray<TValue>(values: readonly TValue[], name: string): void {
  if (values.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
