import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cloneWorldDecisionContextTrace,
  type WorldDecisionContextTrace,
} from './worldDecisionContextTrace';

export type ObjectiveRenewalStrategicPlanUsageTrace = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
};

export type ObjectiveRenewalStrategicPlanAttemptTrace = {
  readonly attemptIndex: number;
  readonly status: string;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: ObjectiveRenewalStrategicPlanUsageTrace;
};

export type ObjectiveRenewalStrategicPlanTrace = {
  readonly status: 'accepted' | 'fallback' | 'deterministic';
  readonly source: 'llm' | 'deterministic-fallback' | 'deterministic';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly attempts?: readonly ObjectiveRenewalStrategicPlanAttemptTrace[];
  readonly usage?: ObjectiveRenewalStrategicPlanUsageTrace;
  readonly shortTermMemoryContext?: { readonly recordCount: number };
  readonly longTermProfileContext?: { readonly entryCount: number };
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type ObjectiveRenewalTrace = {
  readonly traceId: string;
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly agentId: string;
  readonly objectiveId: string;
  readonly selectedCandidateId: string;
  readonly rationale: string;
  readonly score: number;
  readonly shortTermMemoryContextIds: readonly string[];
  readonly profileEntryKeys: readonly string[];
  readonly profileEvidenceRecordIds: readonly string[];
  readonly scheduledIntentionIds?: readonly string[];
  readonly strategicPlan?: ObjectiveRenewalStrategicPlanTrace;
  readonly issuedAt: number;
};

export type ObjectiveRenewalTraceQuery = {
  readonly simulationId: string;
  readonly partitionKey?: string;
  readonly agentId?: string;
  readonly objectiveId?: string;
  readonly fromIssuedAt?: number;
  readonly toIssuedAt?: number;
  readonly limit?: number;
};

export type ObjectiveRenewalTraceRepository = {
  readonly record: (trace: ObjectiveRenewalTrace) => Promise<void>;
  readonly get: (traceId: string) => Promise<ObjectiveRenewalTrace | undefined>;
  readonly query: (query: ObjectiveRenewalTraceQuery) => Promise<ObjectiveRenewalTrace[]>;
};

export class InMemoryObjectiveRenewalTraceRepository implements ObjectiveRenewalTraceRepository {
  private readonly tracesById = new Map<string, ObjectiveRenewalTrace>();

  record(trace: ObjectiveRenewalTrace): Promise<void> {
    return Promise.resolve().then(() => {
      const cloned = cloneTrace(trace);
      if (!this.tracesById.has(cloned.traceId)) {
        this.tracesById.set(cloned.traceId, cloned);
      }
    });
  }

  get(traceId: string): Promise<ObjectiveRenewalTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const trace = this.tracesById.get(traceId);
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(query: ObjectiveRenewalTraceQuery): Promise<ObjectiveRenewalTrace[]> {
    return Promise.resolve().then(() => queryTraces([...this.tracesById.values()], query));
  }
}

export class FileObjectiveRenewalTraceRepository implements ObjectiveRenewalTraceRepository {
  private readonly tracesPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.tracesPath = join(input.rootDir, 'objective-renewal-traces.jsonl');
    ensureFile(this.tracesPath, input.rootDir);
  }

  async record(trace: ObjectiveRenewalTrace): Promise<void> {
    if ((await this.get(trace.traceId)) !== undefined) {
      return;
    }
    appendJsonLines(this.tracesPath, [cloneTrace(trace)]);
  }

  get(traceId: string): Promise<ObjectiveRenewalTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const trace = readJsonLines<ObjectiveRenewalTrace>(this.tracesPath).find(
        (candidate) => candidate.traceId === traceId,
      );
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(query: ObjectiveRenewalTraceQuery): Promise<ObjectiveRenewalTrace[]> {
    return Promise.resolve().then(() =>
      queryTraces(readJsonLines<ObjectiveRenewalTrace>(this.tracesPath), query),
    );
  }
}

function queryTraces(
  traces: readonly ObjectiveRenewalTrace[],
  query: ObjectiveRenewalTraceQuery,
): ObjectiveRenewalTrace[] {
  assertValidQuery(query);
  return traces
    .filter((trace) => trace.simulationId === query.simulationId)
    .filter(
      (trace) => query.partitionKey === undefined || trace.partitionKey === query.partitionKey,
    )
    .filter((trace) => query.agentId === undefined || trace.agentId === query.agentId)
    .filter((trace) => query.objectiveId === undefined || trace.objectiveId === query.objectiveId)
    .filter((trace) => query.fromIssuedAt === undefined || trace.issuedAt >= query.fromIssuedAt)
    .filter((trace) => query.toIssuedAt === undefined || trace.issuedAt <= query.toIssuedAt)
    .sort(compareTraceLatestFirst)
    .slice(0, query.limit)
    .map((trace) => cloneTrace(trace));
}

