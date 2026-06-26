import type {
  AdaptiveReplanningPolicy,
  ActionSequenceGenerator,
  DailyPlanCompiler,
  GlobalActionSynthesizer,
  ReactionEvaluator,
  ReactiveActionSimulator,
  ReactiveCorrector,
  ReplanningDecider,
  SocialDialogueGenerator,
  StrategicPlanCompiler,
  SubtaskPrioritizer,
} from '@aivilization/agent-runtime';
import type { ReflectiveInsightSynthesizer, SocialModelSynthesizer } from '@aivilization/memory';
import {
  createRuntimeProfileAgentCycleDiagnostics,
  createRuntimeProfileCognitionLlmStageDiagnostics,
  createRuntimeProfileRunReport,
  type ExperimentValidationMetric,
  type ExperimentValidationReportGateResult,
  type ExperimentValidationStatus,
  type ObjectiveRenewalTrace,
  type RuntimeProfileAgentCycleDiagnostics,
  type RuntimeProfileCognitionLlmStageDiagnostics,
  type RuntimeProfilePlannerExperiment,
  type RuntimeProfileRunReportRepository,
} from '@aivilization/observability';
import type { PartitionKey, SimulationTimestamp } from '@aivilization/sim-core';
import {
  buildWorkerTickAgentsFromActivePlans,
  completeFinishedActiveObjectives,
  createAivilizationWorldCommandPolicies,
  createCanonicalWorkerRuntimeResolver,
  renewDailyPlanScheduledIntentions,
  renewMissingActiveObjectives,
  recordMarketPriceIndexToEventStream,
  runLocalExperimentValidationSchedule,
  type ObjectiveRenewalDecisionTrace,
  type LocalExperimentValidationScheduleInput,
  type LocalWorldRuntimeAgentProvider,
  type LocalSimulationLifecycleMemoryConsolidationSchedule,
  type LocalSimulationRuntimeOperationTrace,
  type CanonicalDomainRuntimeConfig,
  type WorldStateActionSynthesisPolicyConfig,
  type WorldCommandPolicyResolver,
  type WorldCommandPolicySource,
} from '@aivilization/worker';
import type { LocalRuntimeTownDaemonHealth } from './localRuntimeTownOrchestration';
import {
  createLocalRuntimeTownProfileDailyPlanCompiler,
  createLocalRuntimeTownProfileActionSequenceGenerator,
  createLocalRuntimeTownProfileGlobalSynthesizer,
  createLocalRuntimeTownProfileReflectiveInsightSynthesizer,
  createLocalRuntimeTownProfileReactionEvaluator,
  createLocalRuntimeTownProfileReactiveCorrector,
  createLocalRuntimeTownProfileReplanningDecider,
  createLocalRuntimeTownProfileSocialDialogueGenerator,
  createLocalRuntimeTownProfileSocialModelSynthesizer,
  createLocalRuntimeTownProfileStrategicPlanCompiler,
  createLocalRuntimeTownProfileSubtaskPrioritizer,
  type LocalRuntimeTownProfileActionSequenceGeneratorConfig,
  type LocalRuntimeTownProfileDailyCompilerConfig,
  type LocalRuntimeTownProfileGlobalSynthesizerConfig,
  type LocalRuntimeTownProfileReactiveCorrectorConfig,
  type LocalRuntimeTownProfileReplanningDeciderConfig,
  type LocalRuntimeTownProfileReflectiveInsightSynthesizerConfig,
  type LocalRuntimeTownProfileReactionEvaluatorConfig,
  type LocalRuntimeTownProfileStrategicCompilerConfig,
  type LocalRuntimeTownProfileSocialDialogueGeneratorConfig,
  type LocalRuntimeTownProfileSocialModelSynthesizerConfig,
  type LocalRuntimeTownProfileSubtaskPrioritizerConfig,
} from './localRuntimeTownProfileLlmPlanning';
import { createLocalRuntimeTownProfileDefaults } from './localRuntimeTownProfileDefaults';
import { createLocalRuntimeTownDaemonScenarioProfile } from './localRuntimeTownScenarioProfile';
import type { LocalRuntimeTownDaemonScenarioProfileId } from './localRuntimeTownScenarioProfile';
import { createLocalRuntimeTownApi } from './localRuntimeTownServer';

const DEFAULT_PROFILE_AGENT_MEMORY_RETRIEVAL_LIMIT = 8;

