import {
  createAgentCycleTraceApiService,
  createAgentProfileApiService,
  createBranchPlanApiService,
  createDailyPlanRenewalTraceApiService,
  createObjectiveRenewalTraceApiService,
  createSteeringTraceApiService,
  createSimulationSyncSseRoute,
  createRuntimeProfileRunReportApiService,
  createSocialReflectionObservationApiService,
  createSocietyDirectoryApiService,
  createSocietyInteractionApiService,
  createTownHttpApiHandler,
  createTownNodeHttpServer,
  type TownParticipantAccessPolicy,
  type TownHttpApiHandler,
} from '@aivilization/api';
import type { Server } from 'node:http';
import type { RuntimeProfileRunReportRepository } from '@aivilization/observability';
import { asAgentId } from '@aivilization/sim-core';
import { createTownWebAssets } from '@aivilization/web';
import {
  createPaperPlannerVariantCompiler,
  type PaperPlannerVariant,
} from '@aivilization/agent-runtime';
import {
  bootstrapLocalSimulationRuntimeHostFromManifest,
  createCanonicalAmbientObservationMemoryRuntimeInput,
  createCanonicalLocalRuntimeAgentProvider,
  createCanonicalMemoryConsolidationSchedule,
  createLocalSimulationRuntimeSupervisor,
  createLocalSimulationRuntimeSupervisorApiService,
  type CanonicalLocalRuntimeAgentProviderConfig,
  type LocalSimulationRuntimeHost,
  type LocalSimulationRuntimeHostInput,
  type LocalSimulationRuntimeResolvedRunManifest,
  type LocalSimulationRuntimeSupervisor,
  type LocalSimulationRuntimeSupervisorApiService,
  resolveWorldCommandPolicies,
} from '@aivilization/worker';
import {
  attachLocalRuntimeTownLlmAgentStages,
  attachLocalRuntimeTownLlmMemoryStages,
  createLocalRuntimeTownLlmRuntime,
  type LocalRuntimeTownLlmConfig,
  type LocalRuntimeTownLlmRuntime,
} from './localRuntimeTownLlm';
import {
  createLocalRuntimeTownOrchestration,
  startLocalRuntimeTownOrchestration,
  stopLocalRuntimeTownOrchestration,
  type LocalRuntimeTownOrchestration,
  type LocalRuntimeTownRecoveryInput,
  type LocalRuntimeTownRunQueueWorkerInput,
  type LocalRuntimeTownSchedulerInput,
} from './localRuntimeTownOrchestration';
import {
  createLocalRuntimeTownParticipantAccessPolicy,
  createLocalRuntimeTownParticipantAccessRuntime,
  type LocalRuntimeTownParticipantAccessConfig,
  type LocalRuntimeTownParticipantAccessRuntime,
} from './localRuntimeTownParticipantAccess';

export type LocalRuntimeTownServerInput = LocalSimulationRuntimeHostInput & {
  readonly llm?: LocalRuntimeTownLlmConfig;
  readonly canonicalAgents?:
    | true
    | Omit<CanonicalLocalRuntimeAgentProviderConfig, 'policies' | 'strategicPlanCompiler'>;
  readonly plannerVariant?: PaperPlannerVariant;
  readonly resolvedRunManifest?: LocalSimulationRuntimeResolvedRunManifest;
  readonly runtimeRunQueue?: LocalRuntimeTownRunQueueWorkerInput;
  readonly runtimeScheduler?: LocalRuntimeTownSchedulerInput;
  readonly runtimeRecovery?: LocalRuntimeTownRecoveryInput;
  readonly runtimeProfileRunReports?: RuntimeProfileRunReportRepository;
  readonly participantAccess?: LocalRuntimeTownParticipantAccessConfig;
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
  readonly branchPlansApi: ReturnType<typeof createBranchPlanApiService>;
  readonly agentCycleTracesApi: ReturnType<typeof createAgentCycleTraceApiService>;
  readonly dailyPlanRenewalTracesApi: ReturnType<typeof createDailyPlanRenewalTraceApiService>;
  readonly objectiveRenewalTracesApi: ReturnType<typeof createObjectiveRenewalTraceApiService>;
  readonly steeringTracesApi: ReturnType<typeof createSteeringTraceApiService>;
  readonly socialReflectionObservationsApi: ReturnType<
    typeof createSocialReflectionObservationApiService
  >;
  readonly societyDirectoryApi: ReturnType<typeof createSocietyDirectoryApiService>;
  readonly societyInteractionsApi: ReturnType<typeof createSocietyInteractionApiService>;
  readonly participantAccessPolicy: TownParticipantAccessPolicy;
  readonly participantAccess: LocalRuntimeTownParticipantAccessRuntime;
  readonly handler: TownHttpApiHandler;
};

