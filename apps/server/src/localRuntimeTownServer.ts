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
  createLocalSimulationRuntimeSupervisor,
  createLocalSimulationRuntimeSupervisorApiService,
  FileLocalSimulationRuntimeRunQueueRepository,
  type LocalSimulationRuntimeHost,
  type LocalSimulationRuntimeHostInput,
  type LocalSimulationRuntimeRunQueueApiService,
  type LocalSimulationRuntimeSupervisor,
  type LocalSimulationRuntimeSupervisorApiService,
} from '@aivilization/worker';

export type LocalRuntimeTownServerInput = LocalSimulationRuntimeHostInput;

export type LocalRuntimeTownApi = {
  readonly host: LocalSimulationRuntimeHost;
  readonly supervisor: LocalSimulationRuntimeSupervisor;
  readonly runtimeSupervisorApi: LocalSimulationRuntimeSupervisorApiService;
  readonly runtimeRunQueueApi: LocalSimulationRuntimeRunQueueApiService;
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
  const handler = createTownHttpApiHandler({
    simulation: host.registry.api,
    runtimeSupervisor: runtimeSupervisorApi,
    runtimeRunQueue: runtimeRunQueueApi,
  });

  return {
    host,
    supervisor,
    runtimeSupervisorApi,
    runtimeRunQueueApi,
    handler,
  };
}

export async function createLocalRuntimeTownNodeHttpServer(
  input: LocalRuntimeTownServerInput,
): Promise<LocalRuntimeTownNodeHttpServer> {
  const api = await createLocalRuntimeTownApi(input);
  return {
    ...api,
    server: createTownNodeHttpServer({
      handler: api.handler,
      serverSentEventRoutes: [
        createSimulationSyncSseRoute({
          sync: api.host.registry.api,
        }),
      ],
    }),
  };
}
