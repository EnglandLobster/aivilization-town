import type {
  ReactiveActionSimulator,
  ReactiveLocalizedPlanner,
  ReactiveRepairPolicy,
  StrategicPlanCompiler,
} from '@aivilization/agent-runtime';
import type { CommandConsumerId, SimulationId } from '@aivilization/sim-core';
import type { WorldProjection } from '@aivilization/world';
import {
  drainLocalRuntimeSteeringCommandsToWorld,
  type LocalRuntimeSteeringCommandWorldDrainResult,
} from './localCommandDrain';
import type { LocalWorldRuntimeStorage } from './localRuntimeStorage';
import { hydrateWorldProjectionFromEventStream } from './projectionHydration';
import {
  runWorkerSimulationTick,
  type WorkerTickAgentInput,
  type WorkerTickMarketMetricsInput,
  type WorkerTickResult,
} from './tickRunner';
import type { WorldCommandPolicySource } from './worldCommandPolicySource';

export type LocalWorldRuntimeAgentProviderInput = {
  readonly storage: LocalWorldRuntimeStorage;
  readonly simulationId: SimulationId | string;
  readonly issuedAt: number;
  readonly projection: WorldProjection;
};

export type LocalWorldRuntimeAgentProvider = (
  input: LocalWorldRuntimeAgentProviderInput,
) => readonly WorkerTickAgentInput[] | Promise<readonly WorkerTickAgentInput[]>;

export type LocalWorldRuntimeStepInput = {
  readonly storage: LocalWorldRuntimeStorage;
  readonly tickId: string;
  readonly simulationId: SimulationId | string;
  readonly issuedAt: number;
  readonly initialProjection: WorldProjection;
  readonly policies: WorldCommandPolicySource;
  readonly commandConsumerId: CommandConsumerId;
  readonly commandCheckpointUpdatedAt?: number;
  readonly localizedPlanners: readonly ReactiveLocalizedPlanner[];
  readonly steeringSimulator: ReactiveActionSimulator;
  readonly steeringRepair?: ReactiveRepairPolicy;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly commandDrainLimit?: number;
  readonly agents: readonly WorkerTickAgentInput[];
  readonly agentProvider?: LocalWorldRuntimeAgentProvider;
  readonly timeDeltaMs?: number;
  readonly marketMetrics?: WorkerTickMarketMetricsInput;
};

export type LocalWorldRuntimeStepResult =
  | {
      readonly status: 'command-drain-failed';
      readonly commandDrain: LocalRuntimeSteeringCommandWorldDrainResult;
      readonly projection: WorldProjection;
    }
  | {
      readonly status: 'ticked';
      readonly commandDrain: LocalRuntimeSteeringCommandWorldDrainResult;
      readonly tick: WorkerTickResult;
      readonly projection: WorldProjection;
    };

export async function runLocalWorldRuntimeStep(
  input: LocalWorldRuntimeStepInput,
): Promise<LocalWorldRuntimeStepResult> {
  const hydrated = hydrateWorldProjectionFromEventStream({
    initialProjection: input.initialProjection,
    eventStore: input.storage.eventStore,
    streamName: input.storage.partition.eventStreamName,
    checkpoint: {
      checkpointStore: input.storage.checkpointStore,
      snapshotStore: input.storage.snapshotStore,
      lookup: {
        simulationId: input.storage.partition.simulationId,
        partitionKey: input.storage.partition.partitionKey,
      },
    },
  });
  const commandDrain = await drainLocalRuntimeSteeringCommandsToWorld({
    storage: input.storage,
    consumerId: input.commandConsumerId,
    checkpointUpdatedAt: input.commandCheckpointUpdatedAt ?? input.issuedAt,
    projection: hydrated.projection,
    policies: input.policies,
    localizedPlanners: input.localizedPlanners,
    simulate: input.steeringSimulator,
    ...(input.steeringRepair === undefined ? {} : { repair: input.steeringRepair }),
    ...(input.strategicPlanCompiler === undefined
      ? {}
      : { strategicPlanCompiler: input.strategicPlanCompiler }),
    ...(input.commandDrainLimit === undefined ? {} : { limit: input.commandDrainLimit }),
  });

  if (commandDrain.status === 'failed') {
    return {
      status: 'command-drain-failed',
      commandDrain,
      projection: commandDrain.projection,
    };
  }

  const agents = await resolveTickAgents({
    input,
    projection: commandDrain.projection,
  });
  const tick = await runWorkerSimulationTick({
    tickId: input.tickId,
    simulationId: input.storage.partition.simulationId,
    issuedAt: input.issuedAt,
    projection: commandDrain.projection,
    policies: input.policies,
    eventStore: input.storage.eventStore,
    streamName: input.storage.partition.eventStreamName,
    checkpointing: input.storage.checkpointing,
    traceSink: input.storage.agentCycleTraceRepository,
    agents,
    ...input.storage.repositories,
    ...(input.timeDeltaMs === undefined ? {} : { timeDeltaMs: input.timeDeltaMs }),
    ...(input.marketMetrics === undefined ? {} : { marketMetrics: input.marketMetrics }),
  });

  return {
    status: 'ticked',
    commandDrain,
    tick,
    projection: tick.projection,
  };
}

async function resolveTickAgents(input: {
  readonly input: LocalWorldRuntimeStepInput;
  readonly projection: WorldProjection;
}): Promise<readonly WorkerTickAgentInput[]> {
  const providedAgents =
    (await input.input.agentProvider?.({
      storage: input.input.storage,
      simulationId: input.input.simulationId,
      issuedAt: input.input.issuedAt,
      projection: input.projection,
    })) ?? [];

  return [...input.input.agents, ...providedAgents];
}
