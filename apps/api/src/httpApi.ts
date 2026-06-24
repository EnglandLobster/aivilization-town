import type {
  RuntimeSupervisorApiService,
  RuntimeSupervisorOperationTraceQuery,
  RuntimeSupervisorRunRequest,
} from './runtimeSupervisorApi';
import type { RuntimeDaemonApiService } from './runtimeDaemonApi';
import type {
  RuntimeProfileRunReportApiService,
  RuntimeProfileRunReportLookupRequest,
  RuntimeProfileRunReportQueryRequest,
} from './runtimeProfileRunReportApi';
import type {
  RuntimeRunQueueApiService,
  RuntimeRunQueueJobQueryRequest,
  RuntimeRunQueueJobStatus,
  RuntimeRunQueueReplayRequest,
  RuntimeRunQueueStatsRequest,
  RuntimeRunQueueSubmitRequest,
} from './runtimeRunQueueApi';
import type {
  RuntimeRunQueueWorkerApiService,
  RuntimeRunQueueWorkerDrainRequest,
} from './runtimeRunQueueWorkerApi';
import type { RuntimeRecoveryApiService } from './runtimeRecoveryApi';
import type { RuntimeSchedulerApiService } from './runtimeSchedulerApi';
import type {
  ExperimentValidationReportLookupRequest,
  ExperimentValidationReportQueryRequest,
  SimulationApiService,
  SimulationEventFeedRequest,
  SimulationLifecycleRequest,
  SimulationSyncRequest,
  SubmitLongHorizonObjectiveRequest,
  SubmitReactiveCommandRequest,
} from './simulationApi';

export type TownHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type TownHttpApiRequest = {
  readonly method: TownHttpMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body?: unknown;
};

export type TownHttpApiResponse = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
};

export type TownHttpApiHandler = (request: TownHttpApiRequest) => Promise<TownHttpApiResponse>;

export type TownHttpApiServices<
  TProjection,
  TSteeringResult,
  TLifecycleResult,
  TEventFeed,
  TSync,
  TExperimentValidationReport,
  TRuntimeStatus,
  TRuntimeStartResult,
  TRuntimePauseResult,
  TRuntimeRunResult,
  TRuntimeTrace,
  TRuntimeRunQueueJob,
  TRuntimeRunQueueWorkerStatus,
  TRuntimeRunQueueWorkerDrainResult,
  TRuntimeSchedulerStatus = unknown,
  TRuntimeSchedulerDecision = unknown,
  TRuntimeRecoveryStatus = unknown,
  TRuntimeRecoveryReport = unknown,
  TRuntimeDaemonStatus = unknown,
  TRuntimeCommand extends string = string,
> = {
  readonly simulation: SimulationApiService<
    TProjection,
    TSteeringResult,
    TLifecycleResult,
    TEventFeed,
    TSync,
    TExperimentValidationReport
  >;
  readonly runtimeSupervisor: RuntimeSupervisorApiService<
    TRuntimeStatus,
    TRuntimeStartResult,
    TRuntimePauseResult,
    TRuntimeRunResult,
    TRuntimeTrace,
    TRuntimeCommand
  >;
  readonly runtimeRunQueue: RuntimeRunQueueApiService<TRuntimeRunQueueJob>;
  readonly runtimeRunQueueWorker: RuntimeRunQueueWorkerApiService<
    TRuntimeRunQueueWorkerStatus,
    TRuntimeRunQueueWorkerDrainResult
  >;
  readonly runtimeScheduler?: RuntimeSchedulerApiService<
    TRuntimeSchedulerStatus,
    TRuntimeSchedulerDecision
  >;
  readonly runtimeRecovery?: RuntimeRecoveryApiService<
    TRuntimeRecoveryStatus,
    TRuntimeRecoveryReport
  >;
  readonly runtimeDaemon?: RuntimeDaemonApiService<TRuntimeDaemonStatus>;
  readonly runtimeProfileRunReports?: RuntimeProfileRunReportApiService<unknown>;
};

type SimulationRoute = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly action: string;
  readonly runId?: string;
};

class TownHttpApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const jsonHeaders = { 'content-type': 'application/json' };

