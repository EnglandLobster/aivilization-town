import { type PartitionKey, type SimulationTimestamp } from '@aivilization/sim-core';
import {
  createLocalSimulationBackendRegistry,
  type LocalSimulationBackendRegistry,
} from './localSimulationBackendRegistry';
import {
  bootstrapLocalScenarioRuntime,
  type LocalScenarioRuntimeBootstrapResult,
} from './localScenarioBootstrap';
import {
  createLocalSimulationBackendRegistrationsFromResolvedManifest,
  resolveLocalSimulationRuntimeManifest,
  type LocalSimulationRuntimeRegistryInput,
} from './localSimulationRuntimeManifest';

export type LocalSimulationRuntimeHostInput = LocalSimulationRuntimeRegistryInput & {
  readonly bootstrappedAt: SimulationTimestamp;
};

export type LocalSimulationRuntimeHostPartition = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly scenarioPresetId: string;
  readonly bootstrap: LocalScenarioRuntimeBootstrapResult;
};

export type LocalSimulationRuntimeHost = {
  readonly rootDir: string;
  readonly manifestId: string;
  readonly registry: LocalSimulationBackendRegistry;
  readonly partitions: readonly LocalSimulationRuntimeHostPartition[];
};

export async function bootstrapLocalSimulationRuntimeHostFromManifest(
  input: LocalSimulationRuntimeHostInput,
): Promise<LocalSimulationRuntimeHost> {
  const resolvedManifest = resolveLocalSimulationRuntimeManifest({
    manifest: input.manifest,
    scenarioPresets: input.scenarioPresets,
  });
  const partitions = await Promise.all(
    resolvedManifest.partitions.map(async (partition) => {
      const bootstrap = await bootstrapLocalScenarioRuntime({
        rootDir: input.rootDir,
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        preset: partition.preset,
        ...(partition.marketPools === undefined ? {} : { marketPools: partition.marketPools }),
        ...(partition.moneySupply === undefined ? {} : { moneySupply: partition.moneySupply }),
        bootstrappedAt: input.bootstrappedAt,
      });

      return {
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        scenarioPresetId: partition.scenarioPresetId,
        bootstrap,
      };
    }),
  );
  const registry = createLocalSimulationBackendRegistry({
    rootDir: input.rootDir,
    registrations: createLocalSimulationBackendRegistrationsFromResolvedManifest({
      resolvedManifest,
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
      ...(input.agentProvider === undefined ? {} : { agentProvider: input.agentProvider }),
      ...(input.validationSchedule === undefined
        ? {}
        : { validationSchedule: input.validationSchedule }),
      ...(input.memoryConsolidationSchedule === undefined
        ? {}
        : { memoryConsolidationSchedule: input.memoryConsolidationSchedule }),
    }),
  });

  return {
    rootDir: input.rootDir,
    manifestId: resolvedManifest.id,
    registry,
    partitions,
  };
}
