type MaybePromise<TValue> = TValue | Promise<TValue>;

export type DailyPlanRenewalTraceLookupRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly traceId: string;
};

export type DailyPlanRenewalTraceQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly traceId?: string;
  readonly agentId?: string;
  readonly dailyPlanId?: string;
  readonly fromIssuedAt?: number;
  readonly toIssuedAt?: number;
  readonly limit?: number;
};

export type DailyPlanRenewalTraceQueryPort<TTrace> = {
  readonly getTrace: (
    request: DailyPlanRenewalTraceLookupRequest,
  ) => MaybePromise<TTrace | undefined>;
  readonly queryTraces: (
    request: DailyPlanRenewalTraceQueryRequest,
  ) => MaybePromise<readonly TTrace[]>;
};

export type DailyPlanRenewalTraceApiService<TTrace> = {
  readonly getDailyPlanRenewalTrace: (
    request: DailyPlanRenewalTraceLookupRequest,
  ) => Promise<TTrace | undefined>;
  readonly queryDailyPlanRenewalTraces: (
    request: DailyPlanRenewalTraceQueryRequest,
  ) => Promise<readonly TTrace[]>;
};

export function createDailyPlanRenewalTraceApiService<TTrace>(input: {
  readonly traces: DailyPlanRenewalTraceQueryPort<TTrace>;
}): DailyPlanRenewalTraceApiService<TTrace> {
  return {
    getDailyPlanRenewalTrace: async (request) => input.traces.getTrace(normalizeLookup(request)),
    queryDailyPlanRenewalTraces: async (request) =>
      input.traces.queryTraces(normalizeQuery(request)),
  };
}

function normalizeLookup(
  request: DailyPlanRenewalTraceLookupRequest,
): DailyPlanRenewalTraceLookupRequest {
  return {
    simulationId: normalizeNonEmpty(request.simulationId, 'simulationId'),
    partitionKey: normalizeNonEmpty(request.partitionKey, 'partitionKey'),
    traceId: normalizeNonEmpty(request.traceId, 'traceId'),
  };
}

function normalizeQuery(
  request: DailyPlanRenewalTraceQueryRequest,
): DailyPlanRenewalTraceQueryRequest {
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
    ...(request.dailyPlanId === undefined
      ? {}
      : { dailyPlanId: normalizeNonEmpty(request.dailyPlanId, 'dailyPlanId') }),
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
