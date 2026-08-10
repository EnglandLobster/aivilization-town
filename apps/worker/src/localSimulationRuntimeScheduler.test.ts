import { describe, expect, test } from 'vitest';
import {
  createLocalSimulationRuntimeScheduler,
  createLocalSimulationRuntimeSchedulerHost,
  InMemoryLocalSimulationRuntimeRunQueueRepository,
  type LocalSimulationRuntimeScheduler,
  type LocalSimulationRuntimeSchedulerDecision,
  type LocalSimulationRuntimeSchedulerScheduleRequest,
} from './index';

describe('local simulation runtime scheduler', () => {
  test('enqueues deterministic run jobs when the queue has capacity', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    const scheduler = createLocalSimulationRuntimeScheduler({
      manifestId: 'town-runtime',
      queueRepository: repository,
      policy: {
        schedulerId: 'main-loop',
        cycleCount: 3,
        cycleIntervalMs: 50,
        stopOnAttention: true,
      },
    });

    await expect(scheduler.schedule({ observedAt: 1_000 })).resolves.toMatchObject({
      status: 'enqueued',
      job: {
        jobId: 'town-runtime:scheduler:main-loop:run:1000',
        manifestId: 'town-runtime',
        status: 'queued',
        enqueuedAt: 1_000,
        runRequest: {
          operationId: 'town-runtime:scheduler:main-loop:run:1000:operation',
          requestedAt: 1_000,
          cycleCount: 3,
          cycleIntervalMs: 50,
          stopOnAttention: true,
        },
      },
      statsBeforeSchedule: {
        observedAt: 1_000,
        manifestId: 'town-runtime',
        totalJobCount: 0,
      },
    });
    await expect(
      repository.get('town-runtime:scheduler:main-loop:run:1000'),
    ).resolves.toMatchObject({
      status: 'queued',
      runRequest: {
        cycleCount: 3,
        cycleIntervalMs: 50,
        stopOnAttention: true,
      },
    });
  });

  test('skips scheduling when pending jobs or dead letters require attention', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    const scheduler = createLocalSimulationRuntimeScheduler({
      manifestId: 'town-runtime',
      queueRepository: repository,
      policy: {
        schedulerId: 'main-loop',
        cycleCount: 1,
      },
    });

    await scheduler.schedule({ observedAt: 100 });

    await expect(scheduler.schedule({ observedAt: 101 })).resolves.toMatchObject({
      status: 'skipped',
      reason: 'pending-job-limit-reached',
      statsBeforeSchedule: {
        observedAt: 101,
        statusCounts: {
          queued: 1,
          leased: 0,
        },
      },
    });

    const deadLetterRepository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    await deadLetterRepository.enqueue({
      jobId: 'job-dead',
      manifestId: 'town-runtime',
      enqueuedAt: 190,
      runRequest: {
        operationId: 'op-dead',
        requestedAt: 200,
        cycleCount: 1,
      },
    });
    await deadLetterRepository.claimNext({
      workerId: 'worker-1',
      claimedAt: 210,
      leaseDurationMs: 50,
    });
    await deadLetterRepository.fail({
      jobId: 'job-dead',
      workerId: 'worker-1',
      attemptNumber: 1,
      failedAt: 220,
      maxAttempts: 1,
      error: { name: 'Error', message: 'runtime exploded' },
    });
    const schedulerWithDeadLetter = createLocalSimulationRuntimeScheduler({
      manifestId: 'town-runtime',
      queueRepository: deadLetterRepository,
      policy: {
        schedulerId: 'main-loop',
        cycleCount: 1,
      },
    });

    await expect(schedulerWithDeadLetter.schedule({ observedAt: 230 })).resolves.toMatchObject({
      status: 'skipped',
      reason: 'dead-lettered-jobs-present',
      statsBeforeSchedule: {
        statusCounts: {
          'dead-lettered': 1,
        },
      },
    });
  });

  test('host runs scheduler with injected time and reports counters', async () => {
    const calls: number[] = [];
    const host = createLocalSimulationRuntimeSchedulerHost({
      scheduler: createScheduler(
        [
          createDecision('enqueued', 100),
          createDecision('skipped', 200, 'pending-job-limit-reached'),
        ],
        calls,
      ),
      scheduleIntervalMs: 25,
      clock: createClock([100, 150, 200, 250]),
    });

    await expect(host.runOnce()).resolves.toMatchObject({ status: 'enqueued' });
    await expect(host.runOnce()).resolves.toMatchObject({
      status: 'skipped',
      reason: 'pending-job-limit-reached',
    });
    expect(calls).toEqual([100, 200]);
    expect(host.getStatus()).toMatchObject({
      running: false,
      inFlight: false,
      scheduleIntervalMs: 25,
      attemptedScheduleCount: 2,
      enqueuedScheduleCount: 1,
      skippedScheduleCount: 1,
      lastScheduleStartedAt: 200,
      lastScheduleCompletedAt: 250,
      lastDecision: {
        status: 'skipped',
        reason: 'pending-job-limit-reached',
      },
    });
  });

  test('host starts and stops a single timer loop', () => {
    const scheduled: { readonly delayMs: number; readonly callback: () => void }[] = [];
    const cleared: unknown[] = [];
    const host = createLocalSimulationRuntimeSchedulerHost({
      scheduler: createScheduler([createDecision('skipped', 100)], []),
      scheduleIntervalMs: 40,
      clock: createClock([100, 150]),
      timer: {
        setTimeout: (callback, delayMs) => {
          const handle = { delayMs };
          scheduled.push({ callback, delayMs });
          return handle;
        },
        clearTimeout: (handle) => {
          cleared.push(handle);
        },
      },
    });

    host.start();
    host.start();
    expect(host.getStatus()).toMatchObject({ running: true, inFlight: false });
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([0]);

    host.stop();
    expect(host.getStatus()).toMatchObject({ running: false, inFlight: false });
    expect(cleared).toEqual([{ delayMs: 0 }]);
  });
});

