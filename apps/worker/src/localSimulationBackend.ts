import {
  createCommandStoreSteeringSubmissionPort,
  createSimulationApiService,
  type AgentProfileQueryPort,
  type CommandStoreSteeringSubmissionResult,
  type ExperimentValidationReportQueryPort,
  type MarketObservationQueryPort,
  type SimulationEventFeedPort,
  type SimulationSyncPort,
  type ProjectionQueryPort,
  type SimulationApiService,
  type SimulationLifecyclePort,
  type SteeringCommandSubmissionPort,
} from '@aivilization/api';
import { type LongTermAgentProfile } from '@aivilization/memory';
import type {
  ExperimentValidationReport,
  MarketOhlcBar,
  MarketTradeObservation,
} from '@aivilization/observability';
import { asAgentId } from '@aivilization/sim-core';
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

export type LocalWorldSyncResult = {
  readonly streamName: string;
  readonly streamVersion: number;
  readonly projectionSequence: number;
  readonly projection: WorldProjection;
  readonly nextAfterSequence: number;
  readonly hasMoreEvents: boolean;
  readonly events: readonly WorldEvent[];
};

export type LocalExperimentValidationReportQueryResult = ExperimentValidationReport;
export type LocalMarketTradeObservationQueryResult = MarketTradeObservation;
export type LocalMarketOhlcBarQueryResult = MarketOhlcBar;
export type LocalAgentProfileQueryResult = LongTermAgentProfile;

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
    LocalWorldEventFeedResult,
    LocalWorldSyncResult,
    LocalExperimentValidationReportQueryResult
  >;
  readonly agentProfiles: AgentProfileQueryPort<LocalAgentProfileQueryResult>;
  readonly projectionQueries: ProjectionQueryPort<LocalWorldProjectionQueryResult>;
  readonly eventFeeds: SimulationEventFeedPort<LocalWorldEventFeedResult>;
  readonly sync: SimulationSyncPort<LocalWorldSyncResult>;
  readonly validationReports: ExperimentValidationReportQueryPort<LocalExperimentValidationReportQueryResult>;
  readonly marketObservations: MarketObservationQueryPort;
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
  const sync = createLocalWorldSyncPort({
    storage: input.storage,
    initialProjection: input.initialProjection,
  });
  const validationReports = createLocalExperimentValidationReportQueryPort({
    storage: input.storage,
  });
  const marketObservations = createLocalMarketObservationQueryPort({
    storage: input.storage,
  });
  const agentProfiles = createLocalAgentProfileQueryPort({
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
    LocalSimulationBackendLifecycleResult,
    LocalWorldEventFeedResult,
    LocalWorldSyncResult,
    LocalExperimentValidationReportQueryResult
  >({
    projectionQueries,
    eventFeeds,
    sync,
    validationReports,
    marketObservations,
    steeringCommands,
    lifecycle,
  });

  return {
    storage: input.storage,
    api,
    agentProfiles,
    projectionQueries,
    eventFeeds,
    sync,
    validationReports,
    marketObservations,
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

export function createLocalWorldSyncPort(input: {
  readonly storage: LocalWorldRuntimeStorage;
  readonly initialProjection: WorldProjection;
}): SimulationSyncPort<LocalWorldSyncResult> {
  return {
    getSync: (request) => {
      return Promise.resolve().then(() => {
        assertRequestMatchesStorage(request, input.storage);
        const streamName = input.storage.partition.eventStreamName;
        const hydrated = hydrateWorldProjectionFromEventStream({
          initialProjection: input.initialProjection,
          eventStore: input.storage.eventStore,
          streamName,
          checkpoint: {
            checkpointStore: input.storage.checkpointStore,
            snapshotStore: input.storage.snapshotStore,
            lookup: {
              simulationId: input.storage.partition.simulationId,
              partitionKey: input.storage.partition.partitionKey,
            },
          },
        });
        const afterSequence = request.afterSequence ?? hydrated.streamVersion;
        const events = input.storage.eventStore
          .readStream(streamName, {
            afterSequence,
            ...(request.limit === undefined ? {} : { limit: request.limit }),
          })
          .filter((event) => event.sequence <= hydrated.streamVersion);
        const lastEvent = events.at(-1);
        const nextAfterSequence = lastEvent?.sequence ?? afterSequence;
        return {
          streamName,
          streamVersion: hydrated.streamVersion,
          projectionSequence: hydrated.lastAppliedSequence,
          projection: hydrated.projection,
          nextAfterSequence,
          hasMoreEvents: nextAfterSequence < hydrated.streamVersion,
          events,
        };
      });
    },
  };
}

export function createLocalExperimentValidationReportQueryPort(input: {
  readonly storage: LocalWorldRuntimeStorage;
}): ExperimentValidationReportQueryPort<LocalExperimentValidationReportQueryResult> {
  return {
    getReport: async (request) => {
      assertRequestMatchesStorage(request, input.storage);
      const report = await input.storage.experimentValidationReportRepository.get(request.runId);
      if (report?.run.simulationId !== request.simulationId) {
        return undefined;
      }
      return report;
    },
    queryReports: (request) => {
      return Promise.resolve().then(() => {
        assertRequestMatchesStorage(request, input.storage);
        return input.storage.experimentValidationReportRepository.query({
          simulationId: request.simulationId,
          ...(request.runId === undefined ? {} : { runId: request.runId }),
          ...(request.fromGeneratedAt === undefined
            ? {}
            : { fromGeneratedAt: request.fromGeneratedAt }),
          ...(request.toGeneratedAt === undefined ? {} : { toGeneratedAt: request.toGeneratedAt }),
          ...(request.limit === undefined ? {} : { limit: request.limit }),
        });
      });
    },
  };
}

export function createLocalMarketObservationQueryPort(input: {
  readonly storage: LocalWorldRuntimeStorage;
}): MarketObservationQueryPort {
  return {
    queryMarketTradeObservations: (request) => {
      return Promise.resolve().then(() => {
        assertRequestMatchesStorage(request, input.storage);
        return input.storage.marketObservationRepository.queryTrades({
          simulationId: request.simulationId,
          ...(request.commodityId === undefined ? {} : { commodityId: request.commodityId }),
          ...(request.fromObservedAt === undefined
            ? {}
            : { fromObservedAt: request.fromObservedAt }),
          ...(request.toObservedAt === undefined ? {} : { toObservedAt: request.toObservedAt }),
          ...(request.limit === undefined ? {} : { limit: request.limit }),
        });
      });
    },
    queryMarketOhlcBars: (request) => {
      return Promise.resolve().then(() => {
        assertRequestMatchesStorage(request, input.storage);
        return input.storage.marketObservationRepository.queryOhlcBars({
          simulationId: request.simulationId,
          ...(request.commodityId === undefined ? {} : { commodityId: request.commodityId }),
          ...(request.fromIntervalStartedAt === undefined
            ? {}
            : { fromIntervalStartedAt: request.fromIntervalStartedAt }),
          ...(request.toIntervalStartedAt === undefined
            ? {}
            : { toIntervalStartedAt: request.toIntervalStartedAt }),
          ...(request.limit === undefined ? {} : { limit: request.limit }),
        });
      });
    },
  };
}

export function createLocalAgentProfileQueryPort(input: {
  readonly storage: LocalWorldRuntimeStorage;
  readonly initialProjection: WorldProjection;
}): AgentProfileQueryPort<LocalAgentProfileQueryResult> {
  return {
    getProfile: async (request) => {
      assertRequestMatchesStorage(request, input.storage);
      const agentIds = getProjectedAgentIds(input);
      if (!agentIds.includes(request.agentId)) {
        return undefined;
      }
      return input.storage.longTermProfileRepository.getOrCreate(asAgentId(request.agentId));
    },
    queryProfiles: async (request) => {
      assertRequestMatchesStorage(request, input.storage);
      const agentIds = getProjectedAgentIds(input)
        .filter((agentId) => request.agentId === undefined || agentId === request.agentId)
        .slice(0, request.limit);
      return Promise.all(
        agentIds.map((agentId) =>
          input.storage.longTermProfileRepository.getOrCreate(asAgentId(agentId)),
        ),
      );
    },
  };
}

function getProjectedAgentIds(input: {
  readonly storage: LocalWorldRuntimeStorage;
  readonly initialProjection: WorldProjection;
}): readonly string[] {
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

  return Object.keys(hydrated.projection.agents).sort((left, right) => left.localeCompare(right));
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