export type LocalRuntimeTownProfileRunnerInput = {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly rootDir: string;
  readonly cycleCount: number;
  readonly requestedAt: SimulationTimestamp;
  readonly runIdSuffix?: string;
  readonly cycleIntervalMs?: number;
  readonly policies?: WorldCommandPolicySource;
  readonly domainConfig?: CanonicalDomainRuntimeConfig;
  readonly actionSynthesis?: WorldStateActionSynthesisPolicyConfig | false;
  readonly agentProvider?: LocalWorldRuntimeAgentProvider;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly dailyPlanCompiler?: DailyPlanCompiler;
  readonly reactionEvaluator?: ReactionEvaluator;
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly actionSequenceGenerator?: ActionSequenceGenerator;
  readonly socialDialogueGenerator?: SocialDialogueGenerator;
  readonly globalSynthesizer?: GlobalActionSynthesizer;
  readonly steeringSimulator?: ReactiveActionSimulator;
  readonly reactiveCorrector?: ReactiveCorrector;
  readonly replanningDecider?: ReplanningDecider;
  readonly reflectiveInsightSynthesizer?: ReflectiveInsightSynthesizer;
  readonly socialModelSynthesizer?: SocialModelSynthesizer;
  readonly replanningPolicy?: AdaptiveReplanningPolicy;
  readonly llmPlanning?: LocalRuntimeTownProfileStrategicCompilerConfig;
  readonly dailyPlanning?: LocalRuntimeTownProfileDailyCompilerConfig;
  readonly reactionPlanning?: LocalRuntimeTownProfileReactionEvaluatorConfig;
  readonly subtaskPrioritization?: LocalRuntimeTownProfileSubtaskPrioritizerConfig;
  readonly actionSequenceGeneration?: LocalRuntimeTownProfileActionSequenceGeneratorConfig;
  readonly socialDialogue?: LocalRuntimeTownProfileSocialDialogueGeneratorConfig;
  readonly globalSynthesis?: LocalRuntimeTownProfileGlobalSynthesizerConfig;
  readonly reactiveCorrection?: LocalRuntimeTownProfileReactiveCorrectorConfig;
  readonly replanningDecision?: LocalRuntimeTownProfileReplanningDeciderConfig;
  readonly reflectionSynthesis?: LocalRuntimeTownProfileReflectiveInsightSynthesizerConfig;
  readonly socialModelSynthesis?: LocalRuntimeTownProfileSocialModelSynthesizerConfig;
  readonly memoryConsolidationSchedule?: LocalSimulationLifecycleMemoryConsolidationSchedule;
  readonly experimentValidationSchedule?: LocalRuntimeTownProfileExperimentValidationSchedule;
  readonly profileRunReportRepository?: RuntimeProfileRunReportRepository;
  readonly plannerExperiment?: RuntimeProfilePlannerExperiment;
  readonly reportGeneratedAt?: SimulationTimestamp;
  readonly agentMemoryRetrievalLimit?: number;
  readonly agentMemoryRetrievalCandidateLimit?: number;
  readonly preseedMarketPriceIndex?: boolean;
};

export type LocalRuntimeTownProfileExperimentValidationSchedule = Omit<
  LocalExperimentValidationScheduleInput,
  'storage' | 'initialProjection' | 'runId' | 'generatedAt'
> & {
  readonly runIdPrefix?: string;
};

export type LocalRuntimeTownProfileExperimentValidationMetricSummary = Pick<
  ExperimentValidationMetric,
  'id' | 'label' | 'status' | 'value' | 'unit' | 'evidence'
>;

export type LocalRuntimeTownProfileExperimentValidationReportSummary = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly runId: string;
  readonly generatedAt: SimulationTimestamp;
  readonly source?: string;
  readonly gateStatus?: ExperimentValidationReportGateResult['status'];
  readonly gateFailureCount?: number;
  readonly metricStatusCounts: Readonly<Record<ExperimentValidationStatus, number>>;
  readonly metrics: readonly LocalRuntimeTownProfileExperimentValidationMetricSummary[];
  readonly streamVersion: number;
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly eventCount: number;
  readonly projectionSequence: number;
};

export type LocalRuntimeTownProfileRunnerPartitionSummary = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly scenarioPresetId: string;
  readonly status: string;
  readonly health: string;
  readonly lastAppliedSequence: number;
  readonly streamVersion: number;
  readonly eventCount: number;
  readonly projectionAgentCount: number;
  readonly agentTraceCount: number;
};

