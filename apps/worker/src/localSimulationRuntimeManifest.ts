import type { ReactiveActionSimulator, ReactiveLocalizedPlanner } from '@aivilization/agent-runtime';
import type { ScenarioMarketPoolSeed, ScenarioPreset } from '@aivilization/content';
import type { CommandConsumerId, PartitionKey } from '@aivilization/sim-core';
import type { LocalWorldRuntimeLoopPausePredicate } from './localRuntimeLoop';
import {
  createLocalSimulationBackendRegistry,
  type LocalSimulationBackendRegistry,
} from './localSimulationBackendRegistry';
import type { LocalSimulationBackendRegistration } from './localSimulationBackendRegistry';
import { createWorldProjectionFromScenario } from './scenarioProjection';
import type { WorkerTickAgentInput, WorkerTickMarketMetricsInput } from './tickRunner';
import type { LocalRuntimeSteeringCommandDrainInput } from './localCommandDrain';
import type { WorldCommandPolicySource } from './worldCommandPolicySource';

export type LocalSimulationRuntimeManifestDefaults = {
  readonly tickBatchSize: number;
  readonly tickIntervalMs: number;
  readonly commandConsumerIdPrefix?: string;
};

export type LocalSimulationRuntimePartitionManifest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly scenarioPresetId: string;
  readonly loopId?: string;
  readonly tickBatchSize?: number;
  readonly tickIntervalMs?: number;
  readonly commandConsumerId?: CommandConsumerId;
  readonly marketPools?: readonly ScenarioMarketPoolSeed[];
  readonly moneySupply?: number;
};

export type LocalSimulationRuntimeManifest = {
  readonly id: string;
  readonly defaults: LocalSimulationRuntimeManifestDefaults;
  readonly partitions: readonly LocalSimulationRuntimePartitionManifest[];
};

export type LocalSimulationRuntimeCatalogInput = {
  readonly manifest: LocalSimulationRuntimeManifest;
  readonly scenarioPresets: readonly ScenarioPreset[];
  readonly policies: WorldCommandPolicySource;
  readonly localizedPlanners: readonly ReactiveLocalizedPlanner[];
  readonly steeringSimulator: ReactiveActionSimulator;
  readonly agents: readonly WorkerTickAgentInput[];
  readonly pauseBeforeTick?: LocalWorldRuntimeLoopPausePredicate;
  readonly commandDrainLimit?: LocalRuntimeSteeringCommandDrainInput['limit'];
  readonly timeDeltaMs?: number;
  readonly marketMetrics?: WorkerTickMarketMetricsInput;
};

export type LocalSimulationRuntimeRegistryInput = LocalSimulationRuntimeCatalogInput & {
  readonly rootDir: string;
};

export function createLocalSimulationBackendRegistrationsFromManifest(
  input: LocalSimulationRuntimeCatalogInput,
): readonly LocalSimulationBackendRegistration[] {
  assertNonEmpty(input.manifest.id, 'manifest.id');
  assertNonEmptyArray(input.manifest.partitions, 'manifest.partitions');
  assertPositiveInteger(input.manifest.defaults.tickBatchSize, 'manifest.defaults.tickBatchSize');
  assertNonNegativeFinite(input.manifest.defaults.tickIntervalMs, 'manifest.defaults.tickIntervalMs');

  const scenarioPresets = createScenarioPresetLookup(input.scenarioPresets);

  return input.manifest.partitions.map((partition) => {
    assertNonEmpty(partition.simulationId, 'simulationId');
    assertNonEmpty(partition.partitionKey, 'partitionKey');
    assertNonEmpty(partition.scenarioPresetId, 'scenarioPresetId');
    const preset = scenarioPresets.get(partition.scenarioPresetId);
    if (preset === undefined) {
      throw new Error(`scenario preset is not registered: ${partition.scenarioPresetId}`);
    }

    const tickBatchSize = partition.tickBatchSize ?? input.manifest.defaults.tickBatchSize;
    const tickIntervalMs = partition.tickIntervalMs ?? input.manifest.defaults.tickIntervalMs;
    assertPositiveInteger(tickBatchSize, 'tickBatchSize');
    assertNonNegativeFinite(tickIntervalMs, 'tickIntervalMs');

    return {
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      loopId: partition.loopId ?? createDefaultLoopId(input.manifest.id, partition),
      tickBatchSize,
      tickIntervalMs,
      commandConsumerId:
        partition.commandConsumerId ??
        createDefaultCommandConsumerId(input.manifest.defaults, partition),
      initialProjection: createWorldProjectionFromScenario({
        preset,
        ...(partition.marketPools === undefined ? {} : { marketPools: partition.marketPools }),
        ...(partition.moneySupply === undefined ? {} : { moneySupply: partition.moneySupply }),
      }),
      policies: input.policies,
      localizedPlanners: input.localizedPlanners,
      steeringSimulator: input.steeringSimulator,
      agents: input.agents,
      ...(input.pauseBeforeTick === undefined ? {} : { pauseBeforeTick: input.pauseBeforeTick }),
      ...(input.commandDrainLimit === undefined
        ? {}
        : { commandDrainLimit: input.commandDrainLimit }),
      ...(input.timeDeltaMs === undefined ? {} : { timeDeltaMs: input.timeDeltaMs }),
      ...(input.marketMetrics === undefined ? {} : { marketMetrics: input.marketMetrics }),
    };
  });
}

export function createLocalSimulationBackendRegistryFromManifest(
  input: LocalSimulationRuntimeRegistryInput,
): LocalSimulationBackendRegistry {
  return createLocalSimulationBackendRegistry({
    rootDir: input.rootDir,
    registrations: createLocalSimulationBackendRegistrationsFromManifest(input),
  });
}

function createScenarioPresetLookup(
  scenarioPresets: readonly ScenarioPreset[],
): Map<string, ScenarioPreset> {
  const lookup = new Map<string, ScenarioPreset>();
  for (const preset of scenarioPresets) {
    assertNonEmpty(preset.id, 'scenario preset id');
    if (lookup.has(preset.id)) {
      throw new Error(`duplicate scenario preset id: ${preset.id}`);
    }
    lookup.set(preset.id, preset);
  }
  return lookup;
}

function createDefaultLoopId(
  manifestId: string,
  partition: LocalSimulationRuntimePartitionManifest,
): string {
  return `${manifestId}:${partition.simulationId}:${partition.partitionKey}`;
}

function createDefaultCommandConsumerId(
  defaults: LocalSimulationRuntimeManifestDefaults,
  partition: LocalSimulationRuntimePartitionManifest,
): CommandConsumerId {
  const prefix = defaults.commandConsumerIdPrefix ?? 'worker';
  assertNonEmpty(prefix, 'commandConsumerIdPrefix');
  return `${prefix}-${partition.partitionKey}`;
}

function assertNonEmptyArray<TValue>(values: readonly TValue[], name: string): void {
  if (values.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}
