import {
  createAivilizationPopulationScenarioPreset,
  createCommodityMarketPoolSeeds,
  type ScenarioPreset,
} from '@aivilization/content';
import type { PartitionKey } from '@aivilization/sim-core';
import type { LocalSimulationRuntimeManifest } from '@aivilization/worker';
import type {
  LocalRuntimeTownRecoveryInput,
  LocalRuntimeTownRunQueueWorkerInput,
  LocalRuntimeTownSchedulerInput,
} from './localRuntimeTownOrchestration';

export type LocalRuntimeTownDaemonScenarioProfileId =
  | 'smoke-25'
  | 'default-100'
  | 'headless-stress-1000';

export type LocalRuntimeTownDaemonScenarioProfile = {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly name: string;
  readonly description: string;
  readonly agentCount: number;
  readonly headless: boolean;
  readonly manifest: LocalSimulationRuntimeManifest;
  readonly scenarioPresets: readonly ScenarioPreset[];
  readonly runtimeRunQueue: LocalRuntimeTownRunQueueWorkerInput;
  readonly runtimeScheduler: LocalRuntimeTownSchedulerInput;
  readonly runtimeRecovery: LocalRuntimeTownRecoveryInput;
};

type ProfilePartitionConfig = {
  readonly partitionKey: PartitionKey;
  readonly agentCount: number;
  readonly label: string;
};

type LocalRuntimeTownDaemonScenarioProfileConfig = {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly manifestId: string;
  readonly name: string;
  readonly description: string;
  readonly headless: boolean;
  readonly commandConsumerIdPrefix: string;
  readonly tickBatchSize: number;
  readonly tickIntervalMs: number;
  readonly maxJobsPerPoll: number;
  readonly scheduleIntervalMs: number;
  readonly recoveryIntervalMs: number;
  readonly commodityReserve: number;
  readonly currencyReserve: number;
  readonly partitions: readonly ProfilePartitionConfig[];
};

const profileConfigs = {
  'smoke-25': {
    profileId: 'smoke-25',
    manifestId: 'aivilization-smoke-25',
    name: 'AIvilization Smoke 25',
    description: 'Single-partition 25-agent smoke profile for daemon boot verification.',
    headless: false,
    commandConsumerIdPrefix: 'smoke-worker',
    tickBatchSize: 1,
    tickIntervalMs: 100,
    maxJobsPerPoll: 1,
    scheduleIntervalMs: 1_000,
    recoveryIntervalMs: 1_000,
    commodityReserve: 100,
    currencyReserve: 1_000,
    partitions: [{ partitionKey: 'world-main', agentCount: 25, label: 'Main' }],
  },
  'default-100': {
    profileId: 'default-100',
    manifestId: 'aivilization-default-100',
    name: 'AIvilization Default 100',
    description: 'Two-partition 100-agent default backend profile for local development.',
    headless: false,
    commandConsumerIdPrefix: 'default-worker',
    tickBatchSize: 2,
    tickIntervalMs: 100,
    maxJobsPerPoll: 2,
    scheduleIntervalMs: 1_000,
    recoveryIntervalMs: 1_000,
    commodityReserve: 500,
    currencyReserve: 5_000,
    partitions: [
      { partitionKey: 'world-main', agentCount: 50, label: 'Main' },
      { partitionKey: 'world-east', agentCount: 50, label: 'East' },
    ],
  },
  'headless-stress-1000': {
    profileId: 'headless-stress-1000',
    manifestId: 'aivilization-headless-stress-1000',
    name: 'AIvilization Headless Stress 1000',
    description: 'Ten-partition 1000-agent headless stress profile for backend soak runs.',
    headless: true,
    commandConsumerIdPrefix: 'stress-worker',
    tickBatchSize: 10,
    tickIntervalMs: 0,
    maxJobsPerPoll: 10,
    scheduleIntervalMs: 100,
    recoveryIntervalMs: 1_000,
    commodityReserve: 1_000,
    currencyReserve: 10_000,
    partitions: [
      { partitionKey: 'world-main', agentCount: 100, label: 'Main' },
      { partitionKey: 'world-east', agentCount: 100, label: 'East' },
      { partitionKey: 'world-west', agentCount: 100, label: 'West' },
      { partitionKey: 'world-north', agentCount: 100, label: 'North' },
      { partitionKey: 'world-south', agentCount: 100, label: 'South' },
      { partitionKey: 'world-market', agentCount: 100, label: 'Market' },
      { partitionKey: 'world-residential', agentCount: 100, label: 'Residential' },
      { partitionKey: 'world-industrial', agentCount: 100, label: 'Industrial' },
      { partitionKey: 'world-campus', agentCount: 100, label: 'Campus' },
      { partitionKey: 'world-rural', agentCount: 100, label: 'Rural' },
    ],
  },
} as const satisfies Record<
  LocalRuntimeTownDaemonScenarioProfileId,
  LocalRuntimeTownDaemonScenarioProfileConfig