export type LocalRuntimeTownProfileRunnerSummary = {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly manifestId: string;
  readonly rootDir: string;
  readonly requestedAt: SimulationTimestamp;
  readonly daemonHealth: LocalRuntimeTownDaemonHealth;
  readonly partitionCount: number;
  readonly totalProjectionAgentCount: number;
  readonly totalEventCount: number;
  readonly totalAgentTraceCount: number;
  readonly agentCycleDiagnostics: RuntimeProfileAgentCycleDiagnostics;
  readonly cognitionLlmStageDiagnostics?: readonly RuntimeProfileCognitionLlmStageDiagnostics[];
  readonly experimentValidationReports?: readonly LocalRuntimeTownProfileExperimentValidationReportSummary[];
  readonly run: {
    readonly traceId: string;
    readonly outcome: string;
    readonly requestedCycleCount: number;
    readonly completedCycleCount: number;
    readonly stopReason: string;
  };
  readonly partitions: readonly LocalRuntimeTownProfileRunnerPartitionSummary[];
};

export async function runLocalRuntimeTownDaemonScenarioProfile(
  input: LocalRuntimeTownProfileRunnerInput,
): Promise<LocalRuntimeTownProfileRunnerSummary> {
  assertNonEmpty(input.rootDir, 'rootDir');
  assertPositiveInteger(input.cycleCount, 'cycleCount');
  assertNonNegativeFinite(input.requestedAt, 'requestedAt');
  if (input.cycleIntervalMs !== undefined) {
    assertNonNegativeFinite(input.cycleIntervalMs, 'cycleIntervalMs');
  }
  if (input.runIdSuffix !== undefined) {
    assertNonEmpty(input.runIdSuffix, 'runIdSuffix');
  }
  if (input.reportGeneratedAt !== undefined) {
    assertNonNegativeFinite(input.reportGeneratedAt, 'reportGeneratedAt');
  }

  const profile = createLocalRuntimeTownDaemonScenarioProfile(input.profileId);
  const profileDefaults = createLocalRuntimeTownProfileDefaults(profile.profileId);
  const policies = input.policies ?? createLocalRuntimeTownProfileWorldPolicies();
  const strategicPlanCompiler =
    input.agentProvider === undefined
      ? (input.strategicPlanCompiler ??
        createLocalRuntimeTownProfileStrategicPlanCompiler(input.llmPlanning) ??
        profileDefaults.strategicPlanCompiler)
      : undefined;
  const dailyPlanCompiler =
    input.agentProvider === undefined
      ? (input.dailyPlanCompiler ??
        createLocalRuntimeTownProfileDailyPlanCompiler(input.dailyPlanning))
      : undefined;
  const reactionEvaluator =
    input.reactionEvaluator ??
    createLocalRuntimeTownProfileReactionEvaluator(input.reactionPlanning);
  const subtaskPrioritizer =
    input.subtaskPrioritizer ??
    createLocalRuntimeTownProfileSubtaskPrioritizer(input.subtaskPrioritization);
  const actionSequenceGenerator =
    input.actionSequenceGenerator ??
    createLocalRuntimeTownProfileActionSequenceGenerator(input.actionSequenceGeneration);
  const socialDialogueGenerator =
    input.socialDialogueGenerator ??
    createLocalRuntimeTownProfileSocialDialogueGenerator(input.socialDialogue);
  const globalSynthesizer =
    input.globalSynthesizer ??
    createLocalRuntimeTownProfileGlobalSynthesizer(input.globalSynthesis);
  const reactiveCorrector =
    input.reactiveCorrector ??
    createLocalRuntimeTownProfileReactiveCorrector(input.reactiveCorrection);
  const replanningDecider =
    input.replanningDecider ??
    createLocalRuntimeTownProfileReplanningDecider(input.replanningDecision);
  const reflectiveInsightSynthesizer =
    input.reflectiveInsightSynthesizer ??
    createLocalRuntimeTownProfileReflectiveInsightSynthesizer(input.reflectionSynthesis);
  const socialModelSynthesizer =
    input.socialModelSynthesizer ??
    createLocalRuntimeTownProfileSocialModelSynthesizer(input.socialModelSynthesis);
  const memoryConsolidationSchedule = createProfileMemoryConsolidationSchedule({
    schedule: input.memoryConsolidationSchedule,
    reflectiveInsightSynthesizer,
    socialModelSynthesizer,
  });
  const replanningPolicy = input.replanningPolicy ?? profileDefaults.replanningPolicy;
  const agentProvider =
    input.agentProvider ??
    createLocalRuntimeTownProfileAgentProvider({
      policies,
      ...(input.domainConfig === undefined ? {} : { domainConfig: input.domainConfig }),
      ...(input.actionSynthesis === undefined ? {} : { actionSynthesis: input.actionSynthesis }),
      ...(strategicPlanCompiler === undefined ? {} : { strategicPlanCompiler }),
      ...(dailyPlanCompiler === undefined ? {} : { dailyPlanCompiler }),
      ...(replanningPolicy === undefined ? {} : { replanningPolicy }),
      ...(subtaskPrioritizer === undefined ? {} : { subtaskPrioritizer }),
      ...(actionSequenceGenerator === undefined ? {} : { actionSequenceGenerator }),
      ...(socialDialogueGenerator === undefined ? {} : { socialDialogueGenerator }),
      ...(globalSynthesizer === undefined ? {} : { globalSynthesizer }),
      ...(reactiveCorrector === undefined ? {} : { reactiveCorrector }),
      ...(replanningDecider === undefined ? {} : { replanningDecider }),
      ...(input.agentMemoryRetrievalLimit === undefined
        ? {}
        : { memoryRetrievalLimit: input.agentMemoryRetrievalLimit }),
      ...(input.agentMemoryRetrievalCandidateLimit === undefined
        ? {}
        : { memoryRetrievalCandidateLimit: input.agentMemoryRetrievalCandidateLimit }),
    });
  const profileRunOperationId = createProfileRunOperationId({
    manifestId: profile.manifest.id,
    requestedAt: input.requestedAt,
    ...(input.runIdSuffix === undefined ? {} : { runIdSuffix: input.runIdSuffix }),
  });
  const runtime = await createLocalRuntimeTownApi({
    rootDir: input.rootDir,
    bootstrappedAt: input.requestedAt,
    manifest: profile.manifest,
    scenarioPresets: profile.scenarioPresets,
    policies,
    localizedPlanners: [],
    steeringSimulator:
      input.steeringSimulator ?? (({ action }) => ({ status: 'accepted', action })),
    agents: [],
    agentProvider,
    runtimeRunQueue: profile.runtimeRunQueue,
    runtimeScheduler: profile.runtimeScheduler,
    runtimeRecovery: profile.runtimeRecovery,
    ...(memoryConsolidationSchedule === undefined ? {} : { memoryConsolidationSchedule }),
    ...(input.profileRunReportRepository === undefined
      ? {}
      : { runtimeProfileRunReports: input.profileRunReportRepository }),
    ...(reactionEvaluator === undefined
      ? {}
      : { ambientObservationMemory: { enabled: true, reactionEvaluator } }),
  });
  if (input.preseedMarketPriceIndex === true) {
    preseedRuntimeMarketPriceIndices({
      runtime,
      baselineAt: input.requestedAt,
      issuedAt: input.requestedAt,
      appendIdempotencyKeyPrefix: profileRunOperationId,
    });
  }
  const run = await runtime.supervisor.runCycles({
    operationId: profileRunOperationId,
    requestedAt: input.requestedAt,
    cycleCount: input.cycleCount,
    ...(input.cycleIntervalMs === undefined ? {} : { cycleIntervalMs: input.cycleIntervalMs }),
  });
  const cycleOperationTraces = (
    await Promise.all(
      run.cycles.map((cycle) => runtime.supervisor.getOperationTrace(cycle.traceId)),
    )
  ).flatMap((trace) => (trace === undefined ? [] : [trace]));
  const daemonStatus = await runtime.runtimeDaemonApi.getRuntimeDaemonStatus();
  const partitionResults = await Promise.all(
    runtime.host.partitions.map(async (partition) => {
      const backend = runtime.host.registry.getBackend({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
      });
      const projection = await backend.projectionQueries.getProjection({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
      });
      const traces = await backend.storage.agentCycleTraceRepository.query({
        simulationId: partition.simulationId,
      });
      const [objectiveRenewalTraces, dailyPlanRenewalTraces, reactionEvaluationTraces] =
        await Promise.all([
          backend.storage.objectiveRenewalTraceRepository.query({
            simulationId: partition.simulationId,
            partitionKey: partition.partitionKey,
          }),
          backend.storage.dailyPlanRenewalTraceRepository.query({
            simulationId: partition.simulationId,
            partitionKey: partition.partitionKey,
          }),
          backend.storage.reactionEvaluationTraceRepository.query({
            simulationId: partition.simulationId,
            partitionKey: partition.partitionKey,
          }),
        ]);
      const status = run.status.partitions.find(
        (candidate) =>
          candidate.simulationId === partition.simulationId &&
          candidate.partitionKey === partition.partitionKey,
      );

      const summary: LocalRuntimeTownProfileRunnerPartitionSummary = {
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        scenarioPresetId: partition.scenarioPresetId,
        status: status?.status ?? 'unknown',
        health: status?.health ?? 'attention',
        lastAppliedSequence: projection.lastAppliedSequence,
        streamVersion: projection.streamVersion,
        eventCount: backend.storage.eventStore.getStreamVersion(
          backend.storage.partition.eventStreamName,
        ),
        projectionAgentCount: Object.keys(projection.projection.agents).length,
        agentTraceCount: traces.length,
      };
      return {
        summary,
        traces,
        objectiveRenewalTraces,
        dailyPlanRenewalTraces,
        reactionEvaluationTraces,
      };
    }),
  );
  const partitions = partitionResults.map((result) => result.summary);
  const agentCycleDiagnostics = createRuntimeProfileAgentCycleDiagnostics(
    partitionResults.flatMap((result) => result.traces),
  );
  const cognitionLlmStageDiagnostics = createRuntimeProfileCognitionLlmStageDiagnostics({
    objectiveRenewalTraces: partitionResults.flatMap((result) => result.objectiveRenewalTraces),
    dailyPlanRenewalTraces: partitionResults.flatMap((result) => result.dailyPlanRenewalTraces),
    reactionEvaluationTraces: partitionResults.flatMap((result) => result.reactionEvaluationTraces),
    reflectionSynthesisTraces: collectReflectionSynthesisTraces(cycleOperationTraces),
    socialModelSynthesisTraces: collectSocialModelSynthesisTraces(cycleOperationTraces),
  });

  const baseSummary: Omit<LocalRuntimeTownProfileRunnerSummary, 'experimentValidationReports'> = {
    profileId: profile.profileId,
    manifestId: profile.manifest.id,
    rootDir: input.rootDir,
    requestedAt: input.requestedAt,
    daemonHealth: daemonStatus.health,
    partitionCount: partitions.length,
    totalProjectionAgentCount: sumBy(partitions, (partition) => partition.projectionAgentCount),
    totalEventCount: sumBy(partitions, (partition) => partition.eventCount),
    totalAgentTraceCount: sumBy(partitions, (partition) => partition.agentTraceCount),
    agentCycleDiagnostics,
    cognitionLlmStageDiagnostics,
    run: {
      traceId: run.traceId,
      outcome: run.outcome,
      requestedCycleCount: run.requestedCycleCount,
      completedCycleCount: run.completedCycleCount,
      stopReason: run.stopReason,
    },
    partitions,
  };
  const reportGeneratedAt = input.reportGeneratedAt ?? Date.now();

  if (input.profileRunReportRepository !== undefined) {
    await input.profileRunReportRepository.record(
      createRuntimeProfileRunReport({
        runId: baseSummary.run.traceId,
        profileId: baseSummary.profileId,
        manifestId: baseSummary.manifestId,
        rootDir: baseSummary.rootDir,
        generatedAt: reportGeneratedAt,
        requestedAt: baseSummary.requestedAt,
        daemonHealth: baseSummary.daemonHealth,
        outcome: baseSummary.run.outcome,
        requestedCycleCount: baseSummary.run.requestedCycleCount,
        completedCycleCount: baseSummary.run.completedCycleCount,
        stopReason: baseSummary.run.stopReason,
        partitionCount: baseSummary.partitionCount,
        totalProjectionAgentCount: baseSummary.totalProjectionAgentCount,
        totalEventCount: baseSummary.totalEventCount,
        totalAgentTraceCount: baseSummary.totalAgentTraceCount,
        agentCycleDiagnostics: baseSummary.agentCycleDiagnostics,
        ...(baseSummary.cognitionLlmStageDiagnostics === undefined
          ? {}
          : { cognitionLlmStageDiagnostics: baseSummary.cognitionLlmStageDiagnostics }),
        partitions: baseSummary.partitions,
        ...(input.plannerExperiment === undefined
          ? {}
          : { plannerExperiment: input.plannerExperiment }),
      }),
    );
  }

  const experimentValidationReports =
    input.experimentValidationSchedule === undefined
      ? []
      : await runProfileExperimentValidationSchedule({
          runtime,
          profileRunId: baseSummary.run.traceId,
          generatedAt: reportGeneratedAt,
          schedule: input.experimentValidationSchedule,
        });

  return {
    ...baseSummary,
    ...(experimentValidationReports.length === 0 ? {} : { experimentValidationReports }),
  };
}

