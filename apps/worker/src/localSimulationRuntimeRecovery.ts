import type { SimulationTimestamp } from '@aivilization/sim-core';
import type {
  LocalSimulationRuntimeRunQueueJob,
  LocalSimulationRuntimeRunQueueRepository,
  LocalSimulationRuntimeRunQueueStats,
} from './localSimulationRuntimeRunQueue';
import type {
  LocalSimulationRuntimeRunQueueWorkerHost,
  LocalSimulationRuntimeRunQueueWorkerHostDrainResult,
} from './localSimulationRuntimeRunQueueWorkerHost';

export type LocalSimulationRuntimeRecoveryPolicy = {
  readonly maxDeadLetterReplaysPerRun?: number;
  readonly maxReplayCountPerJob?: number;
  readonly deadLetterReplayMaxAttempts?: number;
  readonly maxDrainJobsPerRun?: number;
};

export type LocalSimulationRuntimeRecoveryRequest = {
  readonly observedAt: SimulationTimestamp;
};

export type LocalSimulationRuntimeRecoverySkippedDeadLetterJob = {
  readonly jobId: string;
  readonly reason: 'replay-limit-reached';
  readonly replayCount: number;
};

export type LocalSimulationRuntimeRecoveryReport = {
  readonly status: 'idle' | 'recovered';
  readonly observedAt: SimulationTimestamp;
  readonly statsBeforeRecovery: LocalSimulationRuntimeRunQueueStats;
  readonly replayedDeadLetterJobs: readonly LocalSimulationRuntimeRunQueueJob[];
  readonly skippedDeadLetterJobs: readonly LocalSimulationRuntimeRecoverySkippedDeadLetterJob[];
  readonly drainResult?: LocalSimulationRuntimeRunQueueWorkerHostDrainResult;
  readonly statsAfterRecovery: LocalSimulationRuntimeRunQueueStats;
};

export type LocalSimulationRuntimeRecovery = {
  readonly recover: (
    request: LocalSimulationRuntimeRecoveryRequest,
  ) => Promise<LocalSimulationRuntimeRecoveryReport>;
};

export function createLocalSimulationRuntimeRecovery(input: {
  readonly manifestId: string;
  readonly queueRepository: Pick<
    LocalSimulationRuntimeRunQueueRepository,
    'getStats' | 'query' | 'replayDeadLetter'
  >;
  readonly workerHost?: Pick<LocalSimulationRuntimeRunQueueWorkerHost, 'drain'>;
  readonly policy?: LocalSimulationRuntimeRecoveryPolicy;
}): LocalSimulationRuntimeRecovery {
  assertNonEmpty(input.manifestId, 'manifestId');
  assertPolicy(input.policy ?? {});

  const maxDeadLetterReplaysPerRun = input.policy?.maxDeadLetterReplaysPerRun ?? 0;
  const maxReplayCountPerJob = input.policy?.maxReplayCountPerJob ?? 0;
  const maxDrainJobsPerRun = input.policy?.maxDrainJobsPerRun ?? 0;

  return {
    recover: async (request) => {
      assertNonNegativeFinite(request.observedAt, 'observedAt');
      const statsBeforeRecovery = await input.queueRepository.getStats({
        observedAt: request.observedAt,
        manifestId: input.manifestId,
      });
      const { replayedDeadLetterJobs, skippedDeadLetterJobs } = await replayDeadLetters({
        queueRepository: input.queueRepository,
        manifestId: input.manifestId,
        observedAt: request.observedAt,
        maxDeadLetterReplaysPerRun,
        maxReplayCountPerJob,
        ...(input.policy?.deadLetterReplayMaxAttempts === undefined
          ? {}
          : { deadLetterReplayMaxAttempts: input.policy.deadLetterReplayMaxAttempts }),
      });
      const drainResult = await drainRecoverableJobs({
        workerHost: input.workerHost,
        stats: statsBeforeRecovery,
        maxDrainJobsPerRun,
      });
      const statsAfterRecovery = await input.queueRepository.getStats({
        observedAt: request.observedAt,
        manifestId: input.manifestId,
      });
      return {
        status:
          replayedDeadLetterJobs.length > 0 || drainResult !== undefined ? 'recovered' : 'idle',
        observedAt: request.observedAt,
        statsBeforeRecovery,
        replayedDeadLetterJobs,
        skippedDeadLetterJobs,
        ...(drainResult === undefined ? {} : { drainResult }),
        statsAfterRecovery,
      };
    },
  };
}

