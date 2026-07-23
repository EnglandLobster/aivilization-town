import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SimulationTimestamp } from '@aivilization/sim-core';
import type {
  LocalSimulationRuntimeSupervisor,
  LocalSimulationRuntimeSupervisorRunCyclesRequest,
} from './localSimulationRuntimeSupervisor';

export type LocalSimulationRuntimeRunQueueJobStatus =
  | 'queued'
  | 'leased'
  | 'completed'
  | 'failed'
  | 'dead-lettered';

export type LocalSimulationRuntimeRunQueueJobInput = {
  readonly jobId: string;
  readonly manifestId: string;
  readonly enqueuedAt: SimulationTimestamp;
  readonly runRequest: LocalSimulationRuntimeSupervisorRunCyclesRequest;
};

export type LocalSimulationRuntimeRunQueueJobError = {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
};

export type LocalSimulationRuntimeRunQueueJobAttempt = {
  readonly attemptNumber: number;
  readonly workerId: string;
  readonly startedAt: SimulationTimestamp;
  readonly leaseExpiresAt: SimulationTimestamp;
  readonly completedAt?: SimulationTimestamp;
  readonly failedAt?: SimulationTimestamp;
  readonly resultTraceId?: string;
  readonly error?: LocalSimulationRuntimeRunQueueJobError;
};

export type LocalSimulationRuntimeRunQueueJob = LocalSimulationRuntimeRunQueueJobInput & {
  readonly status: LocalSimulationRuntimeRunQueueJobStatus;
  readonly updatedAt: SimulationTimestamp;
  readonly attemptCount?: number;
  readonly failedAttemptCount?: number;
  readonly maxAttempts?: number;
  readonly nextAttemptAt?: SimulationTimestamp;
  readonly replayCount?: number;
  readonly lastReplayedAt?: SimulationTimestamp;
  readonly leaseOwnerId?: string;
  readonly leaseExpiresAt?: SimulationTimestamp;
  readonly startedAt?: SimulationTimestamp;
  readonly completedAt?: SimulationTimestamp;
  readonly failedAt?: SimulationTimestamp;
  readonly deadLetteredAt?: SimulationTimestamp;
  readonly resultTraceId?: string;
  readonly error?: LocalSimulationRuntimeRunQueueJobError;
  readonly attempts?: readonly LocalSimulationRuntimeRunQueueJobAttempt[];
};

export type LocalSimulationRuntimeRunQueueClaimRequest = {
  readonly workerId: string;
  readonly claimedAt: SimulationTimestamp;
  readonly leaseDurationMs: number;
  readonly manifestId?: string;
};

export type LocalSimulationRuntimeRunQueueCompleteRequest = {
  readonly jobId: string;
  readonly workerId: string;
  readonly attemptNumber: number;
  readonly completedAt: SimulationTimestamp;
  readonly resultTraceId: string;
};

export type LocalSimulationRuntimeRunQueueRenewLeaseRequest = {
  readonly jobId: string;
  readonly workerId: string;
  readonly attemptNumber: number;
  readonly renewedAt: SimulationTimestamp;
  readonly leaseDurationMs: number;
};

export type LocalSimulationRuntimeRunQueueFailRequest = {
  readonly jobId: string;
  readonly workerId: string;
  readonly attemptNumber: number;
  readonly failedAt: SimulationTimestamp;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly error: LocalSimulationRuntimeRunQueueJobError;
};

export type LocalSimulationRuntimeRunQueueQueryRequest = {
  readonly status?: LocalSimulationRuntimeRunQueueJobStatus;
  readonly manifestId?: string;
  readonly limit?: number;
};

export type LocalSimulationRuntimeRunQueueStatsRequest = {
  readonly observedAt: SimulationTimestamp;
  readonly manifestId?: string;
};

export type LocalSimulationRuntimeRunQueueStatusCounts = {
  readonly queued: number;
  readonly leased: number;
  readonly completed: number;
  readonly failed: number;
  readonly 'dead-lettered': number;
};

export type LocalSimulationRuntimeRunQueueStats = {
  readonly observedAt: SimulationTimestamp;
  readonly manifestId?: string;
  readonly totalJobCount: number;
  readonly statusCounts: LocalSimulationRuntimeRunQueueStatusCounts;
  readonly readyQueueCount: number;
  readonly delayedQueueCount: number;
  readonly activeLeaseCount: number;
  readonly expiredLeaseCount: number;
  readonly failedAttemptCount: number;
  readonly replayCount: number;
  readonly oldestQueuedAt?: SimulationTimestamp;
  readonly oldestReadyJobEnqueuedAt?: SimulationTimestamp;
  readonly newestUpdatedAt?: SimulationTimestamp;
};

