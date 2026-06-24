import type { SimulationTimestamp } from '@aivilization/sim-core';
import type {
  LocalSimulationRuntimeRunQueueJob,
  LocalSimulationRuntimeRunQueueRepository,
  LocalSimulationRuntimeRunQueueStats,
} from './localSimulationRuntimeRunQueue';

export type LocalSimulationRuntimeSchedulerPolicy = {
  readonly schedulerId: string;
  readonly cycleCount: number;
  readonly cycleIntervalMs?: number;
  readonly stopOnAttention?: boolean;
  readonly maxPendingJobs?: number;
  readonly allowWhenDeadLettered?: boolean;
};

export type LocalSimulationRuntimeSchedulerScheduleRequest = {
  readonly observedAt: SimulationTimestamp;
};

export type LocalSimulationRuntimeSchedulerSkipReason =
  | 'pending-job-limit-reached'
  | 'dead-lettered-jobs-present';

export type LocalSimulationRuntimeSchedulerEnqueuedDecision = {
  readonly status: 'enqueued';
  readonly job: LocalSimulationRuntimeRunQueueJob;
  readonly statsBeforeSchedule: LocalSimulationRuntimeRunQueueStats;
};

export type LocalSimulationRuntimeSchedulerSkippedDecision = {
  readonly status: 'skipped';
  readonly reason: LocalSimulationRuntimeSchedulerSkipReason;
  readonly statsBeforeSchedule: LocalSimulationRuntimeRunQueueStats;
};

export type LocalSimulationRuntimeSchedulerDecision =
  | LocalSimulationRuntimeSchedulerEnqueuedDecision
  | LocalSimulationRuntimeSchedulerSkippedDecision;

export type LocalSimulationRuntimeScheduler = {
  readonly schedule: (
    request: LocalSimulationRuntimeSchedulerScheduleRequest,
  ) => Promise<LocalSimulationRuntimeSchedulerDecision>;
};

export type LocalSimulationRuntimeSchedulerHostClock = {
  readonly now: () => SimulationTimestamp;
};

