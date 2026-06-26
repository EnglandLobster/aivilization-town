import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemorySynthesisWorldDecisionContextTrace } from '@aivilization/memory';
import type {
  ExperimentValidationReportGateResult,
  ExperimentValidationStatus,
} from '@aivilization/observability';
import type { AgentId, PartitionKey, SimulationTimestamp } from '@aivilization/sim-core';
import type {
  LocalSimulationRuntimeSupervisorCommandOutcome,
  LocalSimulationRuntimeSupervisorPartitionCommandError,
  LocalSimulationRuntimeSupervisorStatus,
} from './localSimulationRuntimeSupervisor';

export type LocalSimulationRuntimeOperationCommand = 'start-all' | 'pause-all' | 'run-cycles';

export type LocalSimulationRuntimeOperationValidationReportTrace = {
  readonly runId: string;
  readonly generatedAt: SimulationTimestamp;
  readonly source?: string;
  readonly gateStatus?: ExperimentValidationReportGateResult['status'];
  readonly gateFailureCount?: number;
  readonly metricStatusCounts: Readonly<Record<ExperimentValidationStatus, number>>;
  readonly streamVersion: number;
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly eventCount: number;
  readonly projectionSequence: number;
};

export type LocalSimulationRuntimeOperationValidationFailureTrace = {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
};

export type LocalSimulationRuntimeOperationMemorySynthesisProviderTrace = {
  readonly agentId: AgentId;
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly shortTermMemoryContext?: unknown;
  readonly longTermProfileContext?: unknown;
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: MemorySynthesisWorldDecisionContextTrace;
  readonly choices?: readonly unknown[];
  readonly patches?: readonly unknown[];
  readonly reflections?: readonly unknown[];
};

export type LocalSimulationRuntimeOperationMemoryConsolidationTrace = {
  readonly agentCount: number;
  readonly patchCount: number;
  readonly cursorCount: number;
  readonly socialReflectionObservationCount: number;
  readonly consolidatedAt: SimulationTimestamp;
  readonly reflectionSynthesisTraces: readonly LocalSimulationRuntimeOperationMemorySynthesisProviderTrace[];
  readonly socialModelSynthesisTraces: readonly LocalSimulationRuntimeOperationMemorySynthesisProviderTrace[];
};

export type LocalSimulationRuntimeOperationMemoryConsolidationFailureTrace = {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
};

export type LocalSimulationRuntimeOperationRunCycleTrace = {
  readonly cycleIndex: number;
  readonly traceId: string;
  readonly requestedAt: SimulationTimestamp;
  readonly outcome: LocalSimulationRuntimeSupervisorCommandOutcome;
  readonly succeededPartitionCount: number;
  readonly failedPartitionCount: number;
  readonly attentionPartitionCount: number;
};

export type LocalSimulationRuntimeOperationPartitionTrace =
  | {
      readonly simulationId: string;
      readonly partitionKey: PartitionKey;
      readonly outcome: 'succeeded';
      readonly status: string;
      readonly validationReport?: LocalSimulationRuntimeOperationValidationReportTrace;
      readonly validationFailure?: LocalSimulationRuntimeOperationValidationFailureTrace;
      readonly memoryConsolidation?: LocalSimulationRuntimeOperationMemoryConsolidationTrace;
      readonly memoryConsolidationFailure?: LocalSimulationRuntimeOperationMemoryConsolidationFailureTrace;
    }
  | {
      readonly simulationId: string;
      readonly partitionKey: PartitionKey;
      readonly outcome: 'failed';
      readonly status: 'failed';
      readonly error: LocalSimulationRuntimeSupervisorPartitionCommandError;
    };

export type LocalSimulationRuntimeOperationTrace = {
  readonly traceId: string;
  readonly manifestId: string;
  readonly command: LocalSimulationRuntimeOperationCommand;
  readonly requestedAt: SimulationTimestamp;
  readonly recordedAt: SimulationTimestamp;
  readonly outcome: LocalSimulationRuntimeSupervisorCommandOutcome;
  readonly succeededPartitionCount: number;
  readonly failedPartitionCount: number;
  readonly partitions: readonly LocalSimulationRuntimeOperationPartitionTrace[];
  readonly cycles?: readonly LocalSimulationRuntimeOperationRunCycleTrace[];
  readonly status: LocalSimulationRuntimeSupervisorStatus;
};

export type LocalSimulationRuntimeOperationTraceQuery = {
  readonly manifestId?: string;
  readonly command?: LocalSimulationRuntimeOperationCommand;
  readonly fromRequestedAt?: SimulationTimestamp;
  readonly toRequestedAt?: SimulationTimestamp;
  readonly limit?: number;
};