export type LocalSimulationRuntimeRunQueueReplayDeadLetterRequest = {
  readonly jobId: string;
  readonly replayedAt: SimulationTimestamp;
  readonly nextAttemptAt?: SimulationTimestamp;
  readonly maxAttempts?: number;
};

export type LocalSimulationRuntimeRunQueueRepository = {
  readonly enqueue: (
    input: LocalSimulationRuntimeRunQueueJobInput,
  ) => Promise<LocalSimulationRuntimeRunQueueJob>;
  readonly claimNext: (
    request: LocalSimulationRuntimeRunQueueClaimRequest,
  ) => Promise<LocalSimulationRuntimeRunQueueJob | undefined>;
  readonly complete: (
    request: LocalSimulationRuntimeRunQueueCompleteRequest,
  ) => Promise<LocalSimulationRuntimeRunQueueJob | undefined>;
  readonly renewLease: (
    request: LocalSimulationRuntimeRunQueueRenewLeaseRequest,
  ) => Promise<LocalSimulationRuntimeRunQueueJob | undefined>;
  readonly fail: (
    request: LocalSimulationRuntimeRunQueueFailRequest,
  ) => Promise<LocalSimulationRuntimeRunQueueJob | undefined>;
  readonly get: (jobId: string) => Promise<LocalSimulationRuntimeRunQueueJob | undefined>;
  readonly query: (
    request: LocalSimulationRuntimeRunQueueQueryRequest,
  ) => Promise<readonly LocalSimulationRuntimeRunQueueJob[]>;
  readonly getStats: (
    request: LocalSimulationRuntimeRunQueueStatsRequest,
  ) => Promise<LocalSimulationRuntimeRunQueueStats>;
  readonly replayDeadLetter: (
    request: LocalSimulationRuntimeRunQueueReplayDeadLetterRequest,
  ) => Promise<LocalSimulationRuntimeRunQueueJob | undefined>;
};

export type LocalSimulationRuntimeRunQueueWorkerRunRequest = {
  readonly claimedAt: SimulationTimestamp;
};

export type LocalSimulationRuntimeRunQueueWorkerRunResult =
  | {
      readonly status: 'idle';
      readonly job?: undefined;
    }
  | {
      readonly status: 'completed';
      readonly job: LocalSimulationRuntimeRunQueueJob;
    }
  | {
      readonly status: 'failed';
      readonly job: LocalSimulationRuntimeRunQueueJob;
    };

export type LocalSimulationRuntimeRunQueueWorker = {
  readonly runNext: (
    request: LocalSimulationRuntimeRunQueueWorkerRunRequest,
  ) => Promise<LocalSimulationRuntimeRunQueueWorkerRunResult>;
};

export type LocalSimulationRuntimeRunQueueWorkerClock = {
  readonly now: () => SimulationTimestamp;
};