function cloneTrace(trace: ObjectiveRenewalTrace): ObjectiveRenewalTrace {
  assertValidTrace(trace);
  return {
    traceId: trace.traceId,
    simulationId: trace.simulationId,
    partitionKey: trace.partitionKey,
    agentId: trace.agentId,
    objectiveId: trace.objectiveId,
    selectedCandidateId: trace.selectedCandidateId,
    rationale: trace.rationale,
    score: trace.score,
    shortTermMemoryContextIds: [...trace.shortTermMemoryContextIds],
    profileEntryKeys: [...trace.profileEntryKeys],
    profileEvidenceRecordIds: [...trace.profileEvidenceRecordIds],
    ...(trace.scheduledIntentionIds === undefined
      ? {}
      : { scheduledIntentionIds: [...trace.scheduledIntentionIds] }),
    ...(trace.strategicPlan === undefined
      ? {}
      : { strategicPlan: cloneStrategicPlan(trace.strategicPlan) }),
    issuedAt: trace.issuedAt,
  };
}

function cloneStrategicPlan(
  trace: ObjectiveRenewalStrategicPlanTrace,
): ObjectiveRenewalStrategicPlanTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.attempts === undefined
      ? {}
      : { attempts: trace.attempts.map((attempt) => cloneStrategicPlanAttempt(attempt)) }),
    ...(trace.usage === undefined ? {} : { usage: cloneStrategicPlanUsage(trace.usage) }),
    ...(trace.shortTermMemoryContext === undefined
      ? {}
      : {
          shortTermMemoryContext: {
            recordCount: trace.shortTermMemoryContext.recordCount,
          },
        }),
    ...(trace.longTermProfileContext === undefined
      ? {}
      : {
          longTermProfileContext: {
            entryCount: trace.longTermProfileContext.entryCount,
          },
        }),
    ...(trace.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: trace.observedStateSummary }),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function cloneStrategicPlanAttempt(
  attempt: ObjectiveRenewalStrategicPlanAttemptTrace,
): ObjectiveRenewalStrategicPlanAttemptTrace {
  return {
    attemptIndex: attempt.attemptIndex,
    status: attempt.status,
    providerId: attempt.providerId,
    model: attempt.model,
    message: attempt.message,
    usage: cloneStrategicPlanUsage(attempt.usage),
  };
}

function cloneStrategicPlanUsage(
  usage: ObjectiveRenewalStrategicPlanUsageTrace,
): ObjectiveRenewalStrategicPlanUsageTrace {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedCostMicros: usage.estimatedCostMicros,
  };
}

function compareTraceLatestFirst(
  left: ObjectiveRenewalTrace,
  right: ObjectiveRenewalTrace,
): number {
  if (left.issuedAt !== right.issuedAt) {
    return right.issuedAt - left.issuedAt;
  }
  return right.traceId.localeCompare(left.traceId);
}

function assertValidTrace(trace: ObjectiveRenewalTrace): void {
  assertNonEmpty(trace.traceId, 'traceId');
  assertNonEmpty(trace.simulationId, 'simulationId');
  assertNonEmpty(trace.partitionKey, 'partitionKey');
  assertNonEmpty(trace.agentId, 'agentId');
  assertNonEmpty(trace.objectiveId, 'objectiveId');
  assertNonEmpty(trace.selectedCandidateId, 'selectedCandidateId');
  assertNonEmpty(trace.rationale, 'rationale');
  assertFinite(trace.score, 'score');
  assertFinite(trace.issuedAt, 'issuedAt');
  for (const scheduledIntentionId of trace.scheduledIntentionIds ?? []) {
    assertNonEmpty(scheduledIntentionId, 'scheduledIntentionId');
  }
}

function assertValidQuery(query: ObjectiveRenewalTraceQuery): void {
  assertNonEmpty(query.simulationId, 'simulationId');
  if (query.partitionKey !== undefined) {
    assertNonEmpty(query.partitionKey, 'partitionKey');
  }
  if (query.agentId !== undefined) {
    assertNonEmpty(query.agentId, 'agentId');
  }
  if (query.objectiveId !== undefined) {
    assertNonEmpty(query.objectiveId, 'objectiveId');
  }
  if (query.fromIssuedAt !== undefined) {
    assertFinite(query.fromIssuedAt, 'fromIssuedAt');
  }
  if (query.toIssuedAt !== undefined) {
    assertFinite(query.toIssuedAt, 'toIssuedAt');
  }
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) {
    throw new Error('limit must be a positive integer');
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
  appendFileSync(path, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
}

function readJsonLines<TValue>(path: string): TValue[] {
  const text = readFileSync(path, 'utf8');
  if (text.trim().length === 0) {
    return [];
  }
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TValue);
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
