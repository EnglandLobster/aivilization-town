import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type DailyPlanRenewalUsageTrace = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
};

export type DailyPlanRenewalAttemptTrace = {
  readonly attemptIndex: number;
  readonly status: string;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: DailyPlanRenewalUsageTrace;
};

export type DailyPlanRenewalPlanningTrace = {
  readonly status: 'accepted' | 'fallback' | 'deterministic';
  readonly source: 'llm' | 'deterministic-fallback' | 'deterministic';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly attempts?: readonly DailyPlanRenewalAttemptTrace[];
  readonly usage?: DailyPlanRenewalUsageTrace;
};

export type DailyPlanRenewalTrace = {
  readonly traceId: string;
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly agentId: string;
  readonly dailyPlanId: string;
  readonly scheduledIntentionIds: readonly string[];
  readonly shortTermMemoryContextIds: readonly string[];
  readonly profileEntryKeys: readonly string[];
  readonly profileEvidenceRecordIds: readonly string[];
  readonly planningTrace?: DailyPlanRenewalPlanningTrace;
  readonly issuedAt: number;
};

export type DailyPlanRenewalTraceQuery = {
  readonly simulationId: string;
  readonly partitionKey?: string;
  readonly traceId?: string;
  readonly agentId?: string;
  readonly dailyPlanId?: string;
  readonly fromIssuedAt?: number;
  readonly toIssuedAt?: number;
  readonly limit?: number;
};

export type DailyPlanRenewalTraceRepository = {
  readonly record: (trace: DailyPlanRenewalTrace) => Promise<void>;
  readonly get: (traceId: string) => Promise<DailyPlanRenewalTrace | undefined>;
  readonly query: (query: DailyPlanRenewalTraceQuery) => Promise<DailyPlanRenewalTrace[]>;
};

export class InMemoryDailyPlanRenewalTraceRepository implements DailyPlanRenewalTraceRepository {
  private readonly tracesById = new Map<string, DailyPlanRenewalTrace>();

  record(trace: DailyPlanRenewalTrace): Promise<void> {
    return Promise.resolve().then(() => {
      const cloned = cloneTrace(trace);
      if (!this.tracesById.has(cloned.traceId)) {
        this.tracesById.set(cloned.traceId, cloned);
      }
    });
  }

  get(traceId: string): Promise<DailyPlanRenewalTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const trace = this.tracesById.get(traceId);
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(query: DailyPlanRenewalTraceQuery): Promise<DailyPlanRenewalTrace[]> {
    return Promise.resolve().then(() => queryTraces([...this.tracesById.values()], query));
  }
}

export class FileDailyPlanRenewalTraceRepository implements DailyPlanRenewalTraceRepository {
  private readonly tracesPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.tracesPath = join(input.rootDir, 'daily-plan-renewal-traces.jsonl');
    ensureFile(this.tracesPath, input.rootDir);
  }

  async record(trace: DailyPlanRenewalTrace): Promise<void> {
    if ((await this.get(trace.traceId)) !== undefined) {
      return;
    }
    appendJsonLines(this.tracesPath, [cloneTrace(trace)]);
  }

  get(traceId: string): Promise<DailyPlanRenewalTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const trace = readJsonLines<DailyPlanRenewalTrace>(this.tracesPath).find(
        (candidate) => candidate.traceId === traceId,
      );
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(query: DailyPlanRenewalTraceQuery): Promise<DailyPlanRenewalTrace[]> {
    return Promise.resolve().then(() =>
      queryTraces(readJsonLines<DailyPlanRenewalTrace>(this.tracesPath), query),
    );
  }
}

function queryTraces(
  traces: readonly DailyPlanRenewalTrace[],
  query: DailyPlanRenewalTraceQuery,
): DailyPlanRenewalTrace[] {
  assertValidQuery(query);
  return traces
    .filter((trace) => trace.simulationId === query.simulationId)
    .filter(
      (trace) => query.partitionKey === undefined || trace.partitionKey === query.partitionKey,
    )
    .filter((trace) => query.traceId === undefined || trace.traceId === query.traceId)
    .filter((trace) => query.agentId === undefined || trace.agentId === query.agentId)
    .filter((trace) => query.dailyPlanId === undefined || trace.dailyPlanId === query.dailyPlanId)
    .filter((trace) => query.fromIssuedAt === undefined || trace.issuedAt >= query.fromIssuedAt)
    .filter((trace) => query.toIssuedAt === undefined || trace.issuedAt <= query.toIssuedAt)
    .sort(compareTraceLatestFirst)
    .slice(0, query.limit)
    .map((trace) => cloneTrace(trace));
}