export type LocalSimulationRuntimeRunQueueWorkerLeaseHeartbeatScheduler = {
  readonly setInterval: (callback: () => void, intervalMs: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};

export class InMemoryLocalSimulationRuntimeRunQueueRepository implements LocalSimulationRuntimeRunQueueRepository {
  private readonly jobs = new Map<string, LocalSimulationRuntimeRunQueueJob>();

  enqueue(
    input: LocalSimulationRuntimeRunQueueJobInput,
  ): Promise<LocalSimulationRuntimeRunQueueJob> {
    return Promise.resolve().then(() => {
      assertJobInput(input);
      const existing = this.jobs.get(input.jobId);
      if (existing !== undefined) {
        return cloneJob(existing);
      }
      const job = createQueuedJob(input);
      this.jobs.set(job.jobId, job);
      return cloneJob(job);
    });
  }

  claimNext(
    request: LocalSimulationRuntimeRunQueueClaimRequest,
  ): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertClaimRequest(request);
      const candidate = selectClaimCandidate([...this.jobs.values()], request);
      if (candidate === undefined) {
        return undefined;
      }
      const claimed = createLeasedJob(candidate, request);
      this.jobs.set(claimed.jobId, claimed);
      return cloneJob(claimed);
    });
  }

  complete(
    request: LocalSimulationRuntimeRunQueueCompleteRequest,
  ): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertCompleteRequest(request);
      const job = this.jobs.get(request.jobId);
      if (job === undefined || !requestOwnsLease(job, request)) {
        return undefined;
      }
      const completed = createCompletedJob(job, request);
      this.jobs.set(completed.jobId, completed);
      return cloneJob(completed);
    });
  }

  renewLease(
    request: LocalSimulationRuntimeRunQueueRenewLeaseRequest,
  ): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertRenewLeaseRequest(request);
      const job = this.jobs.get(request.jobId);
      if (job === undefined || !requestOwnsLease(job, request)) {
        return undefined;
      }
      const renewed = createRenewedLeaseJob(job, request);
      this.jobs.set(renewed.jobId, renewed);
      return cloneJob(renewed);
    });
  }

  fail(
    request: LocalSimulationRuntimeRunQueueFailRequest,
  ): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertFailRequest(request);
      const job = this.jobs.get(request.jobId);
      if (job === undefined || !requestOwnsLease(job, request)) {
        return undefined;
      }
      const failed = createFailedJob(job, request);
      this.jobs.set(failed.jobId, failed);
      return cloneJob(failed);
    });
  }

  get(jobId: string): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(jobId, 'jobId');
      const job = this.jobs.get(jobId);
      return job === undefined ? undefined : cloneJob(job);
    });
  }

  query(
    request: LocalSimulationRuntimeRunQueueQueryRequest,
  ): Promise<readonly LocalSimulationRuntimeRunQueueJob[]> {
    return Promise.resolve().then(() => {
      assertQueryRequest(request);
      return queryJobs([...this.jobs.values()], request).map(cloneJob);
    });
  }

  getStats(
    request: LocalSimulationRuntimeRunQueueStatsRequest,
  ): Promise<LocalSimulationRuntimeRunQueueStats> {
    return Promise.resolve().then(() => {
      assertStatsRequest(request);
      return calculateQueueStats([...this.jobs.values()], request);
    });
  }

  replayDeadLetter(
    request: LocalSimulationRuntimeRunQueueReplayDeadLetterRequest,
  ): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertReplayDeadLetterRequest(request);
      const job = this.jobs.get(request.jobId);
      if (job === undefined || job.status !== 'dead-lettered') {
        return undefined;
      }
      const replayed = createReplayedDeadLetterJob(job, request);
      this.jobs.set(replayed.jobId, replayed);
      return cloneJob(replayed);
    });
  }
}

export class FileLocalSimulationRuntimeRunQueueRepository implements LocalSimulationRuntimeRunQueueRepository {
  private readonly queuePath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.queuePath = join(input.rootDir, 'supervisor-run-queue.jsonl');
    ensureFile(this.queuePath, input.rootDir);
  }

  enqueue(
    input: LocalSimulationRuntimeRunQueueJobInput,
  ): Promise<LocalSimulationRuntimeRunQueueJob> {
    return Promise.resolve().then(() => {
      assertJobInput(input);
      const existing = readLatestJob(this.queuePath, input.jobId);
      if (existing !== undefined) {
        return cloneJob(existing);
      }
      const job = createQueuedJob(input);
      appendJsonLines(this.queuePath, [job]);
      return cloneJob(job);
    });
  }

  claimNext(
    request: LocalSimulationRuntimeRunQueueClaimRequest,
  ): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertClaimRequest(request);
      const candidate = selectClaimCandidate(readLatestJobs(this.queuePath), request);
      if (candidate === undefined) {
        return undefined;
      }
      const claimed = createLeasedJob(candidate, request);
      appendJsonLines(this.queuePath, [claimed]);
      return cloneJob(claimed);
    });
  }

  complete(
    request: LocalSimulationRuntimeRunQueueCompleteRequest,
  ): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertCompleteRequest(request);
      const job = readLatestJob(this.queuePath, request.jobId);
      if (job === undefined || !requestOwnsLease(job, request)) {
        return undefined;
      }
      const completed = createCompletedJob(job, request);
      appendJsonLines(this.queuePath, [completed]);
      return cloneJob(completed);
    });
  }

  renewLease(
    request: LocalSimulationRuntimeRunQueueRenewLeaseRequest,
  ): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertRenewLeaseRequest(request);
      const job = readLatestJob(this.queuePath, request.jobId);
      if (job === undefined || !requestOwnsLease(job, request)) {
        return undefined;
      }
      const renewed = createRenewedLeaseJob(job, request);
      appendJsonLines(this.queuePath, [renewed]);
      return cloneJob(renewed);
    });
  }

  fail(
    request: LocalSimulationRuntimeRunQueueFailRequest,
  ): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertFailRequest(request);
      const job = readLatestJob(this.queuePath, request.jobId);
      if (job === undefined || !requestOwnsLease(job, request)) {
        return undefined;
      }
      const failed = createFailedJob(job, request);
      appendJsonLines(this.queuePath, [failed]);
      return cloneJob(failed);
    });
  }

  get(jobId: string): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(jobId, 'jobId');
      const job = readLatestJob(this.queuePath, jobId);
      return job === undefined ? undefined : cloneJob(job);
    });
  }

  query(
    request: LocalSimulationRuntimeRunQueueQueryRequest,
  ): Promise<readonly LocalSimulationRuntimeRunQueueJob[]> {
    return Promise.resolve().then(() => {
      assertQueryRequest(request);
      return queryJobs(readLatestJobs(this.queuePath), request).map(cloneJob);
    });
  }

  getStats(
    request: LocalSimulationRuntimeRunQueueStatsRequest,
  ): Promise<LocalSimulationRuntimeRunQueueStats> {
    return Promise.resolve().then(() => {
      assertStatsRequest(request);
      return calculateQueueStats(readLatestJobs(this.queuePath), request);
    });
  }

  replayDeadLetter(
    request: LocalSimulationRuntimeRunQueueReplayDeadLetterRequest,
  ): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertReplayDeadLetterRequest(request);
      const job = readLatestJob(this.queuePath, request.jobId);
      if (job === undefined || job.status !== 'dead-lettered') {
        return undefined;
      }
      const replayed = createReplayedDeadLetterJob(job, request);
      appendJsonLines(this.queuePath, [replayed]);
      return cloneJob(replayed);
    });
  }
}

