import type { SimulationTimestamp } from '@aivilization/sim-core';
import type { RuntimeSupervisorRunRequest } from './runtimeSupervisorApi';

type MaybePromise<TValue> = TValue | Promise<TValue>;

export type RuntimeRunQueueSubmitRequest = RuntimeSupervisorRunRequest & {
  readonly jobId: string;
  readonly enqueuedAt: SimulationTimestamp;
};

export type RuntimeRunQueueJobRequest = {
  readonly jobId: string;
};

export type RuntimeRunQueueJobStatus =
  | 'queued'
  | 'leased'
  | 'completed'
  | 'failed'
  | 'dead-lettered';

export type RuntimeRunQueueJobQueryRequest = {
  readonly status?: RuntimeRunQueueJobStatus;
  readonly manifestId?: string;
  readonly limit?: number;
};

export type RuntimeRunQueueStatsRequest = {
  readonly observedAt: SimulationTimestamp;
  readonly manifestId?: string;
};

export type RuntimeRunQueueReplayRequest = RuntimeRunQueueJobRequest & {
  readonly replayedAt: SimulationTimestamp;
  readonly nextAttemptAt?: SimulationTimestamp;
  readonly maxAttempts?: number;
};

export type RuntimeRunQueueControlPort<TJob, TStats> = {
  readonly enqueueRun: (request: RuntimeRunQueueSubmitRequest) => MaybePromise<TJob>;
  readonly getRunJob: (jobId: string) => MaybePromise<TJob | undefined>;
  readonly queryRunJobs: (request: RuntimeRunQueueJobQueryRequest) => MaybePromise<readonly TJob[]>;
  readonly getRunQueueStats: (request: RuntimeRunQueueStatsRequest) => MaybePromise<TStats>;
  readonly replayRunJob: (request: RuntimeRunQueueReplayRequest) => MaybePromise<TJob | undefined>;
};

export type RuntimeRunQueueApiService<TJob, TStats = unknown> = {
  readonly enqueueRuntimeRun: (request: RuntimeRunQueueSubmitRequest) => Promise<TJob>;
  readonly getRuntimeRunJob: (request: RuntimeRunQueueJobRequest) => Promise<TJob | undefined>;
  readonly queryRuntimeRunJobs: (
    request: RuntimeRunQueueJobQueryRequest,
  ) => Promise<readonly TJob[]>;
  readonly getRuntimeRunQueueStats: (request: RuntimeRunQueueStatsRequest) => Promise<TStats>;
  readonly replayRuntimeRunJob: (
    request: RuntimeRunQueueReplayRequest,
  ) => Promise<TJob | undefined>;
};

export function createRuntimeRunQueueApiService<TJob, TStats>(input: {
  readonly control: RuntimeRunQueueControlPort<TJob, TStats>;
}): RuntimeRunQueueApiService<TJob, TStats> {
  return {
    enqueueRuntimeRun: async (request) => input.control.enqueueRun(normalizeSubmitRequest(request)),
    getRuntimeRunJob: async (request) => input.control.getRunJob(normalizeJobId(request.jobId)),
    queryRuntimeRunJobs: async (request) => input.control.queryRunJobs(normalizeQuery(request)),
    getRuntimeRunQueueStats: async (request) =>
      input.control.getRunQueueStats(normalizeStats(request)),
    replayRuntimeRunJob: async (request) => input.control.replayRunJob(normalizeReplay(request)),
  };
}

function normalizeSubmitRequest(
  request: RuntimeRunQueueSubmitRequest,
): RuntimeRunQueueSubmitRequest {
  const jobId = normalizeJobId(request.jobId);
  assertNonNegativeFinite(request.enqueuedAt, 'enqueuedAt');
  assertNonNegativeFinite(request.requestedAt, 'requestedAt');
  assertPositiveInteger(request.cycleCount, 'cycleCount');
  if (request.operationId !== undefined) {
    assertNonEmpty(request.operationId, 'operationId');
  }
  if (request.cycleIntervalMs !== undefined) {
    assertNonNegativeFinite(request.cycleIntervalMs, 'cycleIntervalMs');
  }
  if (request.stopOnAttention !== undefined && typeof request.stopOnAttention !== 'boolean') {
    throw new Error('stopOnAttention must be a boolean');
  }
  return {
    jobId,
    enqueuedAt: request.enqueuedAt,
    ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
    requestedAt: request.requestedAt,
    cycleCount: request.cycleCount,
    ...(request.cycleIntervalMs === undefined ? {} : { cycleIntervalMs: request.cycleIntervalMs }),
    ...(request.stopOnAttention === undefined ? {} : { stopOnAttention: request.stopOnAttention }),
  };
}

function normalizeJobId(jobId: string): string {
  assertNonEmpty(jobId, 'jobId');
  return jobId;
}

function normalizeQuery(request: RuntimeRunQueueJobQueryRequest): RuntimeRunQueueJobQueryRequest {
  if (request.status !== undefined && !isKnownStatus(request.status)) {
    throw new Error('status must be a known run queue job status');
  }
  if (request.manifestId !== undefined) {
    assertNonEmpty(request.manifestId, 'manifestId');
  }
  if (request.limit !== undefined) {
    assertPositiveInteger(request.limit, 'limit');
  }
  return {
    ...(request.status === undefined ? {} : { status: request.status }),
    ...(request.manifestId === undefined ? {} : { manifestId: request.manifestId }),
    ...(request.limit === undefined ? {} : { limit: request.limit }),
  };
}

function normalizeStats(request: RuntimeRunQueueStatsRequest): RuntimeRunQueueStatsRequest {
  assertNonNegativeFinite(request.observedAt, 'observedAt');
  if (request.manifestId !== undefined) {
    assertNonEmpty(request.manifestId, 'manifestId');
  }
  return {
    observedAt: request.observedAt,
    ...(request.manifestId === undefined ? {} : { manifestId: request.manifestId }),
  };
}

function normalizeReplay(request: RuntimeRunQueueReplayRequest): RuntimeRunQueueReplayRequest {
  const jobId = normalizeJobId(request.jobId);
  assertNonNegativeFinite(request.replayedAt, 'replayedAt');
  if (request.nextAttemptAt !== undefined) {
    assertNonNegativeFinite(request.nextAttemptAt, 'nextAttemptAt');
  }
  if (request.maxAttempts !== undefined) {
    assertPositiveInteger(request.maxAttempts, 'maxAttempts');
  }
  return {
    jobId,
    replayedAt: request.replayedAt,
    ...(request.nextAttemptAt === undefined ? {} : { nextAttemptAt: request.nextAttemptAt }),
    ...(request.maxAttempts === undefined ? {} : { maxAttempts: request.maxAttempts }),
  };
}

function isKnownStatus(value: string): value is RuntimeRunQueueJobStatus {
  return (
    value === 'queued' ||
    value === 'leased' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'dead-lettered'
  );
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
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
