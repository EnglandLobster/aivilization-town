import { describe, expect, test } from 'vitest';
import { createRuntimeRunQueueWorkerApiService } from './index';

type TestWorkerStatus = {
  readonly running: boolean;
  readonly processedJobCount: number;
};

type TestDrainResult = {
  readonly processedJobCount: number;
  readonly idle: boolean;
};

describe('runtime run queue worker API service', () => {
  test('delegates worker status, lifecycle, and drain operations to the injected control port', async () => {
    const calls: unknown[] = [];
    const service = createRuntimeRunQueueWorkerApiService<TestWorkerStatus, TestDrainResult>({
      control: {
        getStatus: () => {
          calls.push({ method: 'getStatus' });
          return Promise.resolve({ running: false, processedJobCount: 0 });
        },
        start: () => {
          calls.push({ method: 'start' });
          return Promise.resolve({ running: true, processedJobCount: 0 });
        },
        stop: () => {
          calls.push({ method: 'stop' });
          return Promise.resolve({ running: false, processedJobCount: 0 });
        },
        drain: (request) => {
          calls.push({ method: 'drain', request });
          return Promise.resolve({
            processedJobCount: request.maxJobs ?? 1,
            idle: false,
          });
        },
      },
    });

    await expect(service.getRuntimeRunQueueWorkerStatus()).resolves.toEqual({
      running: false,
      processedJobCount: 0,
    });
    await expect(service.startRuntimeRunQueueWorker()).resolves.toEqual({
      running: true,
      processedJobCount: 0,
    });
    await expect(service.drainRuntimeRunQueueWorker({ maxJobs: 3 })).resolves.toEqual({
      processedJobCount: 3,
      idle: false,
    });
    await expect(service.stopRuntimeRunQueueWorker()).resolves.toEqual({
      running: false,
      processedJobCount: 0,
    });
    expect(calls).toEqual([
      { method: 'getStatus' },
      { method: 'start' },
      { method: 'drain', request: { maxJobs: 3 } },
      { method: 'stop' },
    ]);
  });

  test('rejects invalid drain requests before hitting the control port', async () => {
    const calls: unknown[] = [];
    const service = createRuntimeRunQueueWorkerApiService<TestWorkerStatus, TestDrainResult>({
      control: {
        getStatus: () => {
          calls.push('getStatus');
          return Promise.resolve({ running: false, processedJobCount: 0 });
        },
        start: () => {
          calls.push('start');
          return Promise.resolve({ running: true, processedJobCount: 0 });
        },
        stop: () => {
          calls.push('stop');
          return Promise.resolve({ running: false, processedJobCount: 0 });
        },
        drain: (request) => {
          calls.push(request);
          return Promise.resolve({ processedJobCount: 0, idle: true });
        },
      },
    });

    await expect(service.drainRuntimeRunQueueWorker({ maxJobs: 0 })).rejects.toThrow(
      'maxJobs must be a positive integer',
    );
    await expect(service.drainRuntimeRunQueueWorker({ maxJobs: 1.5 })).rejects.toThrow(
      'maxJobs must be a positive integer',
    );
    expect(calls).toEqual([]);
  });
});
