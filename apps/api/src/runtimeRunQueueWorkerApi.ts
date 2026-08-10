type MaybePromise<TValue> = TValue | Promise<TValue>;

export type RuntimeRunQueueWorkerDrainRequest = {
  readonly maxJobs?: number;
};

export type RuntimeRunQueueWorkerControlPort<TStatus, TDrainResult> = {
  readonly getStatus: () => MaybePromise<TStatus>;
  readonly start: () => MaybePromise<TStatus>;
  readonly stop: () => MaybePromise<TStatus>;
  readonly drain: (request: RuntimeRunQueueWorkerDrainRequest) => MaybePromise<TDrainResult>;
};

export type RuntimeRunQueueWorkerApiService<TStatus, TDrainResult> = {
  readonly getRuntimeRunQueueWorkerStatus: () => Promise<TStatus>;
  readonly startRuntimeRunQueueWorker: () => Promise<TStatus>;
  readonly stopRuntimeRunQueueWorker: () => Promise<TStatus>;
  readonly drainRuntimeRunQueueWorker: (
    request: RuntimeRunQueueWorkerDrainRequest,
  ) => Promise<TDrainResult>;
};

export function createRuntimeRunQueueWorkerApiService<TStatus, TDrainResult>(input: {
  readonly control: RuntimeRunQueueWorkerControlPort<TStatus, TDrainResult>;
}): RuntimeRunQueueWorkerApiService<TStatus, TDrainResult> {
  return {
    getRuntimeRunQueueWorkerStatus: async () => input.control.getStatus(),
    startRuntimeRunQueueWorker: async () => input.control.start(),
    stopRuntimeRunQueueWorker: async () => input.control.stop(),
    drainRuntimeRunQueueWorker: async (request) =>
      input.control.drain(normalizeDrainRequest(request)),
  };
}

function normalizeDrainRequest(
  request: RuntimeRunQueueWorkerDrainRequest,
): RuntimeRunQueueWorkerDrainRequest {
  if (request.maxJobs !== undefined) {
    assertPositiveInteger(request.maxJobs, 'maxJobs');
    return { maxJobs: request.maxJobs };
  }
  return {};
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