export function createLocalSimulationRuntimeRunQueueWorker(input: {
  readonly workerId: string;
  readonly queueRepository: LocalSimulationRuntimeRunQueueRepository;
  readonly supervisor: Pick<LocalSimulationRuntimeSupervisor, 'runCycles'>;
  readonly leaseDurationMs: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly clock?: LocalSimulationRuntimeRunQueueWorkerClock;
  readonly leaseHeartbeatScheduler?: LocalSimulationRuntimeRunQueueWorkerLeaseHeartbeatScheduler;
}): LocalSimulationRuntimeRunQueueWorker {
  assertNonEmpty(input.workerId, 'workerId');
  assertPositiveFinite(input.leaseDurationMs, 'leaseDurationMs');
  if (input.maxAttempts !== undefined) {
    assertPositiveInteger(input.maxAttempts, 'maxAttempts');
  }
  if (input.retryDelayMs !== undefined) {
    assertNonNegativeFinite(input.retryDelayMs, 'retryDelayMs');
  }
  const clock = input.clock ?? { now: () => Date.now() };
  const leaseHeartbeatScheduler = input.leaseHeartbeatScheduler ?? {
    setInterval: (callback: () => void, intervalMs: number) => setInterval(callback, intervalMs),
    clearInterval: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>),
  };

  return {
    runNext: async (request) => {
      assertNonNegativeFinite(request.claimedAt, 'claimedAt');
      const claimed = await input.queueRepository.claimNext({
        workerId: input.workerId,
        claimedAt: request.claimedAt,
        leaseDurationMs: input.leaseDurationMs,
      });
      if (claimed === undefined) {
        return { status: 'idle' };
      }
      const attemptNumber = claimed.attemptCount ?? claimed.attempts?.length;
      if (attemptNumber === undefined || attemptNumber < 1) {
        throw new Error(`claimed run queue job is missing its attempt number: ${claimed.jobId}`);
      }
      const leaseIdentity = {
        jobId: claimed.jobId,
        workerId: input.workerId,
        attemptNumber,
      } as const;
      let heartbeatActive = true;
      let heartbeatError: unknown;
      let heartbeatChain = Promise.resolve();
      const heartbeatHandle = leaseHeartbeatScheduler.setInterval(
        () => {
          heartbeatChain = heartbeatChain.then(async () => {
            if (!heartbeatActive || heartbeatError !== undefined) {
              return;
            }
            try {
              const renewedAt = Math.max(request.claimedAt, clock.now());
              const renewed = await input.queueRepository.renewLease({
                ...leaseIdentity,
                renewedAt,
                leaseDurationMs: input.leaseDurationMs,
              });
              if (renewed === undefined) {
                heartbeatError = new Error(
                  `run queue lease ownership was lost during execution: ${claimed.jobId}/${attemptNumber}`,
                );
              }
            } catch (error) {
              heartbeatError = error;
            }
          });
        },
        Math.max(1, Math.floor(input.leaseDurationMs / 3)),
      );

      let runResult: Awaited<ReturnType<LocalSimulationRuntimeSupervisor['runCycles']>> | undefined;
      let runError: unknown;
      try {
        runResult = await input.supervisor.runCycles(claimed.runRequest);
      } catch (error) {
        runError = error;
      } finally {
        heartbeatActive = false;
        leaseHeartbeatScheduler.clearInterval(heartbeatHandle);
        await heartbeatChain;
      }

      const executionError = heartbeatError ?? runError;
      if (executionError !== undefined) {
        const failedAt = Math.max(request.claimedAt, clock.now());
        assertNonNegativeFinite(failedAt, 'failedAt');
        const failed = await input.queueRepository.fail({
          ...leaseIdentity,
          failedAt,
          maxAttempts: input.maxAttempts ?? 1,
          retryDelayMs: input.retryDelayMs ?? 0,
          error: serializeQueueError(executionError),
        });
        if (failed === undefined) {
          throw new Error(
            `run queue attempt lost ownership before failure could be recorded: ${claimed.jobId}/${attemptNumber}`,
            { cause: executionError },
          );
        }
        return { status: 'failed', job: failed };
      }
      if (runResult === undefined) {
        throw new Error(`run queue supervisor returned no result: ${claimed.jobId}`);
      }
      const completedAt = Math.max(request.claimedAt, clock.now());
      assertNonNegativeFinite(completedAt, 'completedAt');
      const completed = await input.queueRepository.complete({
        ...leaseIdentity,
        completedAt,
        resultTraceId: runResult.traceId,
      });
      if (completed === undefined) {
        throw new Error(
          `run queue attempt lost ownership before completion: ${claimed.jobId}/${attemptNumber}`,
        );
      }
      return { status: 'completed', job: completed };
    },
  };
}