function createScheduler(
  decisions: LocalSimulationRuntimeSchedulerDecision[],
  calls: number[],
): LocalSimulationRuntimeScheduler {
  return {
    schedule: (request: LocalSimulationRuntimeSchedulerScheduleRequest) => {
      calls.push(request.observedAt);
      const decision = decisions.shift();
      if (decision === undefined) {
        throw new Error('scheduler exhausted');
      }
      return Promise.resolve(decision);
    },
  };
}

function createDecision(
  status: 'enqueued' | 'skipped',
  observedAt: number,
  reason?: 'pending-job-limit-reached' | 'dead-lettered-jobs-present',
): LocalSimulationRuntimeSchedulerDecision {
  const statsBeforeSchedule = {
    observedAt,
    manifestId: 'town-runtime',
    totalJobCount: 0,
    statusCounts: {
      queued: 0,
      leased: 0,
      completed: 0,
      failed: 0,
      'dead-lettered': 0,
    },
    readyQueueCount: 0,
    delayedQueueCount: 0,
    activeLeaseCount: 0,
    expiredLeaseCount: 0,
    failedAttemptCount: 0,
    replayCount: 0,
  };
  if (status === 'skipped') {
    return {
      status,
      reason: reason ?? 'pending-job-limit-reached',
      statsBeforeSchedule,
    };
  }
  return {
    status,
    job: {
      jobId: `job-${observedAt}`,
      manifestId: 'town-runtime',
      enqueuedAt: observedAt,
      runRequest: {
        operationId: `op-${observedAt}`,
        requestedAt: observedAt,
        cycleCount: 1,
      },
      status: 'queued',
      updatedAt: observedAt,
    },
    statsBeforeSchedule,
  };
}

function createClock(values: number[]): { readonly now: () => number } {
  return {
    now: () => {
      const next = values.shift();
      if (next === undefined) {
        throw new Error('clock exhausted');
      }
      return next;
    },
  };
}