function cloneTrace(trace: DailyPlanRenewalTrace): DailyPlanRenewalTrace {
  assertValidTrace(trace);
  return {
    traceId: trace.traceId,
    simulationId: trace.simulationId,
    partitionKey: trace.partitionKey,
    agentId: trace.agentId,
    dailyPlanId: trace.dailyPlanId,
    scheduledIntentionIds: [...trace.scheduledIntentionIds],
    shortTermMemoryContextIds: [...trace.shortTermMemoryContextIds],
    profileEntryKeys: [...trace.profileEntryKeys],
    profileEvidenceRecordIds: [...trace.profileEvidenceRecordIds],
    ...(trace.planningTrace === undefined
      ? {}
      : { planningTrace: clonePlanningTrace(trace.planningTrace) }),
    issuedAt: trace.issuedAt,
  };
}

function clonePlanningTrace(trace: DailyPlanRenewalPlanningTrace): DailyPlanRenewalPlanningTrace {
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
      : { attempts: trace.attempts.map((attempt) => clonePlanningAttempt(attempt)) }),
    ...(trace.usage === undefined ? {} : { usage: clonePlanningUsage(trace.usage) }),
  };
}

function clonePlanningAttempt(attempt: DailyPlanRenewalAttemptTrace): DailyPlanRenewalAttemptTrace {
  return {
    attemptIndex: attempt.attemptIndex,
    status: attempt.status,
    providerId: attempt.providerId,
    model: attempt.model,
    message: attempt.message,
    usage: clonePlanningUsage(attempt.usage),
  };
}

function clonePlanningUsage(usage: DailyPlanRenewalUsageTrace): DailyPlanRenewalUsageTrace {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedCostMicros: usage.estimatedCostMicros,
  };
}

function compareTraceLatestFirst(
  left: DailyPlanRenewalTrace,
  right: DailyPlanRenewalTrace,
): number {
  if (left.issuedAt !== right.issuedAt) {
    return right.issuedAt - left.issuedAt;
  }
  return right.traceId.localeCompare(left.traceId);
}

function assertValidTrace(trace: DailyPlanRenewalTrace): void {
  assertNonEmpty(trace.traceId, 'traceId');
  assertNonEmpty(trace.simulationId, 'simulationId');
  assertNonEmpty(trace.partitionKey, 'partitionKey');
  assertNonEmpty(trace.agentId, 'agentId');
  assertNonEmpty(trace.dailyPlanId, 'dailyPlanId');
  assertFinite(trace.issuedAt, 'issuedAt');
  for (const scheduledIntentionId of trace.scheduledIntentionIds) {
    assertNonEmpty(scheduledIntentionId, 'scheduledIntentionId');
  }
  for (const memoryId of trace.shortTermMemoryContextIds) {
    assertNonEmpty(memoryId, 'shortTermMemoryContextId');
  }
  for (const key of trace.profileEntryKeys) {
    assertNonEmpty(key, 'profileEntryKey');
  }
  for (const recordId of trace.profileEvidenceRecordIds) {
    assertNonEmpty(recordId, 'profileEvidenceRecordId');
  }
}

function assertValidQuery(query: DailyPlanRenewalTraceQuery): void {
  assertNonEmpty(query.simulationId, 'simulationId');
  if (query.partitionKey !== undefined) {
    assertNonEmpty(query.partitionKey, 'partitionKey');
  }
  if (query.agentId !== undefined) {
    assertNonEmpty(query.agentId, 'agentId');
  }
  if (query.traceId !== undefined) {
    assertNonEmpty(query.traceId, 'traceId');
  }
  if (query.dailyPlanId !== undefined) {
    assertNonEmpty(query.dailyPlanId, 'dailyPlanId');
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
