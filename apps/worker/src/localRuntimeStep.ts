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
  type WorkerTickAmbientObservationMemoryInput,
  type WorkerTickMarketMetricsInput,
  type WorkerTickMarketObservationsInput,
  type WorkerTickResult,
} from './tickRunner';
import type { WorkerExperimentValidationPriceBinning } from './experimentValidationRunner';
import type { WorldCommandPolicySource } from './worldCommandPolicySource';
import type { LocalSimulationSocietyDirectory } from './localSimulationSocietyDirectory';

export type LocalWorldRuntimeAgentProviderInput = {
  readonly storage: LocalWorldRuntimeStorage;
  readonly simulationId: SimulationId | string;
  readonly issuedAt: number;
  readonly projection: WorldProjection;
  readonly societyDirectory?: LocalSimulationSocietyDirectory;
};

export type LocalWorldRuntimeAgentProvider = (
  input: LocalWorldRuntimeAgentProviderInput,
) => readonly WorkerTickAgentInput[] | Promise<readonly WorkerTickAgentInput[]>;

export type LocalWorldRuntimeMarketObservationsInput =
  | {
      readonly enabled?: true;
      readonly priceBinning?: WorkerExperimentValidationPriceBinning;
    }
  | {
      readonly enabled: false;
    };

export type LocalWorldRuntimeStepInput = {
  readonly storage: LocalWorldRuntimeStorage;
  readonly tickId: string;
  readonly simulationId: SimulationId | string;
  readonly issuedAt: number;
  readonly initialProjection: WorldProjection;
  /**
   * Replays an interrupted tick from its pre-tick authoritative boundary.
   * Existing append idempotency records reconstruct the exact partial prefix.
   */
  readonly recoveryToSequence?: number;
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
  readonly marketObservations?: LocalWorldRuntimeMarketObservationsInput;
  readonly ambientObservationMemory?: WorkerTickAmbientObservationMemoryInput;
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
    ...(input.recoveryToSequence === undefined ? {} : { toSequence: input.recoveryToSequence }),
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

  const tick = await runWorkerSimulationTick({
    tickId: input.tickId,
    simulationId: input.storage.partition.simulationId,
    issuedAt: input.issuedAt,
    projection: commandDrain.projection,
    policies: input.policies,
    eventStore: input.storage.eventStore,
    streamName: input.storage.partition.eventStreamName,
    ...(input.recoveryToSequence === undefined
      ? {}
      : { expectedVersion: hydrated.lastAppliedSequence }),
    ...(input.recoveryToSequence === undefined ? {} : { replayExistingAgentAppends: true }),
    checkpointing: input.storage.checkpointing,
    traceSink: input.storage.agentCycleTraceRepository,
    reactionEvaluationTraceSink: {
      simulationId: input.storage.partition.simulationId,
      partitionKey: input.storage.partition.partitionKey,
      record: (trace) => input.storage.reactionEvaluationTraceRepository.record(trace),
    },
    agents: input.agents,
    ...(input.agentProvider === undefined
      ? {}
      : {
          agentProvider: ({ projection }) =>
            input.agentProvider?.({
              storage: input.storage,
              simulationId: input.simulationId,
              issuedAt: input.issuedAt,
              projection,
            }) ?? [],
        }),
    ...input.storage.repositories,
    ...(input.timeDeltaMs === undefined ? {} : { timeDeltaMs: input.timeDeltaMs }),
    ...(input.marketMetrics === undefined ? {} : { marketMetrics: input.marketMetrics }),
    ...createTickMarketObservationsInput(input),
    ...createTickAmbientObservationMemoryInput(input),
    ...createTickFullReplanMaterializationInput(input),
  });

  return {
    status: 'ticked',
    commandDrain,
    tick,
    projection: tick.projection,
  };
}

function createTickMarketObservationsInput(
  input: LocalWorldRuntimeStepInput,
): { readonly marketObservations: WorkerTickMarketObservationsInput } | Record<string, never> {
  if (input.marketObservations?.enabled === false) {
    return {};
  }

  return {
    marketObservations: {
      repository: input.storage.marketObservationRepository,
      ...(input.marketObservations?.priceBinning === undefined
        ? {}
        : { priceBinning: input.marketObservations.priceBinning }),
    },
  };
}

function createTickAmbientObservationMemoryInput(input: LocalWorldRuntimeStepInput): {
  readonly ambientObservationMemory: WorkerTickAmbientObservationMemoryInput;
} {
  return {
    ambientObservationMemory: input.ambientObservationMemory ?? { enabled: true },
  };
}

function createTickFullReplanMaterializationInput(input: LocalWorldRuntimeStepInput): {
  readonly materializeFullReplan: {
    readonly strategicPlanCompiler?: StrategicPlanCompiler;
  };
} {
  return {
    materializeFullReplan: {
      ...(input.strategicPlanCompiler === undefined
        ? {}
        : { strategicPlanCompiler: input.strategicPlanCompiler }),
    },
  };
}
