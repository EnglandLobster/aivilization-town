import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PartitionKey } from '@aivilization/sim-core';
import type { AgentCycleTrace } from './agentCycleTrace';
import type { DailyPlanRenewalTrace } from './dailyPlanRenewalTraceRepository';
import type { PlannerExperimentMetric, PlannerExperimentRun } from './experimentValidation';
import type { ObjectiveRenewalTrace } from './objectiveRenewalTraceRepository';
import type { ReactionEvaluationTrace } from './reactionEvaluationTraceRepository';

export type RuntimeProfileRunPartitionReport = {
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

export type RuntimeProfileRunReport = {
  readonly runId: string;
  readonly profileId: string;
  readonly manifestId: string;
  readonly rootDir: string;
  readonly generatedAt: number;
  readonly requestedAt: number;
  readonly daemonHealth: string;
  readonly outcome: string;
  readonly requestedCycleCount: number;
  readonly completedCycleCount: number;
  readonly stopReason: string;
  readonly partitionCount: number;
  readonly totalProjectionAgentCount: number;
  readonly totalEventCount: number;
  readonly totalAgentTraceCount: number;
  readonly agentCycleDiagnostics: RuntimeProfileAgentCycleDiagnostics;
  readonly cognitionLlmStageDiagnostics?: readonly RuntimeProfileCognitionLlmStageDiagnostics[];
  readonly partitions: readonly RuntimeProfileRunPartitionReport[];
  readonly plannerExperiment?: RuntimeProfilePlannerExperiment;
};

export type RuntimeProfileAgentCycleLlmStageName =
  | 'contextualPrioritization'
  | 'actionSequenceGeneration'
  | 'socialDialogueGeneration'
  | 'globalSynthesis'
  | 'reactiveCorrection';

export type RuntimeProfileAgentCycleLlmStageDiagnostics = {
  readonly stageName: RuntimeProfileAgentCycleLlmStageName;
  readonly traceCount: number;
  readonly llmAcceptedCount: number;
  readonly deterministicFallbackCount: number;
  readonly deterministicCount: number;
  readonly missingCycleCount: number;
};

export type RuntimeProfileAgentCycleDiagnostics = {
  readonly traceCount: number;
  readonly acceptedSimulatorCount: number;
  readonly repairedSimulatorCount: number;
  readonly rejectedSimulatorCount: number;
  readonly replanningDecisionCount: number;
  readonly simulatorEventTraceCount: number;
  readonly simulatorEventCount: number;
  readonly commandEmittingCycleCount: number;
  readonly fullReplanMaterializationCount: number;
  readonly commandEmittingCycleRatio: number;
  readonly fullReplanMaterializationRatio: number;
  readonly repairedSimulatorRatio: number;
  readonly rejectedSimulatorRatio: number;
  readonly replanningDecisionRatio: number;
  readonly llmStageDiagnostics?: readonly RuntimeProfileAgentCycleLlmStageDiagnostics[];
};

export type RuntimeProfileCognitionLlmStageName =
  | 'strategicPlanning'
  | 'dailyPlanning'
  | 'reactionEvaluation';

export type RuntimeProfileCognitionLlmStageDiagnostics = {
  readonly stageName: RuntimeProfileCognitionLlmStageName;
  readonly traceCount: number;
  readonly llmAcceptedCount: number;
  readonly deterministicFallbackCount: number;
  readonly deterministicCount: number;
  readonly missingProviderTraceCount: number;
};

export type RuntimeProfilePlannerExperiment = {
  readonly taskId: string;
  readonly variant: string;
  readonly metrics: readonly PlannerExperimentMetric[];
};

export type RuntimeProfileRunReportQuery = {
  readonly runId?: string;
  readonly profileId?: string;
  readonly fromGeneratedAt?: number;
  readonly toGeneratedAt?: number;
  readonly limit?: number;
};

export type RuntimeProfileRunReportRepository = {
  readonly record: (report: RuntimeProfileRunReport) => Promise<void>;
  readonly get: (runId: string) => Promise<RuntimeProfileRunReport | undefined>;
  readonly query: (query: RuntimeProfileRunReportQuery) => Promise<RuntimeProfileRunReport[]>;
};

export class InMemoryRuntimeProfileRunReportRepository implements RuntimeProfileRunReportRepository {
  private readonly reportsByRunId = new Map<string, RuntimeProfileRunReport>();

  record(report: RuntimeProfileRunReport): Promise<void> {
    assertNonEmpty(report.runId, 'runId');
    if (!this.reportsByRunId.has(report.runId)) {
      this.reportsByRunId.set(report.runId, createRuntimeProfileRunReport(report));
    }
    return Promise.resolve();
  }

  get(runId: string): Promise<RuntimeProfileRunReport | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(runId, 'runId');
      const report = this.reportsByRunId.get(runId);
      return report === undefined ? undefined : createRuntimeProfileRunReport(report);
    });
  }

  query(query: RuntimeProfileRunReportQuery): Promise<RuntimeProfileRunReport[]> {
    return Promise.resolve().then(() => queryReports([...this.reportsByRunId.values()], query));
  }
}

