import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PartitionKey } from '@aivilization/sim-core';
import type { AgentCycleTrace } from './agentCycleTrace';
import type { PlannerExperimentMetric, PlannerExperimentRun } from './experimentValidation';

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
  readonly partitions: readonly RuntimeProfileRunPartitionReport[];
  readonly plannerExperiment?: RuntimeProfilePlannerExperiment;
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
  readonly commandEmittingCycleRatio: number;
  readonly repairedSimulatorRatio: number;
  readonly rejectedSimulatorRatio: number;
  readonly replanningDecisionRatio: number;
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
    commandEmittingCycleRatio: ratio(commandEmittingCycleCount, traceCount),
    repairedSimulatorRatio: ratio(repairedSimulatorCount, traceCount),
    rejectedSimulatorRatio: ratio(rejectedSimulatorCount, traceCount),
    replanningDecisionRatio: ratio(replanningDecisionCount, traceCount),
  };
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
  return { ...diagnostics };
}

function validateAgentCycleDiagnostics(
  diagnostics: RuntimeProfileAgentCycleDiagnostics | undefined,
): asserts diagnostics is RuntimeProfileAgentCycleDiagnostics {
  if (diagnostics === undefined) {
    throw new Error('agentCycleDiagnostics is required');
  }
  const countFields: readonly (keyof RuntimeProfileAgentCycleDiagnostics)[] = [
    'traceCount',
    'acceptedSimulatorCount',
    'repairedSimulatorCount',
    'rejectedSimulatorCount',
    'replanningDecisionCount',
    'simulatorEventTraceCount',
    'simulatorEventCount',
    'commandEmittingCycleCount',
  ];
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
  const ratioFields: readonly (keyof RuntimeProfileAgentCycleDiagnostics)[] = [
    'commandEmittingCycleRatio',
    'repairedSimulatorRatio',
    'rejectedSimulatorRatio',
    'replanningDecisionRatio',
  ];
  for (const field of ratioFields) {
    assertRatio(diagnostics[field], `agentCycleDiagnostics ${field}`);
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

function sumBy<TValue>(
  values: readonly TValue[],
  readValue: (value: TValue) => number,
): number {
  return values.reduce((total, value) => total + readValue(value), 0);
}
