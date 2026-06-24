import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PartitionKey } from '@aivilization/sim-core';

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
  readonly partitions: readonly RuntimeProfileRunPartitionReport[];
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
    partitions: input.partitions.map((partition) => ({ ...partition })),
  };
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