export class FileRuntimeProfileRunReportRepository implements RuntimeProfileRunReportRepository {
  private readonly reportsPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.reportsPath = join(input.rootDir, 'runtime-profile-runs.jsonl');
    ensureFile(this.reportsPath, input.rootDir);
  }

  async record(report: RuntimeProfileRunReport): Promise<void> {
    if ((await this.get(report.runId)) !== undefined) {
      return;
    }
    appendJsonLines(this.reportsPath, [createRuntimeProfileRunReport(report)]);
  }

  get(runId: string): Promise<RuntimeProfileRunReport | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(runId, 'runId');
      const report = readJsonLines<RuntimeProfileRunReport>(this.reportsPath).find(
        (candidate) => candidate.runId === runId,
      );
      return report === undefined ? undefined : createRuntimeProfileRunReport(report);
    });
  }

  query(query: RuntimeProfileRunReportQuery): Promise<RuntimeProfileRunReport[]> {
    return Promise.resolve().then(() =>
      queryReports(readJsonLines<RuntimeProfileRunReport>(this.reportsPath), query),
    );
  }
}

export function createRuntimeProfileRunReport(
  input: RuntimeProfileRunReport,
): RuntimeProfileRunReport {
  validateReport(input);
  return {
    runId: input.runId,
    profileId: input.profileId,
    manifestId: input.manifestId,
    rootDir: input.rootDir,
    generatedAt: input.generatedAt,
    requestedAt: input.requestedAt,
    daemonHealth: input.daemonHealth,
    outcome: input.outcome,
    requestedCycleCount: input.requestedCycleCount,
    completedCycleCount: input.completedCycleCount,
    stopReason: input.stopReason,
    partitionCount: input.partitionCount,
    totalProjectionAgentCount: input.totalProjectionAgentCount,
    totalEventCount: input.totalEventCount,
    totalAgentTraceCount: input.totalAgentTraceCount,
    agentCycleDiagnostics: cloneAgentCycleDiagnostics(input.agentCycleDiagnostics),
    ...(input.cognitionLlmStageDiagnostics === undefined
      ? {}
      : {
          cognitionLlmStageDiagnostics: input.cognitionLlmStageDiagnostics.map((stage) => ({
            ...stage,
          })),
        }),
    partitions: input.partitions.map((partition) => ({ ...partition })),
    ...(input.plannerExperiment === undefined
      ? {}
      : { plannerExperiment: clonePlannerExperiment(input.plannerExperiment) }),
  };
}