>;

export function createLocalRuntimeTownDaemonScenarioProfile(
  profileId: LocalRuntimeTownDaemonScenarioProfileId,
): LocalRuntimeTownDaemonScenarioProfile {
  const config = profileConfigs[profileId];
  const scenarioPresets = createScenarioPresets(config);
  const manifest = createManifest(config, scenarioPresets);

  return {
    profileId: config.profileId,
    name: config.name,
    description: config.description,
    agentCount: config.partitions.reduce((total, partition) => total + partition.agentCount, 0),
    headless: config.headless,
    manifest,
    scenarioPresets,
    runtimeRunQueue: {
      workerId: `${config.manifestId}:run-queue-worker`,
      pollIntervalMs: config.headless ? 100 : 1_000,
      leaseDurationMs: 30_000,
      maxJobsPerPoll: config.maxJobsPerPoll,
    },
    runtimeScheduler: {
      schedulerId: `${config.manifestId}:scheduler`,
      cycleCount: 1,
      cycleIntervalMs: config.tickIntervalMs,
      scheduleIntervalMs: config.scheduleIntervalMs,
      maxPendingJobs: config.maxJobsPerPoll,
      allowWhenDeadLettered: false,
    },
    runtimeRecovery: {
      recoveryIntervalMs: config.recoveryIntervalMs,
      maxDrainJobsPerRun: config.maxJobsPerPoll,
      maxDeadLetterReplaysPerRun: config.maxJobsPerPoll,
      maxReplayCountPerJob: 2,
      deadLetterReplayMaxAttempts: 3,
    },
  };
}

function createScenarioPresets(
  config: LocalRuntimeTownDaemonScenarioProfileConfig,
): readonly ScenarioPreset[] {
  let startingIndex = 1;
  return config.partitions.map((partition) => {
    const preset = createAivilizationPopulationScenarioPreset({
      id: `${config.manifestId}-${partition.partitionKey}`,
      name: `${config.name} ${partition.label}`,
      description: `${partition.agentCount}-agent ${partition.partitionKey} slice for ${config.name}.`,
      agentCount: partition.agentCount,
      idPrefix: `${config.profileId}-${partition.partitionKey}-agent`,
      displayNamePrefix: `${config.name} ${partition.label} Agent`,
      startingIndex,
    });
    startingIndex += partition.agentCount;
    return preset;
  });
}

function createManifest(
  config: LocalRuntimeTownDaemonScenarioProfileConfig,
  scenarioPresets: readonly ScenarioPreset[],
): LocalSimulationRuntimeManifest {
  const presetsByPartition = new Map(
    scenarioPresets.map((preset, index) => [config.partitions[index]?.partitionKey, preset]),
  );

  return {
    id: config.manifestId,
    defaults: {
      tickBatchSize: config.tickBatchSize,
      tickIntervalMs: config.tickIntervalMs,
      commandConsumerIdPrefix: config.commandConsumerIdPrefix,
    },
    partitions: config.partitions.map((partition) => {
      const marketPools = createCommodityMarketPoolSeeds({
        commodityReserve: config.commodityReserve,
        currencyReserve: config.currencyReserve,
      });
      const preset = presetsByPartition.get(partition.partitionKey);
      if (preset === undefined) {
        throw new Error(`scenario preset missing for partition ${partition.partitionKey}`);
      }

      return {
        simulationId: config.manifestId,
        partitionKey: partition.partitionKey,
        scenarioPresetId: preset.id,
        marketPools,
        moneySupply:
          marketPools.reduce((total, pool) => total + pool.currencyReserve, 0) +
          partition.agentCount * 100,
      };
    }),
  };
}