function preseedRuntimeMarketPriceIndices(input: {
  readonly runtime: Awaited<ReturnType<typeof createLocalRuntimeTownApi>>;
  readonly baselineAt: SimulationTimestamp;
  readonly issuedAt: SimulationTimestamp;
  readonly appendIdempotencyKeyPrefix: string;
}): void {
  for (const partition of input.runtime.host.partitions) {
    const backend = input.runtime.host.registry.getBackend({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
    });
    const streamName = backend.storage.partition.eventStreamName;
    recordMarketPriceIndexToEventStream({
      simulationId: backend.storage.partition.simulationId,
      baselineProjection: partition.bootstrap.initialProjection,
      currentProjection: partition.bootstrap.initialProjection,
      baselineAt: input.baselineAt,
      issuedAt: input.issuedAt,
      eventStore: backend.storage.eventStore,
      streamName,
      expectedVersion: backend.storage.eventStore.getStreamVersion(streamName),
      appendIdempotencyKey: `${input.appendIdempotencyKeyPrefix}:${partition.partitionKey}:preseed-market-price-index`,
    });
  }
}

async function runProfileExperimentValidationSchedule(input: {
  readonly runtime: Awaited<ReturnType<typeof createLocalRuntimeTownApi>>;
  readonly profileRunId: string;
  readonly generatedAt: SimulationTimestamp;
  readonly schedule: LocalRuntimeTownProfileExperimentValidationSchedule;
}): Promise<LocalRuntimeTownProfileExperimentValidationReportSummary[]> {
  const { runIdPrefix, source, ...schedule } = input.schedule;
  const reports = await Promise.all(
    input.runtime.host.partitions.map(async (partition) => {
      const backend = input.runtime.host.registry.getBackend({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
      });
      const result = await runLocalExperimentValidationSchedule({
        storage: backend.storage,
        initialProjection: partition.bootstrap.initialProjection,
        runId: createProfileExperimentValidationRunId({
          profileRunId: input.profileRunId,
          partitionKey: partition.partitionKey,
          ...(runIdPrefix === undefined ? {} : { runIdPrefix }),
        }),
        generatedAt: input.generatedAt,
        source: source ?? 'local-runtime-profile-validation',
        ...schedule,
      });

      return createProfileExperimentValidationReportSummary({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        result,
      });
    }),
  );
  return reports.sort((left, right) => {
    if (left.simulationId !== right.simulationId) {
      return left.simulationId.localeCompare(right.simulationId);
    }
    return left.partitionKey.localeCompare(right.partitionKey);
  });
}