export function createRuntimeProfileAgentCycleDiagnostics(
  traces: readonly AgentCycleTrace[],
): RuntimeProfileAgentCycleDiagnostics {
  const traceCount = traces.length;
  let acceptedSimulatorCount = 0;
  let repairedSimulatorCount = 0;
  let rejectedSimulatorCount = 0;
  let replanningDecisionCount = 0;
  let simulatorEventTraceCount = 0;
  let simulatorEventCount = 0;
  let commandEmittingCycleCount = 0;
  let fullReplanMaterializationCount = 0;

  for (const trace of traces) {
    if (trace.simulatorResult.status === 'accepted') {
      acceptedSimulatorCount += 1;
    }
    if (trace.simulatorResult.status === 'repaired') {
      repairedSimulatorCount += 1;
    }
    if (trace.simulatorResult.status === 'rejected') {
      rejectedSimulatorCount += 1;
    }
    if (trace.replanningDecision.kind !== 'none') {
      replanningDecisionCount += 1;
    }
    simulatorEventTraceCount += trace.simulatorEvents.length;
    simulatorEventCount += sumBy(trace.simulatorEvents, (entry) => entry.events.length);
    if (trace.emittedCommandIds.length > 0) {
      commandEmittingCycleCount += 1;
    }
    if (trace.replanMaterialization !== undefined) {
      fullReplanMaterializationCount += 1;
    }
  }

  return {
    traceCount,
    acceptedSimulatorCount,
    repairedSimulatorCount,
    rejectedSimulatorCount,
    replanningDecisionCount,
    simulatorEventTraceCount,
    simulatorEventCount,
    commandEmittingCycleCount,
    fullReplanMaterializationCount,
    commandEmittingCycleRatio: ratio(commandEmittingCycleCount, traceCount),
    fullReplanMaterializationRatio: ratio(fullReplanMaterializationCount, traceCount),
    repairedSimulatorRatio: ratio(repairedSimulatorCount, traceCount),
    rejectedSimulatorRatio: ratio(rejectedSimulatorCount, traceCount),
    replanningDecisionRatio: ratio(replanningDecisionCount, traceCount),
    llmStageDiagnostics: createLlmStageDiagnostics(traces),
  };
}

export function createRuntimeProfileCognitionLlmStageDiagnostics(input: {
  readonly objectiveRenewalTraces?: readonly ObjectiveRenewalTrace[];
  readonly dailyPlanRenewalTraces?: readonly DailyPlanRenewalTrace[];
  readonly reactionEvaluationTraces?: readonly ReactionEvaluationTrace[];
}): readonly RuntimeProfileCognitionLlmStageDiagnostics[] {
  const diagnostics = new Map<
    RuntimeProfileCognitionLlmStageName,
    MutableCognitionLlmStageDiagnostics
  >(
    COGNITION_LLM_STAGE_NAMES.map((stageName) => [
      stageName,
      {
        stageName,
        traceCount: 0,
        llmAcceptedCount: 0,
        deterministicFallbackCount: 0,
        deterministicCount: 0,
        missingProviderTraceCount: 0,
      },
    ]),
  );

  const strategic = diagnostics.get('strategicPlanning');
  const daily = diagnostics.get('dailyPlanning');
  const reaction = diagnostics.get('reactionEvaluation');
  if (strategic === undefined || daily === undefined || reaction === undefined) {
    throw new Error('missing cognition LLM stage diagnostics');
  }

  for (const trace of input.objectiveRenewalTraces ?? []) {
    recordCognitionProviderTrace(strategic, trace.strategicPlan);
  }
  for (const trace of input.dailyPlanRenewalTraces ?? []) {
    recordCognitionProviderTrace(daily, trace.planningTrace);
  }
  for (const trace of input.reactionEvaluationTraces ?? []) {
    recordCognitionProviderTrace(reaction, trace.reactionTrace);
  }

  return COGNITION_LLM_STAGE_NAMES.map((stageName) => {
    const stage = diagnostics.get(stageName);
    if (stage === undefined) {
      throw new Error(`missing cognition LLM stage diagnostics for ${stageName}`);
    }
    return { ...stage };
  });
}

