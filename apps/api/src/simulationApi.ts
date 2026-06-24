import {
  createCommandEnvelope,
  type CommandEnvelope,
  type PartitionKey,
  type SimulationTimestamp,
} from '@aivilization/sim-core';

export type ProjectionQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
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

export type SimulationApiService<TProjection, TSteeringResult, TLifecycleResult> = {
  readonly getProjection: (request: ProjectionQueryRequest) => Promise<TProjection>;
  readonly submitLongHorizonObjective: (
    request: SubmitLongHorizonObjectiveRequest,
  ) => Promise<ApiCommandSubmission<TSteeringResult>>;
  readonly submitReactiveCommand: (
    request: SubmitReactiveCommandRequest,
  ) => Promise<ApiCommandSubmission<TSteeringResult>>;
  readonly startSimulation: (
    request: SimulationLifecycleRequest,
  ) => Promise<TLifecycleResult>;
  readonly pauseSimulation: (
    request: SimulationLifecycleRequest,
  ) => Promise<TLifecycleResult>;
  readonly resetSimulation: (
    request: SimulationLifecycleRequest,
  ) => Promise<TLifecycleResult>;
  readonly replaySimulation: (
    request: SimulationLifecycleRequest,
  ) => Promise<TLifecycleResult>;
};

export type ApiCommandSubmission<TResult> = {
  readonly command: CommandEnvelope;
  readonly result: TResult;
};

export function createSimulationApiService<TProjection, TSteeringResult, TLifecycleResult>(input: {
  readonly projectionQueries: ProjectionQueryPort<TProjection>;
  readonly steeringCommands: SteeringCommandSubmissionPort<TSteeringResult>;
  readonly lifecycle: SimulationLifecyclePort<TLifecycleResult>;
}): SimulationApiService<TProjection, TSteeringResult, TLifecycleResult> {
  return {
    getProjection: (request) => input.projectionQueries.getProjection(request),
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
    startSimulation: (request) => input.lifecycle.start(request),
    pauseSimulation: (request) => input.lifecycle.pause(request),
    resetSimulation: (request) => input.lifecycle.reset(request),
    replaySimulation: (request) => input.lifecycle.replay(request),
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
