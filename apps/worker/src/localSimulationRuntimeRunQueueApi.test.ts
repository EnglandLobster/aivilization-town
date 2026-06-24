import { describe, expect, test } from 'vitest';
import {
  createLocalSimulationRuntimeRunQueueApiService,
  InMemoryLocalSimulationRuntimeRunQueueRepository,
} from './index';

describe('local simulation runtime run queue API adapter', () => {
  test('enqueues API run jobs into the manifest-scoped local runtime queue', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    const service = createLocalSimulationRuntimeRunQueueApiService({
      repository,
      manifestId: 'town-runtime',
    });

    await expect(
      service.enqueueRuntimeRun({
        jobId: 'job-run-100',
        operationId: 'op-run-100',
        enqueuedAt: 90,
        requestedAt: 100,
        cycleCount: 2,
        cycleIntervalMs: 50,
        stopOnAttention: true,
      }),
    ).resolves.toMatchObject({
      jobId: 'job-run-100',
      manifestId: 'town-runtime',
      status: 'queued',
      enqueuedAt: 90,
      updatedAt: 90,
      runRequest: {
        operationId: 'op-run-100',
        requestedAt: 100,
        cycleCount: 2,
        cycleIntervalMs: 50,
        stopOnAttention: true,
      },
    });
    await expect(service.getRuntimeRunJob({ jobId: 'job-run-100' })).resolves.toMatchObject({
      jobId: 'job-run-100',
      manifestId: 'town-runtime',
      status: 'queued',
      enqueuedAt: 90,
      runRequest: {
        operationId: 'op-run-100',
        requestedAt: 100,
        cycleCount: 2,
      },
    });
  });
});
