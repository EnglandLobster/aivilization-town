import type { SimulationTimestamp } from '@aivilization/sim-core';

type MaybePromise<TValue> = TValue | Promise<TValue>;

export type RuntimeSupervisorOperationRequest = {
  readonly operationId?: string;
  readonly requestedAt: SimulationTimestamp;
};

export type RuntimeSupervisorRunRequest = RuntimeSupervisorOperationRequest & {
  readonly cycleCount: number;
  readonly cycleIntervalMs?: number;
  readonly stopOnAttention?: boolean;
};

export type RuntimeSupervisorOperationTraceRequest = {
  readonly traceId: string;
};

export type RuntimeSupervisorOperationTraceQuery<TCommand extends string = string> = {
  readonly manifestId?: string;
  readonly command?: TCommand;
  readonly fromRequestedAt?: SimulationTimestamp;
  readonly toRequestedAt?: SimulationTimestamp;
  readonly limit?: number;
};

export type RuntimeSupervisorControlPort<
  TStatus,
  TStartResult,
  TPauseResult,
  TRunResult,
  TOperationTrace,
  TCommand extends string = string,
> = {
  readonly getStatus: () => MaybePromise<TStatus>;
  readonly startAll: (request: RuntimeSupervisorOperationRequest) => MaybePromise<TStartResult>;
  readonly pauseAll: (request: RuntimeSupervisorOperationRequest) => MaybePromise<TPauseResult>;
  readonly runCycles: (request: RuntimeSupervisorRunRequest) => MaybePromise<TRunResult>;
  readonly getOperationTrace: (traceId: string) => MaybePromise<TOperationTrace | undefined>;
  readonly queryOperationTraces: (
    query: RuntimeSupervisorOperationTraceQuery<TCommand>,
  ) => MaybePromise<readonly TOperationTrace[]>;
};

export type RuntimeSupervisorApiService<
  TStatus,
  TStartResult,
  TPauseResult,
  TRunResult,
  TOperationTrace,
  TCommand extends string = string,
> = {
  readonly getRuntimeStatus: () => Promise<TStatus>;
  readonly startRuntime: (request: RuntimeSupervisorOperationRequest) => Promise<TStartResult>;
  readonly pauseRuntime: (request: RuntimeSupervisorOperationRequest) => Promise<TPauseResult>;
  readonly runRuntime: (request: RuntimeSupervisorRunRequest) => Promise<TRunResult>;
  readonly getRuntimeOperationTrace: (
    request: RuntimeSupervisorOperationTraceRequest,
  ) => Promise<TOperationTrace | undefined>;
  readonly queryRuntimeOperationTraces: (
    query: RuntimeSupervisorOperationTraceQuery<TCommand>,
  ) => Promise<readonly TOperationTrace[]>;
};

export function createRuntimeSupervisorApiService<
  TStatus,
  TStartResult,
  TPauseResult,
  TRunResult,
  TOperationTrace,
  TCommand extends string = string,
>(input: {
  readonly control: RuntimeSupervisorControlPort<
    TStatus,
    TStartResult,
    TPauseResult,
    TRunResult,
    TOperationTrace,
    TCommand
  >;
}): RuntimeSupervisorApiService<
  TStatus,
  TStartResult,
  TPauseResult,
  TRunResult,
  TOperationTrace,
  TCommand
> {
  return {
    getRuntimeStatus: async () => input.control.getStatus(),
    startRuntime: async (request) => input.control.startAll(normalizeOperationRequest(request)),
    pauseRuntime: async (request) => input.control.pauseAll(normalizeOperationRequest(request)),
    runRuntime: async (request) => input.control.runCycles(normalizeRunRequest(request)),
    getRuntimeOperationTrace: async (request) =>
      input.control.getOperationTrace(normalizeTraceId(request.traceId)),
    queryRuntimeOperationTraces: async (query) =>
      input.control.queryOperationTraces(normalizeTraceQuery(query)),
  };
}

function normalizeOperationRequest(
  request: RuntimeSupervisorOperationRequest,
): RuntimeSupervisorOperationRequest {
  assertNonNegativeFinite(request.requestedAt, 'requestedAt');
  if (request.operationId !== undefined) {
    assertNonEmpty(request.operationId, 'operationId');
    return { operationId: request.operationId, requestedAt: request.requestedAt };
  }
  return { requestedAt: request.requestedAt };
}

function normalizeRunRequest(request: RuntimeSupervisorRunRequest): RuntimeSupervisorRunRequest {
  const operationRequest = normalizeOperationRequest(request);
  assertPositiveInteger(request.cycleCount, 'cycleCount');
  if (request.cycleIntervalMs !== undefined) {
    assertNonNegativeFinite(request.cycleIntervalMs, 'cycleIntervalMs');
  }
  if (request.stopOnAttention !== undefined && typeof request.stopOnAttention !== 'boolean') {
    throw new Error('stopOnAttention must be a boolean');
  }
  return {
    ...operationRequest,
    cycleCount: request.cycleCount,
    ...(request.cycleIntervalMs === undefined ? {} : { cycleIntervalMs: request.cycleIntervalMs }),
    ...(request.stopOnAttention === undefined ? {} : { stopOnAttention: request.stopOnAttention }),
  };
}

function normalizeTraceId(traceId: string): string {
  assertNonEmpty(traceId, 'traceId');
  return traceId;
}

function normalizeTraceQuery<TCommand extends string>(
  query: RuntimeSupervisorOperationTraceQuery<TCommand>,
): RuntimeSupervisorOperationTraceQuery<TCommand> {
  if (query.manifestId !== undefined) {
    assertNonEmpty(query.manifestId, 'manifestId');
  }
  if (query.command !== undefined) {
    assertNonEmpty(query.command, 'command');
  }
  if (query.fromRequestedAt !== undefined) {
    assertNonNegativeFinite(query.fromRequestedAt, 'fromRequestedAt');
  }
  if (query.toRequestedAt !== undefined) {
    assertNonNegativeFinite(query.toRequestedAt, 'toRequestedAt');
  }
  if (
    query.fromRequestedAt !== undefined &&
    query.toRequestedAt !== undefined &&
    query.toRequestedAt < query.fromRequestedAt
  ) {
    throw new Error('toRequestedAt must be greater than or equal to fromRequestedAt');
  }
  if (query.limit !== undefined && (!Number.isFinite(query.limit) || query.limit <= 0)) {
    throw new Error('limit must be positive');
  }
  return {
    ...(query.manifestId === undefined ? {} : { manifestId: query.manifestId }),
    ...(query.command === undefined ? {} : { command: query.command }),
    ...(query.fromRequestedAt === undefined ? {} : { fromRequestedAt: query.fromRequestedAt }),
    ...(query.toRequestedAt === undefined ? {} : { toRequestedAt: query.toRequestedAt }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  };
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
