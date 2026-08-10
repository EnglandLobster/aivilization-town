type MaybePromise<TValue> = TValue | Promise<TValue>;

export type ObjectiveRenewalTraceLookupRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly traceId: string;
};

export type ObjectiveRenewalTraceQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly traceId?: string;
  readonly agentId?: string;
  readonly objectiveId?: string;
  readonly fromIssuedAt?: number;
  readonly toIssuedAt?: number;
  readonly limit?: number;
};

export type ObjectiveRenewalTraceQueryPort<TTrace> = {
  readonly getTrace: (
    request: ObjectiveRenewalTraceLookupRequest,
  ) => MaybePromise<TTrace | undefined>;
  readonly queryTraces: (
    request: ObjectiveRenewalTraceQueryRequest,
  ) => MaybePromise<readonly TTrace[]>;
};

export type ObjectiveRenewalTraceApiService<TTrace> = {
  readonly getObjectiveRenewalTrace: (
    request: ObjectiveRenewalTraceLookupRequest,
  ) => Promise<TTrace | undefined>;
  readonly queryObjectiveRenewalTraces: (
    request: ObjectiveRenewalTraceQueryRequest,
  ) => Promise<readonly TTrace[]>;
};

export function createObjectiveRenewalTraceApiService<TTrace>(input: {
  readonly traces: ObjectiveRenewalTraceQueryPort<TTrace>;
}): ObjectiveRenewalTraceApiService<TTrace> {
  return {
    getObjectiveRenewalTrace: async (request) => input.traces.getTrace(normalizeLookup(request)),
    queryObjectiveRenewalTraces: async (request) =>
      input.traces.queryTraces(normalizeQuery(request)),
  };
}

function normalizeLookup(
  request: ObjectiveRenewalTraceLookupRequest,
): ObjectiveRenewalTraceLookupRequest {
  return {
    simulationId: normalizeNonEmpty(request.simulationId, 'simulationId'),
    partitionKey: normalizeNonEmpty(request.partitionKey, 'partitionKey'),
    traceId: normalizeNonEmpty(request.traceId, 'traceId'),
  };
}

function normalizeQuery(
  request: ObjectiveRenewalTraceQueryRequest,
): ObjectiveRenewalTraceQueryRequest {
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
    ...(request.agentId === undefined
      ? {}
      : { agentId: normalizeNonEmpty(request.agentId, 'agentId') }),
    ...(request.objectiveId === undefined
      ? {}
      : { objectiveId: normalizeNonEmpty(request.objectiveId, 'objectiveId') }),
    ...(request.fromIssuedAt === undefined ? {} : { fromIssuedAt: request.fromIssuedAt }),
    ...(request.toIssuedAt === undefined ? {} : { toIssuedAt: request.toIssuedAt }),
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
