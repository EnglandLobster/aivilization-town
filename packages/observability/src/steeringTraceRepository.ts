import { join } from 'node:path';
import type { HumanCommandAttribution } from '@aivilization/sim-core';
import { BoundedTraceLedger, type BoundedTraceLedgerDiagnostics } from './boundedTraceLedger';
import {
  cloneWorldDecisionContextTrace,
  type WorldDecisionContextTrace,
} from './worldDecisionContextTrace';

export type SteeringStrategicPlanUsageTrace = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
};

export type SteeringStrategicPlanAttemptTrace = {
  readonly attemptIndex: number;
  readonly status: string;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: SteeringStrategicPlanUsageTrace;
};

export type SteeringStrategicPlanTrace = {
  readonly status: 'accepted' | 'fallback' | 'deterministic';
  readonly source: 'llm' | 'deterministic-fallback' | 'deterministic';
  readonly plannerVariant?: 'default' | 'without-branch' | 'without-objective-decomposition';
  readonly ablationPolicyVersion?: 'paper-planner-ablation-v1';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly attempts?: readonly SteeringStrategicPlanAttemptTrace[];
  readonly usage?: SteeringStrategicPlanUsageTrace;
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type SteeringTraceResultKind = 'long-horizon-objective-set' | 'reactive-command-routed';

export type SteeringTrace = {
  readonly traceId: string;
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly commandId: string;
  readonly commandType: string;
  readonly source: string;
  readonly humanAttribution?: HumanCommandAttribution;
  readonly agentId: string;
  readonly resultKind: SteeringTraceResultKind;
  readonly objectiveId?: string;
  readonly objectiveStatement?: string;
  readonly objectiveAffinityTags?: readonly string[];
  readonly planId?: string;
  readonly reactiveCommandId?: string;
  readonly selectedPlannerDomain?: string;
  readonly candidateActionCount: number;
  readonly commandDraftCount: number;
  readonly shortTermMemoryRecordIds: readonly string[];
  readonly strategicPlan?: SteeringStrategicPlanTrace;
  readonly issuedAt: number;
  readonly recordedAt: number;
};

export type SteeringTraceQuery = {
  readonly simulationId: string;
  readonly partitionKey?: string;
  readonly traceId?: string;
  readonly commandId?: string;
  readonly agentId?: string;
  readonly objectiveId?: string;
  readonly reactiveCommandId?: string;
  readonly resultKind?: SteeringTraceResultKind;
  readonly fromIssuedAt?: number;
  readonly toIssuedAt?: number;
  readonly limit?: number;
};

export type SteeringTraceRepository = {
  readonly record: (trace: SteeringTrace) => Promise<void>;
  readonly get: (traceId: string) => Promise<SteeringTrace | undefined>;
  readonly query: (query: SteeringTraceQuery) => Promise<SteeringTrace[]>;
};

export class InMemorySteeringTraceRepository implements SteeringTraceRepository {
  private readonly tracesById = new Map<string, SteeringTrace>();

  record(trace: SteeringTrace): Promise<void> {
    return Promise.resolve().then(() => {
      const cloned = cloneTrace(trace);
      if (!this.tracesById.has(cloned.traceId)) {
        this.tracesById.set(cloned.traceId, cloned);
      }
    });
  }

  get(traceId: string): Promise<SteeringTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const trace = this.tracesById.get(traceId);
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(query: SteeringTraceQuery): Promise<SteeringTrace[]> {
    return Promise.resolve().then(() => queryTraces([...this.tracesById.values()], query));
  }
}

export class FileSteeringTraceRepository implements SteeringTraceRepository {
  private readonly traces: BoundedTraceLedger<SteeringTrace>;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.traces = new BoundedTraceLedger({
      path: join(input.rootDir, 'steering-traces.jsonl'),
      keyOf: (trace) => trace.traceId,
      clone: cloneTrace,
    });
  }

  record(trace: SteeringTrace): Promise<void> {
    return Promise.resolve().then(() => {
      this.traces.appendUnique(trace);
    });
  }

  get(traceId: string): Promise<SteeringTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      return this.traces.get(traceId);
    });
  }

  query(query: SteeringTraceQuery): Promise<SteeringTrace[]> {
    return Promise.resolve().then(() => queryTraces(this.traces.readAll(), query));
  }

  getStorageDiagnostics(): BoundedTraceLedgerDiagnostics {
    return this.traces.diagnostics();
  }
}

