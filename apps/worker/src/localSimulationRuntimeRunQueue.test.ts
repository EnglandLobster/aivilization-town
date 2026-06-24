import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createLocalSimulationRuntimeRunQueueWorker,
  FileLocalSimulationRuntimeRunQueueRepository,
  InMemoryLocalSimulationRuntimeRunQueueRepository,
  type LocalSimulationRuntimeRunQueueJobInput,
  type LocalSimulationRuntimeSupervisor,
  type LocalSimulationRuntimeSupervisorRunCyclesResult,
  type LocalSimulationRuntimeSupervisorStatus,
} from './index';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local simulation runtime run queue', () => {
  test('in-memory repository stores clones and leases earliest eligible jobs', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    const firstJobInput = createJobInput('job-1', 'op-run-1', 100);
    const secondJobInput = createJobInput('job-2', 'op-run-2', 200);
    await repository.enqueue(firstJobInput);
    await repository.enqueue(secondJobInput);

    (firstJobInput.runRequest as { cycleCount: number }).cycleCount = 99;

    const firstClaim = await repository.claimNext({
      workerId: 'worker-a',
      claimedAt: 300,
      leaseDurationMs: 50,
    });
    expect(firstClaim).toMatchObject({
      jobId: 'job-1',
      status: 'leased',
      leaseOwnerId: 'worker-a',
      leaseExpiresAt: 350,
      runRequest: { cycleCount: 2 },
    });
    const secondClaim = await repository.claimNext({
      workerId: 'worker-a',
      claimedAt: 320,
      leaseDurationMs: 50,
    });
    expect(secondClaim).toMatchObject({
      jobId: 'job-2',
      status: 'leased',
      leaseOwnerId: 'worker-a',
      leaseExpiresAt: 370,
    });

    (firstClaim?.runRequest as { cycleCount: number } | undefined)!.cycleCount = 42;
    await expect(repository.get('job-1')).resolves.toMatchObject({
      jobId: 'job-1',
      runRequest: { cycleCount: 2 },
    });

    const reclaimed = await repository.claimNext({
      workerId: 'worker-b',
      claimedAt: 351,
      leaseDurationMs: 25,
    });
    expect(reclaimed).toMatchObject({
      jobId: 'job-1',
      status: 'leased',
      leaseOwnerId: 'worker-b',
      leaseExpiresAt: 376,
    });
  });

  test('file repository recovers latest queue job state after restart', async () => {
    const rootDir = createRootDir();
    const firstRepository = new FileLocalSimulationRuntimeRunQueueRepository({ rootDir });
    await firstRepository.enqueue(createJobInput('job-file-1', 'op-run-file-1', 100));

    const restartedRepository = new FileLocalSimulationRuntimeRunQueueRepository({ rootDir });
    const claimed = await restartedRepository.claimNext({
      workerId: 'worker-file',
      claimedAt: 150,
      leaseDurationMs: 100,
    });
    expect(claimed).toMatchObject({
      jobId: 'job-file-1',
      status: 'leased',
      leaseOwnerId: 'worker-file',
      leaseExpiresAt: 250,
    });
    await restartedRepository.complete({
      jobId: 'job-file-1',
      completedAt: 180,
      resultTraceId: 'op-run-file-1',
    });

    const finalRepository = new FileLocalSimulationRuntimeRunQueueRepository({ rootDir });
    await expect(finalRepository.get('job-file-1')).resolves.toMatchObject({
      jobId: 'job-file-1',
      status: 'completed',
      completedAt: 180,
      resultTraceId: 'op-run-file-1',
    });
  });

  test('file repository recovers retry metadata after restart', async () => {
    const rootDir = createRootDir();
    const repository = new FileLocalSimulationRuntimeRunQueueRepository({ rootDir });
    await repository.enqueue(createJobInput('job-file-retry', 'op-run-file-retry', 100));
    await repository.claimNext({
      workerId: 'worker-file',
      claimedAt: 150,
      leaseDurationMs: 100,
    });
    await repository.fail({
      jobId: 'job-file-retry',
      failedAt: 160,
      maxAttempts: 2,
      retryDelayMs: 25,
      error: { name: 'Error', message: 'transient failure' },
    });

    const restartedRepository = new FileLocalSimulationRuntimeRunQueueRepository({ rootDir });
    await expect(restartedRepository.get('job-file-retry')).resolves.toMatchObject({
      jobId: 'job-file-retry',
      status: 'queued',
      attemptCount: 1,
      failedAttemptCount: 1,
      maxAttempts: 2,
      nextAttemptAt: 185,
      attempts: [
        {
          attemptNumber: 1,
          workerId: 'worker-file',
          startedAt: 150,
          failedAt: 160,
          error: { message: 'transient failure' },
        },
      ],
    });
    await expect(
      restartedRepository.claimNext({
        workerId: 'worker-file-2',
        claimedAt: 184,
        leaseDurationMs: 100,
      }),
    ).resolves.toBeUndefined();
    await expect(
      restartedRepository.claimNext({
        workerId: 'worker-file-2',
        claimedAt: 185,
        leaseDurationMs: 100,
      }),
    ).resolves.toMatchObject({
      jobId: 'job-file-retry',
      status: 'leased',
      attemptCount: 2,
      attempts: [
        { attemptNumber: 1, failedAt: 160 },
        { attemptNumber: 2, workerId: 'worker-file-2', startedAt: 185 },
      ],
    });
  });

  test('queue worker claims one job and marks it completed after running supervisor cycles', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    await repository.enqueue(createJobInput('job-worker-1', 'op-run-worker-1', 100));
    const calls: unknown[] = [];
    const supervisor = createSupervisor({
      runCycles: (request) => {
        calls.push(request);
        return Promise.resolve(createRunCyclesResult(request.operationId ?? 'generated-run'));
      },
    });
    const worker = createLocalSimulationRuntimeRunQueueWorker({
      workerId: 'worker-1',
      queueRepository: repository,
      supervisor,
      leaseDurationMs: 100,
    });

    await expect(worker.runNext({ claimedAt: 200 })).resolves.toMatchObject({
      status: 'completed',
      job: {
        jobId: 'job-worker-1',
        status: 'completed',
        resultTraceId: 'op-run-worker-1',
      },
    });
    expect(calls).toEqual([
      {
        operationId: 'op-run-worker-1',
        requestedAt: 100,
        cycleCount: 2,
        cycleIntervalMs: 50,
        stopOnAttention: true,
      },
    ]);
    await expect(repository.get('job-worker-1')).resolves.toMatchObject({
      status: 'completed',
      completedAt: 200,
      resultTraceId: 'op-run-worker-1',
    });
  });

  test('queue worker retries a failed attempt after the retry delay and preserves attempt history', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    await repository.enqueue(createJobInput('job-worker-retry', 'op-run-worker-retry', 100));
    let attempt = 0;
    const supervisor = createSupervisor({
      runCycles: (request) => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(new Error('temporary runtime failure'));
        }
        return Promise.resolve(createRunCyclesResult(request.operationId ?? 'generated-run'));
      },
    });
    const worker = createLocalSimulationRuntimeRunQueueWorker({
      workerId: 'worker-1',
      queueRepository: repository,
      supervisor,
      leaseDurationMs: 100,
      maxAttempts: 2,
      retryDelayMs: 25,
    });

    await expect(worker.runNext({ claimedAt: 200 })).resolves.toMatchObject({
      status: 'failed',
      job: {
        jobId: 'job-worker-retry',
        status: 'queued',
        attemptCount: 1,
        failedAttemptCount: 1,
        maxAttempts: 2,
        nextAttemptAt: 225,
        attempts: [
          {
            attemptNumber: 1,
            workerId: 'worker-1',
            startedAt: 200,
            failedAt: 200,
            error: { message: 'temporary runtime failure' },
          },
        ],
      },
    });
    await expect(worker.runNext({ claimedAt: 224 })).resolves.toEqual({ status: 'idle' });
    await expect(worker.runNext({ claimedAt: 225 })).resolves.toMatchObject({
      status: 'completed',
      job: {
        jobId: 'job-worker-retry',
        status: 'completed',
        attemptCount: 2,
        failedAttemptCount: 1,
        resultTraceId: 'op-run-worker-retry',
        attempts: [
          { attemptNumber: 1, failedAt: 200 },
          {
            attemptNumber: 2,
            workerId: 'worker-1',
            startedAt: 225,
            completedAt: 225,
            resultTraceId: 'op-run-worker-retry',
          },
        ],
      },
    });
  });

  test('queue worker dead-letters claimed job when supervisor execution exhausts attempts', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    await repository.enqueue(createJobInput('job-worker-fail', 'op-run-worker-fail', 100));
    const supervisor = createSupervisor({
      runCycles: () => Promise.reject(new Error('runtime exploded')),
    });
    const worker = createLocalSimulationRuntimeRunQueueWorker({
      workerId: 'worker-1',
      queueRepository: repository,
      supervisor,
      leaseDurationMs: 100,
    });

    await expect(worker.runNext({ claimedAt: 200 })).resolves.toMatchObject({
      status: 'failed',
      job: {
        jobId: 'job-worker-fail',
        status: 'dead-lettered',
        attemptCount: 1,
        failedAttemptCount: 1,
        failedAt: 200,
        deadLetteredAt: 200,
        error: {
          name: 'Error',
          message: 'runtime exploded',
        },
        attempts: [
          {
            attemptNumber: 1,
            workerId: 'worker-1',
            startedAt: 200,
            failedAt: 200,
            error: { message: 'runtime exploded' },
          },
        ],
      },
    });
    await expect(repository.get('job-worker-fail')).resolves.toMatchObject({
      status: 'dead-lettered',
      failedAt: 200,
      deadLetteredAt: 200,
      error: {
        name: 'Error',
        message: 'runtime exploded',
      },
    });
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-run-queue-'));
  tmpRoots.push(root);
  return root;
}

