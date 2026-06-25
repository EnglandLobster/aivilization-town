import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cloneWorldDecisionContextTrace,
  type WorldDecisionContextTrace,
} from './worldDecisionContextTrace';

export type ReactionEvaluationUsageTrace = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
};

export type ReactionEvaluationAttemptTrace = {
  readonly attemptIndex: number;
  readonly status: string;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: ReactionEvaluationUsageTrace;
};

export type ReactionEvaluationProviderTrace = {
  readonly status: 'accepted' | 'fallback' | 'deterministic';
  readonly source: 'llm' | 'deterministic-fallback' | 'deterministic';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly attempts?: readonly ReactionEvaluationAttemptTrace[];
  readonly usage?: ReactionEvaluationUsageTrace;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type IgnoredReactionEvaluationDecisionTrace = {
  readonly kind: 'ignore';
  readonly confidence: number;
  readonly rationale: string;
};

export type FollowUpReactionEvaluationDecisionTrace = {
  readonly kind: 'follow-up';
  readonly confidence: number;
  readonly rationale: string;
  readonly description: string;
  readonly priority: number;
  readonly reactionWindowMs: number;
  readonly affinityTags: readonly string[];
};

export type ReactionEvaluationDecisionTrace =
  | IgnoredReactionEvaluationDecisionTrace
  | FollowUpReactionEvaluationDecisionTrace;

export type ReactionEvaluationTrace = {
  readonly traceId: string;
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly agentId: string;
  readonly memoryRecordId: string;
  readonly decision: ReactionEvaluationDecisionTrace;
  readonly reactionTrace?: ReactionEvaluationProviderTrace;
  readonly scheduledIntentionId?: string;
  readonly issuedAt: number;
};

export type ReactionEvaluationTraceQuery = {
  readonly simulationId: string;
  readonly partitionKey?: string;
  readonly traceId?: string;
  readonly agentId?: string;
  readonly memoryRecordId?: string;
  readonly decisionKind?: ReactionEvaluationDecisionTrace['kind'];
  readonly fromIssuedAt?: number;
  readonly toIssuedAt?: number;
  readonly limit?: number;
};

export type ReactionEvaluationTraceRepository = {
  readonly record: (trace: ReactionEvaluationTrace) => Promise<void>;
  readonly get: (traceId: string) => Promise<ReactionEvaluationTrace | undefined>;
  readonly query: (query: ReactionEvaluationTraceQuery) => Promise<ReactionEvaluationTrace[]>;
};

export class InMemoryReactionEvaluationTraceRepository
  implements ReactionEvaluationTraceRepository
{
  private readonly tracesById = new Map<string, ReactionEvaluationTrace>();

  record(trace: ReactionEvaluationTrace): Promise<void> {
    return Promise.resolve().then(() => {
      const cloned = cloneTrace(trace);
      if (!this.tracesById.has(cloned.traceId)) {
        this.tracesById.set(cloned.traceId, cloned);
      }
    });
  }

  get(traceId: string): Promise<ReactionEvaluationTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const trace = this.tracesById.get(traceId);
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(query: ReactionEvaluationTraceQuery): Promise<ReactionEvaluationTrace[]> {
    return Promise.resolve().then(() => queryTraces([...this.tracesById.values()], query));
  }
}

export class FileReactionEvaluationTraceRepository implements ReactionEvaluationTraceRepository {
  private readonly tracesPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.tracesPath = join(input.rootDir, 'reaction-evaluation-traces.jsonl');
    ensureFile(this.tracesPath, input.rootDir);
  }

  async record(trace: ReactionEvaluationTrace): Promise<void> {
    if ((await this.get(trace.traceId)) !== undefined) {
      return;
    }
    appendJsonLines(this.tracesPath, [cloneTrace(trace)]);
  }

  get(traceId: string): Promise<ReactionEvaluationTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const trace = readJsonLines<ReactionEvaluationTrace>(this.tracesPath).find(
        (candidate) => candidate.traceId === traceId,
      );
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(query: ReactionEvaluationTraceQuery): Promise<ReactionEvaluationTrace[]> {
    return Promise.resolve().then(() =>
      queryTraces(readJsonLines<ReactionEvaluationTrace>(this.tracesPath), query),
    );
  }
}

