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

export type ScenarioResidentialUpkeepCostConfig = {
  readonly residentialTier: number;
  readonly currencyCostPerHour: number;
  readonly source: string;
};

export type ScenarioResidentialUpkeepPolicyConfig = {
  readonly costs: readonly ScenarioResidentialUpkeepCostConfig[];
};

export type ScenarioSafetyNetSubsidyPolicyConfig = {
  readonly minimumBalance: number;
  readonly maxSubsidy: number;
  readonly source: string;
};

export type ScenarioMedicalTreatmentCostConfig = {
  readonly currencyCostPerSecond: number;
  readonly source: string;
};

export type ScenarioProductionEfficiencyPolicyConfig = {
  readonly minEfficiency: number;
  readonly educationScoreForMaxEfficiency: number;
  readonly source: string;
};

export type ScenarioSurvivalTimePolicyDefaults = {
  readonly sleepDeprivation: ScenarioSleepDeprivationPolicyConfig;
  readonly stochasticIllness: ScenarioStochasticIllnessPolicyConfig;
  readonly residentialUpkeep: ScenarioResidentialUpkeepPolicyConfig;
  readonly safetyNetSubsidy: ScenarioSafetyNetSubsidyPolicyConfig;
};

export type ScenarioHealthcarePolicyDefaults = {
  readonly seeDoctorTreatmentCost: ScenarioMedicalTreatmentCostConfig;
};

export type ScenarioProductionPolicyDefaults = {
  readonly educationEfficiency: ScenarioProductionEfficiencyPolicyConfig;
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
const healthcarePolicySource =
  'AIvilization v0 Section 3.1.1 healthcare recovery action and resource-constrained survival default runtime tuning';
const productionPolicySource =
  'AIvilization v0 Section 3.1.1 productive efficiency and Section 3.2.1 education score default runtime tuning';

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
  safetyNetSubsidy: {
    minimumBalance: 50,
    maxSubsidy: 25,
    source: survivalTimePolicySource,
  },
} as const satisfies ScenarioSurvivalTimePolicyDefaults;

export const aivilizationHealthcarePolicyDefaults = {
  seeDoctorTreatmentCost: {
    currencyCostPerSecond: 0.02,
    source: healthcarePolicySource,
  },
} as const satisfies ScenarioHealthcarePolicyDefaults;

export const aivilizationProductionPolicyDefaults = {
  educationEfficiency: {
    minEfficiency: 0.5,
    educationScoreForMaxEfficiency: 500,
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
