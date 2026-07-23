import type { SimulationTimestamp } from '@aivilization/sim-core';
import type {
  LocalSimulationRuntimeRunQueueWorker,
  LocalSimulationRuntimeRunQueueWorkerRunResult,
} from './localSimulationRuntimeRunQueue';

export type LocalSimulationRuntimeRunQueueWorkerHostClock = {
  readonly now: () => SimulationTimestamp;
};

export type LocalSimulationRuntimeRunQueueWorkerHostScheduler = {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

export type LocalSimulationRuntimeRunQueueWorkerHostError = {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
};

export type LocalSimulationRuntimeRunQueueWorkerHostStatus = {
  readonly running: boolean;
  readonly inFlight: boolean;
  readonly pollIntervalMs: number;
  readonly processedJobCount: number;
  readonly completedJobCount: number;
  readonly failedJobCount: number;
  readonly lastRunStartedAt?: SimulationTimestamp;
  readonly lastRunCompletedAt?: SimulationTimestamp;
  readonly lastError?: LocalSimulationRuntimeRunQueueWorkerHostError;
};

export type LocalSimulationRuntimeRunQueueWorkerHostDrainRequest = {
  readonly maxJobs?: number;
};

export type LocalSimulationRuntimeRunQueueWorkerHostDrainResult = {
  readonly processedJobCount: number;
  readonly completedJobCount: number;
  readonly failedJobCount: number;
  readonly idle: boolean;
  readonly results: readonly Exclude<
    LocalSimulationRuntimeRunQueueWorkerRunResult,
    { readonly status: 'idle' }
  >[];
};

export type LocalSimulationRuntimeRunQueueWorkerHost = {
  readonly runOnce: () => Promise<LocalSimulationRuntimeRunQueueWorkerRunResult>;
  readonly drain: (
    request?: LocalSimulationRuntimeRunQueueWorkerHostDrainRequest,
  ) => Promise<LocalSimulationRuntimeRunQueueWorkerHostDrainResult>;
  readonly start: () => void;
  readonly stop: () => void;
  readonly getStatus: () => LocalSimulationRuntimeRunQueueWorkerHostStatus;
};

export function createLocalSimulationRuntimeRunQueueWorkerHost(input: {
  readonly worker: LocalSimulationRuntimeRunQueueWorker;
  readonly pollIntervalMs: number;
  readonly maxJobsPerPoll?: number;
  readonly clock?: LocalSimulationRuntimeRunQueueWorkerHostClock;
  readonly scheduler?: LocalSimulationRuntimeRunQueueWorkerHostScheduler;
}): LocalSimulationRuntimeRunQueueWorkerHost {
  assertPositiveFinite(input.pollIntervalMs, 'pollIntervalMs');
  if (input.maxJobsPerPoll !== undefined) {
    assertPositiveInteger(input.maxJobsPerPoll, 'maxJobsPerPoll');
  }

  const clock = input.clock ?? { now: () => Date.now() };
  const scheduler = input.scheduler ?? {
    setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const maxJobsPerPoll = input.maxJobsPerPoll ?? 1;
  let running = false;
  let inFlight = false;
  let timer: { readonly handle: unknown } | undefined;
  let processedJobCount = 0;
  let completedJobCount = 0;
  let failedJobCount = 0;
  let lastRunStartedAt: SimulationTimestamp | undefined;
  let lastRunCompletedAt: SimulationTimestamp | undefined;
  let lastError: LocalSimulationRuntimeRunQueueWorkerHostError | undefined;

  const host: LocalSimulationRuntimeRunQueueWorkerHost = {
    runOnce: async () => {
      // Recovery and the polling loop share this host. Never allow both paths to
      // claim work concurrently; lease renewal handles long-running ownership.
      if (inFlight) {
        return { status: 'idle' };
      }
      const claimedAt = clock.now();
      inFlight = true;
      lastRunStartedAt = claimedAt;
      try {
        const result = await input.worker.runNext({ claimedAt });
        if (result.status === 'completed') {
          processedJobCount += 1;
          completedJobCount += 1;
        } else if (result.status === 'failed') {
          processedJobCount += 1;
          failedJobCount += 1;
        }
        lastError = undefined;
        return result;
      } catch (error) {
        lastError = serializeHostError(error);
        throw error;
      } finally {
        lastRunCompletedAt = clock.now();
        inFlight = false;
      }
    },
    drain: async (request = {}) => {
      const maxJobs = request.maxJobs ?? maxJobsPerPoll;
      assertPositiveInteger(maxJobs, 'maxJobs');
      const results: Exclude<
        LocalSimulationRuntimeRunQueueWorkerRunResult,
        { readonly status: 'idle' }
      >[] = [];
      let completedInDrain = 0;
      let failedInDrain = 0;
      let idle = false;

      for (let processedInDrain = 0; processedInDrain < maxJobs; ) {
        const result = await host.runOnce();
        if (result.status === 'idle') {
          idle = true;
          break;
        }
        results.push(result);
        processedInDrain += 1;
        if (result.status === 'completed') {
          completedInDrain += 1;
        } else {
          failedInDrain += 1;
        }
      }

      return {
        processedJobCount: results.length,
        completedJobCount: completedInDrain,
        failedJobCount: failedInDrain,
        idle,
        results,
      };
    },
    start: () => {
      if (running) {
        return;
      }
      running = true;
      scheduleNext(0);
    },
    stop: () => {
      running = false;
      if (timer !== undefined) {
        scheduler.clearTimeout(timer.handle);
        timer = undefined;
      }
    },
    getStatus: () => ({
      running,
      inFlight,
      pollIntervalMs: input.pollIntervalMs,
      processedJobCount,
      completedJobCount,
      failedJobCount,
      ...(lastRunStartedAt === undefined ? {} : { lastRunStartedAt }),
      ...(lastRunCompletedAt === undefined ? {} : { lastRunCompletedAt }),
      ...(lastError === undefined ? {} : { lastError }),
    }),
  };

  function scheduleNext(delayMs: number): void {
    if (!running || timer !== undefined) {
      return;
    }
    timer = {
      handle: scheduler.setTimeout(() => {
        timer = undefined;
        void runScheduledPoll();
      }, delayMs),
    };
  }

  async function runScheduledPoll(): Promise<void> {
    if (!running || inFlight) {
      scheduleNext(input.pollIntervalMs);
      return;
    }
    try {
      await host.drain({ maxJobs: maxJobsPerPoll });
    } catch (error) {
      lastError = serializeHostError(error);
    } finally {
      scheduleNext(input.pollIntervalMs);
    }
  }

  return host;
}

function serializeHostError(error: unknown): LocalSimulationRuntimeRunQueueWorkerHostError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: 'Error', message: String(error) };
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
