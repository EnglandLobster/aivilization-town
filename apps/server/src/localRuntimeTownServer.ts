import {
  createTownHttpApiHandler,
  createTownNodeHttpServer,
  type TownHttpApiHandler,
} from '@aivilization/api';
import type { Server } from 'node:http';
import {
  bootstrapLocalSimulationRuntimeHostFromManifest,
  createLocalSimulationRuntimeSupervisor,
  createLocalSimulationRuntimeSupervisorApiService,
  type LocalSimulationRuntimeHost,
  type LocalSimulationRuntimeHostInput,
  type LocalSimulationRuntimeSupervisor,
  type LocalSimulationRuntimeSupervisorApiService,
} from '@aivilization/worker';

export type LocalRuntimeTownServerInput = LocalSimulationRuntimeHostInput;

export type LocalRuntimeTownApi = {
  readonly host: LocalSimulationRuntimeHost;
  readonly supervisor: LocalSimulationRuntimeSupervisor;
  readonly runtimeSupervisorApi: LocalSimulationRuntimeSupervisorApiService;
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
  const handler = createTownHttpApiHandler({
    simulation: host.registry.api,
    runtimeSupervisor: runtimeSupervisorApi,
  });

  return {
    host,
    supervisor,
    runtimeSupervisorApi,
    handler,
  };
}

export async function createLocalRuntimeTownNodeHttpServer(
  input: LocalRuntimeTownServerInput,
): Promise<LocalRuntimeTownNodeHttpServer> {
  const api = await createLocalRuntimeTownApi(input);
  return {
    ...api,
    server: createTownNodeHttpServer({ handler: api.handler }),
  };
}