function queryTraces(traces: readonly SteeringTrace[], query: SteeringTraceQuery): SteeringTrace[] {
  assertValidQuery(query);
  return traces
    .filter((trace) => trace.simulationId === query.simulationId)
    .filter(
      (trace) => query.partitionKey === undefined || trace.partitionKey === query.partitionKey,
    )
    .filter((trace) => query.traceId === undefined || trace.traceId === query.traceId)
    .filter((trace) => query.commandId === undefined || trace.commandId === query.commandId)
    .filter((trace) => query.agentId === undefined || trace.agentId === query.agentId)
    .filter((trace) => query.objectiveId === undefined || trace.objectiveId === query.objectiveId)
    .filter(
      (trace) =>
        query.reactiveCommandId === undefined ||
        trace.reactiveCommandId === query.reactiveCommandId,
    )
    .filter((trace) => query.resultKind === undefined || trace.resultKind === query.resultKind)
    .filter((trace) => query.fromIssuedAt === undefined || trace.issuedAt >= query.fromIssuedAt)
    .filter((trace) => query.toIssuedAt === undefined || trace.issuedAt <= query.toIssuedAt)
    .sort(compareTraceLatestFirst)
    .slice(0, query.limit)
    .map((trace) => cloneTrace(trace));
}

function cloneTrace(trace: SteeringTrace): SteeringTrace {
  assertValidTrace(trace);
  return {
    traceId: trace.traceId,
    simulationId: trace.simulationId,
    partitionKey: trace.partitionKey,
    commandId: trace.commandId,
    commandType: trace.commandType,
    source: trace.source,
    ...(trace.humanAttribution === undefined
      ? {}
      : {
          humanAttribution: {
            ...trace.humanAttribution,
            principalRoles: [...trace.humanAttribution.principalRoles],
          },
        }),
    agentId: trace.agentId,
    resultKind: trace.resultKind,
    ...(trace.objectiveId === undefined ? {} : { objectiveId: trace.objectiveId }),
    ...(trace.objectiveStatement === undefined
      ? {}
      : { objectiveStatement: trace.objectiveStatement }),
    ...(trace.objectiveAffinityTags === undefined
      ? {}
      : { objectiveAffinityTags: [...trace.objectiveAffinityTags] }),
    ...(trace.planId === undefined ? {} : { planId: trace.planId }),
    ...(trace.reactiveCommandId === undefined
      ? {}
      : { reactiveCommandId: trace.reactiveCommandId }),
    ...(trace.selectedPlannerDomain === undefined
      ? {}
      : { selectedPlannerDomain: trace.selectedPlannerDomain }),
    candidateActionCount: trace.candidateActionCount,
    commandDraftCount: trace.commandDraftCount,
    shortTermMemoryRecordIds: [...trace.shortTermMemoryRecordIds],
    ...(trace.strategicPlan === undefined
      ? {}
      : { strategicPlan: cloneStrategicPlan(trace.strategicPlan) }),
    issuedAt: trace.issuedAt,
    recordedAt: trace.recordedAt,
  };
}

