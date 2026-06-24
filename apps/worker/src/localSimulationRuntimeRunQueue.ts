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
  readonly completedAt: SimulationTimestamp;
  readonly resultTraceId: string;
};

export type LocalSimulationRuntimeRunQueueFailRequest = {
  readonly jobId: string;
  readonly failedAt: SimulationTimestamp;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly error: LocalSimulationRuntimeRunQueueJobError;
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
  readonly fail: (
    request: LocalSimulationRuntimeRunQueueFailRequest,
  ) => Promise<LocalSimulationRuntimeRunQueueJob | undefined>;
  readonly get: (jobId: string) => Promise<LocalSimulationRuntimeRunQueueJob | undefined>;
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
      if (job === undefined) {
        return undefined;
      }
      const completed = createCompletedJob(job, request);
      this.jobs.set(completed.jobId, completed);
      return cloneJob(completed);
    });
  }

  fail(
    request: LocalSimulationRuntimeRunQueueFailRequest,
  ): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertFailRequest(request);
      const job = this.jobs.get(request.jobId);
      if (job === undefined) {
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
      if (job === undefined) {
        return undefined;
      }
      const completed = createCompletedJob(job, request);
      appendJsonLines(this.queuePath, [completed]);
      return cloneJob(completed);
    });
  }

  fail(
    request: LocalSimulationRuntimeRunQueueFailRequest,
  ): Promise<LocalSimulationRuntimeRunQueueJob | undefined> {
    return Promise.resolve().then(() => {
      assertFailRequest(request);
      const job = readLatestJob(this.queuePath, request.jobId);
      if (job === undefined) {
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
}

export function createLocalSimulationRuntimeRunQueueWorker(input: {
  readonly workerId: string;
  readonly queueRepository: LocalSimulationRuntimeRunQueueRepository;
  readonly supervisor: Pick<LocalSimulationRuntimeSupervisor, 'runCycles'>;
  readonly leaseDurationMs: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}): LocalSimulationRuntimeRunQueueWorker {
  assertNonEmpty(input.workerId, 'workerId');
  assertPositiveFinite(input.leaseDurationMs, 'leaseDurationMs');
  if (input.maxAttempts !== undefined) {
    assertPositiveInteger(input.maxAttempts, 'maxAttempts');
  }
  if (input.retryDelayMs !== undefined) {
    assertNonNegativeFinite(input.retryDelayMs, 'retryDelayMs');
  }

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
      try {
        const result = await input.supervisor.runCycles(claimed.runRequest);
        const completed = await input.queueRepository.complete({
          jobId: claimed.jobId,
          completedAt: request.claimedAt,
          resultTraceId: result.traceId,
        });
        if (completed === undefined) {
          throw new Error(`claimed run queue job disappeared: ${claimed.jobId}`);
        }
        return { status: 'completed', job: completed };
      } catch (error) {
        const failed = await input.queueRepository.fail({
          jobId: claimed.jobId,
          failedAt: request.claimedAt,
          maxAttempts: input.maxAttempts ?? 1,
          retryDelayMs: input.retryDelayMs ?? 0,
          error: serializeQueueError(error),
        });
        if (failed === undefined) {
          throw new Error(`claimed run queue job disappeared: ${claimed.jobId}`);
        }
        return { status: 'failed', job: failed };
      }
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
    ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
    failedAt: request.failedAt,
    deadLetteredAt: request.failedAt,
    error: request.error,
    attempts,
    updatedAt: request.failedAt,
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
  assertNonNegativeFinite(request.completedAt, 'completedAt');
  assertNonEmpty(request.resultTraceId, 'resultTraceId');
}

function assertFailRequest(request: LocalSimulationRuntimeRunQueueFailRequest): void {
  assertNonEmpty(request.jobId, 'jobId');
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
