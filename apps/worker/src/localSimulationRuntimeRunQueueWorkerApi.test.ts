import { describe, expect, test } from 'vitest';
import { createLocalSimulationRuntimeRunQueueWorkerApiService } from './index';
import type {
  LocalSimulationRuntimeRunQueueWorkerHost,
  LocalSimulationRuntimeRunQueueWorkerHostStatus,
} from './localSimulationRuntimeRunQueueWorkerHost';

describe('local simulation runtime run queue worker API adapter', () => {
  test('maps API worker controls onto the local worker host', async () => {
    const calls: unknown[] = [];
    let running = false;
    let processedJobCount = 0;
    const service = createLocalSimulationRuntimeRunQueueWorkerApiService({
      host: createHost({
        getStatus: () => ({
          running,
          inFlight: false,
          pollIntervalMs: 1000,
          processedJobCount,
          completedJobCount: processedJobCount,
          failedJobCount: 0,
        }),
        start: () => {
          calls.push({ method: 'start' });
          running = true;
        },
        stop: () => {
          calls.push({ method: 'stop' });
          running = false;
        },
        drain: (request) => {
          calls.push({ method: 'drain', request });
          processedJobCount += request?.maxJobs ?? 1;
          return Promise.resolve({
            processedJobCount: request?.maxJobs ?? 1,
            completedJobCount: request?.maxJobs ?? 1,
            failedJobCount: 0,
            idle: false,
            results: [],
          });
        },
      }),
    });

    await expect(service.startRuntimeRunQueueWorker()).resolves.toMatchObject({
      running: true,
      processedJobCount: 0,
    });
    await expect(service.drainRuntimeRunQueueWorker({ maxJobs: 2 })).resolves.toMatchObject({
      processedJobCount: 2,
      completedJobCount: 2,
      failedJobCount: 0,
      idle: false,
    });
    await expect(service.stopRuntimeRunQueueWorker()).resolves.toMatchObject({
      running: false,
      processedJobCount: 2,
    });
    await expect(service.getRuntimeRunQueueWorkerStatus()).resolves.toMatchObject({
      running: false,
      processedJobCount: 2,
    });
    expect(calls).toEqual([
      { method: 'start' },
      { method: 'drain', request: { maxJobs: 2 } },
      { method: 'stop' },
    ]);
  });
});

function createHost(input: {
  readonly getStatus: () => LocalSimulationRuntimeRunQueueWorkerHostStatus;
  readonly start: () => void;
  readonly stop: () => void;
  readonly drain: LocalSimulationRuntimeRunQueueWorkerHost['drain'];
}): LocalSimulationRuntimeRunQueueWorkerHost {
  return {
    runOnce: () => Promise.resolve({ status: 'idle' }),
    drain: input.drain,
    start: input.start,
    stop: input.stop,
    getStatus: input.getStatus,
  };
}
