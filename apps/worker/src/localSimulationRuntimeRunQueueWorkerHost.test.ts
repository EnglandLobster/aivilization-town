import { describe, expect, test } from 'vitest';
import {
  createLocalSimulationRuntimeRunQueueWorkerHost,
  type LocalSimulationRuntimeRunQueueJob,
  type LocalSimulationRuntimeRunQueueWorker,
  type LocalSimulationRuntimeRunQueueWorkerRunResult,
} from './index';

describe('local simulation runtime run queue worker host', () => {
  test('drains worker results until idle and reports execution counters', async () => {
    const calls: number[] = [];
    const worker = createWorker([
      { status: 'completed', job: createJob('job-1', 'completed') },
      { status: 'failed', job: createJob('job-2', 'failed') },
      { status: 'idle' },
    ]);
    const host = createLocalSimulationRuntimeRunQueueWorkerHost({
      worker: {
        runNext: (request) => {
          calls.push(request.claimedAt);
          return worker.runNext(request);
        },
      },
      clock: createClock([100, 150, 200, 250, 300, 350]),
      pollIntervalMs: 25,
    });

    await expect(host.drain({ maxJobs: 5 })).resolves.toMatchObject({
      processedJobCount: 2,
      completedJobCount: 1,
      failedJobCount: 1,
      idle: true,
      results: [
        { status: 'completed', job: { jobId: 'job-1' } },
        { status: 'failed', job: { jobId: 'job-2' } },
      ],
    });
    expect(calls).toEqual([100, 200, 300]);
    expect(host.getStatus()).toMatchObject({
      running: false,
      inFlight: false,
      processedJobCount: 2,
      completedJobCount: 1,
      failedJobCount: 1,
      lastRunStartedAt: 300,
      lastRunCompletedAt: 350,
    });
  });

  test('starts and stops a single polling loop through the injected scheduler', () => {
    const scheduled: { readonly delayMs: number; readonly callback: () => void }[] = [];
    const cleared: unknown[] = [];
    const host = createLocalSimulationRuntimeRunQueueWorkerHost({
      worker: createWorker([{ status: 'idle' }]),
      clock: createClock([100, 150]),
      pollIntervalMs: 40,
      scheduler: {
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

function createWorker(
  results: LocalSimulationRuntimeRunQueueWorkerRunResult[],
): LocalSimulationRuntimeRunQueueWorker {
  return {
    runNext: () => {
      const result = results.shift();
      return Promise.resolve(result ?? { status: 'idle' });
    },
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

function createJob(
  jobId: string,
  status: 'completed' | 'failed',
): LocalSimulationRuntimeRunQueueJob {
  return {
    jobId,
    manifestId: 'town-runtime',
    enqueuedAt: 90,
    runRequest: {
      operationId: `op-${jobId}`,
      requestedAt: 100,
      cycleCount: 1,
    },
    status,
    updatedAt: 150,
    startedAt: 100,
    ...(status === 'completed'
      ? { completedAt: 150, resultTraceId: `op-${jobId}` }
      : { failedAt: 150, error: { name: 'Error', message: 'runtime exploded' } }),
  };
}
