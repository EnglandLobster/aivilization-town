import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAgentCycleTrace,
  type AgentCycleActionProposalTrace,
  type AgentCycleActionResourceEstimateTrace,
  type AgentCycleActionSynthesisTrace,
  type AgentCycleTrace,
  type AgentCycleSelectionTraceEvidence,
  type AgentCycleSubtaskCandidateTrace,
  type ReplanningTraceDecision,
  type SimulatorTraceResult,
} from './agentCycleTrace';

export type AgentCycleTraceQuery = {
  readonly simulationId: string;
  readonly agentId?: string;
  readonly fromCycleStartedAt?: number;
  readonly toCycleStartedAt?: number;
  readonly limit?: number;
};

export type AgentCycleTraceRepository = {
  readonly record: (trace: AgentCycleTrace) => Promise<void>;
  readonly get: (traceId: string) => Promise<AgentCycleTrace | undefined>;
  readonly query: (query: AgentCycleTraceQuery) => Promise<AgentCycleTrace[]>;
};

export class InMemoryAgentCycleTraceRepository implements AgentCycleTraceRepository {
  private readonly tracesById = new Map<string, AgentCycleTrace>();

  record(trace: AgentCycleTrace): Promise<void> {
    if (!this.tracesById.has(trace.traceId)) {
      this.tracesById.set(trace.traceId, cloneTrace(trace));
    }
    return Promise.resolve();
  }

  get(traceId: string): Promise<AgentCycleTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const trace = this.tracesById.get(traceId);
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(query: AgentCycleTraceQuery): Promise<AgentCycleTrace[]> {
    return Promise.resolve().then(() => queryTraces([...this.tracesById.values()], query));
  }
}

export class FileAgentCycleTraceRepository implements AgentCycleTraceRepository {
  private readonly tracesPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.tracesPath = join(input.rootDir, 'agent-cycle-traces.jsonl');
    ensureFile(this.tracesPath, input.rootDir);
  }

  async record(trace: AgentCycleTrace): Promise<void> {
    if ((await this.get(trace.traceId)) !== undefined) {
      return;
    }
    appendJsonLines(this.tracesPath, [cloneTrace(trace)]);
  }

  get(traceId: string): Promise<AgentCycleTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const trace = readJsonLines<AgentCycleTrace>(this.tracesPath).find(
        (candidate) => candidate.traceId === traceId,
      );
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(query: AgentCycleTraceQuery): Promise<AgentCycleTrace[]> {
    return Promise.resolve().then(() =>
      queryTraces(readJsonLines<AgentCycleTrace>(this.tracesPath), query),
    );
  }
}

function queryTraces(
  traces: readonly AgentCycleTrace[],
  query: AgentCycleTraceQuery,
): AgentCycleTrace[] {
  assertValidQuery(query);
  return traces
    .filter((trace) => trace.simulationId === query.simulationId)
    .filter((trace) => query.agentId === undefined || trace.agentId === query.agentId)
    .filter(
      (trace) =>
        query.fromCycleStartedAt === undefined ||
        trace.cycleStartedAt >= query.fromCycleStartedAt,
    )
    .filter(
      (trace) =>
        query.toCycleStartedAt === undefined || trace.cycleStartedAt <= query.toCycleStartedAt,
    )
    .sort(compareTraceLatestFirst)
    .slice(0, query.limit)
    .map((trace) => cloneTrace(trace));
}

function cloneTrace(trace: AgentCycleTrace): AgentCycleTrace {
  return createAgentCycleTrace({
    traceId: trace.traceId,
    simulationId: trace.simulationId,
    agentId: trace.agentId,
    cycleStartedAt: trace.cycleStartedAt,
    observedStateSummary: trace.observedStateSummary,
    selectedBranch: trace.selectedBranch,
    subtaskCandidates: trace.subtaskCandidates.map((candidate) =>
      cloneSubtaskCandidate(candidate),
    ),
    actionSynthesis: cloneActionSynthesis(trace.actionSynthesis),
    candidateActions: [...trace.candidateActions],
    simulatorResult: cloneSimulatorResult(trace.simulatorResult),
    selectionEvidence: cloneSelectionEvidence(trace.selectionEvidence),
    replanningDecision: cloneReplanningDecision(trace.replanningDecision),
    emittedCommandIds: [...trace.emittedCommandIds],
    memoryContextIds: [...trace.memoryContextIds],
    memoryWriteIds: [...trace.memoryWriteIds],
  });
}

function cloneActionSynthesis(
  actionSynthesis: AgentCycleActionSynthesisTrace,
): AgentCycleActionSynthesisTrace {
  return {
    acceptedActions: actionSynthesis.acceptedActions.map((action) => cloneActionProposal(action)),
    rejectedActions: actionSynthesis.rejectedActions.map((rejectedAction) => ({
      action: cloneActionProposal(rejectedAction.action),
      reason: rejectedAction.reason,
    })),
  };
}