function createQueuedJob(
  input: LocalSimulationRuntimeRunQueueJobInput,
): LocalSimulationRuntimeRunQueueJob {
  return cloneJob({
    ...input,
    status: 'queued',
    attemptCount: 0,
    failedAttemptCount: 0,
    attempts: [],
    updatedAt: input.enqueuedAt,
  });
}

function createLeasedJob(
  job: LocalSimulationRuntimeRunQueueJob,
  request: LocalSimulationRuntimeRunQueueClaimRequest,
): LocalSimulationRuntimeRunQueueJob {
  const attemptNumber = (job.attemptCount ?? job.attempts?.length ?? 0) + 1;
  const leaseExpiresAt = request.claimedAt + request.leaseDurationMs;
  return cloneJob({
    ...job,
    status: 'leased',
    attemptCount: attemptNumber,
    leaseOwnerId: request.workerId,
    leaseExpiresAt,
    startedAt: job.startedAt ?? request.claimedAt,
    updatedAt: request.claimedAt,
    attempts: [
      ...(job.attempts ?? []),
      {
        attemptNumber,
        workerId: request.workerId,
        startedAt: request.claimedAt,
        leaseExpiresAt,
      },
    ],
  });
}

function createRenewedLeaseJob(
  job: LocalSimulationRuntimeRunQueueJob,
  request: LocalSimulationRuntimeRunQueueRenewLeaseRequest,
): LocalSimulationRuntimeRunQueueJob {
  const leaseExpiresAt = request.renewedAt + request.leaseDurationMs;
  return cloneJob({
    ...job,
    leaseExpiresAt,
    updatedAt: request.renewedAt,
    attempts: annotateLatestAttempt(job.attempts ?? [], { leaseExpiresAt }),
  });
}

function requestOwnsLease(
  job: LocalSimulationRuntimeRunQueueJob,
  request: { readonly workerId: string; readonly attemptNumber: number },
): boolean {
  return (
    job.status === 'leased' &&
    job.leaseOwnerId === request.workerId &&
    (job.attemptCount ?? job.attempts?.length ?? 0) === request.attemptNumber
  );
}

function createCompletedJob(
  job: LocalSimulationRuntimeRunQueueJob,
  request: LocalSimulationRuntimeRunQueueCompleteRequest,
): LocalSimulationRuntimeRunQueueJob {
  return cloneJob({
    jobId: job.jobId,
    manifestId: job.manifestId,
    enqueuedAt: job.enqueuedAt,
    runRequest: job.runRequest,
    status: 'completed',
    attemptCount: job.attemptCount ?? job.attempts?.length ?? 0,
    failedAttemptCount: job.failedAttemptCount ?? 0,
    ...(job.maxAttempts === undefined ? {} : { maxAttempts: job.maxAttempts }),
    ...(job.replayCount === undefined ? {} : { replayCount: job.replayCount }),
    ...(job.lastReplayedAt === undefined ? {} : { lastReplayedAt: job.lastReplayedAt }),
    ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
    completedAt: request.completedAt,
    resultTraceId: request.resultTraceId,
    attempts: annotateLatestAttempt(job.attempts ?? [], {
      completedAt: request.completedAt,
      resultTraceId: request.resultTraceId,
    }),
    updatedAt: request.completedAt,
  });
}