export function createPlannerExperimentRunsFromRuntimeProfileReports(
  reports: readonly RuntimeProfileRunReport[],
): PlannerExperimentRun[] {
  return reports
    .flatMap((report) => {
      const validated = createRuntimeProfileRunReport(report);
      if (validated.plannerExperiment === undefined) {
        return [];
      }
      return [
        {
          taskId: validated.plannerExperiment.taskId,
          variant: validated.plannerExperiment.variant,
          metrics: validated.plannerExperiment.metrics.map(clonePlannerExperimentMetric),
        },
      ];
    })
    .sort(comparePlannerExperimentRuns);
}

function queryReports(
  reports: readonly RuntimeProfileRunReport[],
  query: RuntimeProfileRunReportQuery,
): RuntimeProfileRunReport[] {
  assertValidQuery(query);
  return reports
    .filter((report) => query.runId === undefined || report.runId === query.runId)
    .filter((report) => query.profileId === undefined || report.profileId === query.profileId)
    .filter(
      (report) =>
        query.fromGeneratedAt === undefined || report.generatedAt >= query.fromGeneratedAt,
    )
    .filter(
      (report) => query.toGeneratedAt === undefined || report.generatedAt <= query.toGeneratedAt,
    )
    .sort(compareReportLatestFirst)
    .slice(0, query.limit)
    .map((report) => createRuntimeProfileRunReport(report));
}

function compareReportLatestFirst(
  left: RuntimeProfileRunReport,
  right: RuntimeProfileRunReport,
): number {
  if (left.generatedAt !== right.generatedAt) {
    return right.generatedAt - left.generatedAt;
  }
  return right.runId.localeCompare(left.runId);
}

function validateReport(report: RuntimeProfileRunReport): void {
  assertNonEmpty(report.runId, 'runId');
  assertNonEmpty(report.profileId, 'profileId');
  assertNonEmpty(report.manifestId, 'manifestId');
  assertNonEmpty(report.rootDir, 'rootDir');
  assertFinite(report.generatedAt, 'generatedAt');
  assertFinite(report.requestedAt, 'requestedAt');
  assertNonEmpty(report.daemonHealth, 'daemonHealth');
  assertNonEmpty(report.outcome, 'outcome');
  assertNonEmpty(report.stopReason, 'stopReason');
  assertNonNegativeInteger(report.requestedCycleCount, 'requestedCycleCount');
  assertNonNegativeInteger(report.completedCycleCount, 'completedCycleCount');
  assertNonNegativeInteger(report.partitionCount, 'partitionCount');
  assertNonNegativeInteger(report.totalProjectionAgentCount, 'totalProjectionAgentCount');
  assertNonNegativeInteger(report.totalEventCount, 'totalEventCount');
  assertNonNegativeInteger(report.totalAgentTraceCount, 'totalAgentTraceCount');
  if (report.partitionCount !== report.partitions.length) {
    throw new Error('partitionCount must match partitions length');
  }

  let totalProjectionAgentCount = 0;
  let totalEventCount = 0;
  let totalAgentTraceCount = 0;
  for (const partition of report.partitions) {
    validatePartition(partition);
    totalProjectionAgentCount += partition.projectionAgentCount;
    totalEventCount += partition.eventCount;
    totalAgentTraceCount += partition.agentTraceCount;
  }
  if (report.totalProjectionAgentCount !== totalProjectionAgentCount) {
    throw new Error('totalProjectionAgentCount must equal partition projection agent total');
  }
  if (report.totalEventCount !== totalEventCount) {
    throw new Error('totalEventCount must equal partition event total');
  }
  if (report.totalAgentTraceCount !== totalAgentTraceCount) {
    throw new Error('totalAgentTraceCount must equal partition agent trace total');
  }
  validateAgentCycleDiagnostics(report.agentCycleDiagnostics);
  if (report.agentCycleDiagnostics.traceCount !== report.totalAgentTraceCount) {
    throw new Error('agentCycleDiagnostics traceCount must equal totalAgentTraceCount');
  }
  validateCognitionLlmStageDiagnostics(report.cognitionLlmStageDiagnostics);
  if (report.plannerExperiment !== undefined) {
    validatePlannerExperiment(report.plannerExperiment);
  }
}

