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
  createLocalSimulationRuntimeRunQueueApiService,
  createLocalSimulationRuntimeRunQueueWorker,
  createLocalSimulationRuntimeRunQueueWorkerApiService,
  createLocalSimulationRuntimeRunQueueWorkerHost,
  createLocalSimulationRuntimeSupervisor,
  createLocalSimulationRuntimeSupervisorApiService,
  FileLocalSimulationRuntimeRunQueueRepository,
  type LocalSimulationRuntimeHost,
  type LocalSimulationRuntimeHostInput,
  type LocalSimulationRuntimeRunQueueApiService,
  type LocalSimulationRuntimeRunQueueWorkerApiService,
  type LocalSimulationRuntimeRunQueueWorkerHost,
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

export type LocalRuntimeTownServerInput = LocalSimulationRuntimeHostInput & {
  readonly runtimeRunQueue?: LocalRuntimeTownRunQueueWorkerInput;
};

export type LocalRuntimeTownApi = {
  readonly host: LocalSimulationRuntimeHost;
  readonly supervisor: LocalSimulationRuntimeSupervisor;
  readonly runtimeSupervisorApi: LocalSimulationRuntimeSupervisorApiService;
  readonly runtimeRunQueueApi: LocalSimulationRuntimeRunQueueApiService;
  readonly runtimeRunQueueWorkerApi: LocalSimulationRuntimeRunQueueWorkerApiService;
  readonly runQueueWorkerHost: LocalSimulationRuntimeRunQueueWorkerHost;
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
  const runtimeRunQueueWorkerApi = createLocalSimulationRuntimeRunQueueWorkerApiService({
    host: runQueueWorkerHost,
  });
  const handler = createTownHttpApiHandler({
    simulation: host.registry.api,
    runtimeSupervisor: runtimeSupervisorApi,
    runtimeRunQueue: runtimeRunQueueApi,
    runtimeRunQueueWorker: runtimeRunQueueWorkerApi,
  });

  return {
    host,
    supervisor,
    runtimeSupervisorApi,
    runtimeRunQueueApi,
    runtimeRunQueueWorkerApi,
    runQueueWorkerHost,
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
  });
  if (input.runtimeRunQueue?.autoStart ?? false) {
    api.runQueueWorkerHost.start();
  }
  return {
    ...api,
    server,
  };
}