function createFailedJob(
  job: LocalSimulationRuntimeRunQueueJob,
  request: LocalSimulationRuntimeRunQueueFailRequest,
): LocalSimulationRuntimeRunQueueJob {
  const attemptCount = job.attemptCount ?? job.attempts?.length ?? 0;
  const failedAttemptCount = (job.failedAttemptCount ?? 0) + 1;
  const maxAttempts = request.maxAttempts ?? 1;
  const retryDelayMs = request.retryDelayMs ?? 0;
  const attempts = annotateLatestAttempt(job.attempts ?? [], {
    failedAt: request.failedAt,
    error: request.error,
  });
  if (attemptCount < maxAttempts) {
    return cloneJob({
      jobId: job.jobId,
      manifestId: job.manifestId,
      enqueuedAt: job.enqueuedAt,
      runRequest: job.runRequest,
      status: 'queued',
      attemptCount,
      failedAttemptCount,
      maxAttempts,
      nextAttemptAt: request.failedAt + retryDelayMs,
      ...(job.replayCount === undefined ? {} : { replayCount: job.replayCount }),
      ...(job.lastReplayedAt === undefined ? {} : { lastReplayedAt: job.lastReplayedAt }),
      ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
      failedAt: request.failedAt,
      error: request.error,
      attempts,
      updatedAt: request.failedAt,
    });
  }
  return cloneJob({
    jobId: job.jobId,
    manifestId: job.manifestId,
    enqueuedAt: job.enqueuedAt,
    runRequest: job.runRequest,
    status: 'dead-lettered',
    attemptCount,
    failedAttemptCount,
    maxAttempts,
    ...(job.replayCount === undefined ? {} : { replayCount: job.replayCount }),
    ...(job.lastReplayedAt === undefined ? {} : { lastReplayedAt: job.lastReplayedAt }),
    ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
    failedAt: request.failedAt,
    deadLetteredAt: request.failedAt,
    error: request.error,
    attempts,
    updatedAt: request.failedAt,
  });
}

function createReplayedDeadLetterJob(
  job: LocalSimulationRuntimeRunQueueJob,
  request: LocalSimulationRuntimeRunQueueReplayDeadLetterRequest,
): LocalSimulationRuntimeRunQueueJob {
  const attemptCount = job.attemptCount ?? job.attempts?.length ?? 0;
  const maxAttempts = request.maxAttempts ?? Math.max(job.maxAttempts ?? 0, attemptCount + 1);
  return cloneJob({
    jobId: job.jobId,
    manifestId: job.manifestId,
    enqueuedAt: job.enqueuedAt,
    runRequest: job.runRequest,
    status: 'queued',
    attemptCount,
    failedAttemptCount: job.failedAttemptCount ?? 0,
    maxAttempts,
    nextAttemptAt: request.nextAttemptAt ?? request.replayedAt,
    replayCount: (job.replayCount ?? 0) + 1,
    lastReplayedAt: request.replayedAt,
    attempts: job.attempts ?? [],
    updatedAt: request.replayedAt,
  });
}

function annotateLatestAttempt(
  attempts: readonly LocalSimulationRuntimeRunQueueJobAttempt[],
  patch: Partial<LocalSimulationRuntimeRunQueueJobAttempt>,
): readonly LocalSimulationRuntimeRunQueueJobAttempt[] {
  if (attempts.length === 0) {
    return attempts;
  }
  const latestIndex = attempts.length - 1;
  return attempts.map((attempt, index) =>
    index === latestIndex ? { ...attempt, ...patch } : attempt,
  );
}

function selectClaimCandidate(
  jobs: readonly LocalSimulationRuntimeRunQueueJob[],
  request: LocalSimulationRuntimeRunQueueClaimRequest,
): LocalSimulationRuntimeRunQueueJob | undefined {
  return jobs
    .filter((job) => jobIsClaimEligible(job, request))
    .sort(
      (left, right) => left.enqueuedAt - right.enqueuedAt || left.jobId.localeCompare(right.jobId),
    )
    .at(0);
}

function queryJobs(
  jobs: readonly LocalSimulationRuntimeRunQueueJob[],
  request: LocalSimulationRuntimeRunQueueQueryRequest,
): readonly LocalSimulationRuntimeRunQueueJob[] {
  const filtered = jobs
    .filter((job) => request.status === undefined || job.status === request.status)
    .filter((job) => request.manifestId === undefined || job.manifestId === request.manifestId)
    .sort(
      (left, right) => right.updatedAt - left.updatedAt || left.jobId.localeCompare(right.jobId),
    );
  return request.limit === undefined ? filtered : filtered.slice(0, request.limit);
}

