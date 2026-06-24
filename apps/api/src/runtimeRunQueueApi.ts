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

export type RuntimeRunQueueControlPort<TJob> = {
  readonly enqueueRun: (request: RuntimeRunQueueSubmitRequest) => MaybePromise<TJob>;
  readonly getRunJob: (jobId: string) => MaybePromise<TJob | undefined>;
};

export type RuntimeRunQueueApiService<TJob> = {
  readonly enqueueRuntimeRun: (request: RuntimeRunQueueSubmitRequest) => Promise<TJob>;
  readonly getRuntimeRunJob: (request: RuntimeRunQueueJobRequest) => Promise<TJob | undefined>;
};

export function createRuntimeRunQueueApiService<TJob>(input: {
  readonly control: RuntimeRunQueueControlPort<TJob>;
}): RuntimeRunQueueApiService<TJob> {
  return {
    enqueueRuntimeRun: async (request) => input.control.enqueueRun(normalizeSubmitRequest(request)),
    getRuntimeRunJob: async (request) => input.control.getRunJob(normalizeJobId(request.jobId)),
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
