import {
  createSimulationSyncSseRoute,
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
import {
  createLocalRuntimeTownOrchestration,
  startLocalRuntimeTownOrchestration,
  stopLocalRuntimeTownOrchestration,
  type LocalRuntimeTownOrchestration,
  type LocalRuntimeTownRecoveryInput,
  type LocalRuntimeTownRunQueueWorkerInput,
  type LocalRuntimeTownSchedulerInput,
} from './localRuntimeTownOrchestration';

export type LocalRuntimeTownServerInput = LocalSimulationRuntimeHostInput & {
  readonly runtimeRunQueue?: LocalRuntimeTownRunQueueWorkerInput;
  readonly runtimeScheduler?: LocalRuntimeTownSchedulerInput;
  readonly runtimeRecovery?: LocalRuntimeTownRecoveryInput;
};

export type LocalRuntimeTownApi = {
  readonly host: LocalSimulationRuntimeHost;
  readonly supervisor: LocalSimulationRuntimeSupervisor;
  readonly runtimeSupervisorApi: LocalSimulationRuntimeSupervisorApiService;
  readonly runtimeOrchestration: LocalRuntimeTownOrchestration;
  readonly runtimeRunQueueApi: LocalRuntimeTownOrchestration['runtimeRunQueueApi'];
  readonly runtimeRunQueueWorkerApi: LocalRuntimeTownOrchestration['runtimeRunQueueWorkerApi'];
  readonly runQueueWorkerHost: LocalRuntimeTownOrchestration['runQueueWorkerHost'];
  readonly runQueueSchedulerHost?: LocalRuntimeTownOrchestration['runQueueSchedulerHost'];
  readonly runtimeSchedulerApi?: LocalRuntimeTownOrchestration['runtimeSchedulerApi'];
  readonly runQueueRecoveryHost?: LocalRuntimeTownOrchestration['runQueueRecoveryHost'];
  readonly runtimeRecoveryApi?: LocalRuntimeTownOrchestration['runtimeRecoveryApi'];
  readonly runtimeDaemonApi: LocalRuntimeTownOrchestration['runtimeDaemonApi'];
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
  const runtimeOrchestration = createLocalRuntimeTownOrchestration({
    host,
    supervisor,
    ...(input.runtimeRunQueue === undefined ? {} : { runtimeRunQueue: input.runtimeRunQueue }),
    ...(input.runtimeScheduler === undefined ? {} : { runtimeScheduler: input.runtimeScheduler }),
    ...(input.runtimeRecovery === undefined ? {} : { runtimeRecovery: input.runtimeRecovery }),
  });
  const handler = createTownHttpApiHandler({
    simulation: host.registry.api,
    runtimeSupervisor: runtimeSupervisorApi,
    runtimeRunQueue: runtimeOrchestration.runtimeRunQueueApi,
    runtimeRunQueueWorker: runtimeOrchestration.runtimeRunQueueWorkerApi,
    ...(runtimeOrchestration.runtimeSchedulerApi === undefined
      ? {}
      : { runtimeScheduler: runtimeOrchestration.runtimeSchedulerApi }),
    ...(runtimeOrchestration.runtimeRecoveryApi === undefined
      ? {}
      : { runtimeRecovery: runtimeOrchestration.runtimeRecoveryApi }),
    runtimeDaemon: runtimeOrchestration.runtimeDaemonApi,
  });

  return {
    host,
    supervisor,
    runtimeSupervisorApi,
    runtimeOrchestration,
    runtimeRunQueueApi: runtimeOrchestration.runtimeRunQueueApi,
    runtimeRunQueueWorkerApi: runtimeOrchestration.runtimeRunQueueWorkerApi,
    runQueueWorkerHost: runtimeOrchestration.runQueueWorkerHost,
    ...(runtimeOrchestration.runQueueSchedulerHost === undefined
      ? {}
      : { runQueueSchedulerHost: runtimeOrchestration.runQueueSchedulerHost }),
    ...(runtimeOrchestration.runtimeSchedulerApi === undefined
      ? {}
      : { runtimeSchedulerApi: runtimeOrchestration.runtimeSchedulerApi }),
    ...(runtimeOrchestration.runQueueRecoveryHost === undefined
      ? {}
      : { runQueueRecoveryHost: runtimeOrchestration.runQueueRecoveryHost }),
    ...(runtimeOrchestration.runtimeRecoveryApi === undefined
      ? {}
      : { runtimeRecoveryApi: runtimeOrchestration.runtimeRecoveryApi }),
    runtimeDaemonApi: runtimeOrchestration.runtimeDaemonApi,
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
    stopLocalRuntimeTownOrchestration(api.runtimeOrchestration);
  });
  startLocalRuntimeTownOrchestration(
    {
      ...(input.runtimeRunQueue === undefined ? {} : { runtimeRunQueue: input.runtimeRunQueue }),
      ...(input.runtimeScheduler === undefined ? {} : { runtimeScheduler: input.runtimeScheduler }),
      ...(input.runtimeRecovery === undefined ? {} : { runtimeRecovery: input.runtimeRecovery }),
    },
    api.runtimeOrchestration,
  );
  return {
    ...api,
    server,
  };
}
