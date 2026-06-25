import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAgentCycleTrace,
  type AgentCycleActionRepairTrace,
  type AgentCycleActionSequenceGenerationTrace,
  type AgentCycleContextualPrioritizationTrace,
  type AgentCycleGlobalSynthesisTrace,
  type AgentCycleSocialDialogueGenerationTrace,
  type AgentCycleActionProposalTrace,
  type AgentCycleActionResourceEstimateTrace,
  type AgentCycleActionSynthesisContextTrace,
  type AgentCycleActionSynthesisTrace,
  type AgentCycleReplanMaterializationTrace,
  type AgentCycleReplanningDecisionTrace,
  type AgentCycleSimulatorEventTrace,
  type AgentCycleSimulatorTraceEvent,
  type AgentCycleTrace,
  type AgentCycleSelectionTraceEvidence,
  type AgentCycleSubtaskCandidateTrace,
  type AgentCycleSubtaskReplanningDecisionTrace,
  type ReplanningTraceDecision,
  type SimulatorTraceResult,
} from './agentCycleTrace';
import { cloneWorldDecisionContextTrace } from './worldDecisionContextTrace';

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

type PersistedAgentCycleTrace = Omit<
  AgentCycleTrace,
  'simulatorEvents' | 'subtaskReplanningDecisions'
> & {
  readonly simulatorEvents?: readonly AgentCycleSimulatorEventTrace[];
  readonly subtaskReplanningDecisions?: readonly AgentCycleSubtaskReplanningDecisionTrace[];
};

type LlmCognitiveContextTrace = {
  readonly shortTermMemoryContext?: { readonly recordCount: number };
  readonly longTermProfileContext?: { readonly entryCount: number };
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
      const trace = readJsonLines<PersistedAgentCycleTrace>(this.tracesPath).find(
        (candidate) => candidate.traceId === traceId,
      );
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(query: AgentCycleTraceQuery): Promise<AgentCycleTrace[]> {
    return Promise.resolve().then(() =>
      queryTraces(readJsonLines<PersistedAgentCycleTrace>(this.tracesPath), query),
    );
  }
}

function queryTraces(
  traces: readonly PersistedAgentCycleTrace[],
  query: AgentCycleTraceQuery,
): AgentCycleTrace[] {
  assertValidQuery(query);
  return traces
    .filter((trace) => trace.simulationId === query.simulationId)
    .filter((trace) => query.agentId === undefined || trace.agentId === query.agentId)
    .filter(
      (trace) =>
        query.fromCycleStartedAt === undefined || trace.cycleStartedAt >= query.fromCycleStartedAt,
    )
    .filter(
      (trace) =>
        query.toCycleStartedAt === undefined || trace.cycleStartedAt <= query.toCycleStartedAt,
    )
    .sort(compareTraceLatestFirst)
    .slice(0, query.limit)
    .map((trace) => cloneTrace(trace));
}

function cloneTrace(trace: PersistedAgentCycleTrace): AgentCycleTrace {
  return createAgentCycleTrace({
    traceId: trace.traceId,
    simulationId: trace.simulationId,
    agentId: trace.agentId,
    cycleStartedAt: trace.cycleStartedAt,
    observedStateSummary: trace.observedStateSummary,
    selectedBranch: trace.selectedBranch,
    ...(trace.contextualPrioritization === undefined
      ? {}
      : {
          contextualPrioritization: cloneContextualPrioritization(trace.contextualPrioritization),
        }),
    ...(trace.actionSequenceGeneration === undefined
      ? {}
      : {
          actionSequenceGeneration: trace.actionSequenceGeneration.map((entry) =>
            cloneActionSequenceGeneration(entry),
          ),
        }),
    ...(trace.socialDialogueGeneration === undefined
      ? {}
      : {
          socialDialogueGeneration: trace.socialDialogueGeneration.map((entry) =>
            cloneSocialDialogueGeneration(entry),
          ),
        }),
    ...(trace.globalSynthesis === undefined
      ? {}
      : { globalSynthesis: cloneGlobalSynthesis(trace.globalSynthesis) }),
    subtaskCandidates: trace.subtaskCandidates.map((candidate) => cloneSubtaskCandidate(candidate)),
    actionSynthesis: cloneActionSynthesis(trace.actionSynthesis),
    candidateActions: [...trace.candidateActions],
    simulatorResult: cloneSimulatorResult(trace.simulatorResult),
    simulatorEvents: (trace.simulatorEvents ?? []).map((entry) => cloneSimulatorEventTrace(entry)),
    selectionEvidence: cloneSelectionEvidence(trace.selectionEvidence),
    replanningDecision: cloneReplanningDecision(trace.replanningDecision),
    ...(trace.replanningDecisionTrace === undefined
      ? {}
      : { replanningDecisionTrace: cloneReplanningDecisionTrace(trace.replanningDecisionTrace) }),
    ...(trace.replanMaterialization === undefined
      ? {}
      : { replanMaterialization: cloneReplanMaterialization(trace.replanMaterialization) }),
    subtaskReplanningDecisions: (trace.subtaskReplanningDecisions ?? []).map((decision) =>
      cloneSubtaskReplanningDecision(decision),
    ),
    ...(trace.actionRepair === undefined
      ? {}
      : { actionRepair: trace.actionRepair.map((entry) => cloneActionRepair(entry)) }),
    emittedCommandIds: [...trace.emittedCommandIds],
    memoryContextIds: [...trace.memoryContextIds],
    memoryWriteIds: [...trace.memoryWriteIds],
  });
}