function createJobInput(
  jobId: string,
  operationId: string,
  requestedAt: number,
): LocalSimulationRuntimeRunQueueJobInput {
  return {
    jobId,
    manifestId: 'town-runtime',
    enqueuedAt: requestedAt - 10,
    runRequest: {
      operationId,
      requestedAt,
      cycleCount: 2,
      cycleIntervalMs: 50,
      stopOnAttention: true,
    },
  };
}

function createRunCyclesResult(traceId: string): LocalSimulationRuntimeSupervisorRunCyclesResult {
  return {
    traceId,
    outcome: 'succeeded',
    requestedCycleCount: 2,
    completedCycleCount: 2,
    stopReason: 'cycle-count-completed',
    cycles: [],
    status: createStatus(),
  };
}

function createSupervisor(input: {
  readonly runCycles: LocalSimulationRuntimeSupervisor['runCycles'];
}): LocalSimulationRuntimeSupervisor {
  return {
    getStatus: () => createStatus(),
    getRunSession: () => Promise.resolve(undefined),
    requestRunSessionStop: () => Promise.resolve(undefined),
    getOperationTrace: () => Promise.resolve(undefined),
    queryOperationTraces: () => Promise.resolve([]),
    startAll: () => {
      throw new Error('startAll should not be called');
    },
    pauseAll: () => {
      throw new Error('pauseAll should not be called');
    },
    runCycles: input.runCycles,
  };
}

function createStatus(): LocalSimulationRuntimeSupervisorStatus {
  return {
    manifestId: 'town-runtime',
    partitionCount: 0,
    healthyPartitionCount: 0,
    attentionPartitionCount: 0,
    partitions: [],
  };
}
