import { join } from 'node:path';
import {
  createLocalSimulationRuntimeRecovery,
  createLocalSimulationRuntimeRecoveryApiService,
  createLocalSimulationRuntimeRecoveryHost,
  createLocalSimulationRuntimeRunQueueApiService,
  createLocalSimulationRuntimeRunQueueWorker,
  createLocalSimulationRuntimeRunQueueWorkerApiService,
  createLocalSimulationRuntimeRunQueueWorkerHost,
  createLocalSimulationRuntimeScheduler,
  createLocalSimulationRuntimeSchedulerApiService,
  createLocalSimulationRuntimeSchedulerHost,
  FileLocalSimulationRuntimeRunQueueRepository,
  type LocalSimulationRuntimeHost,
  type LocalSimulationRuntimeRecoveryApiService,
  type LocalSimulationRuntimeRecoveryHost,
  type LocalSimulationRuntimeRunQueueApiService,
  type LocalSimulationRuntimeRunQueueWorkerApiService,
  type LocalSimulationRuntimeRunQueueWorkerHost,
  type LocalSimulationRuntimeSchedulerApiService,
  type LocalSimulationRuntimeSchedulerHost,
  type LocalSimulationRuntimeSupervisor,
} from '@aivilization/worker';

export type LocalRuntimeTownRunQueueWorkerInput = {
  readonly workerId?: string;
  readonly leaseDurationMs?: number;
  readonly pollIntervalMs?: number;
  readonly maxJobsPerPoll?: number;
  readonly autoStart?: boolean;
};

export type LocalRuntimeTownSchedulerInput = {
  readonly schedulerId?: string;
  readonly cycleCount?: number;
  readonly cycleIntervalMs?: number;
  readonly stopOnAttention?: boolean;
  readonly maxPendingJobs?: number;
  readonly allowWhenDeadLettered?: boolean;
  readonly scheduleIntervalMs?: number;
  readonly autoStart?: boolean;
};

export type LocalRuntimeTownRecoveryInput = {
  readonly recoveryIntervalMs?: number;
  readonly autoStart?: boolean;
  readonly maxDeadLetterReplaysPerRun?: number;
  readonly maxReplayCountPerJob?: number;
  readonly deadLetterReplayMaxAttempts?: number;
  readonly maxDrainJobsPerRun?: number;
};

export type LocalRuntimeTownOrchestrationProfile = {
  readonly runtimeRunQueue?: LocalRuntimeTownRunQueueWorkerInput;
  readonly runtimeScheduler?: LocalRuntimeTownSchedulerInput;
  readonly runtimeRecovery?: LocalRuntimeTownRecoveryInput;
};

export type LocalRuntimeTownOrchestrationInput = LocalRuntimeTownOrchestrationProfile & {
  readonly host: LocalSimulationRuntimeHost;
  readonly supervisor: LocalSimulationRuntimeSupervisor;
};

export type LocalRuntimeTownOrchestration = {
  readonly runQueueRepository: FileLocalSimulationRuntimeRunQueueRepository;
  readonly runtimeRunQueueApi: LocalSimulationRuntimeRunQueueApiService;
  readonly runtimeRunQueueWorkerApi: LocalSimulationRuntimeRunQueueWorkerApiService;
  readonly runQueueWorkerHost: LocalSimulationRuntimeRunQueueWorkerHost;
  readonly runQueueSchedulerHost?: LocalSimulationRuntimeSchedulerHost;
  readonly runtimeSchedulerApi?: LocalSimulationRuntimeSchedulerApiService;
  readonly runQueueRecoveryHost?: LocalSimulationRuntimeRecoveryHost;
  readonly runtimeRecoveryApi?: LocalSimulationRuntimeRecoveryApiService;
};

