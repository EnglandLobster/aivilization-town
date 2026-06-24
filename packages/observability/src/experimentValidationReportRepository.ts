import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ExperimentValidationEvidence,
  ExperimentValidationFinding,
  ExperimentValidationMetric,
  ExperimentValidationReport,
  ExperimentValidationRunMetadata,
} from './experimentValidation';

export type ExperimentValidationReportQuery = {
  readonly simulationId: string;
  readonly runId?: string;
  readonly fromGeneratedAt?: number;
  readonly toGeneratedAt?: number;
  readonly limit?: number;
};

export type ExperimentValidationReportRepository = {
  readonly record: (report: ExperimentValidationReport) => Promise<void>;
  readonly get: (runId: string) => Promise<ExperimentValidationReport | undefined>;
  readonly query: (query: ExperimentValidationReportQuery) => Promise<ExperimentValidationReport[]>;
};

export class InMemoryExperimentValidationReportRepository implements ExperimentValidationReportRepository {
  private readonly reportsByRunId = new Map<string, ExperimentValidationReport>();

  record(report: ExperimentValidationReport): Promise<void> {
    const clone = cloneReport(report);
    if (!this.reportsByRunId.has(clone.run.runId)) {
      this.reportsByRunId.set(clone.run.runId, clone);
    }
    return Promise.resolve();
  }

  get(runId: string): Promise<ExperimentValidationReport | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(runId, 'runId');
      const report = this.reportsByRunId.get(runId);
      return report === undefined ? undefined : cloneReport(report);
    });
  }

  query(query: ExperimentValidationReportQuery): Promise<ExperimentValidationReport[]> {
    return Promise.resolve().then(() => queryReports([...this.reportsByRunId.values()], query));
  }
}

export class FileExperimentValidationReportRepository implements ExperimentValidationReportRepository {
  private readonly reportsPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.reportsPath = join(input.rootDir, 'experiment-validation-reports.jsonl');
    ensureFile(this.reportsPath, input.rootDir);
  }

  async record(report: ExperimentValidationReport): Promise<void> {
    if ((await this.get(report.run.runId)) !== undefined) {
      return;
    }
    appendJsonLines(this.reportsPath, [cloneReport(report)]);
  }

  get(runId: string): Promise<ExperimentValidationReport | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(runId, 'runId');
      const report = readJsonLines<ExperimentValidationReport>(this.reportsPath).find(
        (candidate) => candidate.run.runId === runId,
      );
      return report === undefined ? undefined : cloneReport(report);
    });
  }

  query(query: ExperimentValidationReportQuery): Promise<ExperimentValidationReport[]> {
    return Promise.resolve().then(() =>
      queryReports(readJsonLines<ExperimentValidationReport>(this.reportsPath), query),
    );
  }
}

function queryReports(
  reports: readonly ExperimentValidationReport[],
  query: ExperimentValidationReportQuery,
): ExperimentValidationReport[] {
  assertValidQuery(query);
  return reports
    .filter((report) => report.run.simulationId === query.simulationId)
    .filter((report) => query.runId === undefined || report.run.runId === query.runId)
    .filter(
      (report) =>
        query.fromGeneratedAt === undefined || report.run.generatedAt >= query.fromGeneratedAt,
    )
    .filter(
      (report) =>
        query.toGeneratedAt === undefined || report.run.generatedAt <= query.toGeneratedAt,
    )
    .sort(compareReportLatestFirst)
    .slice(0, query.limit)
    .map((report) => cloneReport(report));
}

function cloneReport(report: ExperimentValidationReport): ExperimentValidationReport {
  return {
    run: cloneRunMetadata(report.run),
    metrics: report.metrics.map((metric) => cloneMetric(metric)),
    findings: report.findings.map((finding) => cloneFinding(finding)),
  };
}

function cloneRunMetadata(run: ExperimentValidationRunMetadata): ExperimentValidationRunMetadata {
  return {
    runId: run.runId,
    simulationId: run.simulationId,
    generatedAt: run.generatedAt,
    ...(run.source === undefined ? {} : { source: run.source }),
  };
}

function cloneMetric(metric: ExperimentValidationMetric): ExperimentValidationMetric {
  return {
    id: metric.id,
    label: metric.label,
    status: metric.status,
    value: metric.value,
    unit: metric.unit,
    evidence: cloneEvidence(metric.evidence),
  };
}

function cloneFinding(finding: ExperimentValidationFinding): ExperimentValidationFinding {
  return {
    topic: finding.topic,
    severity: finding.severity,
    message: finding.message,
    evidence: cloneEvidence(finding.evidence),
  };
}

function cloneEvidence(evidence: ExperimentValidationEvidence): ExperimentValidationEvidence {
  return { ...evidence };
}

function compareReportLatestFirst(
  left: ExperimentValidationReport,
  right: ExperimentValidationReport,
): number {
  if (left.run.generatedAt !== right.run.generatedAt) {
    return right.run.generatedAt - left.run.generatedAt;
  }
  return right.run.runId.localeCompare(left.run.runId);
}

function assertValidQuery(query: ExperimentValidationReportQuery): void {
  assertNonEmpty(query.simulationId, 'simulationId');
  if (query.runId !== undefined) {
    assertNonEmpty(query.runId, 'runId');
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
