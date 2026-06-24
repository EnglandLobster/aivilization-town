import {
  createCommandStoreSteeringSubmissionPort,
  createSimulationApiService,
  type CommandStoreSteeringSubmissionResult,
  type SimulationEventFeedPort,
  type ProjectionQueryPort,
  type SimulationApiService,
  type SimulationLifecyclePort,
  type SteeringCommandSubmissionPort,
} from '@aivilization/api';
import type { WorldEvent, WorldProjection } from '@aivilization/world';
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

export type LocalWorldEventFeedResult = {
  readonly streamName: string;
  readonly streamVersion: number;
  readonly nextAfterSequence: number;
  readonly events: readonly WorldEvent[];
};

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
    LocalSimulationBackendLifecycleResult,
    LocalWorldEventFeedResult
  >;
  readonly projectionQueries: ProjectionQueryPort<LocalWorldProjectionQueryResult>;
  readonly eventFeeds: SimulationEventFeedPort<LocalWorldEventFeedResult>;
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
  const eventFeeds = createLocalWorldEventFeedPort({
    storage: input.storage,
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
    LocalSimulationBackendLifecycleResult,
    LocalWorldEventFeedResult
  >({
    projectionQueries,
    eventFeeds,
    steeringCommands,
    lifecycle,
  });

  return {
    storage: input.storage,
    api,
    projectionQueries,
    eventFeeds,
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

export function createLocalWorldEventFeedPort(input: {
  readonly storage: LocalWorldRuntimeStorage;
}): SimulationEventFeedPort<LocalWorldEventFeedResult> {
  return {
    getEvents: (request) => {
      return Promise.resolve().then(() => {
        assertRequestMatchesStorage(request, input.storage);
        const events = input.storage.eventStore.readStream(
          input.storage.partition.eventStreamName,
          {
            ...(request.afterSequence === undefined
              ? {}
              : { afterSequence: request.afterSequence }),
            ...(request.limit === undefined ? {} : { limit: request.limit }),
          },
        );
        const lastEvent = events.at(-1);
        return {
          streamName: input.storage.partition.eventStreamName,
          streamVersion: input.storage.eventStore.getStreamVersion(
            input.storage.partition.eventStreamName,
          ),
          nextAfterSequence: lastEvent?.sequence ?? request.afterSequence ?? 0,
          events,
        };
      });
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