export function createTownHttpApiHandler<
  TProjection,
  TSteeringResult,
  TLifecycleResult,
  TEventFeed,
  TSync,
  TExperimentValidationReport,
  TRuntimeStatus,
  TRuntimeStartResult,
  TRuntimePauseResult,
  TRuntimeRunResult,
  TRuntimeTrace,
  TRuntimeRunQueueJob,
  TRuntimeRunQueueWorkerStatus,
  TRuntimeRunQueueWorkerDrainResult,
  TRuntimeSchedulerStatus = unknown,
  TRuntimeSchedulerDecision = unknown,
  TRuntimeRecoveryStatus = unknown,
  TRuntimeRecoveryReport = unknown,
  TRuntimeDaemonStatus = unknown,
  TRuntimeCommand extends string = string,
>(
  services: TownHttpApiServices<
    TProjection,
    TSteeringResult,
    TLifecycleResult,
    TEventFeed,
    TSync,
    TExperimentValidationReport,
    TRuntimeStatus,
    TRuntimeStartResult,
    TRuntimePauseResult,
    TRuntimeRunResult,
    TRuntimeTrace,
    TRuntimeRunQueueJob,
    TRuntimeRunQueueWorkerStatus,
    TRuntimeRunQueueWorkerDrainResult,
    TRuntimeSchedulerStatus,
    TRuntimeSchedulerDecision,
    TRuntimeRecoveryStatus,
    TRuntimeRecoveryReport,
    TRuntimeDaemonStatus,
    TRuntimeCommand
  >,
): TownHttpApiHandler {
  return async (request) => {
    try {
      return await routeTownHttpRequest(services, request);
    } catch (error) {
      if (error instanceof TownHttpApiError) {
        return jsonResponse(error.status, {
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }
  };
}

async function routeTownHttpRequest<
  TProjection,
  TSteeringResult,
  TLifecycleResult,
  TEventFeed,
  TSync,
  TExperimentValidationReport,
  TRuntimeStatus,
  TRuntimeStartResult,
  TRuntimePauseResult,
  TRuntimeRunResult,
  TRuntimeTrace,
  TRuntimeRunQueueJob,
  TRuntimeRunQueueWorkerStatus,
  TRuntimeRunQueueWorkerDrainResult,
  TRuntimeSchedulerStatus = unknown,
  TRuntimeSchedulerDecision = unknown,
  TRuntimeRecoveryStatus = unknown,
  TRuntimeRecoveryReport = unknown,
  TRuntimeDaemonStatus = unknown,
  TRuntimeCommand extends string = string,
>(
  services: TownHttpApiServices<
    TProjection,
    TSteeringResult,
    TLifecycleResult,
    TEventFeed,
    TSync,
    TExperimentValidationReport,
    TRuntimeStatus,
    TRuntimeStartResult,
    TRuntimePauseResult,
    TRuntimeRunResult,
    TRuntimeTrace,
    TRuntimeRunQueueJob,
    TRuntimeRunQueueWorkerStatus,
    TRuntimeRunQueueWorkerDrainResult,
    TRuntimeSchedulerStatus,
    TRuntimeSchedulerDecision,
    TRuntimeRecoveryStatus,
    TRuntimeRecoveryReport,
    TRuntimeDaemonStatus,
    TRuntimeCommand
  >,
  request: TownHttpApiRequest,
): Promise<TownHttpApiResponse> {
  const segments = splitPath(request.path);
  const simulationRoute = matchSimulationRoute(segments);
  if (simulationRoute !== undefined) {
    return routeSimulationRequest(services.simulation, request, simulationRoute);
  }
  if (segments[0] === 'runtime') {
    return routeRuntimeRequest(
      services.runtimeSupervisor,
      services.runtimeRunQueue,
      services.runtimeRunQueueWorker,
      services.runtimeScheduler,
      services.runtimeRecovery,
      services.runtimeDaemon,
      services.runtimeProfileRunReports,
      request,
      segments,
    );
  }
  throw new TownHttpApiError(404, 'not_found', 'route not found');
}

async function routeSimulationRequest<
  TProjection,
  TSteeringResult,
  TLifecycleResult,
  TEventFeed,
  TSync,
  TExperimentValidationReport,
>(
  simulation: SimulationApiService<
    TProjection,
    TSteeringResult,
    TLifecycleResult,
    TEventFeed,
    TSync,
    TExperimentValidationReport
  >,
  request: TownHttpApiRequest,
  route: SimulationRoute,
): Promise<TownHttpApiResponse> {
  if (route.action === 'projection') {
    assertMethod(request, 'GET');
    return jsonResponse(
      200,
      await simulation.getProjection({
        simulationId: route.simulationId,
        partitionKey: route.partitionKey,
      }),
    );
  }
  if (route.action === 'events') {
    assertMethod(request, 'GET');
    return jsonResponse(
      200,
      await simulation.getEvents(createEventFeedRequest(route, request.query)),
    );
  }
  if (route.action === 'sync') {
    assertMethod(request, 'GET');
    return jsonResponse(200, await simulation.getSync(createSyncRequest(route, request.query)));
  }
  if (route.action === 'validation-reports') {
    assertMethod(request, 'GET');
    if (route.runId !== undefined) {
      return jsonResponse(
        200,
        await simulation.getExperimentValidationReport(createValidationReportLookupRequest(route)),
      );
    }
    return jsonResponse(
      200,
      await simulation.queryExperimentValidationReports(
        createValidationReportQueryRequest(route, request.query),
      ),
    );
  }
  assertMethod(request, 'POST');

  if (route.action === 'objectives') {
    return jsonResponse(
      202,
      await simulation.submitLongHorizonObjective(
        createLongHorizonObjectiveRequest(route, request.body),
      ),
    );
  }
  if (route.action === 'reactive-commands') {
    return jsonResponse(
      202,
      await simulation.submitReactiveCommand(createReactiveCommandRequest(route, request.body)),
    );
  }
  if (route.action === 'start') {
    return jsonResponse(
      202,
      await simulation.startSimulation(createLifecycleRequest(route, request.body)),
    );
  }
  if (route.action === 'pause') {
    return jsonResponse(
      202,
      await simulation.pauseSimulation(createLifecycleRequest(route, request.body)),
    );
  }
  if (route.action === 'reset') {
    return jsonResponse(
      202,
      await simulation.resetSimulation(createLifecycleRequest(route, request.body)),
    );
  }
  if (route.action === 'replay') {
    return jsonResponse(
      202,
      await simulation.replaySimulation(createLifecycleRequest(route, request.body)),
    );
  }
  throw new TownHttpApiError(404, 'not_found', 'route not found');
}

async function routeRuntimeRequest<
  TRuntimeStatus,
  TRuntimeStartResult,
  TRuntimePauseResult,
  TRuntimeRunResult,
  TRuntimeTrace,
  TRuntimeRunQueueJob,
  TRuntimeRunQueueWorkerStatus,
  TRuntimeRunQueueWorkerDrainResult,
  TRuntimeSchedulerStatus,
  TRuntimeSchedulerDecision,
  TRuntimeRecoveryStatus,
  TRuntimeRecoveryReport,
  TRuntimeDaemonStatus,
  TRuntimeCommand extends string,
>(
  runtimeSupervisor: RuntimeSupervisorApiService<
    TRuntimeStatus,
    TRuntimeStartResult,
    TRuntimePauseResult,
    TRuntimeRunResult,
    TRuntimeTrace,
    TRuntimeCommand
  >,
  runtimeRunQueue: RuntimeRunQueueApiService<TRuntimeRunQueueJob>,
  runtimeRunQueueWorker: RuntimeRunQueueWorkerApiService<
    TRuntimeRunQueueWorkerStatus,
    TRuntimeRunQueueWorkerDrainResult
  >,
  runtimeScheduler:
    | RuntimeSchedulerApiService<TRuntimeSchedulerStatus, TRuntimeSchedulerDecision>
    | undefined,
  runtimeRecovery:
    | RuntimeRecoveryApiService<TRuntimeRecoveryStatus, TRuntimeRecoveryReport>
    | undefined,
  runtimeDaemon: RuntimeDaemonApiService<TRuntimeDaemonStatus> | undefined,
  runtimeProfileRunReports: RuntimeProfileRunReportApiService<unknown> | undefined,
  request: TownHttpApiRequest,
  segments: readonly string[],
): Promise<TownHttpApiResponse> {
  if (segments.length === 3 && segments[1] === 'daemon') {
    if (runtimeDaemon === undefined) {
      throw new TownHttpApiError(404, 'not_found', 'route not found');
    }
    const action = segments[2];
    if (action === 'status') {
      assertMethod(request, 'GET');
      return jsonResponse(200, await runtimeDaemon.getRuntimeDaemonStatus());
    }
  }
  if (segments.length === 2 && segments[1] === 'profile-run-reports') {
    if (runtimeProfileRunReports === undefined) {
      throw new TownHttpApiError(404, 'not_found', 'route not found');
    }
    assertMethod(request, 'GET');
    return jsonResponse(
      200,
      await runtimeProfileRunReports.queryRuntimeProfileRunReports(
        createRuntimeProfileRunReportQueryRequest(request.query),
      ),
    );
  }
  if (segments.length === 3 && segments[1] === 'profile-run-reports') {
    if (runtimeProfileRunReports === undefined) {
      throw new TownHttpApiError(404, 'not_found', 'route not found');
    }
    assertMethod(request, 'GET');
    const runId = segments[2];
    if (runId === undefined) {
      throw new TownHttpApiError(404, 'not_found', 'route not found');
    }
    return jsonResponse(
      200,
      await runtimeProfileRunReports.getRuntimeProfileRunReport(
        createRuntimeProfileRunReportLookupRequest(decodePathPart(runId)),
      ),
    );
  }
  if (segments.length === 3 && segments[1] === 'scheduler') {
    if (runtimeScheduler === undefined) {
      throw new TownHttpApiError(404, 'not_found', 'route not found');
    }
    const action = segments[2];
    if (action === 'status') {
      assertMethod(request, 'GET');
      return jsonResponse(200, await runtimeScheduler.getRuntimeSchedulerStatus());
    }
    if (action === 'start') {
      assertMethod(request, 'POST');
      return jsonResponse(202, await runtimeScheduler.startRuntimeScheduler());
    }
    if (action === 'stop') {
      assertMethod(request, 'POST');
      return jsonResponse(202, await runtimeScheduler.stopRuntimeScheduler());
    }
    if (action === 'run-once') {
      assertMethod(request, 'POST');
      return jsonResponse(202, await runtimeScheduler.runRuntimeSchedulerOnce());
    }
  }
  if (segments.length === 3 && segments[1] === 'recovery') {
    if (runtimeRecovery === undefined) {
      throw new TownHttpApiError(404, 'not_found', 'route not found');
    }
    const action = segments[2];
    if (action === 'status') {
      assertMethod(request, 'GET');
      return jsonResponse(200, await runtimeRecovery.getRuntimeRecoveryStatus());
    }
    if (action === 'start') {
      assertMethod(request, 'POST');
      return jsonResponse(202, await runtimeRecovery.startRuntimeRecovery());
    }
    if (action === 'stop') {
      assertMethod(request, 'POST');
      return jsonResponse(202, await runtimeRecovery.stopRuntimeRecovery());
    }
    if (action === 'run-once') {
      assertMethod(request, 'POST');
      return jsonResponse(202, await runtimeRecovery.runRuntimeRecoveryOnce());
    }
  }
  if (segments.length === 3 && segments[1] === 'run-queue-worker') {
    const action = segments[2];
    if (action === 'status') {
      assertMethod(request, 'GET');
      return jsonResponse(200, await runtimeRunQueueWorker.getRuntimeRunQueueWorkerStatus());
    }
    if (action === 'start') {
      assertMethod(request, 'POST');
      return jsonResponse(202, await runtimeRunQueueWorker.startRuntimeRunQueueWorker());
    }
    if (action === 'stop') {
      assertMethod(request, 'POST');
      return jsonResponse(202, await runtimeRunQueueWorker.stopRuntimeRunQueueWorker());
    }
    if (action === 'drain') {
      assertMethod(request, 'POST');
      return jsonResponse(
        202,
        await runtimeRunQueueWorker.drainRuntimeRunQueueWorker(
          createRuntimeRunQueueWorkerDrainRequest(request.body),
        ),
      );
    }
  }
  if (segments.length === 2 && segments[1] === 'run-jobs') {
    if (request.method === 'GET') {
      return jsonResponse(
        200,
        await runtimeRunQueue.queryRuntimeRunJobs(
          createRuntimeRunQueueJobQueryRequest(request.query),
        ),
      );
    }
    assertMethod(request, 'POST');
    return jsonResponse(
      202,
      await runtimeRunQueue.enqueueRuntimeRun(createRuntimeRunQueueSubmitRequest(request.body)),
    );
  }
  if (segments.length === 3 && segments[1] === 'run-jobs' && segments[2] === 'stats') {
    assertMethod(request, 'GET');
    return jsonResponse(
      200,
      await runtimeRunQueue.getRuntimeRunQueueStats(
        createRuntimeRunQueueStatsRequest(request.query),
      ),
    );
  }
  if (segments.length === 4 && segments[1] === 'run-jobs' && segments[3] === 'replay') {
    assertMethod(request, 'POST');
    const jobId = segments[2];
    if (jobId === undefined) {
      throw new TownHttpApiError(404, 'not_found', 'route not found');
    }
    return jsonResponse(
      202,
      await runtimeRunQueue.replayRuntimeRunJob(
        createRuntimeRunQueueReplayRequest(decodePathPart(jobId), request.body),
      ),
    );
  }
  if (segments.length === 3 && segments[1] === 'run-jobs') {
    assertMethod(request, 'GET');
    const jobId = segments[2];
    if (jobId === undefined) {
      throw new TownHttpApiError(404, 'not_found', 'route not found');
    }
    return jsonResponse(
      200,
      await runtimeRunQueue.getRuntimeRunJob({ jobId: decodePathPart(jobId) }),
    );
  }
  if (segments.length === 2 && segments[1] === 'status') {
    assertMethod(request, 'GET');
    return jsonResponse(200, await runtimeSupervisor.getRuntimeStatus());
  }
  if (segments.length === 2 && segments[1] === 'start') {
    assertMethod(request, 'POST');
    return jsonResponse(
      202,
      await runtimeSupervisor.startRuntime(createRuntimeRequest(request.body)),
    );
  }
  if (segments.length === 2 && segments[1] === 'pause') {
    assertMethod(request, 'POST');
    return jsonResponse(
      202,
      await runtimeSupervisor.pauseRuntime(createRuntimeRequest(request.body)),
    );
  }
  if (segments.length === 2 && segments[1] === 'run') {
    assertMethod(request, 'POST');
    return jsonResponse(
      202,
      await runtimeSupervisor.runRuntime(createRuntimeRunRequest(request.body)),
    );
  }
  if (segments.length === 2 && segments[1] === 'operation-traces') {
    assertMethod(request, 'GET');
    return jsonResponse(
      200,
      await runtimeSupervisor.queryRuntimeOperationTraces(
        createTraceQuery<TRuntimeCommand>(request.query),
      ),
    );
  }
  if (segments.length === 4 && segments[1] === 'run-sessions' && segments[3] === 'stop') {
    assertMethod(request, 'POST');
    const traceId = segments[2];
    if (traceId === undefined) {
      throw new TownHttpApiError(404, 'not_found', 'route not found');
    }
    return jsonResponse(
      202,
      await runtimeSupervisor.stopRuntimeRunSession(
        createRuntimeRunSessionStopRequest(decodePathPart(traceId), request.body),
      ),
    );
  }
  if (segments.length === 3 && segments[1] === 'run-sessions') {
    assertMethod(request, 'GET');
    const traceId = segments[2];
    if (traceId === undefined) {
      throw new TownHttpApiError(404, 'not_found', 'route not found');
    }
    return jsonResponse(
      200,
      await runtimeSupervisor.getRuntimeRunSession({ traceId: decodePathPart(traceId) }),
    );
  }
  if (segments.length === 3 && segments[1] === 'operation-traces') {
    assertMethod(request, 'GET');
    const traceId = segments[2];
    if (traceId === undefined) {
      throw new TownHttpApiError(404, 'not_found', 'route not found');
    }
    return jsonResponse(
      200,
      await runtimeSupervisor.getRuntimeOperationTrace({ traceId: decodePathPart(traceId) }),
    );
  }
  throw new TownHttpApiError(404, 'not_found', 'route not found');
}

function matchSimulationRoute(segments: readonly string[]): SimulationRoute | undefined {
  if (segments.length === 5 && segments[0] === 'simulations' && segments[2] === 'partitions') {
    const simulationId = segments[1];
    const partitionKey = segments[3];
    const action = segments[4];
    if (simulationId === undefined || partitionKey === undefined || action === undefined) {
      return undefined;
    }
    return {
      simulationId: decodePathPart(simulationId),
      partitionKey: decodePathPart(partitionKey),
      action: decodePathPart(action),
    };
  }
  if (
    segments.length === 6 &&
    segments[0] === 'simulations' &&
    segments[2] === 'partitions' &&
    segments[4] === 'validation-reports'
  ) {
    const simulationId = segments[1];
    const partitionKey = segments[3];
    const runId = segments[5];
    if (simulationId === undefined || partitionKey === undefined || runId === undefined) {
      return undefined;
    }
    return {
      simulationId: decodePathPart(simulationId),
      partitionKey: decodePathPart(partitionKey),
      action: 'validation-reports',
      runId: decodePathPart(runId),
    };
  }
  return undefined;
}

function createLongHorizonObjectiveRequest(
  route: SimulationRoute,
  body: unknown,
): SubmitLongHorizonObjectiveRequest {
  const record = requireRecordBody(body);
  return {
    simulationId: route.simulationId,
    partitionKey: route.partitionKey,
    agentId: requireString(record, 'agentId'),
    objectiveId: requireString(record, 'objectiveId'),
    statement: requireString(record, 'statement'),
    priority: requireNumber(record, 'priority'),
    affinityTags: requireStringArray(record, 'affinityTags'),
    issuedAt: requireNumber(record, 'issuedAt'),
    ...optionalString(record, 'commandId'),
    ...optionalString(record, 'idempotencyKey'),
    ...optionalNumber(record, 'expectedVersion'),
  };
}

function createReactiveCommandRequest(
  route: SimulationRoute,
  body: unknown,
): SubmitReactiveCommandRequest {
  const record = requireRecordBody(body);
  return {
    simulationId: route.simulationId,
    partitionKey: route.partitionKey,
    agentId: requireString(record, 'agentId'),
    reactiveCommandId: requireString(record, 'reactiveCommandId'),
    summary: requireString(record, 'summary'),
    issuedAt: requireNumber(record, 'issuedAt'),
    ...optionalStringArray(record, 'tags'),
    ...optionalString(record, 'commandId'),
    ...optionalString(record, 'idempotencyKey'),
    ...optionalNumber(record, 'expectedVersion'),
  };
}

function createLifecycleRequest(route: SimulationRoute, body: unknown): SimulationLifecycleRequest {
  const record = requireRecordBody(body);
  return {
    simulationId: route.simulationId,
    partitionKey: route.partitionKey,
    requestedAt: requireNumber(record, 'requestedAt'),
    ...optionalString(record, 'scenarioPresetId'),
    ...optionalNumber(record, 'fromSequence'),
    ...optionalNumber(record, 'toSequence'),
  };
}

function createEventFeedRequest(
  route: SimulationRoute,
  query: TownHttpApiRequest['query'],
): SimulationEventFeedRequest {
  return {
    simulationId: route.simulationId,
    partitionKey: route.partitionKey,
    ...optionalQueryInteger(query, 'afterSequence', {
      min: 0,
      description: 'a non-negative integer',
    }),
    ...optionalQueryInteger(query, 'limit', {
      min: 1,
      description: 'a positive integer',
    }),
  };
}

function createSyncRequest(
  route: SimulationRoute,
  query: TownHttpApiRequest['query'],
): SimulationSyncRequest {
  return {
    simulationId: route.simulationId,
    partitionKey: route.partitionKey,
    ...optionalQueryInteger(query, 'afterSequence', {
      min: 0,
      description: 'a non-negative integer',
    }),
    ...optionalQueryInteger(query, 'limit', {
      min: 1,
      description: 'a positive integer',
    }),
  };
}

function createValidationReportLookupRequest(
  route: SimulationRoute,
): ExperimentValidationReportLookupRequest {
  if (route.runId === undefined) {
    throw new TownHttpApiError(404, 'not_found', 'route not found');
  }
  return {
    simulationId: route.simulationId,
    partitionKey: route.partitionKey,
    runId: route.runId,
  };
}

function createValidationReportQueryRequest(
  route: SimulationRoute,
  query: TownHttpApiRequest['query'],
): ExperimentValidationReportQueryRequest {
  return {
    simulationId: route.simulationId,
    partitionKey: route.partitionKey,
    ...optionalQueryString(query, 'runId'),
    ...optionalQueryNumber(query, 'fromGeneratedAt'),
    ...optionalQueryNumber(query, 'toGeneratedAt'),
    ...optionalQueryInteger(query, 'limit', {
      min: 1,
      description: 'a positive integer',
    }),
  };
}

function createRuntimeRequest(body: unknown): {
  readonly operationId?: string;
  readonly requestedAt: number;
} {
  const record = requireRecordBody(body);
  return {
    requestedAt: requireNumber(record, 'requestedAt'),
    ...optionalString(record, 'operationId'),
  };
}

function createRuntimeRunRequest(body: unknown): RuntimeSupervisorRunRequest {
  const record = requireRecordBody(body);
  return {
    requestedAt: requireNumber(record, 'requestedAt'),
    cycleCount: requirePositiveInteger(record, 'cycleCount'),
    ...optionalString(record, 'operationId'),
    ...optionalNonNegativeNumber(record, 'cycleIntervalMs'),
    ...optionalBoolean(record, 'stopOnAttention'),
  };
}

function createRuntimeRunQueueSubmitRequest(body: unknown): RuntimeRunQueueSubmitRequest {
  const record = requireRecordBody(body);
  return {
    jobId: requireString(record, 'jobId'),
    enqueuedAt: requireNonNegativeNumber(record, 'enqueuedAt'),
    requestedAt: requireNonNegativeNumber(record, 'requestedAt'),
    cycleCount: requirePositiveInteger(record, 'cycleCount'),
    ...optionalString(record, 'operationId'),
    ...optionalNonNegativeNumber(record, 'cycleIntervalMs'),
    ...optionalBoolean(record, 'stopOnAttention'),
  };
}

function createRuntimeRunQueueJobQueryRequest(
  query: TownHttpApiRequest['query'],
): RuntimeRunQueueJobQueryRequest {
  return {
    ...optionalQueryString(query, 'status', parseRuntimeRunQueueJobStatus),
    ...optionalQueryString(query, 'manifestId'),
    ...optionalQueryInteger(query, 'limit', {
      min: 1,
      description: 'a positive integer',
    }),
  };
}

function createRuntimeProfileRunReportLookupRequest(
  runId: string,
): RuntimeProfileRunReportLookupRequest {
  return { runId };
}

function createRuntimeProfileRunReportQueryRequest(
  query: TownHttpApiRequest['query'],
): RuntimeProfileRunReportQueryRequest {
  return {
    ...optionalQueryString(query, 'runId'),
    ...optionalQueryString(query, 'profileId'),
    ...optionalQueryNumber(query, 'fromGeneratedAt'),
    ...optionalQueryNumber(query, 'toGeneratedAt'),
    ...optionalQueryInteger(query, 'limit', {
      min: 1,
      description: 'a positive integer',
    }),
  };
}

function createRuntimeRunQueueStatsRequest(
  query: TownHttpApiRequest['query'],
): RuntimeRunQueueStatsRequest {
  return {
    observedAt: requireQueryNonNegativeNumber(query, 'observedAt'),
    ...optionalQueryString(query, 'manifestId'),
  };
}

function createRuntimeRunQueueReplayRequest(
  jobId: string,
  body: unknown,
): RuntimeRunQueueReplayRequest {
  const record = requireRecordBody(body);
  return {
    jobId,
    replayedAt: requireNonNegativeNumber(record, 'replayedAt'),
    ...optionalNonNegativeNumber(record, 'nextAttemptAt'),
    ...optionalPositiveInteger(record, 'maxAttempts'),
  };
}

function createRuntimeRunQueueWorkerDrainRequest(body: unknown): RuntimeRunQueueWorkerDrainRequest {
  if (body === undefined) {
    return {};
  }
  const record = requireRecordBody(body);
  return {
    ...optionalPositiveInteger(record, 'maxJobs'),
  };
}

function createRuntimeRunSessionStopRequest(
  traceId: string,
  body: unknown,
): {
  readonly traceId: string;
  readonly requestedAt: number;
} {
  const record = requireRecordBody(body);
  return {
    traceId,
    requestedAt: requireNumber(record, 'requestedAt'),
  };
}

function createTraceQuery<TRuntimeCommand extends string>(
  query: TownHttpApiRequest['query'],
): RuntimeSupervisorOperationTraceQuery<TRuntimeCommand> {
  return {
    ...optionalQueryString(query, 'manifestId'),
    ...optionalQueryString(query, 'command', (value) => value as TRuntimeCommand),
    ...optionalQueryNumber(query, 'fromRequestedAt'),
    ...optionalQueryNumber(query, 'toRequestedAt'),
    ...optionalQueryNumber(query, 'limit'),
  };
}

function parseRuntimeRunQueueJobStatus(value: string): RuntimeRunQueueJobStatus {
  if (
    value === 'queued' ||
    value === 'leased' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'dead-lettered'
  ) {
    return value;
  }
  throw new TownHttpApiError(400, 'bad_request', 'status must be a known run queue job status');
}

function assertMethod(request: TownHttpApiRequest, method: TownHttpMethod): void {
  if (request.method !== method) {
    throw new TownHttpApiError(405, 'method_not_allowed', 'method not allowed');
  }
}

function jsonResponse(status: number, body: unknown): TownHttpApiResponse {
  return {
    status,
    headers: jsonHeaders,
    body,
  };
}

function splitPath(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function decodePathPart(value: string): string {
  return decodeURIComponent(value);
}

function requireRecordBody(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new TownHttpApiError(400, 'bad_request', 'request body must be an object');
  }
  return body as Record<string, unknown>;
}

function requireString(record: Readonly<Record<string, unknown>>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be a non-empty string`);
  }
  return value;
}

function requireNumber(record: Readonly<Record<string, unknown>>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be a number`);
  }
  return value;
}

function requireNonNegativeNumber(
  record: Readonly<Record<string, unknown>>,
  field: string,
): number {
  const value = requireNumber(record, field);
  if (value < 0) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be a non-negative finite number`);
  }
  return value;
}

function requirePositiveInteger(record: Readonly<Record<string, unknown>>, field: string): number {
  const value = requireNumber(record, field);
  if (!Number.isInteger(value) || value < 1) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be a positive integer`);
  }
  return value;
}

