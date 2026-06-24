import { join } from 'node:path';
import { createRuntimeDaemonApiService, type RuntimeDaemonApiService } from '@aivilization/api';
import type { SimulationTimestamp } from '@aivilization/sim-core';
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
  type LocalSimulationRuntimeRecoveryHostStatus,
  type LocalSimulationRuntimeRecoveryApiService,
  type LocalSimulationRuntimeRecoveryHost,
  type LocalSimulationRuntimeRunQueueApiService,
  type LocalSimulationRuntimeRunQueueStats,
  type LocalSimulationRuntimeRunQueueWorkerApiService,
  type LocalSimulationRuntimeRunQueueWorkerHost,
  type LocalSimulationRuntimeRunQueueWorkerHostStatus,
  type LocalSimulationRuntimeSchedulerApiService,
  type LocalSimulationRuntimeSchedulerHost,
  type LocalSimulationRuntimeSchedulerHostStatus,
  type LocalSimulationRuntimeSupervisor,
  type LocalSimulationRuntimeSupervisorStatus,
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

export type LocalRuntimeTownDaemonHealthClock = {
  readonly now: () => SimulationTimestamp;
};

export type LocalRuntimeTownDaemonHealth = 'healthy' | 'degraded' | 'attention';

export type LocalRuntimeTownDaemonSupervisorComponentStatus = {
  readonly health: Extract<LocalRuntimeTownDaemonHealth, 'healthy' | 'attention'>;
  readonly partitionCount: number;
  readonly healthyPartitionCount: number;
  readonly attentionPartitionCount: number;
  readonly status: LocalSimulationRuntimeSupervisorStatus;
};

export type LocalRuntimeTownDaemonRunQueueComponentStatus = {
  readonly health: LocalRuntimeTownDaemonHealth;
  readonly stats: LocalSimulationRuntimeRunQueueStats;
};

export type LocalRuntimeTownDaemonHostComponentStatus<TStatus> = {
  readonly configured: true;
  readonly desiredRunning: boolean;
  readonly health: LocalRuntimeTownDaemonHealth;
  readonly status: TStatus;
};

export type LocalRuntimeTownDaemonStatus = {
  readonly manifestId: string;
  readonly observedAt: SimulationTimestamp;
  readonly health: LocalRuntimeTownDaemonHealth;
  readonly components: {
    readonly supervisor: LocalRuntimeTownDaemonSupervisorComponentStatus;
    readonly runQueue: LocalRuntimeTownDaemonRunQueueComponentStatus;
    readonly worker: LocalRuntimeTownDaemonHostComponentStatus<LocalSimulationRuntimeRunQueueWorkerHostStatus>;
    readonly scheduler?: LocalRuntimeTownDaemonHostComponentStatus<LocalSimulationRuntimeSchedulerHostStatus>;
    readonly recovery?: LocalRuntimeTownDaemonHostComponentStatus<LocalSimulationRuntimeRecoveryHostStatus>;
  };
};

export type LocalRuntimeTownOrchestrationInput = LocalRuntimeTownOrchestrationProfile & {
  readonly host: LocalSimulationRuntimeHost;
  readonly supervisor: LocalSimulationRuntimeSupervisor;
  readonly clock?: LocalRuntimeTownDaemonHealthClock;
};

export type LocalRuntimeTownOrchestrationCore = {
  readonly manifestId: string;
  readonly profile: LocalRuntimeTownOrchestrationProfile;
  readonly supervisor: LocalSimulationRuntimeSupervisor;
  readonly clock: LocalRuntimeTownDaemonHealthClock;
  readonly runQueueRepository: FileLocalSimulationRuntimeRunQueueRepository;
  readonly runtimeRunQueueApi: LocalSimulationRuntimeRunQueueApiService;
  readonly runtimeRunQueueWorkerApi: LocalSimulationRuntimeRunQueueWorkerApiService;
  readonly runQueueWorkerHost: LocalSimulationRuntimeRunQueueWorkerHost;
  readonly runQueueSchedulerHost?: LocalSimulationRuntimeSchedulerHost;
  readonly runtimeSchedulerApi?: LocalSimulationRuntimeSchedulerApiService;
  readonly runQueueRecoveryHost?: LocalSimulationRuntimeRecoveryHost;
  readonly runtimeRecoveryApi?: LocalSimulationRuntimeRecoveryApiService;
};

export type LocalRuntimeTownOrchestration = LocalRuntimeTownOrchestrationCore & {
  readonly runtimeDaemonApi: RuntimeDaemonApiService<LocalRuntimeTownDaemonStatus>;
};

