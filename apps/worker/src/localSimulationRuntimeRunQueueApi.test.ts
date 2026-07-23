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

  test('queries and replays dead-lettered jobs through the local repository', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    const service = createLocalSimulationRuntimeRunQueueApiService({
      repository,
      manifestId: 'town-runtime',
    });
    await repository.enqueue({
      jobId: 'job-dead-100',
      manifestId: 'town-runtime',
      enqueuedAt: 90,
      runRequest: {
        operationId: 'op-run-dead-100',
        requestedAt: 100,
        cycleCount: 1,
      },
    });
    await repository.claimNext({
      workerId: 'worker-1',
      claimedAt: 110,
      leaseDurationMs: 100,
    });
    await repository.fail({
      jobId: 'job-dead-100',
      workerId: 'worker-1',
      attemptNumber: 1,
      failedAt: 120,
      maxAttempts: 1,
      error: { name: 'Error', message: 'runtime exploded' },
    });

    await expect(
      service.queryRuntimeRunJobs({ status: 'dead-lettered', limit: 1 }),
    ).resolves.toMatchObject([
      {
        jobId: 'job-dead-100',
        manifestId: 'town-runtime',
        status: 'dead-lettered',
        deadLetteredAt: 120,
      },
    ]);
    await expect(
      service.replayRuntimeRunJob({
        jobId: 'job-dead-100',
        replayedAt: 200,
      }),
    ).resolves.toMatchObject({
      jobId: 'job-dead-100',
      manifestId: 'town-runtime',
      status: 'queued',
      nextAttemptAt: 200,
      replayCount: 1,
      lastReplayedAt: 200,
      maxAttempts: 2,
    });
    await expect(
      service.getRuntimeRunQueueStats({ observedAt: 200, manifestId: 'town-runtime' }),
    ).resolves.toMatchObject({
      observedAt: 200,
      manifestId: 'town-runtime',
      totalJobCount: 1,
      statusCounts: {
        queued: 1,
        leased: 0,
        completed: 0,
        failed: 0,
        'dead-lettered': 0,
      },
      readyQueueCount: 1,
      failedAttemptCount: 1,
      replayCount: 1,
    });
  });
});