function validatePartition(partition: RuntimeProfileRunPartitionReport): void {
  assertNonEmpty(partition.simulationId, 'partition simulationId');
  assertNonEmpty(partition.partitionKey, 'partition partitionKey');
  assertNonEmpty(partition.scenarioPresetId, 'partition scenarioPresetId');
  assertNonEmpty(partition.status, 'partition status');
  assertNonEmpty(partition.health, 'partition health');
  assertNonNegativeInteger(partition.lastAppliedSequence, 'partition lastAppliedSequence');
  assertNonNegativeInteger(partition.streamVersion, 'partition streamVersion');
  assertNonNegativeInteger(partition.eventCount, 'partition eventCount');
  assertNonNegativeInteger(partition.projectionAgentCount, 'partition projectionAgentCount');
  assertNonNegativeInteger(partition.agentTraceCount, 'partition agentTraceCount');
}

function assertValidQuery(query: RuntimeProfileRunReportQuery): void {
  if (query.runId !== undefined) {
    assertNonEmpty(query.runId, 'runId');
  }
  if (query.profileId !== undefined) {
    assertNonEmpty(query.profileId, 'profileId');
  }
  if (query.limit !== undefined && (!Number.isFinite(query.limit) || query.limit <= 0)) {
    throw new Error('limit must be positive');
  }
  if (query.fromGeneratedAt !== undefined && !Number.isFinite(query.fromGeneratedAt)) {
    throw new Error('fromGeneratedAt must be finite');
  }
  if (query.toGeneratedAt !== undefined && !Number.isFinite(query.toGeneratedAt)) {
    throw new Error('toGeneratedAt must be finite');
  }
}

function clonePlannerExperiment(
  experiment: RuntimeProfilePlannerExperiment,
): RuntimeProfilePlannerExperiment {
  validatePlannerExperiment(experiment);
  return {
    taskId: experiment.taskId,
    variant: experiment.variant,
    metrics: experiment.metrics.map(clonePlannerExperimentMetric),
  };
}

function cloneAgentCycleDiagnostics(
  diagnostics: RuntimeProfileAgentCycleDiagnostics,
): RuntimeProfileAgentCycleDiagnostics {
  validateAgentCycleDiagnostics(diagnostics);
  return {
    ...diagnostics,
    ...(diagnostics.llmStageDiagnostics === undefined
      ? {}
      : {
          llmStageDiagnostics: diagnostics.llmStageDiagnostics.map((stage) => ({
            ...stage,
          })),
        }),
  };
}

function validateAgentCycleDiagnostics(
  diagnostics: RuntimeProfileAgentCycleDiagnostics | undefined,
): asserts diagnostics is RuntimeProfileAgentCycleDiagnostics {
  if (diagnostics === undefined) {
    throw new Error('agentCycleDiagnostics is required');
  }
  const countFields = [
    'traceCount',
    'acceptedSimulatorCount',
    'repairedSimulatorCount',
    'rejectedSimulatorCount',
    'replanningDecisionCount',
    'simulatorEventTraceCount',
    'simulatorEventCount',
    'commandEmittingCycleCount',
    'fullReplanMaterializationCount',
  ] as const;
  for (const field of countFields) {
    assertNonNegativeInteger(diagnostics[field], `agentCycleDiagnostics ${field}`);
  }
  if (
    diagnostics.acceptedSimulatorCount +
      diagnostics.repairedSimulatorCount +
      diagnostics.rejectedSimulatorCount !==
    diagnostics.traceCount
  ) {
    throw new Error('agentCycleDiagnostics simulator status counts must equal traceCount');
  }
  if (diagnostics.replanningDecisionCount > diagnostics.traceCount) {
    throw new Error('agentCycleDiagnostics replanningDecisionCount must not exceed traceCount');
  }
  if (diagnostics.commandEmittingCycleCount > diagnostics.traceCount) {
    throw new Error('agentCycleDiagnostics commandEmittingCycleCount must not exceed traceCount');
  }
  if (diagnostics.fullReplanMaterializationCount > diagnostics.traceCount) {
    throw new Error(
      'agentCycleDiagnostics fullReplanMaterializationCount must not exceed traceCount',
    );
  }
  const ratioFields = [
    'commandEmittingCycleRatio',
    'fullReplanMaterializationRatio',
    'repairedSimulatorRatio',
    'rejectedSimulatorRatio',
    'replanningDecisionRatio',
  ] as const;
  for (const field of ratioFields) {
    assertRatio(diagnostics[field], `agentCycleDiagnostics ${field}`);
  }
  validateLlmStageDiagnostics(diagnostics);
}