async function replayDeadLetters(input: {
  readonly queueRepository: Pick<
    LocalSimulationRuntimeRunQueueRepository,
    'query' | 'replayDeadLetter'
  >;
  readonly manifestId: string;
  readonly observedAt: SimulationTimestamp;
  readonly maxDeadLetterReplaysPerRun: number;
  readonly maxReplayCountPerJob: number;
  readonly deadLetterReplayMaxAttempts?: number;
}): Promise<{
  readonly replayedDeadLetterJobs: readonly LocalSimulationRuntimeRunQueueJob[];
  readonly skippedDeadLetterJobs: readonly LocalSimulationRuntimeRecoverySkippedDeadLetterJob[];
}> {
  if (input.maxDeadLetterReplaysPerRun < 1) {
    return { replayedDeadLetterJobs: [], skippedDeadLetterJobs: [] };
  }
  const deadLetterJobs = await input.queueRepository.query({
    status: 'dead-lettered',
    manifestId: input.manifestId,
    limit: input.maxDeadLetterReplaysPerRun,
  });
  const replayedDeadLetterJobs: LocalSimulationRuntimeRunQueueJob[] = [];
  const skippedDeadLetterJobs: LocalSimulationRuntimeRecoverySkippedDeadLetterJob[] = [];
  for (const job of deadLetterJobs) {
    const replayCount = job.replayCount ?? 0;
    if (replayCount >= input.maxReplayCountPerJob) {
      skippedDeadLetterJobs.push({
        jobId: job.jobId,
        reason: 'replay-limit-reached',
        replayCount,
      });
      continue;
    }
    const replayed = await input.queueRepository.replayDeadLetter({
      jobId: job.jobId,
      replayedAt: input.observedAt,
      nextAttemptAt: input.observedAt,
      ...(input.deadLetterReplayMaxAttempts === undefined
        ? {}
        : { maxAttempts: input.deadLetterReplayMaxAttempts }),
    });
    if (replayed !== undefined) {
      replayedDeadLetterJobs.push(replayed);
    }
  }
  return { replayedDeadLetterJobs, skippedDeadLetterJobs };
}

async function drainRecoverableJobs(input: {
  readonly workerHost: Pick<LocalSimulationRuntimeRunQueueWorkerHost, 'drain'> | undefined;
  readonly stats: LocalSimulationRuntimeRunQueueStats;
  readonly maxDrainJobsPerRun: number;
}): Promise<LocalSimulationRuntimeRunQueueWorkerHostDrainResult | undefined> {
  if (input.workerHost === undefined || input.maxDrainJobsPerRun < 1) {
    return undefined;
  }
  const recoverableJobCount = input.stats.readyQueueCount + input.stats.expiredLeaseCount;
  if (recoverableJobCount < 1) {
    return undefined;
  }
  return input.workerHost.drain({
    maxJobs: Math.min(input.maxDrainJobsPerRun, recoverableJobCount),
  });
}

function assertPolicy(policy: LocalSimulationRuntimeRecoveryPolicy): void {
  if (policy.maxDeadLetterReplaysPerRun !== undefined) {
    assertPositiveInteger(policy.maxDeadLetterReplaysPerRun, 'maxDeadLetterReplaysPerRun');
  }
  if (policy.maxReplayCountPerJob !== undefined) {
    assertPositiveInteger(policy.maxReplayCountPerJob, 'maxReplayCountPerJob');
  }
  if (policy.deadLetterReplayMaxAttempts !== undefined) {
    assertPositiveInteger(policy.deadLetterReplayMaxAttempts, 'deadLetterReplayMaxAttempts');
  }
  if (policy.maxDrainJobsPerRun !== undefined) {
    assertPositiveInteger(policy.maxDrainJobsPerRun, 'maxDrainJobsPerRun');
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
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