function requireStringArray(
  record: Readonly<Record<string, unknown>>,
  field: string,
): readonly string[] {
  const value = record[field];
  if (!isNonEmptyStringArray(value)) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be an array of strings`);
  }
  return value;
}

function optionalString(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, string> {
  const value = record[field];
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be a non-empty string`);
  }
  return { [field]: value };
}

function optionalNumber(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, number> {
  const value = record[field];
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be a number`);
  }
  return { [field]: value };
}

function optionalNonNegativeNumber(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, number> {
  const value = optionalNumber(record, field);
  const parsed = value[field];
  if (parsed !== undefined && parsed < 0) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be a non-negative finite number`);
  }
  return value;
}

function optionalPositiveInteger(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, number> {
  if (record[field] === undefined) {
    return {};
  }
  return { [field]: requirePositiveInteger(record, field) };
}

function optionalBoolean(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, boolean> {
  const value = record[field];
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'boolean') {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be a boolean`);
  }
  return { [field]: value };
}

function optionalStringArray(
  record: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, readonly string[]> {
  if (record[field] === undefined) {
    return {};
  }
  return { [field]: requireStringArray(record, field) };
}

function optionalQueryString<TValue extends string = string>(
  query: TownHttpApiRequest['query'],
  field: string,
  map: (value: string) => TValue = (value) => value as TValue,
): Record<string, TValue> {
  const value = getSingleQueryValue(query, field);
  if (value === undefined) {
    return {};
  }
  if (value.trim().length === 0) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be a non-empty string`);
  }
  return { [field]: map(value) };
}

