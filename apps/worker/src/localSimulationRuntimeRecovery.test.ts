import { describe, expect, test, vi } from 'vitest';
import {
  createLocalSimulationRuntimeRecovery,
  InMemoryLocalSimulationRuntimeRunQueueRepository,
} from './index';

describe('local simulation runtime recovery', () => {
  test('replays dead-lettered jobs within guardrails and reports skipped replay limits', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    await createDeadLetter(repository, {
      jobId: 'job-dead-1',
      operationId: 'op-dead-1',
      enqueuedAt: 100,
      claimedAt: 110,
      failedAt: 120,
    });
    await createDeadLetter(repository, {
      jobId: 'job-dead-2',
      operationId: 'op-dead-2',
      enqueuedAt: 130,
      claimedAt: 140,
      failedAt: 150,
    });
    await repository.replayDeadLetter({
      jobId: 'job-dead-2',
      replayedAt: 160,
    });
    await repository.claimNext({
      workerId: 'worker-a',
      claimedAt: 170,
      leaseDurationMs: 50,
    });
    await repository.fail({
      jobId: 'job-dead-2',
      workerId: 'worker-a',
      attemptNumber: 2,
      failedAt: 180,
      maxAttempts: 2,
      error: { name: 'Error', message: 'failed after replay' },
    });

    const recovery = createLocalSimulationRuntimeRecovery({
      manifestId: 'town-runtime',
      queueRepository: repository,
      policy: {
        maxDeadLetterReplaysPerRun: 2,
        maxReplayCountPerJob: 1,
        deadLetterReplayMaxAttempts: 3,
      },
    });

    await expect(recovery.recover({ observedAt: 300 })).resolves.toMatchObject({
      status: 'recovered',
      statsBeforeRecovery: {
        observedAt: 300,
        manifestId: 'town-runtime',
        statusCounts: {
          'dead-lettered': 2,
        },
      },
      replayedDeadLetterJobs: [
        {
          jobId: 'job-dead-1',
          status: 'queued',
          nextAttemptAt: 300,
          replayCount: 1,
          maxAttempts: 3,
        },
      ],
      skippedDeadLetterJobs: [
        {
          jobId: 'job-dead-2',
          reason: 'replay-limit-reached',
          replayCount: 1,
        },
      ],
      statsAfterRecovery: {
        statusCounts: {
          queued: 1,
          'dead-lettered': 1,
        },
      },
    });
  });

  test('drains a dead letter replayed during the same recovery run', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    await repository.enqueue({
      jobId: 'dead-letter-same-run',
      manifestId: 'town-runtime',
      enqueuedAt: 100,
      runRequest: { requestedAt: 100, cycleCount: 1 },
    });
    await repository.claimNext({
      workerId: 'fault-worker',
      claimedAt: 100,
      leaseDurationMs: 10,
      manifestId: 'town-runtime',
    });
    await repository.fail({
      jobId: 'dead-letter-same-run',
      workerId: 'fault-worker',
      attemptNumber: 1,
      failedAt: 101,
      maxAttempts: 1,
      error: { name: 'InjectedFailure', message: 'drill' },
    });
    const drain = vi.fn().mockResolvedValue({
      processedJobCount: 1,
      completedJobCount: 1,
      failedJobCount: 0,
      idle: false,
      results: [],
    });
    const recovery = createLocalSimulationRuntimeRecovery({
      manifestId: 'town-runtime',
      queueRepository: repository,
      workerHost: { drain },
      policy: {
        maxDeadLetterReplaysPerRun: 1,
        maxReplayCountPerJob: 1,
        maxDrainJobsPerRun: 1,
      },
    });

    const report = await recovery.recover({ observedAt: 200 });

    expect(report.replayedDeadLetterJobs).toHaveLength(1);
    expect(drain).toHaveBeenCalledWith({ maxJobs: 1 });
  });

  test('drains ready and expired queue work through the worker host', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    await repository.enqueue({
      jobId: 'job-ready',
      manifestId: 'town-runtime',
      enqueuedAt: 100,
      runRequest: {
        operationId: 'op-ready',
        requestedAt: 100,
        cycleCount: 1,
      },
    });
    await repository.enqueue({
      jobId: 'job-expired',
      manifestId: 'town-runtime',
      enqueuedAt: 110,
      runRequest: {
        operationId: 'op-expired',
        requestedAt: 110,
        cycleCount: 1,
      },
    });
    await repository.claimNext({
      workerId: 'worker-stale',
      claimedAt: 120,
      leaseDurationMs: 50,
    });
    const drainCalls: unknown[] = [];
    const recovery = createLocalSimulationRuntimeRecovery({
      manifestId: 'town-runtime',
      queueRepository: repository,
      workerHost: {
        drain: (request) => {
          drainCalls.push(request);
          return Promise.resolve({
            processedJobCount: 2,
            completedJobCount: 1,
            failedJobCount: 1,
            idle: false,
            results: [],
          });
        },
      },
      policy: {
        maxDrainJobsPerRun: 5,
      },
    });

    await expect(recovery.recover({ observedAt: 200 })).resolves.toMatchObject({
      status: 'recovered',
      drainResult: {
        processedJobCount: 2,
        completedJobCount: 1,
        failedJobCount: 1,
        idle: false,
      },
    });
    expect(drainCalls).toEqual([{ maxJobs: 2 }]);
  });
});

async function createDeadLetter(
  repository: InMemoryLocalSimulationRuntimeRunQueueRepository,
  input: {
    readonly jobId: string;
    readonly operationId: string;
    readonly enqueuedAt: number;
    readonly claimedAt: number;
    readonly failedAt: number;
  },
): Promise<void> {
  await repository.enqueue({
    jobId: input.jobId,
    manifestId: 'town-runtime',
    enqueuedAt: input.enqueuedAt,
    runRequest: {
      operationId: input.operationId,
      requestedAt: input.enqueuedAt,
      cycleCount: 1,
    },
  });
  await repository.claimNext({
    workerId: 'worker-a',
    claimedAt: input.claimedAt,
    leaseDurationMs: 50,
  });
  await repository.fail({
    jobId: input.jobId,
    workerId: 'worker-a',
    attemptNumber: 1,
    failedAt: input.failedAt,
    maxAttempts: 1,
    error: { name: 'Error', message: `failure for ${input.jobId}` },
  });
}