function queryTraces(
  traces: readonly ReactionEvaluationTrace[],
  query: ReactionEvaluationTraceQuery,
): ReactionEvaluationTrace[] {
  assertValidQuery(query);
  return traces
    .filter((trace) => trace.simulationId === query.simulationId)
    .filter(
      (trace) => query.partitionKey === undefined || trace.partitionKey === query.partitionKey,
    )
    .filter((trace) => query.traceId === undefined || trace.traceId === query.traceId)
    .filter((trace) => query.agentId === undefined || trace.agentId === query.agentId)
    .filter(
      (trace) =>
        query.memoryRecordId === undefined || trace.memoryRecordId === query.memoryRecordId,
    )
    .filter(
      (trace) => query.decisionKind === undefined || trace.decision.kind === query.decisionKind,
    )
    .filter((trace) => query.fromIssuedAt === undefined || trace.issuedAt >= query.fromIssuedAt)
    .filter((trace) => query.toIssuedAt === undefined || trace.issuedAt <= query.toIssuedAt)
    .sort(compareTraceLatestFirst)
    .slice(0, query.limit)
    .map((trace) => cloneTrace(trace));
}

function cloneTrace(trace: ReactionEvaluationTrace): ReactionEvaluationTrace {
  assertValidTrace(trace);
  return {
    traceId: trace.traceId,
    simulationId: trace.simulationId,
    partitionKey: trace.partitionKey,
    agentId: trace.agentId,
    memoryRecordId: trace.memoryRecordId,
    decision: cloneDecision(trace.decision),
    ...(trace.reactionTrace === undefined
      ? {}
      : { reactionTrace: cloneProviderTrace(trace.reactionTrace) }),
    ...(trace.scheduledIntentionId === undefined
      ? {}
      : { scheduledIntentionId: trace.scheduledIntentionId }),
    issuedAt: trace.issuedAt,
  };
}

function cloneDecision(
  decision: ReactionEvaluationDecisionTrace,
): ReactionEvaluationDecisionTrace {
  if (decision.kind === 'ignore') {
    return {
      kind: 'ignore',
      confidence: decision.confidence,
      rationale: decision.rationale,
    };
  }

  return {
    kind: 'follow-up',
    confidence: decision.confidence,
    rationale: decision.rationale,
    description: decision.description,
    priority: decision.priority,
    reactionWindowMs: decision.reactionWindowMs,
    affinityTags: [...decision.affinityTags],
  };
}

function cloneProviderTrace(
  trace: ReactionEvaluationProviderTrace,
): ReactionEvaluationProviderTrace {
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
      : { attempts: trace.attempts.map((attempt) => cloneProviderAttempt(attempt)) }),
    ...(trace.usage === undefined ? {} : { usage: cloneProviderUsage(trace.usage) }),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function cloneProviderAttempt(
  attempt: ReactionEvaluationAttemptTrace,
): ReactionEvaluationAttemptTrace {
  return {
    attemptIndex: attempt.attemptIndex,
    status: attempt.status,
    providerId: attempt.providerId,
    model: attempt.model,
    message: attempt.message,
    usage: cloneProviderUsage(attempt.usage),
  };
}

function cloneProviderUsage(usage: ReactionEvaluationUsageTrace): ReactionEvaluationUsageTrace {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedCostMicros: usage.estimatedCostMicros,
  };
}

function compareTraceLatestFirst(
  left: ReactionEvaluationTrace,
  right: ReactionEvaluationTrace,
): number {
  if (left.issuedAt !== right.issuedAt) {
    return right.issuedAt - left.issuedAt;
  }
  return right.traceId.localeCompare(left.traceId);
}