function cloneActionProposal(
  action: AgentCycleActionProposalTrace,
): AgentCycleActionProposalTrace {
  return {
    id: action.id,
    description: action.description,
    commandType: action.commandType,
    ...(action.priority === undefined ? {} : { priority: action.priority }),
    ...(action.resourceEstimate === undefined
      ? {}
      : { resourceEstimate: cloneResourceEstimate(action.resourceEstimate) }),
  };
}

function cloneResourceEstimate(
  resourceEstimate: AgentCycleActionResourceEstimateTrace,
): AgentCycleActionResourceEstimateTrace {
  return {
    ...(resourceEstimate.actionSeconds === undefined
      ? {}
      : { actionSeconds: resourceEstimate.actionSeconds }),
    ...(resourceEstimate.energyCost === undefined
      ? {}
      : { energyCost: resourceEstimate.energyCost }),
    ...(resourceEstimate.satietyCost === undefined
      ? {}
      : { satietyCost: resourceEstimate.satietyCost }),
    ...(resourceEstimate.currencyCost === undefined
      ? {}
      : { currencyCost: resourceEstimate.currencyCost }),
    ...(resourceEstimate.inventoryCosts === undefined
      ? {}
      : { inventoryCosts: { ...resourceEstimate.inventoryCosts } }),
  };
}

function cloneSubtaskCandidate(
  candidate: AgentCycleSubtaskCandidateTrace,
): AgentCycleSubtaskCandidateTrace {
  return {
    branchId: candidate.branchId,
    subtaskId: candidate.subtaskId,
    description: candidate.description,
    score: candidate.score,
    scoreBreakdown: {
      basePriorityScore: candidate.scoreBreakdown.basePriorityScore,
      signalInfluenceScore: candidate.scoreBreakdown.signalInfluenceScore,
      intentionInfluenceScore: candidate.scoreBreakdown.intentionInfluenceScore,
      memoryInfluenceScore: candidate.scoreBreakdown.memoryInfluenceScore,
      profileInfluenceScore: candidate.scoreBreakdown.profileInfluenceScore,
    },
  };
}

function cloneSimulatorResult(result: SimulatorTraceResult): SimulatorTraceResult {
  switch (result.status) {
    case 'accepted':
      return {
        status: 'accepted',
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      };
    case 'rejected':
      return { status: 'rejected', reason: result.reason };
    case 'repaired':
      return { status: 'repaired', reason: result.reason };
  }
}

function cloneSelectionEvidence(
  evidence: AgentCycleSelectionTraceEvidence,
): AgentCycleSelectionTraceEvidence {
  return {
    selectedSubtaskId: evidence.selectedSubtaskId,
    intentionInfluenceScore: evidence.intentionInfluenceScore,
    memoryInfluenceScore: evidence.memoryInfluenceScore,
    profileInfluenceScore: evidence.profileInfluenceScore,
    memoryEvidenceRecordIds: [...evidence.memoryEvidenceRecordIds],
    profileEntryKeys: [...evidence.profileEntryKeys],
    profileEvidenceRecordIds: [...evidence.profileEvidenceRecordIds],
  };
}

function cloneReplanningDecision(decision: ReplanningTraceDecision): ReplanningTraceDecision {
  switch (decision.kind) {
    case 'none':
      return { kind: 'none' };
    case 'memory-guided-correction':
      return {
        kind: 'memory-guided-correction',
        trigger: decision.trigger,
        reason: decision.reason,
        failedActionIds: [...decision.failedActionIds],
        evidenceRecordIds: [...decision.evidenceRecordIds],
      };
    case 'full-replan':
      return {
        kind: 'full-replan',
        trigger: decision.trigger,
        reason: decision.reason,
        failedActionIds: [...decision.failedActionIds],
        evidenceRecordIds: [...decision.evidenceRecordIds],
        matchingFailureCount: decision.matchingFailureCount,
      };
  }
}

function compareTraceLatestFirst(left: AgentCycleTrace, right: AgentCycleTrace): number {
  if (left.cycleStartedAt !== right.cycleStartedAt) {
    return right.cycleStartedAt - left.cycleStartedAt;
  }
  return right.traceId.localeCompare(left.traceId);
}

function assertValidQuery(query: AgentCycleTraceQuery): void {
  assertNonEmpty(query.simulationId, 'simulationId');
  if (query.limit !== undefined && (!Number.isFinite(query.limit) || query.limit <= 0)) {
    throw new Error('limit must be positive');
  }
  if (
    query.fromCycleStartedAt !== undefined &&
    !Number.isFinite(query.fromCycleStartedAt)
  ) {
    throw new Error('fromCycleStartedAt must be finite');
  }
  if (query.toCycleStartedAt !== undefined && !Number.isFinite(query.toCycleStartedAt)) {
    throw new Error('toCycleStartedAt must be finite');
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
