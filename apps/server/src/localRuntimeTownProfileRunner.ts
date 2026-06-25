import type {
  AdaptiveReplanningPolicy,
  ActionSequenceGenerator,
  DailyPlanCompiler,
  GlobalActionSynthesizer,
  ReactionEvaluator,
  ReactiveCorrector,
  SocialDialogueGenerator,
  StrategicPlanCompiler,
  SubtaskPrioritizer,
} from '@aivilization/agent-runtime';
import type { ReflectiveInsightSynthesizer, SocialModelSynthesizer } from '@aivilization/memory';
import {
  createRuntimeProfileAgentCycleDiagnostics,
  createRuntimeProfileCognitionLlmStageDiagnostics,
  createRuntimeProfileRunReport,
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
  type ObjectiveRenewalDecisionTrace,
  type LocalWorldRuntimeAgentProvider,
  type LocalSimulationLifecycleMemoryConsolidationSchedule,
  type LocalSimulationRuntimeOperationTrace,
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
  createLocalRuntimeTownProfileSocialDialogueGenerator,
  createLocalRuntimeTownProfileSocialModelSynthesizer,
  createLocalRuntimeTownProfileStrategicPlanCompiler,
  createLocalRuntimeTownProfileSubtaskPrioritizer,
  type LocalRuntimeTownProfileActionSequenceGeneratorConfig,
  type LocalRuntimeTownProfileDailyCompilerConfig,
  type LocalRuntimeTownProfileGlobalSynthesizerConfig,
  type LocalRuntimeTownProfileReactiveCorrectorConfig,
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
  readonly agentProvider?: LocalWorldRuntimeAgentProvider;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly dailyPlanCompiler?: DailyPlanCompiler;
  readonly reactionEvaluator?: ReactionEvaluator;
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly actionSequenceGenerator?: ActionSequenceGenerator;
  readonly socialDialogueGenerator?: SocialDialogueGenerator;
  readonly globalSynthesizer?: GlobalActionSynthesizer;
  readonly reactiveCorrector?: ReactiveCorrector;
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
  readonly reflectionSynthesis?: LocalRuntimeTownProfileReflectiveInsightSynthesizerConfig;
  readonly socialModelSynthesis?: LocalRuntimeTownProfileSocialModelSynthesizerConfig;
  readonly memoryConsolidationSchedule?: LocalSimulationLifecycleMemoryConsolidationSchedule;
  readonly profileRunReportRepository?: RuntimeProfileRunReportRepository;
  readonly plannerExperiment?: RuntimeProfilePlannerExperiment;
  readonly reportGeneratedAt?: SimulationTimestamp;
  readonly agentMemoryRetrievalLimit?: number;
  readonly agentMemoryRetrievalCandidateLimit?: number;
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
      ...(strategicPlanCompiler === undefined ? {} : { strategicPlanCompiler }),
      ...(dailyPlanCompiler === undefined ? {} : { dailyPlanCompiler }),
      ...(replanningPolicy === undefined ? {} : { replanningPolicy }),
      ...(subtaskPrioritizer === undefined ? {} : { subtaskPrioritizer }),
      ...(actionSequenceGenerator === undefined ? {} : { actionSequenceGenerator }),
      ...(socialDialogueGenerator === undefined ? {} : { socialDialogueGenerator }),
      ...(globalSynthesizer === undefined ? {} : { globalSynthesizer }),
      ...(reactiveCorrector === undefined ? {} : { reactiveCorrector }),
      ...(input.agentMemoryRetrievalLimit === undefined
        ? {}
        : { memoryRetrievalLimit: input.agentMemoryRetrievalLimit }),
      ...(input.agentMemoryRetrievalCandidateLimit === undefined
        ? {}
        : { memoryRetrievalCandidateLimit: input.agentMemoryRetrievalCandidateLimit }),
    });
  const runtime = await createLocalRuntimeTownApi({
    rootDir: input.rootDir,
    bootstrappedAt: input.requestedAt,
    manifest: profile.manifest,
    scenarioPresets: profile.scenarioPresets,
    policies,
    localizedPlanners: [],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
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
  const run = await runtime.supervisor.runCycles({
    operationId: createProfileRunOperationId({
      manifestId: profile.manifest.id,
      requestedAt: input.requestedAt,
      ...(input.runIdSuffix === undefined ? {} : { runIdSuffix: input.runIdSuffix }),
    }),
    requestedAt: input.requestedAt,
    cycleCount: input.cycleCount,
    ...(input.cycleIntervalMs === undefined ? {} : { cycleIntervalMs: input.cycleIntervalMs }),
  });
  const cycleOperationTraces = (
    await Promise.all(run.cycles.map((cycle) => runtime.supervisor.getOperationTrace(cycle.traceId)))
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

  const summary: LocalRuntimeTownProfileRunnerSummary = {
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

  if (input.profileRunReportRepository !== undefined) {
    await input.profileRunReportRepository.record(
      createRuntimeProfileRunReport({
        runId: summary.run.traceId,
        profileId: summary.profileId,
        manifestId: summary.manifestId,
        rootDir: summary.rootDir,
        generatedAt: input.reportGeneratedAt ?? Date.now(),
        requestedAt: summary.requestedAt,
        daemonHealth: summary.daemonHealth,
        outcome: summary.run.outcome,
        requestedCycleCount: summary.run.requestedCycleCount,
        completedCycleCount: summary.run.completedCycleCount,
        stopReason: summary.run.stopReason,
        partitionCount: summary.partitionCount,
        totalProjectionAgentCount: summary.totalProjectionAgentCount,
        totalEventCount: summary.totalEventCount,
        totalAgentTraceCount: summary.totalAgentTraceCount,
        agentCycleDiagnostics: summary.agentCycleDiagnostics,
        ...(summary.cognitionLlmStageDiagnostics === undefined
          ? {}
          : { cognitionLlmStageDiagnostics: summary.cognitionLlmStageDiagnostics }),
        partitions: summary.partitions,
        ...(input.plannerExperiment === undefined
          ? {}
          : { plannerExperiment: input.plannerExperiment }),
      }),
    );
  }

  return summary;
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
  if (input.schedule === undefined) {
    return undefined;
  }
  const shouldInjectReflectiveInsightSynthesizer =
    input.schedule.reflectiveInsightSynthesizer === undefined &&
    input.reflectiveInsightSynthesizer !== undefined;
  const shouldInjectSocialModelSynthesizer =
    input.schedule.socialModelSynthesizer === undefined &&
    input.socialModelSynthesizer !== undefined;
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
    readonly strategicPlanCompiler?: StrategicPlanCompiler;
    readonly dailyPlanCompiler?: DailyPlanCompiler;
    readonly replanningPolicy?: AdaptiveReplanningPolicy;
    readonly subtaskPrioritizer?: SubtaskPrioritizer;
    readonly actionSequenceGenerator?: ActionSequenceGenerator;
    readonly socialDialogueGenerator?: SocialDialogueGenerator;
    readonly globalSynthesizer?: GlobalActionSynthesizer;
    readonly reactiveCorrector?: ReactiveCorrector;
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
      resolveRuntime: createCanonicalWorkerRuntimeResolver({
        simulationId: storage.partition.simulationId,
        policies,
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