function cloneActionRepair(trace: AgentCycleActionRepairTrace): AgentCycleActionRepairTrace {
  return {
    actionId: trace.actionId,
    rejectionReason: trace.rejectionReason,
    selectedSubtask: {
      branchId: trace.selectedSubtask.branchId,
      subtaskId: trace.selectedSubtask.subtaskId,
    },
    localRepair: {
      status: trace.localRepair.status,
      ...(trace.localRepair.attemptedAction === undefined
        ? {}
        : {
            attemptedAction: {
              id: trace.localRepair.attemptedAction.id,
              description: trace.localRepair.attemptedAction.description,
              commandType: trace.localRepair.attemptedAction.commandType,
            },
          }),
      ...(trace.localRepair.rejectionReason === undefined
        ? {}
        : { rejectionReason: trace.localRepair.rejectionReason }),
    },
    ...(trace.reactiveCorrection === undefined
      ? {}
      : { reactiveCorrection: cloneReactiveCorrection(trace.reactiveCorrection) }),
    outcome: trace.outcome,
  };
}

function cloneLlmCognitiveContext(trace: LlmCognitiveContextTrace): LlmCognitiveContextTrace {
  return {
    ...(trace.shortTermMemoryContext === undefined
      ? {}
      : { shortTermMemoryContext: { recordCount: trace.shortTermMemoryContext.recordCount } }),
    ...(trace.longTermProfileContext === undefined
      ? {}
      : { longTermProfileContext: { entryCount: trace.longTermProfileContext.entryCount } }),
  };
}

function cloneReactiveCorrection(
  trace: NonNullable<AgentCycleActionRepairTrace['reactiveCorrection']>,
): NonNullable<AgentCycleActionRepairTrace['reactiveCorrection']> {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    decision:
      trace.decision.kind === 'no-correction'
        ? {
            kind: 'no-correction',
            rationale: trace.decision.rationale,
            evidenceRecordIds: [...trace.decision.evidenceRecordIds],
          }
        : {
            kind: 'propose-action',
            rationale: trace.decision.rationale,
            evidenceRecordIds: [...trace.decision.evidenceRecordIds],
            action: {
              id: trace.decision.action.id,
              description: trace.decision.action.description,
              commandType: trace.decision.action.commandType,
            },
          },
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...cloneLlmCognitiveContext(trace),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
    ...(trace.simulatorResult === undefined
      ? {}
      : {
          simulatorResult: {
            status: trace.simulatorResult.status,
            ...(trace.simulatorResult.reason === undefined
              ? {}
              : { reason: trace.simulatorResult.reason }),
            ...(trace.simulatorResult.traceEvents === undefined
              ? {}
              : {
                  traceEvents: trace.simulatorResult.traceEvents.map((event) =>
                    cloneSimulatorTraceEvent(event),
                  ),
                }),
          },
        }),
  };
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

function cloneActionProposal(action: AgentCycleActionProposalTrace): AgentCycleActionProposalTrace {
  return {
    id: action.id,
    description: action.description,
    commandType: action.commandType,
    ...(action.priority === undefined ? {} : { priority: action.priority }),
    ...(action.synthesisContext === undefined
      ? {}
      : { synthesisContext: cloneSynthesisContext(action.synthesisContext) }),
    ...(action.resourceEstimate === undefined
      ? {}
      : { resourceEstimate: cloneResourceEstimate(action.resourceEstimate) }),
  };
}

function cloneSynthesisContext(
  synthesisContext: AgentCycleActionSynthesisContextTrace,
): AgentCycleActionSynthesisContextTrace {
  return {
    ...(synthesisContext.branchId === undefined ? {} : { branchId: synthesisContext.branchId }),
    ...(synthesisContext.subtaskId === undefined ? {} : { subtaskId: synthesisContext.subtaskId }),
    ...(synthesisContext.subtaskScore === undefined
      ? {}
      : { subtaskScore: synthesisContext.subtaskScore }),
    ...(synthesisContext.strategicAlignment === undefined
      ? {}
      : { strategicAlignment: synthesisContext.strategicAlignment }),
    ...(synthesisContext.branchUrgency === undefined
      ? {}
      : { branchUrgency: synthesisContext.branchUrgency }),
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
      ...(candidate.scoreBreakdown.contextualReasoningScore === undefined
        ? {}
        : { contextualReasoningScore: candidate.scoreBreakdown.contextualReasoningScore }),
    },
  };
}