function createProfileExperimentValidationReportSummary(input: {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly result: Awaited<ReturnType<typeof runLocalExperimentValidationSchedule>>;
}): LocalRuntimeTownProfileExperimentValidationReportSummary {
  return {
    simulationId: input.simulationId,
    partitionKey: input.partitionKey,
    runId: input.result.report.run.runId,
    generatedAt: input.result.report.run.generatedAt,
    ...(input.result.report.run.source === undefined
      ? {}
      : { source: input.result.report.run.source }),
    ...(input.result.reportGate === undefined
      ? {}
      : {
          gateStatus: input.result.reportGate.status,
          gateFailureCount: input.result.reportGate.failureCount,
        }),
    metricStatusCounts: countExperimentValidationMetricStatuses(input.result.report.metrics),
    metrics: summarizeExperimentValidationMetrics(input.result.report.metrics),
    streamVersion: input.result.streamVersion,
    fromSequence: input.result.fromSequence,
    toSequence: input.result.toSequence,
    eventCount: input.result.eventCount,
    projectionSequence: input.result.projectionSequence,
  };
}

function summarizeExperimentValidationMetrics(
  metrics: readonly ExperimentValidationMetric[],
): readonly LocalRuntimeTownProfileExperimentValidationMetricSummary[] {
  return metrics.map((metric) => ({
    id: metric.id,
    label: metric.label,
    status: metric.status,
    value: metric.value,
    unit: metric.unit,
    evidence: { ...metric.evidence },
  }));
}