export type LocalSimulationRuntimeSchedulerHostTimer = {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

export type LocalSimulationRuntimeSchedulerHostError = {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
};

export type LocalSimulationRuntimeSchedulerHostStatus = {
  readonly running: boolean;
  readonly inFlight: boolean;
  readonly scheduleIntervalMs: number;
  readonly attemptedScheduleCount: number;
  readonly enqueuedScheduleCount: number;
  readonly skippedScheduleCount: number;
  readonly lastScheduleStartedAt?: SimulationTimestamp;
  readonly lastScheduleCompletedAt?: SimulationTimestamp;
  readonly lastDecision?: LocalSimulationRuntimeSchedulerDecision;
  readonly lastError?: LocalSimulationRuntimeSchedulerHostError;
};

export type LocalSimulationRuntimeSchedulerHost = {
  readonly runOnce: () => Promise<LocalSimulationRuntimeSchedulerDecision>;
  readonly start: () => void;
  readonly stop: () => void;
  readonly getStatus: () => LocalSimulationRuntimeSchedulerHostStatus;
};

export function createLocalSimulationRuntimeScheduler(input: {
  readonly manifestId: string;
  readonly queueRepository: Pick<LocalSimulationRuntimeRunQueueRepository, 'enqueue' | 'getStats'>;
  readonly policy: LocalSimulationRuntimeSchedulerPolicy;
}): LocalSimulationRuntimeScheduler {
  assertNonEmpty(input.manifestId, 'manifestId');
  assertPolicy(input.policy);

  const maxPendingJobs = input.policy.maxPendingJobs ?? 1;
  const allowWhenDeadLettered = input.policy.allowWhenDeadLettered ?? false;

  return {
    schedule: async (request) => {
      assertNonNegativeFinite(request.observedAt, 'observedAt');
      const statsBeforeSchedule = await input.queueRepository.getStats({
        observedAt: request.observedAt,
        manifestId: input.manifestId,
      });
      if (!allowWhenDeadLettered && statsBeforeSchedule.statusCounts['dead-lettered'] > 0) {
        return {
          status: 'skipped',
          reason: 'dead-lettered-jobs-present',
          statsBeforeSchedule,
        };
      }
      const pendingJobCount =
        statsBeforeSchedule.statusCounts.queued + statsBeforeSchedule.statusCounts.leased;
      if (pendingJobCount >= maxPendingJobs) {
        return {
          status: 'skipped',
          reason: 'pending-job-limit-reached',
          statsBeforeSchedule,
        };
      }

      const jobId = createScheduledRunJobId({
        manifestId: input.manifestId,
        schedulerId: input.policy.schedulerId,
        observedAt: request.observedAt,
      });
      const job = await input.queueRepository.enqueue({
        jobId,
        manifestId: input.manifestId,
        enqueuedAt: request.observedAt,
        runRequest: {
          operationId: `${jobId}:operation`,
          requestedAt: request.observedAt,
          cycleCount: input.policy.cycleCount,
          ...(input.policy.cycleIntervalMs === undefined
            ? {}
            : { cycleIntervalMs: input.policy.cycleIntervalMs }),
          ...(input.policy.stopOnAttention === undefined
            ? {}
            : { stopOnAttention: input.policy.stopOnAttention }),
        },
      });
      return {
        status: 'enqueued',
        job,
        statsBeforeSchedule,
      };
    },
  };
}

export function createLocalSimulationRuntimeSchedulerHost(input: {
  readonly scheduler: LocalSimulationRuntimeScheduler;
  readonly scheduleIntervalMs: number;
  readonly clock?: LocalSimulationRuntimeSchedulerHostClock;
  readonly timer?: LocalSimulationRuntimeSchedulerHostTimer;
}): LocalSimulationRuntimeSchedulerHost {
  assertPositiveFinite(input.scheduleIntervalMs, 'scheduleIntervalMs');

  const clock = input.clock ?? { now: () => Date.now() };
  const timer = input.timer ?? {
    setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let running = false;
  let inFlight = false;
  let scheduledTimer: { readonly handle: unknown } | undefined;
  let attemptedScheduleCount = 0;
  let enqueuedScheduleCount = 0;
  let skippedScheduleCount = 0;
  let lastScheduleStartedAt: SimulationTimestamp | undefined;
  let lastScheduleCompletedAt: SimulationTimestamp | undefined;
  let lastDecision: LocalSimulationRuntimeSchedulerDecision | undefined;
  let lastError: LocalSimulationRuntimeSchedulerHostError | undefined;

  const host: LocalSimulationRuntimeSchedulerHost = {
    runOnce: async () => {
      const observedAt = clock.now();
      assertNonNegativeFinite(observedAt, 'observedAt');
      inFlight = true;
      lastScheduleStartedAt = observedAt;
      attemptedScheduleCount += 1;
      try {
        const decision = await input.scheduler.schedule({ observedAt });
        if (decision.status === 'enqueued') {
          enqueuedScheduleCount += 1;
        } else {
          skippedScheduleCount += 1;
        }
        lastDecision = decision;
        lastError = undefined;
        return decision;
      } catch (error) {
        lastError = serializeHostError(error);
        throw error;
      } finally {
        lastScheduleCompletedAt = clock.now();
        inFlight = false;
      }
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
      if (scheduledTimer !== undefined) {
        timer.clearTimeout(scheduledTimer.handle);
        scheduledTimer = undefined;
      }
    },
    getStatus: () => ({
      running,
      inFlight,
      scheduleIntervalMs: input.scheduleIntervalMs,
      attemptedScheduleCount,
      enqueuedScheduleCount,
      skippedScheduleCount,
      ...(lastScheduleStartedAt === undefined ? {} : { lastScheduleStartedAt }),
      ...(lastScheduleCompletedAt === undefined ? {} : { lastScheduleCompletedAt }),
      ...(lastDecision === undefined ? {} : { lastDecision }),
      ...(lastError === undefined ? {} : { lastError }),
    }),
  };

  function scheduleNext(delayMs: number): void {
    if (!running || scheduledTimer !== undefined) {
      return;
    }
    scheduledTimer = {
      handle: timer.setTimeout(() => {
        scheduledTimer = undefined;
        void runScheduledTick();
      }, delayMs),
    };
  }

  async function runScheduledTick(): Promise<void> {
    if (!running || inFlight) {
      scheduleNext(input.scheduleIntervalMs);
      return;
    }
    try {
      await host.runOnce();
    } catch (error) {
      lastError = serializeHostError(error);
    } finally {
      scheduleNext(input.scheduleIntervalMs);
    }
  }

  return host;
}

function createScheduledRunJobId(input: {
  readonly manifestId: string;
  readonly schedulerId: string;
  readonly observedAt: SimulationTimestamp;
}): string {
  return `${input.manifestId}:scheduler:${input.schedulerId}:run:${input.observedAt}`;
}

function assertPolicy(policy: LocalSimulationRuntimeSchedulerPolicy): void {
  assertNonEmpty(policy.schedulerId, 'schedulerId');
  assertPositiveInteger(policy.cycleCount, 'cycleCount');
  if (policy.cycleIntervalMs !== undefined) {
    assertNonNegativeFinite(policy.cycleIntervalMs, 'cycleIntervalMs');
  }
  if (policy.stopOnAttention !== undefined && typeof policy.stopOnAttention !== 'boolean') {
    throw new Error('stopOnAttention must be a boolean');
  }
  if (policy.maxPendingJobs !== undefined) {
    assertPositiveInteger(policy.maxPendingJobs, 'maxPendingJobs');
  }
  if (
    policy.allowWhenDeadLettered !== undefined &&
    typeof policy.allowWhenDeadLettered !== 'boolean'
  ) {
    throw new Error('allowWhenDeadLettered must be a boolean');
  }
}

function serializeHostError(error: unknown): LocalSimulationRuntimeSchedulerHostError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: 'Error', message: String(error) };
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
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

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
