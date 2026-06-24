import {
  createCommandEnvelope,
  type CommandEnvelope,
  type PartitionKey,
  type SimulationTimestamp,
} from '@aivilization/sim-core';
import type {
  MarketOhlcBar,
  MarketTradeObservation,
} from '@aivilization/observability';

export type ProjectionQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
};

export type SimulationEventFeedRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly afterSequence?: number;
  readonly limit?: number;
};

export type SimulationSyncRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly afterSequence?: number;
  readonly limit?: number;
};

export type ExperimentValidationReportLookupRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly runId: string;
};

export type ExperimentValidationReportQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly runId?: string;
  readonly fromGeneratedAt?: number;
  readonly toGeneratedAt?: number;
  readonly limit?: number;
};

export type MarketTradeObservationQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly commodityId?: string;
  readonly fromObservedAt?: number;
  readonly toObservedAt?: number;
  readonly limit?: number;
};

export type MarketOhlcBarQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly commodityId?: string;
  readonly fromIntervalStartedAt?: number;
  readonly toIntervalStartedAt?: number;
  readonly limit?: number;
};

export type SimulationLifecycleRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly requestedAt: SimulationTimestamp;
  readonly scenarioPresetId?: string;
  readonly fromSequence?: number;
  readonly toSequence?: number;
};

export type SubmitLongHorizonObjectiveRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly agentId: string;
  readonly objectiveId: string;
  readonly statement: string;
  readonly priority: number;
  readonly affinityTags: readonly string[];
  readonly issuedAt: SimulationTimestamp;
  readonly commandId?: string;
  readonly idempotencyKey?: string;
  readonly expectedVersion?: number;
};

export type SubmitReactiveCommandRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly agentId: string;
  readonly reactiveCommandId: string;
  readonly summary: string;
  readonly tags?: readonly string[];
  readonly issuedAt: SimulationTimestamp;
  readonly commandId?: string;
  readonly idempotencyKey?: string;
  readonly expectedVersion?: number;
};

export type ProjectionQueryPort<TProjection> = {
  readonly getProjection: (request: ProjectionQueryRequest) => Promise<TProjection>;
};

export type SimulationEventFeedPort<TResult> = {
  readonly getEvents: (request: SimulationEventFeedRequest) => Promise<TResult>;
};

export type SimulationSyncPort<TResult> = {
  readonly getSync: (request: SimulationSyncRequest) => Promise<TResult>;
};

export type ExperimentValidationReportQueryPort<TReport> = {
  readonly getReport: (
    request: ExperimentValidationReportLookupRequest,
  ) => Promise<TReport | undefined>;
  readonly queryReports: (
    request: ExperimentValidationReportQueryRequest,
  ) => Promise<readonly TReport[]>;
};

export type MarketObservationQueryPort = {
  readonly queryMarketTradeObservations: (
    request: MarketTradeObservationQueryRequest,
  ) => Promise<readonly MarketTradeObservation[]>;
  readonly queryMarketOhlcBars: (
    request: MarketOhlcBarQueryRequest,
  ) => Promise<readonly MarketOhlcBar[]>;
};

export type SteeringCommandSubmissionContext = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
};

export type SteeringCommandSubmissionPort<TResult> = {
  readonly submit: (
    command: CommandEnvelope,
    context: SteeringCommandSubmissionContext,
  ) => Promise<TResult>;
};

export type SimulationLifecyclePort<TResult> = {
  readonly start: (request: SimulationLifecycleRequest) => Promise<TResult>;
  readonly pause: (request: SimulationLifecycleRequest) => Promise<TResult>;
  readonly reset: (request: SimulationLifecycleRequest) => Promise<TResult>;
  readonly replay: (request: SimulationLifecycleRequest) => Promise<TResult>;
};

export type SimulationApiService<
  TProjection,
  TSteeringResult,
  TLifecycleResult,
  TEventFeed,
  TSync,
  TExperimentValidationReport,