function assertValidTrace(trace: ReactionEvaluationTrace): void {
  assertNonEmpty(trace.traceId, 'traceId');
  assertNonEmpty(trace.simulationId, 'simulationId');
  assertNonEmpty(trace.partitionKey, 'partitionKey');
  assertNonEmpty(trace.agentId, 'agentId');
  assertNonEmpty(trace.memoryRecordId, 'memoryRecordId');
  assertValidDecision(trace.decision);
  if (trace.reactionTrace !== undefined) {
    assertValidProviderTrace(trace.reactionTrace);
  }
  if (trace.scheduledIntentionId !== undefined) {
    assertNonEmpty(trace.scheduledIntentionId, 'scheduledIntentionId');
  }
  assertFinite(trace.issuedAt, 'issuedAt');
}

function assertValidDecision(decision: ReactionEvaluationDecisionTrace): void {
  assertConfidence(decision.confidence);
  assertNonEmpty(decision.rationale, 'reaction rationale');

  if (decision.kind === 'ignore') {
    return;
  }

  if (decision.kind !== 'follow-up') {
    throw new Error('reaction decision kind must be ignore or follow-up');
  }
  assertNonEmpty(decision.description, 'follow-up reaction description');
  assertFinite(decision.priority, 'follow-up reaction priority');
  assertPositiveFinite(decision.reactionWindowMs, 'follow-up reaction window');
  if (decision.affinityTags.length === 0) {
    throw new Error('follow-up reaction affinityTags must not be empty');
  }
  for (const tag of decision.affinityTags) {
    assertNonEmpty(tag, 'follow-up reaction affinityTag');
  }
}

function assertValidProviderTrace(trace: ReactionEvaluationProviderTrace): void {
  if (!['accepted', 'fallback', 'deterministic'].includes(trace.status)) {
    throw new Error('reaction trace status must be accepted, fallback, or deterministic');
  }
  if (!['llm', 'deterministic-fallback', 'deterministic'].includes(trace.source)) {
    throw new Error('reaction trace source must be llm, deterministic-fallback, or deterministic');
  }
  if (trace.requestId !== undefined) {
    assertNonEmpty(trace.requestId, 'reaction trace requestId');
  }
  if (trace.providerId !== undefined) {
    assertNonEmpty(trace.providerId, 'reaction trace providerId');
  }
  if (trace.model !== undefined) {
    assertNonEmpty(trace.model, 'reaction trace model');
  }
  if (trace.failureReason !== undefined) {
    assertNonEmpty(trace.failureReason, 'reaction trace failureReason');
  }
  if (trace.message !== undefined) {
    assertNonEmpty(trace.message, 'reaction trace message');
  }
  for (const attempt of trace.attempts ?? []) {
    assertValidProviderAttempt(attempt);
  }
  if (trace.usage !== undefined) {
    assertValidProviderUsage(trace.usage);
  }
}

function assertValidProviderAttempt(attempt: ReactionEvaluationAttemptTrace): void {
  if (!Number.isInteger(attempt.attemptIndex) || attempt.attemptIndex < 1) {
    throw new Error('reaction trace attemptIndex must be a positive integer');
  }
  assertNonEmpty(attempt.status, 'reaction trace attempt status');
  assertNonEmpty(attempt.providerId, 'reaction trace attempt providerId');
  assertNonEmpty(attempt.model, 'reaction trace attempt model');
  assertNonEmpty(attempt.message, 'reaction trace attempt message');
  assertValidProviderUsage(attempt.usage);
}

function assertValidProviderUsage(usage: ReactionEvaluationUsageTrace): void {
  assertFinite(usage.inputTokens, 'reaction trace inputTokens');
  assertFinite(usage.outputTokens, 'reaction trace outputTokens');
  assertFinite(usage.totalTokens, 'reaction trace totalTokens');
  assertFinite(usage.estimatedCostMicros, 'reaction trace estimatedCostMicros');
}

function assertValidQuery(query: ReactionEvaluationTraceQuery): void {
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
  if (query.memoryRecordId !== undefined) {
    assertNonEmpty(query.memoryRecordId, 'memoryRecordId');
  }
  if (
    query.decisionKind !== undefined &&
    query.decisionKind !== 'ignore' &&
    query.decisionKind !== 'follow-up'
  ) {
    throw new Error('decisionKind must be ignore or follow-up');
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

function assertConfidence(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('reaction confidence must be within [0, 1]');
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
