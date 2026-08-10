type MaybePromise<TValue> = TValue | Promise<TValue>;

export type RuntimeProfileRunReportLookupRequest = {
  readonly runId: string;
};

export type RuntimeProfileRunReportQueryRequest = {
  readonly runId?: string;
  readonly profileId?: string;
  readonly fromGeneratedAt?: number;
  readonly toGeneratedAt?: number;
  readonly limit?: number;
};

export type RuntimeProfileRunReportQueryPort<TReport> = {
  readonly getReport: (
    request: RuntimeProfileRunReportLookupRequest,
  ) => MaybePromise<TReport | undefined>;
  readonly queryReports: (
    request: RuntimeProfileRunReportQueryRequest,
  ) => MaybePromise<readonly TReport[]>;
};

export type RuntimeProfileRunReportApiService<TReport> = {
  readonly getRuntimeProfileRunReport: (
    request: RuntimeProfileRunReportLookupRequest,
  ) => Promise<TReport | undefined>;
  readonly queryRuntimeProfileRunReports: (
    request: RuntimeProfileRunReportQueryRequest,
  ) => Promise<readonly TReport[]>;
};

export function createRuntimeProfileRunReportApiService<TReport>(input: {
  readonly reports: RuntimeProfileRunReportQueryPort<TReport>;
}): RuntimeProfileRunReportApiService<TReport> {
  return {
    getRuntimeProfileRunReport: async (request) =>
      input.reports.getReport(normalizeLookup(request)),
    queryRuntimeProfileRunReports: async (request) =>
      input.reports.queryReports(normalizeQuery(request)),
  };
}

function normalizeLookup(
  request: RuntimeProfileRunReportLookupRequest,
): RuntimeProfileRunReportLookupRequest {
  return {
    runId: normalizeNonEmpty(request.runId, 'runId'),
  };
}

function normalizeQuery(
  request: RuntimeProfileRunReportQueryRequest,
): RuntimeProfileRunReportQueryRequest {
  if (request.fromGeneratedAt !== undefined) {
    assertFinite(request.fromGeneratedAt, 'fromGeneratedAt');
  }
  if (request.toGeneratedAt !== undefined) {
    assertFinite(request.toGeneratedAt, 'toGeneratedAt');
  }
  if (request.limit !== undefined) {
    assertPositiveInteger(request.limit, 'limit');
  }

  return {
    ...(request.runId === undefined ? {} : { runId: normalizeNonEmpty(request.runId, 'runId') }),
    ...(request.profileId === undefined
      ? {}
      : { profileId: normalizeNonEmpty(request.profileId, 'profileId') }),
    ...(request.fromGeneratedAt === undefined ? {} : { fromGeneratedAt: request.fromGeneratedAt }),
    ...(request.toGeneratedAt === undefined ? {} : { toGeneratedAt: request.toGeneratedAt }),
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