> = {
  readonly getProjection: (request: ProjectionQueryRequest) => Promise<TProjection>;
  readonly getEvents: (request: SimulationEventFeedRequest) => Promise<TEventFeed>;
  readonly getSync: (request: SimulationSyncRequest) => Promise<TSync>;
  readonly getExperimentValidationReport: (
    request: ExperimentValidationReportLookupRequest,
  ) => Promise<TExperimentValidationReport | undefined>;
  readonly queryExperimentValidationReports: (
    request: ExperimentValidationReportQueryRequest,
  ) => Promise<readonly TExperimentValidationReport[]>;
  readonly queryMarketTradeObservations: (
    request: MarketTradeObservationQueryRequest,
  ) => Promise<readonly MarketTradeObservation[]>;
  readonly queryMarketOhlcBars: (
    request: MarketOhlcBarQueryRequest,
  ) => Promise<readonly MarketOhlcBar[]>;
  readonly submitLongHorizonObjective: (
    request: SubmitLongHorizonObjectiveRequest,
  ) => Promise<ApiCommandSubmission<TSteeringResult>>;
  readonly submitReactiveCommand: (
    request: SubmitReactiveCommandRequest,
  ) => Promise<ApiCommandSubmission<TSteeringResult>>;
  readonly startSimulation: (request: SimulationLifecycleRequest) => Promise<TLifecycleResult>;
  readonly pauseSimulation: (request: SimulationLifecycleRequest) => Promise<TLifecycleResult>;
  readonly resetSimulation: (request: SimulationLifecycleRequest) => Promise<TLifecycleResult>;
  readonly replaySimulation: (request: SimulationLifecycleRequest) => Promise<TLifecycleResult>;
};

export type ApiCommandSubmission<TResult> = {
  readonly command: CommandEnvelope;
  readonly result: TResult;
};

export function createSimulationApiService<
  TProjection,
  TSteeringResult,
  TLifecycleResult,
  TEventFeed,
  TSync,
  TExperimentValidationReport,
>(input: {
  readonly projectionQueries: ProjectionQueryPort<TProjection>;
  readonly eventFeeds: SimulationEventFeedPort<TEventFeed>;
  readonly sync: SimulationSyncPort<TSync>;
  readonly validationReports: ExperimentValidationReportQueryPort<TExperimentValidationReport>;
  readonly marketObservations: MarketObservationQueryPort;
  readonly steeringCommands: SteeringCommandSubmissionPort<TSteeringResult>;
  readonly lifecycle: SimulationLifecyclePort<TLifecycleResult>;
}): SimulationApiService<
  TProjection,
  TSteeringResult,
  TLifecycleResult,
  TEventFeed,
  TSync,
  TExperimentValidationReport
> {
  return {
    getProjection: async (request) => input.projectionQueries.getProjection(request),
    getEvents: async (request) => input.eventFeeds.getEvents(request),
    getSync: async (request) => input.sync.getSync(request),
    getExperimentValidationReport: async (request) => input.validationReports.getReport(request),
    queryExperimentValidationReports: async (request) =>
      input.validationReports.queryReports(request),
    queryMarketTradeObservations: async (request) =>
      input.marketObservations.queryMarketTradeObservations(request),
    queryMarketOhlcBars: async (request) => input.marketObservations.queryMarketOhlcBars(request),
    submitLongHorizonObjective: async (request) => {
      const command = createLongHorizonObjectiveCommand(request);
      const result = await input.steeringCommands.submit(command, createSteeringContext(request));
      return { command, result };
    },
    submitReactiveCommand: async (request) => {
      const command = createReactiveCommand(request);
      const result = await input.steeringCommands.submit(command, createSteeringContext(request));
      return { command, result };
    },
    startSimulation: async (request) => input.lifecycle.start(request),
    pauseSimulation: async (request) => input.lifecycle.pause(request),
    resetSimulation: async (request) => input.lifecycle.reset(request),
    replaySimulation: async (request) => input.lifecycle.replay(request),
  };
}

function createSteeringContext(request: {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
}): SteeringCommandSubmissionContext {
  return {
    simulationId: request.simulationId,
    partitionKey: request.partitionKey,
  };
}

function createLongHorizonObjectiveCommand(
  request: SubmitLongHorizonObjectiveRequest,
): CommandEnvelope<'SetLongHorizonObjective'> {
  return createCommandEnvelope({
    id:
      request.commandId ??
      `api-objective-${request.simulationId}-${request.agentId}-${request.objectiveId}`,
    simulationId: request.simulationId,
    ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
    actorId: request.agentId,
    source: 'human',
    type: 'SetLongHorizonObjective',
    payload: {
      objectiveId: request.objectiveId,
      statement: request.statement,
      priority: request.priority,
      affinityTags: request.affinityTags,
    },
    issuedAt: request.issuedAt,
    ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }),
  });
}

function createReactiveCommand(
  request: SubmitReactiveCommandRequest,
): CommandEnvelope<'IssueReactiveCommand'> {
  return createCommandEnvelope({
    id:
      request.commandId ??
      `api-reactive-${request.simulationId}-${request.agentId}-${request.reactiveCommandId}`,
    simulationId: request.simulationId,
    ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
    actorId: request.agentId,
    source: 'human',
    type: 'IssueReactiveCommand',
    payload: {
      reactiveCommandId: request.reactiveCommandId,
      summary: request.summary,
      ...(request.tags === undefined ? {} : { tags: request.tags }),
    },
    issuedAt: request.issuedAt,
    ...(request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion }),
  });
}