function countExperimentValidationMetricStatuses(
  metrics: readonly ExperimentValidationMetric[],
): LocalRuntimeTownProfileExperimentValidationReportSummary['metricStatusCounts'] {
  const counts: Record<ExperimentValidationMetric['status'], number> = {
    pass: 0,
    watch: 0,
    fail: 0,
  };
  for (const metric of metrics) {
    counts[metric.status] += 1;
  }
  return counts;
}

function createProfileExperimentValidationRunId(input: {
  readonly profileRunId: string;
  readonly partitionKey: PartitionKey;
  readonly runIdPrefix?: string;
}): string {
  const prefix = input.runIdPrefix ?? input.profileRunId;
  assertNonEmpty(prefix, 'experimentValidationSchedule runIdPrefix');
  return `${prefix}:${input.partitionKey}:experiment-validation`;
}

function collectReflectionSynthesisTraces(
  operationTraces: readonly LocalSimulationRuntimeOperationTrace[],
) {
  return operationTraces.flatMap((trace) =>
    trace.partitions.flatMap((partition) =>
      partition.outcome !== 'succeeded'
        ? []
        : (partition.memoryConsolidation?.reflectionSynthesisTraces ?? []),
    ),
  );
}

function collectSocialModelSynthesisTraces(
  operationTraces: readonly LocalSimulationRuntimeOperationTrace[],
) {
  return operationTraces.flatMap((trace) =>
    trace.partitions.flatMap((partition) =>
      partition.outcome !== 'succeeded'
        ? []
        : (partition.memoryConsolidation?.socialModelSynthesisTraces ?? []),
    ),
  );
}