const AGENT_CYCLE_LLM_STAGE_NAMES = [
  'contextualPrioritization',
  'actionSequenceGeneration',
  'socialDialogueGeneration',
  'globalSynthesis',
  'reactiveCorrection',
] as const satisfies readonly RuntimeProfileAgentCycleLlmStageName[];

const COGNITION_LLM_STAGE_NAMES = [
  'strategicPlanning',
  'dailyPlanning',
  'reactionEvaluation',
] as const satisfies readonly RuntimeProfileCognitionLlmStageName[];

type AgentCycleLlmStageTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
};

type CognitionLlmStageTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
};

type MutableLlmStageDiagnostics = {
  stageName: RuntimeProfileAgentCycleLlmStageName;
  traceCount: number;
  llmAcceptedCount: number;
  deterministicFallbackCount: number;
  deterministicCount: number;
  missingCycleCount: number;
};

type MutableCognitionLlmStageDiagnostics = {
  stageName: RuntimeProfileCognitionLlmStageName;
  traceCount: number;
  llmAcceptedCount: number;
  deterministicFallbackCount: number;
  deterministicCount: number;
  missingProviderTraceCount: number;
};

function createLlmStageDiagnostics(
  traces: readonly AgentCycleTrace[],
): readonly RuntimeProfileAgentCycleLlmStageDiagnostics[] {
  const diagnostics = new Map<RuntimeProfileAgentCycleLlmStageName, MutableLlmStageDiagnostics>(
    AGENT_CYCLE_LLM_STAGE_NAMES.map((stageName) => [
      stageName,
      {
        stageName,
        traceCount: 0,
        llmAcceptedCount: 0,
        deterministicFallbackCount: 0,
        deterministicCount: 0,
        missingCycleCount: 0,
      },
    ]),
  );

  for (const trace of traces) {
    recordStageTrace({
      diagnostics,
      stageName: 'contextualPrioritization',
      stageTraces:
        trace.contextualPrioritization === undefined ? [] : [trace.contextualPrioritization],
    });
    recordStageTrace({
      diagnostics,
      stageName: 'actionSequenceGeneration',
      stageTraces: trace.actionSequenceGeneration ?? [],
    });
    recordStageTrace({
      diagnostics,
      stageName: 'socialDialogueGeneration',
      stageTraces: trace.socialDialogueGeneration ?? [],
    });
    recordStageTrace({
      diagnostics,
      stageName: 'globalSynthesis',
      stageTraces: trace.globalSynthesis === undefined ? [] : [trace.globalSynthesis],
    });
    recordStageTrace({
      diagnostics,
      stageName: 'reactiveCorrection',
      stageTraces:
        trace.actionRepair?.flatMap((repair) =>
          repair.reactiveCorrection === undefined ? [] : [repair.reactiveCorrection],
        ) ?? [],
    });
  }

  return AGENT_CYCLE_LLM_STAGE_NAMES.map((stageName) => {
    const stage = diagnostics.get(stageName);
    if (stage === undefined) {
      throw new Error(`missing LLM stage diagnostics for ${stageName}`);
    }
    return { ...stage };
  });
}