export type LocalRuntimeTownNodeHttpServer = LocalRuntimeTownApi & {
  readonly server: Server;
};

export async function createLocalRuntimeTownApi(
  input: LocalRuntimeTownServerInput,
): Promise<LocalRuntimeTownApi> {
  assertCanonicalAgentProviderInput(input);
  const llmRuntime =
    input.llm === undefined ? undefined : createLocalRuntimeTownLlmRuntime(input.llm);
  const baseStrategicPlanCompiler =
    input.strategicPlanCompiler ?? llmRuntime?.strategicPlanCompiler;
  const strategicPlanCompiler = createPaperPlannerVariantCompiler({
    variant: input.plannerVariant ?? 'default',
    ...(baseStrategicPlanCompiler === undefined ? {} : { baseCompiler: baseStrategicPlanCompiler }),
  });
  const memoryConsolidationSchedule = resolveMemoryConsolidationSchedule(input, llmRuntime);
  const canonicalAgentConfig = input.canonicalAgents === true ? undefined : input.canonicalAgents;
  const configuredAgentProvider =
    input.agentProvider ??
    (input.canonicalAgents === undefined
      ? undefined
      : createCanonicalLocalRuntimeAgentProvider({
          ...(canonicalAgentConfig ?? {}),
          policies: input.policies,
          ...(strategicPlanCompiler === undefined ? {} : { strategicPlanCompiler }),
          ...(canonicalAgentConfig?.globalSynthesizer !== undefined ||
          llmRuntime?.globalSynthesizer === undefined
            ? {}
            : { globalSynthesizer: llmRuntime.globalSynthesizer }),
          ...(canonicalAgentConfig?.socialDialogueGenerator !== undefined ||
          llmRuntime?.socialDialogueGenerator === undefined
            ? {}
            : { socialDialogueGenerator: llmRuntime.socialDialogueGenerator }),
        }));
  const agentProvider =
    configuredAgentProvider === undefined || llmRuntime === undefined
      ? configuredAgentProvider
      : async (providerInput: Parameters<typeof configuredAgentProvider>[0]) =>
          (await configuredAgentProvider(providerInput)).map((agent) =>
            attachLocalRuntimeTownLlmAgentStages({ agent, runtime: llmRuntime }),
          );
  const participantAccessPolicy = createLocalRuntimeTownParticipantAccessPolicy(
    input.participantAccess,
  );
  const participantAgentQuota =
    participantAccessPolicy.mode === 'open'
      ? undefined
      : requireParticipantAgentQuota(participantAccessPolicy);
  const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
    ...input,
    policies:
      participantAgentQuota === undefined
        ? input.policies
        : (projection) => ({
            ...resolveWorldCommandPolicies({ policies: input.policies, projection }),
            agentRegistration: {
              maxAgentsPerCreator: participantAgentQuota,
            },
          }),
    agents:
      llmRuntime === undefined
        ? input.agents
        : input.agents.map((agent) =>
            attachLocalRuntimeTownLlmAgentStages({ agent, runtime: llmRuntime }),
          ),
    ...(agentProvider === undefined ? {} : { agentProvider }),
    ...(strategicPlanCompiler === undefined ? {} : { strategicPlanCompiler }),
    ambientObservationMemory: resolveAmbientObservationMemory(input, llmRuntime),
    memoryConsolidationSchedule,
  });
  const supervisor = createLocalSimulationRuntimeSupervisor({
    host,
    ...(input.resolvedRunManifest === undefined
      ? {}
      : { resolvedRunManifest: input.resolvedRunManifest }),
  });
  const runtimeSupervisorApi = createLocalSimulationRuntimeSupervisorApiService({ supervisor });
  const runtimeOrchestration = createLocalRuntimeTownOrchestration({
    host,
    supervisor,
    ...(input.resolvedRunManifest === undefined
      ? {}
      : { runManifestId: input.resolvedRunManifest.runManifestId }),
    llmProviderConfigured: input.llm !== undefined,
    llmPricingConfigured: input.llm?.pricing !== undefined,
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
  const branchPlansApi = createBranchPlanApiService({
    plans: {
      queryPlans: async (request) =>
        host.registry
          .getBackend({
            simulationId: request.simulationId,
            partitionKey: request.partitionKey,
          })
          .storage.planRepository.query({
            ...(request.planId === undefined ? {} : { planId: request.planId }),
            ...(request.agentId === undefined ? {} : { agentId: asAgentId(request.agentId) }),
            ...(request.fromCreatedAt === undefined
              ? {}
              : { fromCreatedAt: request.fromCreatedAt }),
            ...(request.toCreatedAt === undefined ? {} : { toCreatedAt: request.toCreatedAt }),
            ...(request.fromUpdatedAt === undefined
              ? {}
              : { fromUpdatedAt: request.fromUpdatedAt }),
            ...(request.toUpdatedAt === undefined ? {} : { toUpdatedAt: request.toUpdatedAt }),
            ...(request.limit === undefined ? {} : { limit: request.limit }),
          }),
    },
  });
  const agentCycleTracesApi = createAgentCycleTraceApiService({
    traces: {
      getTrace: async (request) =>
        host.registry
          .getBackend({
            simulationId: request.simulationId,
            partitionKey: request.partitionKey,
          })
          .storage.agentCycleTraceRepository.get(request.traceId),
      queryTraces: async (request) =>
        host.registry
          .getBackend({
            simulationId: request.simulationId,
            partitionKey: request.partitionKey,
          })
          .storage.agentCycleTraceRepository.query(request),
    },
  });
  const dailyPlanRenewalTracesApi = createDailyPlanRenewalTraceApiService({
    traces: {
      getTrace: async (request) =>
        host.registry
          .getBackend({
            simulationId: request.simulationId,
            partitionKey: request.partitionKey,
          })
          .storage.dailyPlanRenewalTraceRepository.get(request.traceId),
      queryTraces: async (request) =>
        host.registry
          .getBackend({
            simulationId: request.simulationId,
            partitionKey: request.partitionKey,
          })
          .storage.dailyPlanRenewalTraceRepository.query(request),
    },
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
  const steeringTracesApi = createSteeringTraceApiService({
    traces: {
      getTrace: async (request) =>
        host.registry
          .getBackend({
            simulationId: request.simulationId,
            partitionKey: request.partitionKey,
          })
          .storage.steeringTraceRepository.get(request.traceId),
      queryTraces: async (request) =>
        host.registry
          .getBackend({
            simulationId: request.simulationId,
            partitionKey: request.partitionKey,
          })
          .storage.steeringTraceRepository.query(request),
    },
  });
  const socialReflectionObservationsApi = createSocialReflectionObservationApiService({
    observations: {
      getObservation: async (request) =>
        host.registry
          .getBackend({
            simulationId: request.simulationId,
            partitionKey: request.partitionKey,
          })
          .storage.socialReflectionObservationRepository.get(request.observationId),
      queryObservations: async (request) =>
        host.registry
          .getBackend({
            simulationId: request.simulationId,
            partitionKey: request.partitionKey,
          })
          .storage.socialReflectionObservationRepository.query(request),
    },
  });
  const societyDirectoryApi = createSocietyDirectoryApiService({
    directory: host.societyDirectory,
  });
  const societyInteractionsApi = createSocietyInteractionApiService({
    interactions: {
      executeConversation: (request) =>
        host.socialInteractions.executeConversation({
          ...request,
          initiatorAgentId: asAgentId(request.initiatorAgentId),
          targetAgentId: asAgentId(request.targetAgentId),
          turns: request.turns.map((turn) => ({
            ...turn,
            speakerAgentId: asAgentId(turn.speakerAgentId),
          })),
        }),
    },
  });
  const baseHandler = createTownHttpApiHandler({
    simulation: host.registry.api,
    agentProfiles: agentProfilesApi,
    branchPlans: branchPlansApi,
    agentCycleTraces: agentCycleTracesApi,
    dailyPlanRenewalTraces: dailyPlanRenewalTracesApi,
    objectiveRenewalTraces: objectiveRenewalTracesApi,
    steeringTraces: steeringTracesApi,
    socialReflectionObservations: socialReflectionObservationsApi,
    societyDirectory: societyDirectoryApi,
    societyInteractions: societyInteractionsApi,
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
  const participantAccess = createLocalRuntimeTownParticipantAccessRuntime({
    ...(input.participantAccess === undefined ? {} : { config: input.participantAccess }),
    host,
    next: baseHandler,
  });
  const handler = participantAccess.controller.handle;

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
    branchPlansApi,
    agentCycleTracesApi,
    dailyPlanRenewalTracesApi,
    objectiveRenewalTracesApi,
    steeringTracesApi,
    socialReflectionObservationsApi,
    societyDirectoryApi,
    societyInteractionsApi,
    participantAccessPolicy: participantAccess.policy,
    participantAccess,
    handler,
  };
}

function requireParticipantAgentQuota(policy: TownParticipantAccessPolicy): number {
  const quota = policy.maxAgentsPerParticipant;
  if (quota === null) {
    throw new Error('authenticated participant access policy must define an agent quota');
  }
  return quota;
}

function assertCanonicalAgentProviderInput(input: LocalRuntimeTownServerInput): void {
  if (input.canonicalAgents === undefined) {
    return;
  }
  if (input.agentProvider !== undefined) {
    throw new Error('canonicalAgents cannot be combined with agentProvider');
  }
  if (input.agents.length > 0) {
    throw new Error('canonicalAgents cannot be combined with static agents');
  }
}

function resolveMemoryConsolidationSchedule(
  input: LocalRuntimeTownServerInput,
  llmRuntime: LocalRuntimeTownLlmRuntime | undefined,
) {
  const schedule =
    input.memoryConsolidationSchedule ?? createCanonicalMemoryConsolidationSchedule();
  return llmRuntime === undefined
    ? schedule
    : attachLocalRuntimeTownLlmMemoryStages({ schedule, runtime: llmRuntime });
}

function resolveAmbientObservationMemory(
  input: LocalRuntimeTownServerInput,
  llmRuntime: LocalRuntimeTownLlmRuntime | undefined,
) {
  if (input.ambientObservationMemory?.enabled === false) {
    return input.ambientObservationMemory;
  }
  const ambientObservationMemory = {
    ...createCanonicalAmbientObservationMemoryRuntimeInput(),
    ...(input.ambientObservationMemory ?? {}),
  };
  return {
    ...ambientObservationMemory,
    ...(ambientObservationMemory.reactionEvaluator !== undefined ||
    llmRuntime?.reactionEvaluator === undefined
      ? {}
      : { reactionEvaluator: llmRuntime.reactionEvaluator }),
  };
}

export async function createLocalRuntimeTownNodeHttpServer(
  input: LocalRuntimeTownServerInput,
): Promise<LocalRuntimeTownNodeHttpServer> {
  const api = await createLocalRuntimeTownApi(input);
  const server = createTownNodeHttpServer({
    handler: api.handler,
    ...(api.participantAccess.authenticator === undefined
      ? {}
      : { authenticator: api.participantAccess.authenticator }),
    staticAssets: createTownWebAssets(),
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