function calculateQueueStats(
  jobs: readonly LocalSimulationRuntimeRunQueueJob[],
  request: LocalSimulationRuntimeRunQueueStatsRequest,
): LocalSimulationRuntimeRunQueueStats {
  const filtered = jobs.filter(
    (job) => request.manifestId === undefined || job.manifestId === request.manifestId,
  );
  const queuedJobs = filtered.filter((job) => job.status === 'queued');
  const readyQueuedJobs = queuedJobs.filter(
    (job) => (job.nextAttemptAt ?? job.enqueuedAt) <= request.observedAt,
  );
  const leasedJobs = filtered.filter((job) => job.status === 'leased');
  const activeLeases = leasedJobs.filter((job) => (job.leaseExpiresAt ?? 0) > request.observedAt);
  const expiredLeases = leasedJobs.filter((job) => (job.leaseExpiresAt ?? 0) <= request.observedAt);
  const stats: LocalSimulationRuntimeRunQueueStats = {
    observedAt: request.observedAt,
    ...(request.manifestId === undefined ? {} : { manifestId: request.manifestId }),
    totalJobCount: filtered.length,
    statusCounts: countStatuses(filtered),
    readyQueueCount: readyQueuedJobs.length,
    delayedQueueCount: queuedJobs.length - readyQueuedJobs.length,
    activeLeaseCount: activeLeases.length,
    expiredLeaseCount: expiredLeases.length,
    failedAttemptCount: sumCounts(filtered, 'failedAttemptCount'),
    replayCount: sumCounts(filtered, 'replayCount'),
    ...optionalMinimumTimestamp(
      queuedJobs.map((job) => job.enqueuedAt),
      'oldestQueuedAt',
    ),
    ...optionalMinimumTimestamp(
      readyQueuedJobs.map((job) => job.enqueuedAt),
      'oldestReadyJobEnqueuedAt',
    ),
    ...optionalMaximumTimestamp(
      filtered.map((job) => job.updatedAt),
      'newestUpdatedAt',
    ),
  };
  return stats;
}

function countStatuses(
  jobs: readonly LocalSimulationRuntimeRunQueueJob[],
): LocalSimulationRuntimeRunQueueStatusCounts {
  const counts: Record<LocalSimulationRuntimeRunQueueJobStatus, number> = {
    queued: 0,
    leased: 0,
    completed: 0,
    failed: 0,
    'dead-lettered': 0,
  };
  for (const job of jobs) {
    counts[job.status] += 1;
  }
  return counts;
}

function sumCounts(
  jobs: readonly LocalSimulationRuntimeRunQueueJob[],
  field: 'failedAttemptCount' | 'replayCount',
): number {
  return jobs.reduce((sum, job) => sum + (job[field] ?? 0), 0);
}

function optionalMinimumTimestamp<TField extends string>(
  values: readonly SimulationTimestamp[],
  field: TField,
): Record<TField, SimulationTimestamp> | Record<string, never> {
  if (values.length === 0) {
    return {};
  }
  return { [field]: Math.min(...values) } as Record<TField, SimulationTimestamp>;
}

function optionalMaximumTimestamp<TField extends string>(
  values: readonly SimulationTimestamp[],
  field: TField,
): Record<TField, SimulationTimestamp> | Record<string, never> {
  if (values.length === 0) {
    return {};
  }
  return { [field]: Math.max(...values) } as Record<TField, SimulationTimestamp>;
}

function jobIsClaimEligible(
  job: LocalSimulationRuntimeRunQueueJob,
  request: LocalSimulationRuntimeRunQueueClaimRequest,
): boolean {
  if (request.manifestId !== undefined && job.manifestId !== request.manifestId) {
    return false;
  }
  if (job.status === 'queued') {
    return (job.nextAttemptAt ?? job.enqueuedAt) <= request.claimedAt;
  }
  return job.status === 'leased' && (job.leaseExpiresAt ?? 0) <= request.claimedAt;
}

function readLatestJobs(path: string): readonly LocalSimulationRuntimeRunQueueJob[] {
  const latest = new Map<string, LocalSimulationRuntimeRunQueueJob>();
  for (const job of readJsonLines<LocalSimulationRuntimeRunQueueJob>(path)) {
    latest.set(job.jobId, job);
  }
  return [...latest.values()];
}

function readLatestJob(path: string, jobId: string): LocalSimulationRuntimeRunQueueJob | undefined {
  return readLatestJobs(path).find((job) => job.jobId === jobId);
}

function cloneJob(job: LocalSimulationRuntimeRunQueueJob): LocalSimulationRuntimeRunQueueJob {
  return JSON.parse(JSON.stringify(job)) as LocalSimulationRuntimeRunQueueJob;
}

function ensureFile(path: string, rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, '');
  }
}

function appendJsonLines(path: string, values: readonly unknown[]): void {
  if (values.length === 0) {
    return;
  }
  appendFileSync(path, values.map((value) => JSON.stringify(value)).join('\n') + '\n');
}

