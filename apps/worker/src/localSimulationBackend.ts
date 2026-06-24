import {
  createCommandStoreSteeringSubmissionPort,
  createSimulationApiService,
  type CommandStoreSteeringSubmissionResult,
  type ProjectionQueryPort,
  type SimulationApiService,
  type SimulationLifecyclePort,
  type SteeringCommandSubmissionPort,
} from '@aivilization/api';
import type { WorldProjection } from '@aivilization/world';
import type {
  LocalSimulationLifecyclePauseResult,
  LocalSimulationLifecycleReplayResult,
  LocalSimulationLifecycleResetResult,
  LocalSimulationLifecycleStartResult,
} from './localSimulationLifecycle';
import {
  createLocalSimulationLifecycleController,
  type LocalSimulationLifecycleControllerInput,
} from './localSimulationLifecycle';
import type { LocalWorldRuntimeStorage } from './localRuntimeStorage';
import {
  hydrateWorldProjectionFromEventStream,
  type WorldProjectionHydrationResult,
} from './projectionHydration';

export type LocalWorldProjectionQueryResult = WorldProjectionHydrationResult;

export type LocalSimulationBackendLifecycleResult =
  | LocalSimulationLifecycleStartResult
  | LocalSimulationLifecyclePauseResult
  | LocalSimulationLifecycleResetResult
  | LocalSimulationLifecycleReplayResult;

export type LocalSimulationBackendInput = LocalSimulationLifecycleControllerInput;

export type LocalSimulationBackend = {
  readonly storage: LocalWorldRuntimeStorage;
  readonly api: SimulationApiService<
    LocalWorldProjectionQueryResult,
    CommandStoreSteeringSubmissionResult,
    LocalSimulationBackendLifecycleResult
  >;
  readonly projectionQueries: ProjectionQueryPort<LocalWorldProjectionQueryResult>;
  readonly steeringCommands: SteeringCommandSubmissionPort<CommandStoreSteeringSubmissionResult>;
  readonly lifecycle: SimulationLifecyclePort<LocalSimulationBackendLifecycleResult>;
};

export function createLocalSimulationBackend(
  input: LocalSimulationBackendInput,
): LocalSimulationBackend {
  const projectionQueries = createLocalWorldProjectionQueryPort({
    storage: input.storage,
    initialProjection: input.initialProjection,
  });
  const commandStoreSteeringCommands = createCommandStoreSteeringSubmissionPort({
    commandStore: input.storage.commandStore,
  });
  const steeringCommands: SteeringCommandSubmissionPort<CommandStoreSteeringSubmissionResult> = {
    submit: (command, context) => {
      assertRequestMatchesStorage(context, input.storage);
      return commandStoreSteeringCommands.submit(command, context);
    },
  };
  const lifecycle: SimulationLifecyclePort<LocalSimulationBackendLifecycleResult> =
    createLocalSimulationLifecycleController({
      ...input,
      lifecycleStateStore: input.lifecycleStateStore ?? input.storage.lifecycleStateStore,
    });
  const api = createSimulationApiService<
    LocalWorldProjectionQueryResult,
    CommandStoreSteeringSubmissionResult,
    LocalSimulationBackendLifecycleResult
  >({
    projectionQueries,
    steeringCommands,
    lifecycle,
  });

  return {
    storage: input.storage,
    api,
    projectionQueries,
    steeringCommands,
    lifecycle,
  };
}

export function createLocalWorldProjectionQueryPort(input: {
  readonly storage: LocalWorldRuntimeStorage;
  readonly initialProjection: WorldProjection;
}): ProjectionQueryPort<LocalWorldProjectionQueryResult> {
  return {
    getProjection: (request) => {
      assertRequestMatchesStorage(request, input.storage);
      return Promise.resolve(
        hydrateWorldProjectionFromEventStream({
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
        }),
      );
    },
  };
}

function assertRequestMatchesStorage(
  request: { readonly simulationId: string; readonly partitionKey: string },
  storage: LocalWorldRuntimeStorage,
): void {
  if (request.simulationId !== storage.partition.simulationId) {
    throw new Error(
      `request simulationId ${request.simulationId} must match storage simulationId ${storage.partition.simulationId}`,
    );
  }
  if (request.partitionKey !== storage.partition.partitionKey) {
    throw new Error(
      `request partitionKey ${request.partitionKey} must match storage partitionKey ${storage.partition.partitionKey}`,
    );
  }
}