function cloneStrategicPlan(trace: SteeringStrategicPlanTrace): SteeringStrategicPlanTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.plannerVariant === undefined ? {} : { plannerVariant: trace.plannerVariant }),
    ...(trace.ablationPolicyVersion === undefined
      ? {}
      : { ablationPolicyVersion: trace.ablationPolicyVersion }),
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.attempts === undefined
      ? {}
      : { attempts: trace.attempts.map((attempt) => cloneStrategicPlanAttempt(attempt)) }),
    ...(trace.usage === undefined ? {} : { usage: cloneStrategicPlanUsage(trace.usage) }),
    ...(trace.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: trace.observedStateSummary }),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function cloneStrategicPlanAttempt(
  attempt: SteeringStrategicPlanAttemptTrace,
): SteeringStrategicPlanAttemptTrace {
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
  usage: SteeringStrategicPlanUsageTrace,
): SteeringStrategicPlanUsageTrace {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedCostMicros: usage.estimatedCostMicros,
  };
}

function compareTraceLatestFirst(left: SteeringTrace, right: SteeringTrace): number {
  if (left.issuedAt !== right.issuedAt) {
    return right.issuedAt - left.issuedAt;
  }
  return right.traceId.localeCompare(left.traceId);
}

function assertValidTrace(trace: SteeringTrace): void {
  assertNonEmpty(trace.traceId, 'traceId');
  assertNonEmpty(trace.simulationId, 'simulationId');
  assertNonEmpty(trace.partitionKey, 'partitionKey');
  assertNonEmpty(trace.commandId, 'commandId');
  assertNonEmpty(trace.commandType, 'commandType');
  assertNonEmpty(trace.source, 'source');
  if (trace.humanAttribution !== undefined) {
    assertNonEmpty(
      trace.humanAttribution.principalSubjectId,
      'humanAttribution principalSubjectId',
    );
    assertNonEmpty(
      trace.humanAttribution.accessPolicyVersion,
      'humanAttribution accessPolicyVersion',
    );
    assertNonEmpty(
      trace.humanAttribution.consentPolicyVersion,
      'humanAttribution consentPolicyVersion',
    );
    if (trace.humanAttribution.principalRoles.length === 0) {
      throw new Error('humanAttribution principalRoles must not be empty');
    }
  }
  assertNonEmpty(trace.agentId, 'agentId');
  assertResultKind(trace.resultKind);
  if (trace.objectiveStatement !== undefined) {
    assertNonEmpty(trace.objectiveStatement, 'objectiveStatement');
  }
  if (trace.objectiveAffinityTags !== undefined) {
    for (const tag of trace.objectiveAffinityTags) {
      assertNonEmpty(tag, 'objectiveAffinityTag');
    }
  }
  assertNonNegativeInteger(trace.candidateActionCount, 'candidateActionCount');
  assertNonNegativeInteger(trace.commandDraftCount, 'commandDraftCount');
  assertFinite(trace.issuedAt, 'issuedAt');
  assertFinite(trace.recordedAt, 'recordedAt');
}

function assertValidQuery(query: SteeringTraceQuery): void {
  assertNonEmpty(query.simulationId, 'simulationId');
  if (query.partitionKey !== undefined) {
    assertNonEmpty(query.partitionKey, 'partitionKey');
  }
  if (query.traceId !== undefined) {
    assertNonEmpty(query.traceId, 'traceId');
  }
  if (query.commandId !== undefined) {
    assertNonEmpty(query.commandId, 'commandId');
  }
  if (query.agentId !== undefined) {
    assertNonEmpty(query.agentId, 'agentId');
  }
  if (query.objectiveId !== undefined) {
    assertNonEmpty(query.objectiveId, 'objectiveId');
  }
  if (query.reactiveCommandId !== undefined) {
    assertNonEmpty(query.reactiveCommandId, 'reactiveCommandId');
  }
  if (query.resultKind !== undefined) {
    assertResultKind(query.resultKind);
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

function assertResultKind(value: string): asserts value is SteeringTraceResultKind {
  if (value !== 'long-horizon-objective-set' && value !== 'reactive-command-routed') {
    throw new Error('resultKind must be a known steering result kind');
  }
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
