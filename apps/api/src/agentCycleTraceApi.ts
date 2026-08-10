type MaybePromise<TValue> = TValue | Promise<TValue>;

export type AgentCycleTraceLookupRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly traceId: string;
};

export type AgentCycleTraceQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly traceId?: string;
  readonly agentId?: string;
  readonly fromCycleStartedAt?: number;
  readonly toCycleStartedAt?: number;
  readonly limit?: number;
};

export type AgentCycleTraceQueryPort<TTrace> = {
  readonly getTrace: (request: AgentCycleTraceLookupRequest) => MaybePromise<TTrace | undefined>;
  readonly queryTraces: (
    request: AgentCycleTraceQueryRequest,
  ) => MaybePromise<readonly TTrace[]>;
};

export type AgentCycleTraceApiService<TTrace> = {
  readonly getAgentCycleTrace: (
    request: AgentCycleTraceLookupRequest,
  ) => Promise<TTrace | undefined>;
  readonly queryAgentCycleTraces: (
    request: AgentCycleTraceQueryRequest,
  ) => Promise<readonly TTrace[]>;
};

export function createAgentCycleTraceApiService<TTrace>(input: {
  readonly traces: AgentCycleTraceQueryPort<TTrace>;
}): AgentCycleTraceApiService<TTrace> {
  return {
    getAgentCycleTrace: async (request) => input.traces.getTrace(normalizeLookup(request)),
    queryAgentCycleTraces: async (request) => input.traces.queryTraces(normalizeQuery(request)),
  };
}

function normalizeLookup(request: AgentCycleTraceLookupRequest): AgentCycleTraceLookupRequest {
  return {
    simulationId: normalizeNonEmpty(request.simulationId, 'simulationId'),
    partitionKey: normalizeNonEmpty(request.partitionKey, 'partitionKey'),
    traceId: normalizeNonEmpty(request.traceId, 'traceId'),
  };
}

function normalizeQuery(request: AgentCycleTraceQueryRequest): AgentCycleTraceQueryRequest {
  if (request.fromCycleStartedAt !== undefined) {
    assertFinite(request.fromCycleStartedAt, 'fromCycleStartedAt');
  }
  if (request.toCycleStartedAt !== undefined) {
    assertFinite(request.toCycleStartedAt, 'toCycleStartedAt');
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
    ...(request.agentId === undefined
      ? {}
      : { agentId: normalizeNonEmpty(request.agentId, 'agentId') }),
    ...(request.fromCycleStartedAt === undefined
      ? {}
      : { fromCycleStartedAt: request.fromCycleStartedAt }),
    ...(request.toCycleStartedAt === undefined
      ? {}
      : { toCycleStartedAt: request.toCycleStartedAt }),
    ...(request.limit === undefined ? {} : { limit: request.limit }),
  };
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
