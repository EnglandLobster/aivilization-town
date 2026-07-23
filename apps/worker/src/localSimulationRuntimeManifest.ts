import type {
  ReactiveActionSimulator,
  ReactiveLocalizedPlanner,
  StrategicPlanCompiler,
} from '@aivilization/agent-runtime';
import type { ScenarioMarketPoolSeed, ScenarioPreset } from '@aivilization/content';
import type { CommandConsumerId, PartitionKey } from '@aivilization/sim-core';
import type { LocalWorldRuntimeLoopPausePredicate } from './localRuntimeLoop';
import type {
  LocalWorldRuntimeAgentProvider,
  LocalWorldRuntimeMarketObservationsInput,
} from './localRuntimeStep';
import type {
  LocalSimulationLifecycleMemoryConsolidationSchedule,
  LocalSimulationLifecycleValidationSchedule,
} from './localSimulationLifecycle';
import {
  createLocalSimulationBackendRegistry,
  type LocalSimulationBackendRegistry,
} from './localSimulationBackendRegistry';
import type { LocalSimulationBackendRegistration } from './localSimulationBackendRegistry';
import { createWorldProjectionFromScenario } from './scenarioProjection';
import type {
  WorkerTickAgentInput,
  WorkerTickAmbientObservationMemoryInput,
  WorkerTickMarketMetricsInput,
} from './tickRunner';
import type { LocalRuntimeSteeringCommandDrainInput } from './localCommandDrain';
import type { WorldCommandPolicySource } from './worldCommandPolicySource';

export const SCENARIO_TIME_SCALE_POLICY_VERSION = 'scenario-time-scale-v1';

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

export type LocalSimulationRuntimeManifestResolutionInput = {
  readonly manifest: LocalSimulationRuntimeManifest;
  readonly scenarioPresets: readonly ScenarioPreset[];
};

export type ResolvedLocalSimulationRuntimePartition = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly scenarioPresetId: string;
  readonly preset: ScenarioPreset;
  readonly loopId: string;
  readonly tickBatchSize: number;
  readonly tickIntervalMs: number;
  readonly commandConsumerId: CommandConsumerId;
  readonly marketPools?: readonly ScenarioMarketPoolSeed[];
  readonly moneySupply?: number;
};

export type ResolvedLocalSimulationRuntimeManifest = {
  readonly id: string;
  readonly partitions: readonly ResolvedLocalSimulationRuntimePartition[];
};

export type LocalSimulationRuntimeWiringInput = {
  readonly policies: WorldCommandPolicySource;
  readonly localizedPlanners: readonly ReactiveLocalizedPlanner[];
  readonly steeringSimulator: ReactiveActionSimulator;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly agents: readonly WorkerTickAgentInput[];
  readonly pauseBeforeTick?: LocalWorldRuntimeLoopPausePredicate;
  readonly commandDrainLimit?: LocalRuntimeSteeringCommandDrainInput['limit'];
  readonly timeDeltaMs?: number;
  readonly marketMetrics?: WorkerTickMarketMetricsInput;
  readonly marketObservations?: LocalWorldRuntimeMarketObservationsInput;
  readonly ambientObservationMemory?: WorkerTickAmbientObservationMemoryInput;
  readonly agentProvider?: LocalWorldRuntimeAgentProvider;
  readonly validationSchedule?: LocalSimulationLifecycleValidationSchedule;
  readonly memoryConsolidationSchedule?: LocalSimulationLifecycleMemoryConsolidationSchedule;
};

export type LocalSimulationRuntimeCatalogInput = LocalSimulationRuntimeManifestResolutionInput &
  LocalSimulationRuntimeWiringInput;

export type LocalSimulationRuntimeResolvedCatalogInput = {
  readonly resolvedManifest: ResolvedLocalSimulationRuntimeManifest;
} & LocalSimulationRuntimeWiringInput;

export type LocalSimulationRuntimeRegistryInput = LocalSimulationRuntimeCatalogInput & {
  readonly rootDir: string;
};

export function resolveLocalSimulationRuntimeManifest(
  input: LocalSimulationRuntimeManifestResolutionInput,
): ResolvedLocalSimulationRuntimeManifest {
  assertNonEmpty(input.manifest.id, 'manifest.id');
  assertNonEmptyArray(input.manifest.partitions, 'manifest.partitions');
  assertPositiveInteger(input.manifest.defaults.tickBatchSize, 'manifest.defaults.tickBatchSize');
  assertNonNegativeFinite(
    input.manifest.defaults.tickIntervalMs,
    'manifest.defaults.tickIntervalMs',
  );

  const scenarioPresets = createScenarioPresetLookup(input.scenarioPresets);

  return {
    id: input.manifest.id,
    partitions: input.manifest.partitions.map((partition) =>
      resolvePartitionManifest(input.manifest, scenarioPresets, partition),
    ),
  };
}

