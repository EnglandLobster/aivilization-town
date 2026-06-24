import {
  createAgentProfileApiService,
  createObjectiveRenewalTraceApiService,
  createSimulationSyncSseRoute,
  createRuntimeProfileRunReportApiService,
  createTownHttpApiHandler,
  createTownNodeHttpServer,
  type TownHttpApiHandler,
} from '@aivilization/api';
import type { Server } from 'node:http';
import type { RuntimeProfileRunReportRepository } from '@aivilization/observability';
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
  readonly runtimeProfileRunReports?: RuntimeProfileRunReportRepository;
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
  readonly runtimeProfileRunReportsApi?: ReturnType<typeof createRuntimeProfileRunReportApiService>;
  readonly agentProfilesApi: ReturnType<typeof createAgentProfileApiService>;
  readonly objectiveRenewalTracesApi: ReturnType<typeof createObjectiveRenewalTraceApiService>;
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
  const runtimeProfileRunReportsApi =
    input.runtimeProfileRunReports === undefined
      ? undefined
      : createRuntimeProfileRunReportApiService({
          reports: {
            getReport: (request) => input.runtimeProfileRunReports?.get(request.runId),
            queryReports: (request) => input.runtimeProfileRunReports?.query(request) ?? [],
          },
        });
  const agentProfilesApi = createAgentProfileApiService({
    profiles: host.registry.agentProfiles,
  });
  const objectiveRenewalTracesApi = createObjectiveRenewalTraceApiService({
    traces: {
      getTrace: async (request) =>
        host.registry
          .getBackend({
            simulationId: request.simulationId,
            partitionKey: request.partitionKey,
          })
          .storage.objectiveRenewalTraceRepository.get(request.traceId),
      queryTraces: async (request) =>
        host.registry
          .getBackend({
            simulationId: request.simulationId,
            partitionKey: request.partitionKey,
          })
          .storage.objectiveRenewalTraceRepository.query(request),
    },
  });
  const handler = createTownHttpApiHandler({
    simulation: host.registry.api,
    agentProfiles: agentProfilesApi,
    objectiveRenewalTraces: objectiveRenewalTracesApi,
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
    ...(runtimeProfileRunReportsApi === undefined
      ? {}
      : { runtimeProfileRunReports: runtimeProfileRunReportsApi }),
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
    ...(runtimeProfileRunReportsApi === undefined ? {} : { runtimeProfileRunReportsApi }),
    agentProfilesApi,
    objectiveRenewalTracesApi,
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