function readJsonLines<TValue>(path: string): TValue[] {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, 'utf8');
  if (content.trim().length === 0) {
    return [];
  }
  return content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as TValue);
}

function serializeQueueError(error: unknown): LocalSimulationRuntimeRunQueueJobError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return {
    name: 'Error',
    message: String(error),
  };
}

function assertJobInput(input: LocalSimulationRuntimeRunQueueJobInput): void {
  assertNonEmpty(input.jobId, 'jobId');
  assertNonEmpty(input.manifestId, 'manifestId');
  assertNonNegativeFinite(input.enqueuedAt, 'enqueuedAt');
  assertNonNegativeFinite(input.runRequest.requestedAt, 'requestedAt');
  assertPositiveInteger(input.runRequest.cycleCount, 'cycleCount');
  if (input.runRequest.operationId !== undefined) {
    assertNonEmpty(input.runRequest.operationId, 'operationId');
  }
  if (input.runRequest.cycleIntervalMs !== undefined) {
    assertNonNegativeFinite(input.runRequest.cycleIntervalMs, 'cycleIntervalMs');
  }
}

function assertClaimRequest(request: LocalSimulationRuntimeRunQueueClaimRequest): void {
  assertNonEmpty(request.workerId, 'workerId');
  assertNonNegativeFinite(request.claimedAt, 'claimedAt');
  assertPositiveFinite(request.leaseDurationMs, 'leaseDurationMs');
  if (request.manifestId !== undefined) {
    assertNonEmpty(request.manifestId, 'manifestId');
  }
}

function assertCompleteRequest(request: LocalSimulationRuntimeRunQueueCompleteRequest): void {
  assertNonEmpty(request.jobId, 'jobId');
  assertNonEmpty(request.workerId, 'workerId');
  assertPositiveInteger(request.attemptNumber, 'attemptNumber');
  assertNonNegativeFinite(request.completedAt, 'completedAt');
  assertNonEmpty(request.resultTraceId, 'resultTraceId');
}

function assertRenewLeaseRequest(request: LocalSimulationRuntimeRunQueueRenewLeaseRequest): void {
  assertNonEmpty(request.jobId, 'jobId');
  assertNonEmpty(request.workerId, 'workerId');
  assertPositiveInteger(request.attemptNumber, 'attemptNumber');
  assertNonNegativeFinite(request.renewedAt, 'renewedAt');
  assertPositiveFinite(request.leaseDurationMs, 'leaseDurationMs');
}

function assertFailRequest(request: LocalSimulationRuntimeRunQueueFailRequest): void {
  assertNonEmpty(request.jobId, 'jobId');
  assertNonEmpty(request.workerId, 'workerId');
  assertPositiveInteger(request.attemptNumber, 'attemptNumber');
  assertNonNegativeFinite(request.failedAt, 'failedAt');
  if (request.maxAttempts !== undefined) {
    assertPositiveInteger(request.maxAttempts, 'maxAttempts');
  }
  if (request.retryDelayMs !== undefined) {
    assertNonNegativeFinite(request.retryDelayMs, 'retryDelayMs');
  }
  assertNonEmpty(request.error.name, 'error.name');
  assertNonEmpty(request.error.message, 'error.message');
}

function assertQueryRequest(request: LocalSimulationRuntimeRunQueueQueryRequest): void {
  if (request.status !== undefined && !isKnownJobStatus(request.status)) {
    throw new Error('status must be a known run queue job status');
  }
  if (request.manifestId !== undefined) {
    assertNonEmpty(request.manifestId, 'manifestId');
  }
  if (request.limit !== undefined) {
    assertPositiveInteger(request.limit, 'limit');
  }
}

function assertStatsRequest(request: LocalSimulationRuntimeRunQueueStatsRequest): void {
  assertNonNegativeFinite(request.observedAt, 'observedAt');
  if (request.manifestId !== undefined) {
    assertNonEmpty(request.manifestId, 'manifestId');
  }
}

function assertReplayDeadLetterRequest(
  request: LocalSimulationRuntimeRunQueueReplayDeadLetterRequest,
): void {
  assertNonEmpty(request.jobId, 'jobId');
  assertNonNegativeFinite(request.replayedAt, 'replayedAt');
  if (request.nextAttemptAt !== undefined) {
    assertNonNegativeFinite(request.nextAttemptAt, 'nextAttemptAt');
  }
  if (request.maxAttempts !== undefined) {
    assertPositiveInteger(request.maxAttempts, 'maxAttempts');
  }
}

function isKnownJobStatus(value: string): value is LocalSimulationRuntimeRunQueueJobStatus {
  return (
    value === 'queued' ||
    value === 'leased' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'dead-lettered'
  );
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
