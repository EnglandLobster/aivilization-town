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