function recordStageTrace(input: {
  readonly diagnostics: Map<RuntimeProfileAgentCycleLlmStageName, MutableLlmStageDiagnostics>;
  readonly stageName: RuntimeProfileAgentCycleLlmStageName;
  readonly stageTraces: readonly AgentCycleLlmStageTrace[];
}): void {
  const diagnostics = input.diagnostics.get(input.stageName);
  if (diagnostics === undefined) {
    throw new Error(`unsupported LLM stage ${input.stageName}`);
  }

  if (input.stageTraces.length === 0) {
    diagnostics.missingCycleCount += 1;
    return;
  }

  for (const trace of input.stageTraces) {
    diagnostics.traceCount += 1;
    if (trace.source === 'llm' && trace.status === 'accepted') {
      diagnostics.llmAcceptedCount += 1;
    }
    if (trace.source === 'deterministic-fallback') {
      diagnostics.deterministicFallbackCount += 1;
    }
    if (trace.source === 'deterministic') {
      diagnostics.deterministicCount += 1;
    }
  }
}

function validateLlmStageDiagnostics(diagnostics: RuntimeProfileAgentCycleDiagnostics): void {
  if (diagnostics.llmStageDiagnostics === undefined) {
    return;
  }

  const seen = new Set<RuntimeProfileAgentCycleLlmStageName>();
  for (const stage of diagnostics.llmStageDiagnostics) {
    if (!AGENT_CYCLE_LLM_STAGE_NAMES.includes(stage.stageName)) {
      throw new Error(`agentCycleDiagnostics llmStageDiagnostics stageName is unsupported`);
    }
    if (seen.has(stage.stageName)) {
      throw new Error(`agentCycleDiagnostics llmStageDiagnostics stageName must be unique`);
    }
    seen.add(stage.stageName);
    assertNonNegativeInteger(
      stage.traceCount,
      `agentCycleDiagnostics ${stage.stageName} traceCount`,
    );
    assertNonNegativeInteger(
      stage.llmAcceptedCount,
      `agentCycleDiagnostics ${stage.stageName} llmAcceptedCount`,
    );
    assertNonNegativeInteger(
      stage.deterministicFallbackCount,
      `agentCycleDiagnostics ${stage.stageName} deterministicFallbackCount`,
    );
    assertNonNegativeInteger(
      stage.deterministicCount,
      `agentCycleDiagnostics ${stage.stageName} deterministicCount`,
    );
    assertNonNegativeInteger(
      stage.missingCycleCount,
      `agentCycleDiagnostics ${stage.stageName} missingCycleCount`,
    );
    if (stage.missingCycleCount > diagnostics.traceCount) {
      throw new Error(
        `agentCycleDiagnostics ${stage.stageName} missingCycleCount must not exceed traceCount`,
      );
    }
    if (
      stage.llmAcceptedCount + stage.deterministicFallbackCount + stage.deterministicCount >
      stage.traceCount
    ) {
      throw new Error(
        `agentCycleDiagnostics ${stage.stageName} source counts must not exceed stage traceCount`,
      );
    }
  }
}

function recordCognitionProviderTrace(
  diagnostics: MutableCognitionLlmStageDiagnostics,
  trace: CognitionLlmStageTrace | undefined,
): void {
  diagnostics.traceCount += 1;
  if (trace === undefined) {
    diagnostics.missingProviderTraceCount += 1;
    return;
  }
  if (trace.source === 'llm' && trace.status === 'accepted') {
    diagnostics.llmAcceptedCount += 1;
  }
  if (trace.source === 'deterministic-fallback') {
    diagnostics.deterministicFallbackCount += 1;
  }
  if (trace.source === 'deterministic') {
    diagnostics.deterministicCount += 1;
  }
}

