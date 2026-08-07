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
import {
  createLocalRuntimeTownProductionSloPolicy,
  evaluateLocalRuntimeTownProductionSlo,
  summarizeLocalRuntimeTownLlmProviderTraces,
  type LocalRuntimeTownProductionSloPolicy,
  type LocalRuntimeTownProductionSloReport,
} from './localRuntimeTownProductionSlo';

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

/**
 * Deployment-level health contract for the simulation-wide authority. A
 * disabled authority is reported explicitly rather than omitted; when enabled
 * the component exposes the authoritative ledger position so separate worker
 * processes (and operators) can verify they observe ONE shared ledger.
 */
export type LocalRuntimeTownDaemonAuthorityComponentStatus =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly health: LocalRuntimeTownDaemonHealth;
      readonly simulationId?: string;
      readonly revision?: number;
      readonly latestFencingToken?: number;
      readonly simulationTime?: number;
      readonly pendingTransferCount?: number;
      readonly pendingMoveCount?: number;
      readonly partitionKeys?: readonly string[];
    };

export type LocalRuntimeTownDaemonStatus = {
  readonly manifestId: string;
  readonly observedAt: SimulationTimestamp;
  readonly health: LocalRuntimeTownDaemonHealth;
  readonly productionSlo: LocalRuntimeTownProductionSloReport;
  readonly components: {
    readonly supervisor: LocalRuntimeTownDaemonSupervisorComponentStatus;
    readonly runQueue: LocalRuntimeTownDaemonRunQueueComponentStatus;
    readonly worker: LocalRuntimeTownDaemonHostComponentStatus<LocalSimulationRuntimeRunQueueWorkerHostStatus>;
    readonly authority: LocalRuntimeTownDaemonAuthorityComponentStatus;
    readonly scheduler?: LocalRuntimeTownDaemonHostComponentStatus<LocalSimulationRuntimeSchedulerHostStatus>;
    readonly recovery?: LocalRuntimeTownDaemonHostComponentStatus<LocalSimulationRuntimeRecoveryHostStatus>;
  };
};

export type LocalRuntimeTownOrchestrationInput = LocalRuntimeTownOrchestrationProfile & {
  readonly host: LocalSimulationRuntimeHost;
  readonly supervisor: LocalSimulationRuntimeSupervisor;
  readonly runManifestId?: string;
  readonly llmProviderConfigured?: boolean;
  readonly llmPricingConfigured?: boolean;
  readonly clock?: LocalRuntimeTownDaemonHealthClock;
};

export type LocalRuntimeTownOrchestrationCore = {
  readonly manifestId: string;
  readonly runManifestId?: string;
  readonly llmProviderConfigured: boolean;
  readonly llmPricingConfigured: boolean;
  readonly profile: LocalRuntimeTownOrchestrationProfile;
  readonly productionSloPolicy: LocalRuntimeTownProductionSloPolicy;
  readonly host: LocalSimulationRuntimeHost;
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
    ...(input.runManifestId === undefined ? {} : { runManifestId: input.runManifestId }),
    llmProviderConfigured: input.llmProviderConfigured ?? false,
    llmPricingConfigured: input.llmPricingConfigured ?? false,
    profile,
    productionSloPolicy: createLocalRuntimeTownProductionSloPolicy({
      maxPendingJobs:
        input.runtimeScheduler?.maxPendingJobs ?? input.runtimeRunQueue?.maxJobsPerPoll ?? 1,
      workerPollIntervalMs: input.runtimeRunQueue?.pollIntervalMs ?? 1_000,
      schedulerIntervalMs: input.runtimeScheduler?.scheduleIntervalMs ?? 1_000,
      recoveryIntervalMs: input.runtimeRecovery?.recoveryIntervalMs ?? 1_000,
    }),
    host: input.host,
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
  const authorityComponent = createAuthorityComponent(orchestration.host);
  const baseHealth = combineHealth(
    [
      supervisorComponent.health,
      runQueueComponent.health,
      workerComponent.health,
      ...(authorityComponent.enabled === true ? [authorityComponent.health] : []),
      schedulerComponent?.health,
      recoveryComponent?.health,
    ].filter((value): value is LocalRuntimeTownDaemonHealth => value !== undefined),
  );
  const productionSlo = await createProductionSloReport({
    orchestration,
    observedAt,
    baseHealth,
    runQueueStats,
    recoveryStatus: recoveryComponent?.status,
  });
  const health = productionSlo.status === 'fail' ? 'attention' : baseHealth;

  return {
    manifestId: orchestration.manifestId,
    observedAt,
    health,
    productionSlo,
    components: {
      supervisor: supervisorComponent,
      runQueue: runQueueComponent,
      worker: workerComponent,
      authority: authorityComponent,
      ...(schedulerComponent === undefined ? {} : { scheduler: schedulerComponent }),
      ...(recoveryComponent === undefined ? {} : { recovery: recoveryComponent }),
    },
  };
}