function optionalQueryNumber(
  query: TownHttpApiRequest['query'],
  field: string,
): Record<string, number> {
  const value = getSingleQueryValue(query, field);
  if (value === undefined) {
    return {};
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be a number`);
  }
  return { [field]: parsed };
}

function requireQueryNumber(query: TownHttpApiRequest['query'], field: string): number {
  const value = optionalQueryNumber(query, field)[field];
  if (value === undefined) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be a number`);
  }
  return value;
}

function requireQueryNonNegativeNumber(query: TownHttpApiRequest['query'], field: string): number {
  const value = requireQueryNumber(query, field);
  if (value < 0) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be a non-negative finite number`);
  }
  return value;
}

function optionalQueryInteger(
  query: TownHttpApiRequest['query'],
  field: string,
  rule: { readonly min: number; readonly description: string },
): Record<string, number> {
  const value = getSingleQueryValue(query, field);
  if (value === undefined) {
    return {};
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < rule.min) {
    throw new TownHttpApiError(400, 'bad_request', `${field} must be ${rule.description}`);
  }
  return { [field]: parsed };
}

function getSingleQueryValue(
  query: TownHttpApiRequest['query'],
  field: string,
): string | undefined {
  const value = query?.[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  return value[0];
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every(isNonEmptyString);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
