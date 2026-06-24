import { describe, expect, test } from 'vitest';
import { createRuntimeRunQueueApiService } from './index';

type TestRunQueueJob = {
  readonly jobId: string;
  readonly status: 'queued';
  readonly enqueuedAt: number;
  readonly runRequest: {
    readonly operationId?: string;
    readonly requestedAt: number;
    readonly cycleCount: number;
    readonly cycleIntervalMs?: number;
    readonly stopOnAttention?: boolean;
  };
};

describe('runtime run queue API service', () => {
  test('normalizes run job requests before delegating to the injected control port', async () => {
    const calls: unknown[] = [];
    const service = createRuntimeRunQueueApiService<TestRunQueueJob>({
      control: {
        enqueueRun: (request) => {
          calls.push({ method: 'enqueueRun', request });
          return Promise.resolve({
            jobId: request.jobId,
            status: 'queued',
            enqueuedAt: request.enqueuedAt,
            runRequest: request,
          });
        },
        getRunJob: (jobId) => {
          calls.push({ method: 'getRunJob', jobId });
          return Promise.resolve({
            jobId,
            status: 'queued',
            enqueuedAt: 95,
            runRequest: {
              operationId: 'op-run-100',
              requestedAt: 100,
              cycleCount: 2,
              cycleIntervalMs: 50,
              stopOnAttention: true,
            },
          });
        },
      },
    });

    await expect(
      service.enqueueRuntimeRun({
        jobId: 'job-run-100',
        enqueuedAt: 95,
        operationId: 'op-run-100',
        requestedAt: 100,
        cycleCount: 2,
        cycleIntervalMs: 50,
        stopOnAttention: true,
      }),
    ).resolves.toEqual({
      jobId: 'job-run-100',
      status: 'queued',
      enqueuedAt: 95,
      runRequest: {
        jobId: 'job-run-100',
        enqueuedAt: 95,
        operationId: 'op-run-100',
        requestedAt: 100,
        cycleCount: 2,
        cycleIntervalMs: 50,
        stopOnAttention: true,
      },
    });
    await expect(service.getRuntimeRunJob({ jobId: 'job-run-100' })).resolves.toEqual({
      jobId: 'job-run-100',
      status: 'queued',
      enqueuedAt: 95,
      runRequest: {
        operationId: 'op-run-100',
        requestedAt: 100,
        cycleCount: 2,
        cycleIntervalMs: 50,
        stopOnAttention: true,
      },
    });
    expect(calls).toEqual([
      {
        method: 'enqueueRun',
        request: {
          jobId: 'job-run-100',
          enqueuedAt: 95,
          operationId: 'op-run-100',
          requestedAt: 100,
          cycleCount: 2,
          cycleIntervalMs: 50,
          stopOnAttention: true,
        },
      },
      { method: 'getRunJob', jobId: 'job-run-100' },
    ]);
  });

  test('rejects invalid queue requests before hitting the control port', async () => {
    const calls: unknown[] = [];
    const service = createRuntimeRunQueueApiService<TestRunQueueJob>({
      control: {
        enqueueRun: (request) => {
          calls.push(request);
          return Promise.resolve({
            jobId: request.jobId,
            status: 'queued',
            enqueuedAt: request.enqueuedAt,
            runRequest: request,
          });
        },
        getRunJob: (jobId) => {
          calls.push(jobId);
          return Promise.resolve(undefined);
        },
      },
    });

    await expect(
      service.enqueueRuntimeRun({ jobId: ' ', enqueuedAt: 1, requestedAt: 2, cycleCount: 1 }),
    ).rejects.toThrow('jobId must not be empty');
    await expect(
      service.enqueueRuntimeRun({ jobId: 'job-1', enqueuedAt: -1, requestedAt: 2, cycleCount: 1 }),
    ).rejects.toThrow('enqueuedAt must be a non-negative finite number');
    await expect(
      service.enqueueRuntimeRun({ jobId: 'job-1', enqueuedAt: 1, requestedAt: -1, cycleCount: 1 }),
    ).rejects.toThrow('requestedAt must be a non-negative finite number');
    await expect(
      service.enqueueRuntimeRun({ jobId: 'job-1', enqueuedAt: 1, requestedAt: 2, cycleCount: 0 }),
    ).rejects.toThrow('cycleCount must be a positive integer');
    await expect(
      service.enqueueRuntimeRun({
        jobId: 'job-1',
        enqueuedAt: 1,
        requestedAt: 2,
        cycleCount: 1,
        cycleIntervalMs: -1,
      }),
    ).rejects.toThrow('cycleIntervalMs must be a non-negative finite number');
    await expect(
      service.enqueueRuntimeRun({
        jobId: 'job-1',
        enqueuedAt: 1,
        requestedAt: 2,
        cycleCount: 1,
        stopOnAttention: 'yes' as unknown as boolean,
      }),
    ).rejects.toThrow('stopOnAttention must be a boolean');
    await expect(service.getRuntimeRunJob({ jobId: '' })).rejects.toThrow(
      'jobId must not be empty',
    );
    expect(calls).toEqual([]);
  });
});