export function createLocalRuntimeTownOrchestration(
  input: LocalRuntimeTownOrchestrationInput,
): LocalRuntimeTownOrchestration {
  const runQueueRepository = new FileLocalSimulationRuntimeRunQueueRepository({
    rootDir: join(input.host.rootDir, 'operations'),
  });
  const runtimeRunQueueApi = createLocalSimulationRuntimeRunQueueApiService({
    repository: runQueueRepository,
    manifestId: input.host.manifestId,
  });
  const runQueueWorker = createLocalSimulationRuntimeRunQueueWorker({
    workerId: input.runtimeRunQueue?.workerId ?? `${input.host.manifestId}:run-queue-worker`,
    queueRepository: runQueueRepository,
    supervisor: input.supervisor,
    leaseDurationMs: input.runtimeRunQueue?.leaseDurationMs ?? 30_000,
  });
  const runQueueWorkerHost = createLocalSimulationRuntimeRunQueueWorkerHost({
    worker: runQueueWorker,
    pollIntervalMs: input.runtimeRunQueue?.pollIntervalMs ?? 1_000,
    ...(input.runtimeRunQueue?.maxJobsPerPoll === undefined
      ? {}
      : { maxJobsPerPoll: input.runtimeRunQueue.maxJobsPerPoll }),
  });
  const runQueueSchedulerHost =
    input.runtimeScheduler === undefined
      ? undefined
      : createLocalSimulationRuntimeSchedulerHost({
          scheduler: createLocalSimulationRuntimeScheduler({
            manifestId: input.host.manifestId,
            queueRepository: runQueueRepository,
            policy: {
              schedulerId:
                input.runtimeScheduler.schedulerId ?? `${input.host.manifestId}:scheduler`,
              cycleCount: input.runtimeScheduler.cycleCount ?? 1,
              ...(input.runtimeScheduler.cycleIntervalMs === undefined
                ? {}
                : { cycleIntervalMs: input.runtimeScheduler.cycleIntervalMs }),
              ...(input.runtimeScheduler.stopOnAttention === undefined
                ? {}
                : { stopOnAttention: input.runtimeScheduler.stopOnAttention }),
              ...(input.runtimeScheduler.maxPendingJobs === undefined
                ? {}
                : { maxPendingJobs: input.runtimeScheduler.maxPendingJobs }),
              ...(input.runtimeScheduler.allowWhenDeadLettered === undefined
                ? {}
                : { allowWhenDeadLettered: input.runtimeScheduler.allowWhenDeadLettered }),
            },
          }),
          scheduleIntervalMs: input.runtimeScheduler.scheduleIntervalMs ?? 1_000,
        });
  const runQueueRecoveryHost =
    input.runtimeRecovery === undefined
      ? undefined
      : createLocalSimulationRuntimeRecoveryHost({
          recovery: createLocalSimulationRuntimeRecovery({
            manifestId: input.host.manifestId,
            queueRepository: runQueueRepository,
            workerHost: runQueueWorkerHost,
            policy: {
              ...(input.runtimeRecovery.maxDeadLetterReplaysPerRun === undefined
                ? {}
                : { maxDeadLetterReplaysPerRun: input.runtimeRecovery.maxDeadLetterReplaysPerRun }),
              ...(input.runtimeRecovery.maxReplayCountPerJob === undefined
                ? {}
                : { maxReplayCountPerJob: input.runtimeRecovery.maxReplayCountPerJob }),
              ...(input.runtimeRecovery.deadLetterReplayMaxAttempts === undefined
                ? {}
                : {
                    deadLetterReplayMaxAttempts: input.runtimeRecovery.deadLetterReplayMaxAttempts,
                  }),
              ...(input.runtimeRecovery.maxDrainJobsPerRun === undefined
                ? {}
                : { maxDrainJobsPerRun: input.runtimeRecovery.maxDrainJobsPerRun }),
            },
          }),
          recoveryIntervalMs: input.runtimeRecovery.recoveryIntervalMs ?? 1_000,
        });
  const runtimeRunQueueWorkerApi = createLocalSimulationRuntimeRunQueueWorkerApiService({
    host: runQueueWorkerHost,
  });
  const runtimeSchedulerApi =
    runQueueSchedulerHost === undefined
      ? undefined
      : createLocalSimulationRuntimeSchedulerApiService({ host: runQueueSchedulerHost });
  const runtimeRecoveryApi =
    runQueueRecoveryHost === undefined
      ? undefined
      : createLocalSimulationRuntimeRecoveryApiService({ host: runQueueRecoveryHost });

  return {
    runQueueRepository,
    runtimeRunQueueApi,
    runtimeRunQueueWorkerApi,
    runQueueWorkerHost,
    ...(runQueueSchedulerHost === undefined ? {} : { runQueueSchedulerHost }),
    ...(runtimeSchedulerApi === undefined ? {} : { runtimeSchedulerApi }),
    ...(runQueueRecoveryHost === undefined ? {} : { runQueueRecoveryHost }),
    ...(runtimeRecoveryApi === undefined ? {} : { runtimeRecoveryApi }),
  };
}

export function startLocalRuntimeTownOrchestration(
  profile: LocalRuntimeTownOrchestrationProfile,
  orchestration: LocalRuntimeTownOrchestration,
): void {
  if (profile.runtimeRunQueue?.autoStart ?? false) {
    orchestration.runQueueWorkerHost.start();
  }
  if (
    (profile.runtimeScheduler?.autoStart ?? false) &&
    orchestration.runQueueSchedulerHost !== undefined
  ) {
    orchestration.runQueueSchedulerHost.start();
  }
  if (
    (profile.runtimeRecovery?.autoStart ?? false) &&
    orchestration.runQueueRecoveryHost !== undefined
  ) {
    orchestration.runQueueRecoveryHost.start();
  }
}

export function stopLocalRuntimeTownOrchestration(
  orchestration: LocalRuntimeTownOrchestration,
): void {
  orchestration.runQueueWorkerHost.stop();
  orchestration.runQueueSchedulerHost?.stop();
  orchestration.runQueueRecoveryHost?.stop();
}
