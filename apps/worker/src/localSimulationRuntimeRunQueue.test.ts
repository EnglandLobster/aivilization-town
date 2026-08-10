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
      workerId: 'worker-file',
      attemptNumber: 1,
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
      workerId: 'worker-file',
      attemptNumber: 1,
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

  test('renews an owned lease and fences stale attempts from terminal transitions', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    await repository.enqueue(createJobInput('job-fenced', 'op-fenced', 100));
    await repository.claimNext({
      workerId: 'worker-a',
      claimedAt: 110,
      leaseDurationMs: 30,
    });

    await expect(
      repository.renewLease({
        jobId: 'job-fenced',
        workerId: 'worker-a',
        attemptNumber: 1,
        renewedAt: 130,
        leaseDurationMs: 30,
      }),
    ).resolves.toMatchObject({ leaseExpiresAt: 160, attemptCount: 1 });
    await expect(
      repository.claimNext({ workerId: 'worker-b', claimedAt: 150, leaseDurationMs: 30 }),
    ).resolves.toBeUndefined();
    await repository.claimNext({ workerId: 'worker-b', claimedAt: 161, leaseDurationMs: 30 });

    await expect(
      repository.complete({
        jobId: 'job-fenced',
        workerId: 'worker-a',
        attemptNumber: 1,
        completedAt: 162,
        resultTraceId: 'stale-result',
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.fail({
        jobId: 'job-fenced',
        workerId: 'worker-a',
        attemptNumber: 1,
        failedAt: 162,
        error: { name: 'Error', message: 'stale failure' },
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.complete({
        jobId: 'job-fenced',
        workerId: 'worker-b',
        attemptNumber: 2,
        completedAt: 170,
        resultTraceId: 'current-result',
      }),
    ).resolves.toMatchObject({ status: 'completed', attemptCount: 2 });
  });

  test('repositories can query dead-lettered jobs and replay one while preserving attempts', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    await repository.enqueue(createJobInput('job-dead-1', 'op-run-dead-1', 100));
    await repository.enqueue(createJobInput('job-dead-2', 'op-run-dead-2', 120));
    await repository.claimNext({
      workerId: 'worker-a',
      claimedAt: 200,
      leaseDurationMs: 100,
    });
    await repository.fail({
      jobId: 'job-dead-1',
      workerId: 'worker-a',
      attemptNumber: 1,
      failedAt: 210,
      maxAttempts: 1,
      error: { name: 'Error', message: 'permanent failure 1' },
    });
    await repository.claimNext({
      workerId: 'worker-a',
      claimedAt: 220,
      leaseDurationMs: 100,
    });
    await repository.fail({
      jobId: 'job-dead-2',
      workerId: 'worker-a',
      attemptNumber: 1,
      failedAt: 230,
      maxAttempts: 1,
      error: { name: 'Error', message: 'permanent failure 2' },
    });

    await expect(
      repository.query({ status: 'dead-lettered', manifestId: 'town-runtime', limit: 1 }),
    ).resolves.toMatchObject([
      {
        jobId: 'job-dead-2',
        status: 'dead-lettered',
        deadLetteredAt: 230,
      },
    ]);
    await expect(
      repository.replayDeadLetter({
        jobId: 'job-dead-1',
        replayedAt: 300,
      }),
    ).resolves.toMatchObject({
      jobId: 'job-dead-1',
      status: 'queued',
      attemptCount: 1,
      failedAttemptCount: 1,
      maxAttempts: 2,
      nextAttemptAt: 300,
      replayCount: 1,
      lastReplayedAt: 300,
      attempts: [
        {
          attemptNumber: 1,
          failedAt: 210,
          error: { message: 'permanent failure 1' },
        },
      ],
    });
    const replayed = await repository.get('job-dead-1');
    expect(replayed).not.toHaveProperty('deadLetteredAt');
    expect(replayed).not.toHaveProperty('leaseOwnerId');
    await expect(repository.query({ status: 'dead-lettered' })).resolves.toMatchObject([
      { jobId: 'job-dead-2' },
    ]);
    await expect(
      repository.claimNext({
        workerId: 'worker-b',
        claimedAt: 300,
        leaseDurationMs: 100,
      }),
    ).resolves.toMatchObject({
      jobId: 'job-dead-1',
      status: 'leased',
      attemptCount: 2,
      attempts: [
        { attemptNumber: 1, failedAt: 210 },
        { attemptNumber: 2, workerId: 'worker-b', startedAt: 300 },
      ],
    });
  });

  test('repository reports queue stats from latest job states at an observed timestamp', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    await repository.enqueue(createJobInput('job-delayed', 'op-run-delayed', 100));
    await repository.claimNext({
      workerId: 'worker-a',
      claimedAt: 110,
      leaseDurationMs: 50,
    });
    await repository.fail({
      jobId: 'job-delayed',
      workerId: 'worker-a',
      attemptNumber: 1,
      failedAt: 120,
      maxAttempts: 2,
      retryDelayMs: 200,
      error: { name: 'Error', message: 'transient failure' },
    });

    await repository.enqueue(createJobInput('job-dead-stats', 'op-run-dead-stats', 150));
    await repository.claimNext({
      workerId: 'worker-a',
      claimedAt: 160,
      leaseDurationMs: 50,
    });
    await repository.fail({
      jobId: 'job-dead-stats',
      workerId: 'worker-a',
      attemptNumber: 1,
      failedAt: 170,
      maxAttempts: 1,
      error: { name: 'Error', message: 'permanent failure before replay' },
    });
    await repository.replayDeadLetter({
      jobId: 'job-dead-stats',
      replayedAt: 180,
    });
    await repository.claimNext({
      workerId: 'worker-a',
      claimedAt: 190,
      leaseDurationMs: 50,
    });
    await repository.fail({
      jobId: 'job-dead-stats',
      workerId: 'worker-a',
      attemptNumber: 2,
      failedAt: 200,
      maxAttempts: 2,
      error: { name: 'Error', message: 'permanent failure after replay' },
    });

    await repository.enqueue(createJobInput('job-expired-lease', 'op-run-expired-lease', 220));
    await repository.claimNext({
      workerId: 'worker-a',
      claimedAt: 220,
      leaseDurationMs: 30,
    });

    await repository.enqueue(createJobInput('job-ready', 'op-run-ready', 230));

    await expect(
      repository.getStats({ observedAt: 260, manifestId: 'town-runtime' }),
    ).resolves.toEqual({
      observedAt: 260,
      manifestId: 'town-runtime',
      totalJobCount: 4,
      statusCounts: {
        queued: 2,
        leased: 1,
        completed: 0,
        failed: 0,
        'dead-lettered': 1,
      },
      readyQueueCount: 1,
      delayedQueueCount: 1,
      activeLeaseCount: 0,
      expiredLeaseCount: 1,
      failedAttemptCount: 3,
      replayCount: 1,
      oldestQueuedAt: 90,
      oldestReadyJobEnqueuedAt: 220,
      newestUpdatedAt: 220,
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
      clock: { now: () => 260 },
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
      completedAt: 260,
      resultTraceId: 'op-run-worker-1',
    });
  });

  test('queue worker renews its lease while a long supervisor cycle is running', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
    await repository.enqueue(createJobInput('job-heartbeat', 'op-heartbeat', 100));
    let resolveRun!: (result: LocalSimulationRuntimeSupervisorRunCyclesResult) => void;
    let reportStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    const run = new Promise<LocalSimulationRuntimeSupervisorRunCyclesResult>((resolve) => {
      resolveRun = resolve;
    });
    let heartbeatCallback: (() => void) | undefined;
    const cleared: unknown[] = [];
    const clockValues = [120, 140];
    const worker = createLocalSimulationRuntimeRunQueueWorker({
      workerId: 'worker-heartbeat',
      queueRepository: repository,
      supervisor: createSupervisor({
        runCycles: () => {
          reportStarted();
          return run;
        },
      }),
      leaseDurationMs: 30,
      clock: { now: () => clockValues.shift()! },
      leaseHeartbeatScheduler: {
        setInterval: (callback) => {
          heartbeatCallback = callback;
          return 'heartbeat-handle';
        },
        clearInterval: (handle) => {
          cleared.push(handle);
        },
      },
    });

    const execution = worker.runNext({ claimedAt: 100 });
    await started;
    heartbeatCallback!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(repository.get('job-heartbeat')).resolves.toMatchObject({
      status: 'leased',
      leaseExpiresAt: 150,
      attemptCount: 1,
    });
    resolveRun(createRunCyclesResult('op-heartbeat'));
    await expect(execution).resolves.toMatchObject({ status: 'completed' });
    expect(cleared).toEqual(['heartbeat-handle']);
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
      clock: { now: () => (attempt === 1 ? 210 : 250) },
    });

    await expect(worker.runNext({ claimedAt: 200 })).resolves.toMatchObject({
      status: 'failed',
      job: {
        jobId: 'job-worker-retry',
        status: 'queued',
        attemptCount: 1,
        failedAttemptCount: 1,
        maxAttempts: 2,
        nextAttemptAt: 235,
        attempts: [
          {
            attemptNumber: 1,
            workerId: 'worker-1',
            startedAt: 200,
            failedAt: 210,
            error: { message: 'temporary runtime failure' },
          },
        ],
      },
    });
    await expect(worker.runNext({ claimedAt: 234 })).resolves.toEqual({ status: 'idle' });
    await expect(worker.runNext({ claimedAt: 235 })).resolves.toMatchObject({
      status: 'completed',
      job: {
        jobId: 'job-worker-retry',
        status: 'completed',
        attemptCount: 2,
        failedAttemptCount: 1,
        resultTraceId: 'op-run-worker-retry',
        attempts: [
          { attemptNumber: 1, failedAt: 210 },
          {
            attemptNumber: 2,
            workerId: 'worker-1',
            startedAt: 235,
            completedAt: 250,
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
      clock: { now: () => 260 },
    });

    await expect(worker.runNext({ claimedAt: 200 })).resolves.toMatchObject({
      status: 'failed',
      job: {
        jobId: 'job-worker-fail',
        status: 'dead-lettered',
        attemptCount: 1,
        failedAttemptCount: 1,
        failedAt: 260,
        deadLetteredAt: 260,
        error: {
          name: 'Error',
          message: 'runtime exploded',
        },
        attempts: [
          {
            attemptNumber: 1,
            workerId: 'worker-1',
            startedAt: 200,
            failedAt: 260,
            error: { message: 'runtime exploded' },
          },
        ],
      },
    });
    await expect(repository.get('job-worker-fail')).resolves.toMatchObject({
      status: 'dead-lettered',
      failedAt: 260,
      deadLetteredAt: 260,
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
    getResolvedRunManifest: () => Promise.resolve(undefined),
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