function cloneContextualPrioritization(
  trace: AgentCycleContextualPrioritizationTrace,
): AgentCycleContextualPrioritizationTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.choices === undefined
      ? {}
      : {
          choices: trace.choices.map((choice) => ({
            branchId: choice.branchId,
            subtaskId: choice.subtaskId,
            priorityScore: choice.priorityScore,
            rationale: choice.rationale,
          })),
        }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...cloneLlmCognitiveContext(trace),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function cloneActionSequenceGeneration(
  trace: AgentCycleActionSequenceGenerationTrace,
): AgentCycleActionSequenceGenerationTrace {
  return {
    status: trace.status,
    source: trace.source,
    selectedSubtask: {
      branchId: trace.selectedSubtask.branchId,
      subtaskId: trace.selectedSubtask.subtaskId,
    },
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.actions === undefined
      ? {}
      : {
          actions: trace.actions.map((action) => ({
            id: action.id,
            commandType: action.commandType,
            rationale: action.rationale,
          })),
        }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...cloneLlmCognitiveContext(trace),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function cloneSocialDialogueGeneration(
  trace: AgentCycleSocialDialogueGenerationTrace,
): AgentCycleSocialDialogueGenerationTrace {
  return {
    status: trace.status,
    source: trace.source,
    selectedSubtask: {
      branchId: trace.selectedSubtask.branchId,
      subtaskId: trace.selectedSubtask.subtaskId,
    },
    actionId: trace.actionId,
    targetAgentId: trace.targetAgentId,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    turnCount: trace.turnCount,
    rationale: trace.rationale,
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...cloneLlmCognitiveContext(trace),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function cloneGlobalSynthesis(
  trace: AgentCycleGlobalSynthesisTrace,
): AgentCycleGlobalSynthesisTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.choices === undefined
      ? {}
      : {
          choices: trace.choices.map((choice) => ({
            actionId: choice.actionId,
            priorityScore: choice.priorityScore,
            rationale: choice.rationale,
            ...(choice.strategicAlignment === undefined
              ? {}
              : { strategicAlignment: choice.strategicAlignment }),
            ...(choice.branchUrgency === undefined ? {} : { branchUrgency: choice.branchUrgency }),
          })),
        }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...cloneLlmCognitiveContext(trace),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function cloneReplanMaterialization(
  materialization: AgentCycleReplanMaterializationTrace,
): AgentCycleReplanMaterializationTrace {
  switch (materialization.status) {
    case 'replanned':
      return {
        status: 'replanned',
        objectiveId: materialization.objectiveId,
        planId: materialization.planId,
        progressReset: materialization.progressReset,
        trigger: materialization.trigger,
        failedActionIds: [...materialization.failedActionIds],
        evidenceRecordIds: [...materialization.evidenceRecordIds],
        matchingFailureCount: materialization.matchingFailureCount,
      };
    case 'skipped':
      return {
        status: 'skipped',
        planId: materialization.planId,
        reason: materialization.reason,
        ...(materialization.objectiveId === undefined
          ? {}
          : { objectiveId: materialization.objectiveId }),
      };
  }
}

function cloneSubtaskReplanningDecision(
  decision: AgentCycleSubtaskReplanningDecisionTrace,
): AgentCycleSubtaskReplanningDecisionTrace {
  return {
    branchId: decision.branchId,
    subtaskId: decision.subtaskId,
    decision: cloneReplanningDecision(decision.decision),
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

function cloneSimulatorEventTrace(
  entry: AgentCycleSimulatorEventTrace,
): AgentCycleSimulatorEventTrace {
  return {
    actionId: entry.actionId,
    attempt: entry.attempt,
    status: entry.status,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    events: entry.events.map((event) => cloneSimulatorTraceEvent(event)),
  };
}

function cloneSimulatorTraceEvent(
  event: AgentCycleSimulatorTraceEvent,
): AgentCycleSimulatorTraceEvent {
  return {
    type: event.type,
    ...(event.sequence === undefined ? {} : { sequence: event.sequence }),
    ...(event.summary === undefined ? {} : { summary: event.summary }),
  };
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

function cloneReplanningDecisionTrace(
  trace: AgentCycleReplanningDecisionTrace,
): AgentCycleReplanningDecisionTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    decision: cloneReplanningDecision(trace.decision),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...cloneLlmCognitiveContext(trace),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function compareTraceLatestFirst(
  left: PersistedAgentCycleTrace,
  right: PersistedAgentCycleTrace,
): number {
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
  if (query.fromCycleStartedAt !== undefined && !Number.isFinite(query.fromCycleStartedAt)) {
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