export type LocalSimulationRuntimeOperationTraceRepository = {
  readonly record: (trace: LocalSimulationRuntimeOperationTrace) => Promise<void>;
  readonly get: (traceId: string) => Promise<LocalSimulationRuntimeOperationTrace | undefined>;
  readonly query: (
    query: LocalSimulationRuntimeOperationTraceQuery,
  ) => Promise<LocalSimulationRuntimeOperationTrace[]>;
};

export class InMemoryLocalSimulationRuntimeOperationTraceRepository implements LocalSimulationRuntimeOperationTraceRepository {
  private readonly tracesById = new Map<string, LocalSimulationRuntimeOperationTrace>();

  record(trace: LocalSimulationRuntimeOperationTrace): Promise<void> {
    if (!this.tracesById.has(trace.traceId)) {
      this.tracesById.set(trace.traceId, cloneTrace(trace));
    }
    return Promise.resolve();
  }

  get(traceId: string): Promise<LocalSimulationRuntimeOperationTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const trace = this.tracesById.get(traceId);
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(
    query: LocalSimulationRuntimeOperationTraceQuery,
  ): Promise<LocalSimulationRuntimeOperationTrace[]> {
    return Promise.resolve().then(() => queryTraces([...this.tracesById.values()], query));
  }
}

export class FileLocalSimulationRuntimeOperationTraceRepository implements LocalSimulationRuntimeOperationTraceRepository {
  private readonly tracesPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.tracesPath = join(input.rootDir, 'supervisor-operation-traces.jsonl');
    ensureFile(this.tracesPath, input.rootDir);
  }

  async record(trace: LocalSimulationRuntimeOperationTrace): Promise<void> {
    if ((await this.get(trace.traceId)) !== undefined) {
      return;
    }
    appendJsonLines(this.tracesPath, [cloneTrace(trace)]);
  }

  get(traceId: string): Promise<LocalSimulationRuntimeOperationTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const trace = readJsonLines<LocalSimulationRuntimeOperationTrace>(this.tracesPath).find(
        (candidate) => candidate.traceId === traceId,
      );
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(
    query: LocalSimulationRuntimeOperationTraceQuery,
  ): Promise<LocalSimulationRuntimeOperationTrace[]> {
    return Promise.resolve().then(() =>
      queryTraces(readJsonLines<LocalSimulationRuntimeOperationTrace>(this.tracesPath), query),
    );
  }
}

function queryTraces(
  traces: readonly LocalSimulationRuntimeOperationTrace[],
  query: LocalSimulationRuntimeOperationTraceQuery,
): LocalSimulationRuntimeOperationTrace[] {
  assertValidQuery(query);
  return traces
    .filter((trace) => query.manifestId === undefined || trace.manifestId === query.manifestId)
    .filter((trace) => query.command === undefined || trace.command === query.command)
    .filter(
      (trace) => query.fromRequestedAt === undefined || trace.requestedAt >= query.fromRequestedAt,
    )
    .filter(
      (trace) => query.toRequestedAt === undefined || trace.requestedAt <= query.toRequestedAt,
    )
    .sort(compareTraceLatestFirst)
    .slice(0, query.limit)
    .map((trace) => cloneTrace(trace));
}

function compareTraceLatestFirst(
  left: LocalSimulationRuntimeOperationTrace,
  right: LocalSimulationRuntimeOperationTrace,
): number {
  if (left.requestedAt !== right.requestedAt) {
    return right.requestedAt - left.requestedAt;
  }
  return right.traceId.localeCompare(left.traceId);
}

function cloneTrace(
  trace: LocalSimulationRuntimeOperationTrace,
): LocalSimulationRuntimeOperationTrace {
  return JSON.parse(JSON.stringify(trace)) as LocalSimulationRuntimeOperationTrace;
}

function ensureFile(path: string, rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, '');
  }
}

function appendJsonLines(path: string, values: readonly unknown[]): void {
  if (values.length === 0) {
    return;
  }
  appendFileSync(path, values.map((value) => JSON.stringify(value)).join('\n') + '\n');
}

function readJsonLines<TValue>(path: string): TValue[] {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, 'utf8');
  if (content.trim().length === 0) {
    return [];
  }
  return content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as TValue);
}

function assertValidQuery(query: LocalSimulationRuntimeOperationTraceQuery): void {
  if (query.manifestId !== undefined) {
    assertNonEmpty(query.manifestId, 'manifestId');
  }
  if (query.limit !== undefined && (!Number.isFinite(query.limit) || query.limit <= 0)) {
    throw new Error('limit must be positive');
  }
  if (
    query.fromRequestedAt !== undefined &&
    query.toRequestedAt !== undefined &&
    query.toRequestedAt < query.fromRequestedAt
  ) {
    throw new Error('toRequestedAt must be greater than or equal to fromRequestedAt');
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