export function createLocalSimulationBackendRegistrationsFromManifest(
  input: LocalSimulationRuntimeCatalogInput,
): readonly LocalSimulationBackendRegistration[] {
  return createLocalSimulationBackendRegistrationsFromResolvedManifest({
    resolvedManifest: resolveLocalSimulationRuntimeManifest(input),
    policies: input.policies,
    localizedPlanners: input.localizedPlanners,
    steeringSimulator: input.steeringSimulator,
    ...(input.strategicPlanCompiler === undefined
      ? {}
      : { strategicPlanCompiler: input.strategicPlanCompiler }),
    agents: input.agents,
    ...(input.pauseBeforeTick === undefined ? {} : { pauseBeforeTick: input.pauseBeforeTick }),
    ...(input.commandDrainLimit === undefined
      ? {}
      : { commandDrainLimit: input.commandDrainLimit }),
    ...(input.timeDeltaMs === undefined ? {} : { timeDeltaMs: input.timeDeltaMs }),
    ...(input.marketMetrics === undefined ? {} : { marketMetrics: input.marketMetrics }),
    ...(input.marketObservations === undefined
      ? {}
      : { marketObservations: input.marketObservations }),
    ...(input.ambientObservationMemory === undefined
      ? {}
      : { ambientObservationMemory: input.ambientObservationMemory }),
    ...(input.agentProvider === undefined ? {} : { agentProvider: input.agentProvider }),
    ...(input.validationSchedule === undefined
      ? {}
      : { validationSchedule: input.validationSchedule }),
    ...(input.memoryConsolidationSchedule === undefined
      ? {}
      : { memoryConsolidationSchedule: input.memoryConsolidationSchedule }),
  });
}

export function createLocalSimulationBackendRegistrationsFromResolvedManifest(
  input: LocalSimulationRuntimeResolvedCatalogInput,
): readonly LocalSimulationBackendRegistration[] {
  return input.resolvedManifest.partitions.map((partition) => {
    return {
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      loopId: partition.loopId,
      tickBatchSize: partition.tickBatchSize,
      tickIntervalMs: partition.tickIntervalMs,
      commandConsumerId: partition.commandConsumerId,
      initialProjection: createWorldProjectionFromScenario({
        preset: partition.preset,
        ...(partition.marketPools === undefined ? {} : { marketPools: partition.marketPools }),
        ...(partition.moneySupply === undefined ? {} : { moneySupply: partition.moneySupply }),
      }),
      policies: input.policies,
      localizedPlanners: input.localizedPlanners,
      steeringSimulator: input.steeringSimulator,
      ...(input.strategicPlanCompiler === undefined
        ? {}
        : { strategicPlanCompiler: input.strategicPlanCompiler }),
      agents: input.agents,
      ...(input.pauseBeforeTick === undefined ? {} : { pauseBeforeTick: input.pauseBeforeTick }),
      ...(input.commandDrainLimit === undefined
        ? {}
        : { commandDrainLimit: input.commandDrainLimit }),
      timeDeltaMs: input.timeDeltaMs ?? resolveScenarioTimeDeltaMs(partition.preset),
      ...(input.marketMetrics === undefined ? {} : { marketMetrics: input.marketMetrics }),
      ...(input.marketObservations === undefined
        ? {}
        : { marketObservations: input.marketObservations }),
      ...(input.ambientObservationMemory === undefined
        ? {}
        : { ambientObservationMemory: input.ambientObservationMemory }),
      ...(input.agentProvider === undefined ? {} : { agentProvider: input.agentProvider }),
      ...(input.validationSchedule === undefined
        ? {}
        : { validationSchedule: input.validationSchedule }),
      ...(input.memoryConsolidationSchedule === undefined
        ? {}
        : { memoryConsolidationSchedule: input.memoryConsolidationSchedule }),
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

function resolvePartitionManifest(
  manifest: LocalSimulationRuntimeManifest,
  scenarioPresets: ReadonlyMap<string, ScenarioPreset>,
  partition: LocalSimulationRuntimePartitionManifest,
): ResolvedLocalSimulationRuntimePartition {
  assertNonEmpty(partition.simulationId, 'simulationId');
  assertNonEmpty(partition.partitionKey, 'partitionKey');
  assertNonEmpty(partition.scenarioPresetId, 'scenarioPresetId');
  const preset = scenarioPresets.get(partition.scenarioPresetId);
  if (preset === undefined) {
    throw new Error(`scenario preset is not registered: ${partition.scenarioPresetId}`);
  }

  const tickBatchSize = partition.tickBatchSize ?? manifest.defaults.tickBatchSize;
  const tickIntervalMs = partition.tickIntervalMs ?? manifest.defaults.tickIntervalMs;
  assertPositiveInteger(tickBatchSize, 'tickBatchSize');
  assertNonNegativeFinite(tickIntervalMs, 'tickIntervalMs');
  resolveScenarioTimeDeltaMs(preset);

  return {
    simulationId: partition.simulationId,
    partitionKey: partition.partitionKey,
    scenarioPresetId: partition.scenarioPresetId,
    preset,
    loopId: partition.loopId ?? createDefaultLoopId(manifest.id, partition),
    tickBatchSize,
    tickIntervalMs,
    commandConsumerId:
      partition.commandConsumerId ?? createDefaultCommandConsumerId(manifest.defaults, partition),
    ...(partition.marketPools === undefined ? {} : { marketPools: partition.marketPools }),
    ...(partition.moneySupply === undefined ? {} : { moneySupply: partition.moneySupply }),
  };
}

export function resolveScenarioTimeDeltaMs(preset: ScenarioPreset): number {
  assertPositiveFinite(preset.clock.tickDurationMs, 'scenario clock.tickDurationMs');
  assertPositiveFinite(preset.timeScale, 'scenario timeScale');
  const timeDeltaMs = preset.clock.tickDurationMs * preset.timeScale;
  assertPositiveFinite(timeDeltaMs, 'scenario scaled timeDeltaMs');
  return timeDeltaMs;
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

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}