function createProfileRunOperationId(input: {
  readonly manifestId: string;
  readonly requestedAt: SimulationTimestamp;
  readonly runIdSuffix?: string;
}): string {
  const base = `${input.manifestId}:profile-run:${input.requestedAt}`;
  return input.runIdSuffix === undefined ? base : `${base}:${input.runIdSuffix}`;
}

function createProfileMemoryConsolidationSchedule(input: {
  readonly schedule: LocalSimulationLifecycleMemoryConsolidationSchedule | undefined;
  readonly reflectiveInsightSynthesizer: ReflectiveInsightSynthesizer | undefined;
  readonly socialModelSynthesizer: SocialModelSynthesizer | undefined;
}): LocalSimulationLifecycleMemoryConsolidationSchedule | undefined {
  const hasReflectiveInsightSynthesizer = input.reflectiveInsightSynthesizer !== undefined;
  const hasSocialModelSynthesizer = input.socialModelSynthesizer !== undefined;
  if (input.schedule === undefined) {
    if (!hasReflectiveInsightSynthesizer && !hasSocialModelSynthesizer) {
      return undefined;
    }
    return {
      retrievalLimit: 10,
      minPatternCount: 1,
      ...(hasReflectiveInsightSynthesizer
        ? { reflectiveInsightSynthesizer: input.reflectiveInsightSynthesizer }
        : {}),
      ...(hasSocialModelSynthesizer
        ? { socialModelSynthesizer: input.socialModelSynthesizer }
        : {}),
    };
  }
  const shouldInjectReflectiveInsightSynthesizer =
    input.schedule.reflectiveInsightSynthesizer === undefined && hasReflectiveInsightSynthesizer;
  const shouldInjectSocialModelSynthesizer =
    input.schedule.socialModelSynthesizer === undefined && hasSocialModelSynthesizer;
  if (!shouldInjectReflectiveInsightSynthesizer && !shouldInjectSocialModelSynthesizer) {
    return input.schedule;
  }
  return {
    ...input.schedule,
    ...(!shouldInjectReflectiveInsightSynthesizer
      ? {}
      : { reflectiveInsightSynthesizer: input.reflectiveInsightSynthesizer }),
    ...(!shouldInjectSocialModelSynthesizer
      ? {}
      : { socialModelSynthesizer: input.socialModelSynthesizer }),
  };
}