export function createLocalRuntimeTownOrchestration(
  input: LocalRuntimeTownOrchestrationInput,
): LocalRuntimeTownOrchestration {
  const profile: LocalRuntimeTownOrchestrationProfile = {
    ...(input.runtimeRunQueue === undefined ? {} : { runtimeRunQueue: input.runtimeRunQueue }),
    ...(input.runtimeScheduler === undefined ? {} : { runtimeScheduler: input.runtimeScheduler }),
    ...(input.runtimeRecovery === undefined ? {} : { runtimeRecovery: input.runtimeRecovery }),
  };
  const clock = input.clock ?? { now: () => Date.now() };
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
  const orchestrationCore: LocalRuntimeTownOrchestrationCore = {
    manifestId: input.host.manifestId,
    profile,
    supervisor: input.supervisor,
    clock,
    runQueueRepository,
    runtimeRunQueueApi,
    runtimeRunQueueWorkerApi,
    runQueueWorkerHost,
    ...(runQueueSchedulerHost === undefined ? {} : { runQueueSchedulerHost }),
    ...(runtimeSchedulerApi === undefined ? {} : { runtimeSchedulerApi }),
    ...(runQueueRecoveryHost === undefined ? {} : { runQueueRecoveryHost }),
    ...(runtimeRecoveryApi === undefined ? {} : { runtimeRecoveryApi }),
  };
  const runtimeDaemonApi = createRuntimeDaemonApiService({
    control: {
      getStatus: () => getLocalRuntimeTownDaemonStatus(orchestrationCore),
    },
  });

  return {
    ...orchestrationCore,
    runtimeDaemonApi,
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

async function getLocalRuntimeTownDaemonStatus(
  orchestration: LocalRuntimeTownOrchestrationCore,
): Promise<LocalRuntimeTownDaemonStatus> {
  const observedAt = orchestration.clock.now();
  const supervisorStatus = orchestration.supervisor.getStatus();
  const runQueueStats = await orchestration.runQueueRepository.getStats({
    observedAt,
    manifestId: orchestration.manifestId,
  });
  const supervisorComponent = createSupervisorComponent(supervisorStatus);
  const runQueueComponent = createRunQueueComponent(runQueueStats);
  const workerComponent = createHostComponent({
    desiredRunning: orchestration.profile.runtimeRunQueue?.autoStart ?? false,
    status: orchestration.runQueueWorkerHost.getStatus(),
  });
  const schedulerComponent =
    orchestration.runQueueSchedulerHost === undefined
      ? undefined
      : createHostComponent({
          desiredRunning: orchestration.profile.runtimeScheduler?.autoStart ?? false,
          status: orchestration.runQueueSchedulerHost.getStatus(),
        });
  const recoveryComponent =
    orchestration.runQueueRecoveryHost === undefined
      ? undefined
      : createHostComponent({
          desiredRunning: orchestration.profile.runtimeRecovery?.autoStart ?? false,
          status: orchestration.runQueueRecoveryHost.getStatus(),
        });
  const health = combineHealth(
    [
      supervisorComponent.health,
      runQueueComponent.health,
      workerComponent.health,
      schedulerComponent?.health,
      recoveryComponent?.health,
    ].filter((value): value is LocalRuntimeTownDaemonHealth => value !== undefined),
  );

  return {
    manifestId: orchestration.manifestId,
    observedAt,
    health,
    components: {
      supervisor: supervisorComponent,
      runQueue: runQueueComponent,
      worker: workerComponent,
      ...(schedulerComponent === undefined ? {} : { scheduler: schedulerComponent }),
      ...(recoveryComponent === undefined ? {} : { recovery: recoveryComponent }),
    },
  };
}

function createSupervisorComponent(
  status: LocalSimulationRuntimeSupervisorStatus,
): LocalRuntimeTownDaemonSupervisorComponentStatus {
  return {
    health: status.attentionPartitionCount > 0 ? 'attention' : 'healthy',
    partitionCount: status.partitionCount,
    healthyPartitionCount: status.healthyPartitionCount,
    attentionPartitionCount: status.attentionPartitionCount,
    status,
  };
}

function createRunQueueComponent(
  stats: LocalSimulationRuntimeRunQueueStats,
): LocalRuntimeTownDaemonRunQueueComponentStatus {
  return {
    health: deriveRunQueueHealth(stats),
    stats,
  };
}

function createHostComponent<
  TStatus extends { readonly running: boolean; readonly lastError?: unknown },
>(input: {
  readonly desiredRunning: boolean;
  readonly status: TStatus;
}): LocalRuntimeTownDaemonHostComponentStatus<TStatus> {
  return {
    configured: true,
    desiredRunning: input.desiredRunning,
    health: deriveHostHealth(input),
    status: input.status,
  };
}

function deriveRunQueueHealth(
  stats: LocalSimulationRuntimeRunQueueStats,
): LocalRuntimeTownDaemonHealth {
  if (stats.statusCounts['dead-lettered'] > 0) {
    return 'attention';
  }
  if (stats.expiredLeaseCount > 0 || stats.failedAttemptCount > 0) {
    return 'degraded';
  }
  return 'healthy';
}

function deriveHostHealth(input: {
  readonly desiredRunning: boolean;
  readonly status: { readonly running: boolean; readonly lastError?: unknown };
}): LocalRuntimeTownDaemonHealth {
  if (input.status.lastError !== undefined) {
    return 'attention';
  }
  if (input.desiredRunning && !input.status.running) {
    return 'degraded';
  }
  return 'healthy';
}

function combineHealth(
  healths: readonly LocalRuntimeTownDaemonHealth[],
): LocalRuntimeTownDaemonHealth {
  if (healths.includes('attention')) {
    return 'attention';
  }
  if (healths.includes('degraded')) {
    return 'degraded';
  }
  return 'healthy';
}
