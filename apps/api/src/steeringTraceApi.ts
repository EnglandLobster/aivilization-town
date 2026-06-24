type MaybePromise<TValue> = TValue | Promise<TValue>;

export type SteeringTraceResultKind = 'long-horizon-objective-set' | 'reactive-command-routed';

export type SteeringTraceLookupRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly traceId: string;
};

export type SteeringTraceQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly traceId?: string;
  readonly commandId?: string;
  readonly agentId?: string;
  readonly objectiveId?: string;
  readonly reactiveCommandId?: string;
  readonly resultKind?: SteeringTraceResultKind;
  readonly fromIssuedAt?: number;
  readonly toIssuedAt?: number;
  readonly limit?: number;
};

export type SteeringTraceQueryPort<TTrace> = {
  readonly getTrace: (request: SteeringTraceLookupRequest) => MaybePromise<TTrace | undefined>;
  readonly queryTraces: (request: SteeringTraceQueryRequest) => MaybePromise<readonly TTrace[]>;
};

export type SteeringTraceApiService<TTrace> = {
  readonly getSteeringTrace: (request: SteeringTraceLookupRequest) => Promise<TTrace | undefined>;
  readonly querySteeringTraces: (request: SteeringTraceQueryRequest) => Promise<readonly TTrace[]>;
};

export function createSteeringTraceApiService<TTrace>(input: {
  readonly traces: SteeringTraceQueryPort<TTrace>;
}): SteeringTraceApiService<TTrace> {
  return {
    getSteeringTrace: async (request) => input.traces.getTrace(normalizeLookup(request)),
    querySteeringTraces: async (request) => input.traces.queryTraces(normalizeQuery(request)),
  };
}

function normalizeLookup(request: SteeringTraceLookupRequest): SteeringTraceLookupRequest {
  return {
    simulationId: normalizeNonEmpty(request.simulationId, 'simulationId'),
    partitionKey: normalizeNonEmpty(request.partitionKey, 'partitionKey'),
    traceId: normalizeNonEmpty(request.traceId, 'traceId'),
  };
}

function normalizeQuery(request: SteeringTraceQueryRequest): SteeringTraceQueryRequest {
  if (request.fromIssuedAt !== undefined) {
    assertFinite(request.fromIssuedAt, 'fromIssuedAt');
  }
  if (request.toIssuedAt !== undefined) {
    assertFinite(request.toIssuedAt, 'toIssuedAt');
  }
  if (request.limit !== undefined) {
    assertPositiveInteger(request.limit, 'limit');
  }

  return {
    simulationId: normalizeNonEmpty(request.simulationId, 'simulationId'),
    partitionKey: normalizeNonEmpty(request.partitionKey, 'partitionKey'),
    ...(request.traceId === undefined
      ? {}
      : { traceId: normalizeNonEmpty(request.traceId, 'traceId') }),
    ...(request.commandId === undefined
      ? {}
      : { commandId: normalizeNonEmpty(request.commandId, 'commandId') }),
    ...(request.agentId === undefined
      ? {}
      : { agentId: normalizeNonEmpty(request.agentId, 'agentId') }),
    ...(request.objectiveId === undefined
      ? {}
      : { objectiveId: normalizeNonEmpty(request.objectiveId, 'objectiveId') }),
    ...(request.reactiveCommandId === undefined
      ? {}
      : { reactiveCommandId: normalizeNonEmpty(request.reactiveCommandId, 'reactiveCommandId') }),
    ...(request.resultKind === undefined
      ? {}
      : { resultKind: normalizeResultKind(request.resultKind) }),
    ...(request.fromIssuedAt === undefined ? {} : { fromIssuedAt: request.fromIssuedAt }),
    ...(request.toIssuedAt === undefined ? {} : { toIssuedAt: request.toIssuedAt }),
    ...(request.limit === undefined ? {} : { limit: request.limit }),
  };
}

function normalizeResultKind(value: SteeringTraceResultKind): SteeringTraceResultKind {
  if (value !== 'long-horizon-objective-set' && value !== 'reactive-command-routed') {
    throw new Error('resultKind must be a known steering result kind');
  }
  return value;
}

function normalizeNonEmpty(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return value;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
