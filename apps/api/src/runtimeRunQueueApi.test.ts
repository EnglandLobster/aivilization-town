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

type TestRunQueueStats = {
  readonly observedAt: number;
  readonly manifestId?: string;
  readonly totalJobCount: number;
};

describe('runtime run queue API service', () => {
  test('normalizes run job requests before delegating to the injected control port', async () => {
    const calls: unknown[] = [];
    const service = createRuntimeRunQueueApiService<TestRunQueueJob, TestRunQueueStats>({
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
        queryRunJobs: (request) => {
          calls.push({ method: 'queryRunJobs', request });
          return Promise.resolve([
            {
              jobId: 'job-dead-100',
              status: 'queued',
              enqueuedAt: 95,
              runRequest: {
                operationId: 'op-run-100',
                requestedAt: 100,
                cycleCount: 2,
              },
            },
          ]);
        },
        getRunQueueStats: (request) => {
          calls.push({ method: 'getRunQueueStats', request });
          return Promise.resolve({
            observedAt: request.observedAt,
            ...(request.manifestId === undefined ? {} : { manifestId: request.manifestId }),
            totalJobCount: 4,
          });
        },
        replayRunJob: (request) => {
          calls.push({ method: 'replayRunJob', request });
          return Promise.resolve({
            jobId: request.jobId,
            status: 'queued',
            enqueuedAt: 95,
            runRequest: {
              operationId: 'op-run-100',
              requestedAt: 100,
              cycleCount: 2,
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
    await expect(
      service.queryRuntimeRunJobs({
        status: 'dead-lettered',
        manifestId: 'town-runtime',
        limit: 2,
      }),
    ).resolves.toEqual([
      {
        jobId: 'job-dead-100',
        status: 'queued',
        enqueuedAt: 95,
        runRequest: {
          operationId: 'op-run-100',
          requestedAt: 100,
          cycleCount: 2,
        },
      },
    ]);
    await expect(
      service.getRuntimeRunQueueStats({
        observedAt: 260,
        manifestId: 'town-runtime',
      }),
    ).resolves.toEqual({
      observedAt: 260,
      manifestId: 'town-runtime',
      totalJobCount: 4,
    });
    await expect(
      service.replayRuntimeRunJob({
        jobId: 'job-dead-100',
        replayedAt: 500,
        maxAttempts: 3,
      }),
    ).resolves.toEqual({
      jobId: 'job-dead-100',
      status: 'queued',
      enqueuedAt: 95,
      runRequest: {
        operationId: 'op-run-100',
        requestedAt: 100,
        cycleCount: 2,
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
      {
        method: 'queryRunJobs',
        request: { status: 'dead-lettered', manifestId: 'town-runtime', limit: 2 },
      },
      {
        method: 'getRunQueueStats',
        request: { observedAt: 260, manifestId: 'town-runtime' },
      },
      {
        method: 'replayRunJob',
        request: { jobId: 'job-dead-100', replayedAt: 500, maxAttempts: 3 },
      },
    ]);
  });

  test('rejects invalid queue requests before hitting the control port', async () => {
    const calls: unknown[] = [];
    const service = createRuntimeRunQueueApiService<TestRunQueueJob, TestRunQueueStats>({
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
        queryRunJobs: (request) => {
          calls.push(request);
          return Promise.resolve([]);
        },
        getRunQueueStats: (request) => {
          calls.push(request);
          return Promise.resolve({ observedAt: request.observedAt, totalJobCount: 0 });
        },
        replayRunJob: (request) => {
          calls.push(request);
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
    await expect(
      service.queryRuntimeRunJobs({ status: 'missing' as 'dead-lettered' }),
    ).rejects.toThrow('status must be a known run queue job status');
    await expect(service.queryRuntimeRunJobs({ limit: 0 })).rejects.toThrow(
      'limit must be a positive integer',
    );
    await expect(service.getRuntimeRunQueueStats({ observedAt: -1 })).rejects.toThrow(
      'observedAt must be a non-negative finite number',
    );
    await expect(
      service.getRuntimeRunQueueStats({ observedAt: 1, manifestId: '' }),
    ).rejects.toThrow('manifestId must not be empty');
    await expect(service.replayRuntimeRunJob({ jobId: '', replayedAt: 100 })).rejects.toThrow(
      'jobId must not be empty',
    );
    await expect(
      service.replayRuntimeRunJob({ jobId: 'job-dead-1', replayedAt: -1 }),
    ).rejects.toThrow('replayedAt must be a non-negative finite number');
    await expect(
      service.replayRuntimeRunJob({ jobId: 'job-dead-1', replayedAt: 100, maxAttempts: 0 }),
    ).rejects.toThrow('maxAttempts must be a positive integer');
    expect(calls).toEqual([]);
  });
});