function createAuthorityComponent(
  host: LocalSimulationRuntimeHost,
): LocalRuntimeTownDaemonAuthorityComponentStatus {
  if (host.authorityEnabled !== true || host.authority === undefined) {
    return { enabled: false };
  }
  try {
    const snapshot = host.authority.getSnapshot();
    return {
      enabled: true,
      health: 'healthy',
      simulationId: snapshot.simulationId,
      revision: snapshot.revision,
      latestFencingToken: snapshot.latestFencingToken,
      simulationTime: snapshot.projection.clock.now,
      pendingTransferCount: Object.keys(snapshot.pendingTransfers).length,
      pendingMoveCount: Object.keys(snapshot.pendingMoves ?? {}).length,
      partitionKeys: [...snapshot.partitionKeys],
    };
  } catch {
    // The authority is configured but its durable ledger cannot be read: the
    // deployment must treat settlement as unavailable until this recovers.
    return { enabled: true, health: 'attention' };
  }
}

async function createProductionSloReport(input: {
  readonly orchestration: LocalRuntimeTownOrchestrationCore;
  readonly observedAt: SimulationTimestamp;
  readonly baseHealth: LocalRuntimeTownDaemonHealth;
  readonly runQueueStats: LocalSimulationRuntimeRunQueueStats;
  readonly recoveryStatus: LocalSimulationRuntimeRecoveryHostStatus | undefined;
}): Promise<LocalRuntimeTownProductionSloReport> {
  const supervisorStatus = input.orchestration.supervisor.getStatus();
  const partitionObservations = await Promise.all(
    input.orchestration.host.registry.listPartitions().map(async (partition) => {
      const backend = input.orchestration.host.registry.getBackend(partition);
      const projectionResult = await backend.projectionQueries.getProjection(partition);
      const simulationNow = projectionResult.projection.clock.now;
      const llmWindowStartedAt = Math.max(
        0,
        simulationNow - input.orchestration.productionSloPolicy.llm.simulatedWindowMs,
      );
      const marketWindowStartedAt = Math.max(
        0,
        simulationNow - input.orchestration.productionSloPolicy.market.maxObservationLagSimulatedMs,
      );
      const traceLimit = 100_000;
      const [providerTraceRoots, recentTrades, recentBars] = await Promise.all([
        input.orchestration.llmProviderConfigured
          ? Promise.all([
              backend.storage.agentCycleTraceRepository.query({
                simulationId: partition.simulationId,
                fromCycleStartedAt: llmWindowStartedAt,
                toCycleStartedAt: simulationNow,
                limit: traceLimit,
              }),
              backend.storage.objectiveRenewalTraceRepository.query({
                simulationId: partition.simulationId,
                partitionKey: partition.partitionKey,
                fromIssuedAt: llmWindowStartedAt,
                toIssuedAt: simulationNow,
                limit: traceLimit,
              }),
              backend.storage.dailyPlanRenewalTraceRepository.query({
                simulationId: partition.simulationId,
                partitionKey: partition.partitionKey,
                fromIssuedAt: llmWindowStartedAt,
                toIssuedAt: simulationNow,
                limit: traceLimit,
              }),
              backend.storage.reactionEvaluationTraceRepository.query({
                simulationId: partition.simulationId,
                partitionKey: partition.partitionKey,
                fromIssuedAt: llmWindowStartedAt,
                toIssuedAt: simulationNow,
                limit: traceLimit,
              }),
              backend.storage.steeringTraceRepository.query({
                simulationId: partition.simulationId,
                partitionKey: partition.partitionKey,
                fromIssuedAt: llmWindowStartedAt,
                toIssuedAt: simulationNow,
                limit: traceLimit,
              }),
            ])
          : Promise.resolve([[], [], [], [], []] as const),
        backend.storage.marketObservationRepository.queryTrades({
          simulationId: partition.simulationId,
          fromObservedAt: marketWindowStartedAt,
          toObservedAt: simulationNow,
          limit: traceLimit,
        }),
        backend.storage.marketObservationRepository.queryOhlcBars({
          simulationId: partition.simulationId,
          fromIntervalStartedAt: Math.max(
            0,
            marketWindowStartedAt -
              input.orchestration.productionSloPolicy.market.maxObservationLagSimulatedMs,
          ),
          toIntervalStartedAt: simulationNow,
          limit: traceLimit,
        }),
      ]);
      const [
        agentCycleTraces,
        objectiveRenewalTraces,
        dailyPlanRenewalTraces,
        reactionEvaluationTraces,
        steeringTraces,
      ] = providerTraceRoots;
      const checkpoint = backend.storage.checkpointStore.getLatestCheckpoint(
        backend.storage.partition,
      );
      const eventStreamVersion = backend.storage.eventStore.getStreamVersion(
        backend.storage.partition.eventStreamName,
      );
      const supervisorPartition = supervisorStatus.partitions.find(
        (candidate) =>
          candidate.simulationId === partition.simulationId &&
          candidate.partitionKey === partition.partitionKey,
      );
      const latestTradeObservedAt = maximum(recentTrades.map((trade) => trade.observedAt));
      const tradedCommodityIds = [...new Set(recentTrades.map((trade) => trade.commodityId))];
      const coveringBarEnds = tradedCommodityIds.map((commodityId) => {
        const latestCommodityTradeAt = maximum(
          recentTrades
            .filter((trade) => trade.commodityId === commodityId)
            .map((trade) => trade.observedAt),
        );
        return latestCommodityTradeAt === undefined
          ? undefined
          : maximum(
              recentBars
                .filter(
                  (bar) =>
                    bar.commodityId === commodityId &&
                    bar.intervalStartedAt <= latestCommodityTradeAt &&
                    bar.intervalEndedAt >= latestCommodityTradeAt,
                )
                .map((bar) => bar.intervalEndedAt),
            );
      });
      const everyTradeCovered = coveringBarEnds.every((value) => value !== undefined);
      const latestCoveringBarEndedAt = everyTradeCovered
        ? minimum(coveringBarEnds.filter((value): value is number => value !== undefined))
        : undefined;
      return {
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        simulationNow,
        llmWindowStartedAt,
        agentCycleCount: agentCycleTraces.length,
        traceCollectionTruncated: [
          agentCycleTraces,
          objectiveRenewalTraces,
          dailyPlanRenewalTraces,
          reactionEvaluationTraces,
          steeringTraces,
        ].some((records) => records.length === traceLimit),
        traceRoots: [
          ...agentCycleTraces,
          ...objectiveRenewalTraces,
          ...dailyPlanRenewalTraces,
          ...reactionEvaluationTraces,
          ...steeringTraces,
        ],
        checkpoint: {
          simulationId: partition.simulationId,
          partitionKey: partition.partitionKey,
          eventStreamVersion,
          checkpointSequence: checkpoint?.lastAppliedSequence ?? 0,
          ...(supervisorPartition?.updatedAt === undefined ||
          input.observedAt < supervisorPartition.updatedAt
            ? {}
            : {
                checkpointWallClockAgeMs: input.observedAt - supervisorPartition.updatedAt,
              }),
        },
        market: {
          simulationId: partition.simulationId,
          partitionKey: partition.partitionKey,
          recentTradeCount: recentTrades.length,
          collectionTruncated:
            recentTrades.length === traceLimit || recentBars.length === traceLimit,
          ...(latestTradeObservedAt === undefined ? {} : { latestTradeObservedAt }),
          ...(latestCoveringBarEndedAt === undefined ? {} : { latestCoveringBarEndedAt }),
          ...(recentTrades.length === 0 || latestCoveringBarEndedAt === undefined
            ? {}
            : {
                observationLagSimulatedMs: Math.max(0, simulationNow - latestCoveringBarEndedAt),
              }),
        },
      };
    }),
  );
  const llmWindowStartedAt =
    minimum(partitionObservations.map((partition) => partition.llmWindowStartedAt)) ?? 0;
  const llmWindowEndedAt =
    maximum(partitionObservations.map((partition) => partition.simulationNow)) ?? 0;
  const operationTraces = await input.orchestration.supervisor.queryOperationTraces({
    manifestId: input.orchestration.manifestId,
    limit: 10_000,
  });
  const recentMemoryProviderTraces = operationTraces.flatMap((trace) =>
    trace.partitions.flatMap((partition) => {
      if (
        partition.outcome !== 'succeeded' ||
        partition.memoryConsolidation === undefined ||
        partition.memoryConsolidation.consolidatedAt < llmWindowStartedAt ||
        partition.memoryConsolidation.consolidatedAt > llmWindowEndedAt
      ) {
        return [];
      }
      return [partition.memoryConsolidation];
    }),
  );
  const llmSummary = summarizeLocalRuntimeTownLlmProviderTraces([
    ...partitionObservations.flatMap((partition) => partition.traceRoots),
    ...recentMemoryProviderTraces,
  ]);
  const artifactIntegrity = await inspectRegisteredArtifactIntegrity(input.orchestration);
  const recoveryStatus = input.recoveryStatus;
  return evaluateLocalRuntimeTownProductionSlo({
    policy: input.orchestration.productionSloPolicy,
    observation: {
      observedAt: input.observedAt,
      manifestId: input.orchestration.manifestId,
      baseDaemonHealth: input.baseHealth,
      schedulerDesiredRunning: input.orchestration.profile.runtimeScheduler?.autoStart ?? false,
      queue: {
        readyDepth: input.runQueueStats.readyQueueCount,
        ...(input.runQueueStats.oldestReadyJobEnqueuedAt === undefined ||
        input.observedAt < input.runQueueStats.oldestReadyJobEnqueuedAt
          ? {}
          : {
              oldestReadyAgeMs: input.observedAt - input.runQueueStats.oldestReadyJobEnqueuedAt,
            }),
        deadLetterCount: input.runQueueStats.statusCounts['dead-lettered'],
        expiredLeaseCount: input.runQueueStats.expiredLeaseCount,
      },
      checkpoints: partitionObservations.map((partition) => partition.checkpoint),
      llm: {
        providerConfigured: input.orchestration.llmProviderConfigured,
        pricingConfigured: input.orchestration.llmPricingConfigured,
        observedAgentCycleCount: partitionObservations.reduce(
          (total, partition) => total + partition.agentCycleCount,
          0,
        ),
        traceCollectionTruncated:
          operationTraces.length === 10_000 ||
          partitionObservations.some((partition) => partition.traceCollectionTruncated),
        simulatedWindowStartedAt: llmWindowStartedAt,
        simulatedWindowEndedAt: llmWindowEndedAt,
        ...llmSummary,
      },
      market: partitionObservations.map((partition) => partition.market),
      recovery:
        recoveryStatus === undefined
          ? undefined
          : {
              desiredRunning: input.orchestration.profile.runtimeRecovery?.autoStart ?? false,
              running: recoveryStatus.running,
              attemptedRecoveryCount: recoveryStatus.attemptedRecoveryCount,
              recoveredCount: recoveryStatus.recoveredCount,
              ...(recoveryStatus.lastRecoveryCompletedAt === undefined ||
              input.observedAt < recoveryStatus.lastRecoveryCompletedAt
                ? {}
                : {
                    lastCompletedCheckAgeMs:
                      input.observedAt - recoveryStatus.lastRecoveryCompletedAt,
                  }),
              hasLastError: recoveryStatus.lastError !== undefined,
            },
      artifacts: artifactIntegrity,
    },
  });
}

async function inspectRegisteredArtifactIntegrity(
  orchestration: LocalRuntimeTownOrchestrationCore,
): Promise<{
  readonly registeredCount: number;
  readonly verifiedCount: number;
  readonly failedArtifactIds: readonly string[];
}> {
  if (orchestration.runManifestId === undefined) {
    return { registeredCount: 0, verifiedCount: 0, failedArtifactIds: [] };
  }
  try {
    const manifest = await orchestration.supervisor.getResolvedRunManifest(
      orchestration.runManifestId,
    );
    return manifest === undefined
      ? {
          registeredCount: 1,
          verifiedCount: 0,
          failedArtifactIds: [orchestration.runManifestId],
        }
      : { registeredCount: 1, verifiedCount: 1, failedArtifactIds: [] };
  } catch {
    return {
      registeredCount: 1,
      verifiedCount: 0,
      failedArtifactIds: [orchestration.runManifestId],
    };
  }
}

function maximum(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : Math.max(...values);
}

function minimum(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : Math.min(...values);
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