export function createLocalRuntimeTownProfileAgentProvider(
  input: {
    readonly policies?: WorldCommandPolicySource;
    readonly domainConfig?: CanonicalDomainRuntimeConfig;
    readonly actionSynthesis?: WorldStateActionSynthesisPolicyConfig | false;
    readonly strategicPlanCompiler?: StrategicPlanCompiler;
    readonly dailyPlanCompiler?: DailyPlanCompiler;
    readonly replanningPolicy?: AdaptiveReplanningPolicy;
    readonly subtaskPrioritizer?: SubtaskPrioritizer;
    readonly actionSequenceGenerator?: ActionSequenceGenerator;
    readonly socialDialogueGenerator?: SocialDialogueGenerator;
    readonly globalSynthesizer?: GlobalActionSynthesizer;
    readonly reactiveCorrector?: ReactiveCorrector;
    readonly replanningDecider?: ReplanningDecider;
    readonly memoryRetrievalLimit?: number;
    readonly memoryRetrievalCandidateLimit?: number;
  } = {},
): LocalWorldRuntimeAgentProvider {
  const policies = input.policies ?? createLocalRuntimeTownProfileWorldPolicies();
  const memoryRetrievalLimit =
    input.memoryRetrievalLimit ?? DEFAULT_PROFILE_AGENT_MEMORY_RETRIEVAL_LIMIT;

  return async ({ storage, projection, issuedAt }) => {
    await completeFinishedActiveObjectives({
      projection,
      intentionRepository: storage.intentionRepository,
      planRepository: storage.planRepository,
      planProgressRepository: storage.planProgressRepository,
      completedAt: issuedAt,
    });
    if (input.dailyPlanCompiler !== undefined) {
      await renewDailyPlanScheduledIntentions({
        projection,
        policies,
        intentionRepository: storage.intentionRepository,
        longTermProfileRepository: storage.longTermProfileRepository,
        shortTermMemoryRepository: storage.shortTermMemoryRepository,
        issuedAt,
        compileDailyPlan: input.dailyPlanCompiler,
        dailyPlanRenewalTraceScope: {
          simulationId: storage.partition.simulationId,
          partitionKey: storage.partition.partitionKey,
        },
        dailyPlanRenewalTraceSink: storage.dailyPlanRenewalTraceRepository,
      });
    }
    await renewMissingActiveObjectives({
      projection,
      policies,
      intentionRepository: storage.intentionRepository,
      longTermProfileRepository: storage.longTermProfileRepository,
      shortTermMemoryRepository: storage.shortTermMemoryRepository,
      planRepository: storage.planRepository,
      issuedAt,
      objectiveRenewalTraceSink: {
        record: (trace) =>
          storage.objectiveRenewalTraceRepository.record(
            createProfileObjectiveRenewalTrace({
              simulationId: storage.partition.simulationId,
              partitionKey: storage.partition.partitionKey,
              trace,
            }),
          ),
      },
      ...(input.strategicPlanCompiler === undefined
        ? {}
        : { strategicPlanCompiler: input.strategicPlanCompiler }),
    });

    return buildWorkerTickAgentsFromActivePlans({
      projection,
      intentionRepository: storage.intentionRepository,
      planRepository: storage.planRepository,
      planProgressRepository: storage.planProgressRepository,
      memoryRetrievalLimit,
      ...(input.memoryRetrievalCandidateLimit === undefined
        ? {}
        : { memoryRetrievalCandidateLimit: input.memoryRetrievalCandidateLimit }),
      policies,
      resolveRuntime: createCanonicalWorkerRuntimeResolver({
        simulationId: storage.partition.simulationId,
        policies,
        ...(input.domainConfig === undefined ? {} : { domainConfig: input.domainConfig }),
        ...(input.actionSynthesis === undefined ? {} : { actionSynthesis: input.actionSynthesis }),
        issuedAt,
        commandIdPrefix: `${storage.partition.partitionKey}:profile-provider:${issuedAt}`,
        ...(input.replanningPolicy === undefined
          ? {}
          : { replanningPolicy: input.replanningPolicy }),
        ...(input.subtaskPrioritizer === undefined
          ? {}
          : { subtaskPrioritizer: input.subtaskPrioritizer }),
        ...(input.actionSequenceGenerator === undefined
          ? {}
          : { actionSequenceGenerator: input.actionSequenceGenerator }),
        ...(input.socialDialogueGenerator === undefined
          ? {}
          : { socialDialogueGenerator: input.socialDialogueGenerator }),
        ...(input.globalSynthesizer === undefined
          ? {}
          : { globalSynthesizer: input.globalSynthesizer }),
        ...(input.reactiveCorrector === undefined
          ? {}
          : { reactiveCorrector: input.reactiveCorrector }),
        ...(input.replanningDecider === undefined
          ? {}
          : { replanningDecider: input.replanningDecider }),
      }),
    });
  };
}

function createProfileObjectiveRenewalTrace(input: {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly trace: ObjectiveRenewalDecisionTrace;
}): ObjectiveRenewalTrace {
  return {
    traceId: `${input.simulationId}:${input.partitionKey}:${input.trace.agentId}:${input.trace.objectiveId}:${input.trace.issuedAt}`,
    simulationId: input.simulationId,
    partitionKey: input.partitionKey,
    agentId: input.trace.agentId,
    objectiveId: input.trace.objectiveId,
    selectedCandidateId: input.trace.selectedCandidateId,
    rationale: input.trace.rationale,
    score: input.trace.score,
    shortTermMemoryContextIds: [...input.trace.shortTermMemoryContextIds],
    profileEntryKeys: [...input.trace.profileEntryKeys],
    profileEvidenceRecordIds: [...input.trace.profileEvidenceRecordIds],
    ...(input.trace.scheduledIntentionIds === undefined
      ? {}
      : { scheduledIntentionIds: [...input.trace.scheduledIntentionIds] }),
    ...(input.trace.strategicPlan === undefined
      ? {}
      : { strategicPlan: input.trace.strategicPlan }),
    issuedAt: input.trace.issuedAt,
  };
}

export function createLocalRuntimeTownProfileWorldPolicies(): WorldCommandPolicyResolver {
  return createAivilizationWorldCommandPolicies();
}

function sumBy<TValue>(values: readonly TValue[], project: (value: TValue) => number): number {
  return values.reduce((total, value) => total + project(value), 0);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}
