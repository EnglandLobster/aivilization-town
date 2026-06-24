import {
  createSimulationSyncSseRoute,
  createTownHttpApiHandler,
  createTownNodeHttpServer,
  type TownHttpApiHandler,
} from '@aivilization/api';
import type { Server } from 'node:http';
import { join } from 'node:path';
import {
  bootstrapLocalSimulationRuntimeHostFromManifest,
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
  createLocalSimulationRuntimeSupervisor,
  createLocalSimulationRuntimeSupervisorApiService,
  FileLocalSimulationRuntimeRunQueueRepository,
  type LocalSimulationRuntimeRecoveryApiService,
  type LocalSimulationRuntimeRecoveryHost,
  type LocalSimulationRuntimeHost,
  type LocalSimulationRuntimeHostInput,
  type LocalSimulationRuntimeRunQueueApiService,
  type LocalSimulationRuntimeRunQueueWorkerApiService,
  type LocalSimulationRuntimeRunQueueWorkerHost,
  type LocalSimulationRuntimeSchedulerApiService,
  type LocalSimulationRuntimeSchedulerHost,
  type LocalSimulationRuntimeSupervisor,
  type LocalSimulationRuntimeSupervisorApiService,
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

export type LocalRuntimeTownServerInput = LocalSimulationRuntimeHostInput & {
  readonly runtimeRunQueue?: LocalRuntimeTownRunQueueWorkerInput;
  readonly runtimeScheduler?: LocalRuntimeTownSchedulerInput;
  readonly runtimeRecovery?: LocalRuntimeTownRecoveryInput;
};

export type LocalRuntimeTownApi = {
  readonly host: LocalSimulationRuntimeHost;
  readonly supervisor: LocalSimulationRuntimeSupervisor;
  readonly runtimeSupervisorApi: LocalSimulationRuntimeSupervisorApiService;
  readonly runtimeRunQueueApi: LocalSimulationRuntimeRunQueueApiService;
  readonly runtimeRunQueueWorkerApi: LocalSimulationRuntimeRunQueueWorkerApiService;
  readonly runQueueWorkerHost: LocalSimulationRuntimeRunQueueWorkerHost;
  readonly runQueueSchedulerHost?: LocalSimulationRuntimeSchedulerHost;
  readonly runtimeSchedulerApi?: LocalSimulationRuntimeSchedulerApiService;
  readonly runQueueRecoveryHost?: LocalSimulationRuntimeRecoveryHost;
  readonly runtimeRecoveryApi?: LocalSimulationRuntimeRecoveryApiService;
  readonly handler: TownHttpApiHandler;
};

export type LocalRuntimeTownNodeHttpServer = LocalRuntimeTownApi & {
  readonly server: Server;
};

export async function createLocalRuntimeTownApi(
  input: LocalRuntimeTownServerInput,
): Promise<LocalRuntimeTownApi> {
  const host = await bootstrapLocalSimulationRuntimeHostFromManifest(input);
  const supervisor = createLocalSimulationRuntimeSupervisor({ host });
  const runtimeSupervisorApi = createLocalSimulationRuntimeSupervisorApiService({ supervisor });
  const runQueueRepository = new FileLocalSimulationRuntimeRunQueueRepository({
    rootDir: join(host.rootDir, 'operations'),
  });
  const runtimeRunQueueApi = createLocalSimulationRuntimeRunQueueApiService({
    repository: runQueueRepository,
    manifestId: host.manifestId,
  });
  const runQueueWorker = createLocalSimulationRuntimeRunQueueWorker({
    workerId: input.runtimeRunQueue?.workerId ?? `${host.manifestId}:run-queue-worker`,
    queueRepository: runQueueRepository,
    supervisor,
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
            manifestId: host.manifestId,
            queueRepository: runQueueRepository,
            policy: {
              schedulerId: input.runtimeScheduler.schedulerId ?? `${host.manifestId}:scheduler`,
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
            manifestId: host.manifestId,
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
  const handler = createTownHttpApiHandler({
    simulation: host.registry.api,
    runtimeSupervisor: runtimeSupervisorApi,
    runtimeRunQueue: runtimeRunQueueApi,
    runtimeRunQueueWorker: runtimeRunQueueWorkerApi,
    ...(runtimeSchedulerApi === undefined ? {} : { runtimeScheduler: runtimeSchedulerApi }),
    ...(runtimeRecoveryApi === undefined ? {} : { runtimeRecovery: runtimeRecoveryApi }),
  });

  return {
    host,
    supervisor,
    runtimeSupervisorApi,
    runtimeRunQueueApi,
    runtimeRunQueueWorkerApi,
    runQueueWorkerHost,
    ...(runQueueSchedulerHost === undefined ? {} : { runQueueSchedulerHost }),
    ...(runtimeSchedulerApi === undefined ? {} : { runtimeSchedulerApi }),
    ...(runQueueRecoveryHost === undefined ? {} : { runQueueRecoveryHost }),
    ...(runtimeRecoveryApi === undefined ? {} : { runtimeRecoveryApi }),
    handler,
  };
}

export async function createLocalRuntimeTownNodeHttpServer(
  input: LocalRuntimeTownServerInput,
): Promise<LocalRuntimeTownNodeHttpServer> {
  const api = await createLocalRuntimeTownApi(input);
  const server = createTownNodeHttpServer({
    handler: api.handler,
    serverSentEventRoutes: [
      createSimulationSyncSseRoute({
        sync: api.host.registry.api,
      }),
    ],
  });
  server.on('close', () => {
    api.runQueueWorkerHost.stop();
    api.runQueueSchedulerHost?.stop();
    api.runQueueRecoveryHost?.stop();
  });
  if (input.runtimeRunQueue?.autoStart ?? false) {
    api.runQueueWorkerHost.start();
  }
  if ((input.runtimeScheduler?.autoStart ?? false) && api.runQueueSchedulerHost !== undefined) {
    api.runQueueSchedulerHost.start();
  }
  if ((input.runtimeRecovery?.autoStart ?? false) && api.runQueueRecoveryHost !== undefined) {
    api.runQueueRecoveryHost.start();
  }
  return {
    ...api,
    server,
  };
}