function validateCognitionLlmStageDiagnostics(
  diagnostics: readonly RuntimeProfileCognitionLlmStageDiagnostics[] | undefined,
): void {
  if (diagnostics === undefined) {
    return;
  }

  const seen = new Set<RuntimeProfileCognitionLlmStageName>();
  for (const stage of diagnostics) {
    if (!COGNITION_LLM_STAGE_NAMES.includes(stage.stageName)) {
      throw new Error('cognitionLlmStageDiagnostics stageName is unsupported');
    }
    if (seen.has(stage.stageName)) {
      throw new Error('cognitionLlmStageDiagnostics stageName must be unique');
    }
    seen.add(stage.stageName);
    assertNonNegativeInteger(
      stage.traceCount,
      `cognitionLlmStageDiagnostics ${stage.stageName} traceCount`,
    );
    assertNonNegativeInteger(
      stage.llmAcceptedCount,
      `cognitionLlmStageDiagnostics ${stage.stageName} llmAcceptedCount`,
    );
    assertNonNegativeInteger(
      stage.deterministicFallbackCount,
      `cognitionLlmStageDiagnostics ${stage.stageName} deterministicFallbackCount`,
    );
    assertNonNegativeInteger(
      stage.deterministicCount,
      `cognitionLlmStageDiagnostics ${stage.stageName} deterministicCount`,
    );
    assertNonNegativeInteger(
      stage.missingProviderTraceCount,
      `cognitionLlmStageDiagnostics ${stage.stageName} missingProviderTraceCount`,
    );
    if (
      stage.llmAcceptedCount +
        stage.deterministicFallbackCount +
        stage.deterministicCount +
        stage.missingProviderTraceCount >
      stage.traceCount
    ) {
      throw new Error(
        `cognitionLlmStageDiagnostics ${stage.stageName} source counts must not exceed traceCount`,
      );
    }
  }
}

function clonePlannerExperimentMetric(metric: PlannerExperimentMetric): PlannerExperimentMetric {
  validatePlannerExperimentMetric(metric);
  return {
    metricId: metric.metricId,
    value: metric.value,
    higherIsBetter: metric.higherIsBetter,
  };
}

function validatePlannerExperiment(experiment: RuntimeProfilePlannerExperiment): void {
  assertNonEmpty(experiment.taskId, 'plannerExperiment taskId');
  assertNonEmpty(experiment.variant, 'plannerExperiment variant');
  if (experiment.metrics.length === 0) {
    throw new Error('plannerExperiment metrics requires at least one metric');
  }
  for (const metric of experiment.metrics) {
    validatePlannerExperimentMetric(metric);
  }
}

function validatePlannerExperimentMetric(metric: PlannerExperimentMetric): void {
  assertNonEmpty(metric.metricId, 'plannerExperiment metricId');
  assertFinite(metric.value, 'plannerExperiment value');
  if (typeof metric.higherIsBetter !== 'boolean') {
    throw new Error('plannerExperiment higherIsBetter must be boolean');
  }
}

function comparePlannerExperimentRuns(
  left: PlannerExperimentRun,
  right: PlannerExperimentRun,
): number {
  if (left.taskId !== right.taskId) {
    return left.taskId.localeCompare(right.taskId);
  }
  if (left.variant === 'default' && right.variant !== 'default') {
    return -1;
  }
  if (left.variant !== 'default' && right.variant === 'default') {
    return 1;
  }
  return left.variant.localeCompare(right.variant);
}

function ensureFile(filePath: string, rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '');
  }
}

function appendJsonLines(path: string, values: readonly unknown[]): void {
  if (values.length === 0) {
    return;
  }
  const payload = values.map((value) => JSON.stringify(value)).join('\n');
  appendFileSync(path, `${payload}\n`);
}

function readJsonLines<TValue>(path: string): readonly TValue[] {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, 'utf8').trim();
  if (content.length === 0) {
    return [];
  }
  return content.split('\n').map((line) => JSON.parse(line) as TValue);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertRatio(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function sumBy<TValue>(values: readonly TValue[], readValue: (value: TValue) => number): number {
  return values.reduce((total, value) => total + readValue(value), 0);
}
