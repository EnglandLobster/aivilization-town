export type SimulatorTraceResult =
  | { readonly status: 'accepted'; readonly reason?: string }
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'repaired'; readonly reason: string };

export type ReplanningTraceDecision =
  | {
      readonly kind: 'none';
    }
  | {
      readonly kind: 'memory-guided-correction';
      readonly trigger: 'simulator-rejection';
      readonly reason: string;
      readonly failedActionIds: readonly string[];
      readonly evidenceRecordIds: readonly string[];
    }
  | {
      readonly kind: 'full-replan';
      readonly trigger: 'major-context-shift' | 'repeated-failure';
      readonly reason: string;
      readonly failedActionIds: readonly string[];
      readonly evidenceRecordIds: readonly string[];
      readonly matchingFailureCount: number;
    };

export type AgentCycleSelectionTraceEvidence = {
  readonly selectedSubtaskId: string;
  readonly intentionInfluenceScore: number;
  readonly memoryInfluenceScore: number;
  readonly profileInfluenceScore: number;
  readonly memoryEvidenceRecordIds: readonly string[];
  readonly profileEntryKeys: readonly string[];
  readonly profileEvidenceRecordIds: readonly string[];
};

export type AgentCycleSubtaskCandidateTrace = {
  readonly branchId: string;
  readonly subtaskId: string;
  readonly description: string;
  readonly score: number;
  readonly scoreBreakdown: {
    readonly basePriorityScore: number;
    readonly signalInfluenceScore: number;
    readonly intentionInfluenceScore: number;
    readonly memoryInfluenceScore: number;
    readonly profileInfluenceScore: number;
  };
};

export type AgentCycleSubtaskReplanningDecisionTrace = {
  readonly branchId: string;
  readonly subtaskId: string;
  readonly decision: ReplanningTraceDecision;
};

export type AgentCycleActionResourceEstimateTrace = {
  readonly actionSeconds?: number;
  readonly energyCost?: number;
  readonly satietyCost?: number;
  readonly currencyCost?: number;
  readonly inventoryCosts?: Readonly<Record<string, number>>;
};

export type AgentCycleActionSynthesisContextTrace = {
  readonly branchId?: string;
  readonly subtaskId?: string;
  readonly subtaskScore?: number;
  readonly strategicAlignment?: number;
  readonly branchUrgency?: number;
};

export type AgentCycleActionProposalTrace = {
  readonly id: string;
  readonly description: string;
  readonly commandType: string;
  readonly priority?: number;
  readonly synthesisContext?: AgentCycleActionSynthesisContextTrace;
  readonly resourceEstimate?: AgentCycleActionResourceEstimateTrace;
};

export type AgentCycleRejectedActionTrace = {
  readonly action: AgentCycleActionProposalTrace;
  readonly reason: string;
};

export type AgentCycleActionSynthesisTrace = {
  readonly acceptedActions: readonly AgentCycleActionProposalTrace[];
  readonly rejectedActions: readonly AgentCycleRejectedActionTrace[];
};

export type AgentCycleSimulatorTraceEvent = {
  readonly type: string;
  readonly sequence?: number;
  readonly summary?: string;
};

export type AgentCycleSimulatorEventTrace = {
  readonly actionId: string;
  readonly attempt: 'original' | 'repair';
  readonly status: 'accepted' | 'rejected';
  readonly reason?: string;
  readonly events: readonly AgentCycleSimulatorTraceEvent[];
};

export type AgentCycleTrace = {
  readonly traceId: string;
  readonly simulationId: string;
  readonly agentId: string;
  readonly cycleStartedAt: number;
  readonly observedStateSummary: string;
  readonly selectedBranch: string;
  readonly subtaskCandidates: readonly AgentCycleSubtaskCandidateTrace[];
  readonly actionSynthesis: AgentCycleActionSynthesisTrace;
  readonly candidateActions: readonly string[];
  readonly simulatorResult: SimulatorTraceResult;
  readonly simulatorEvents: readonly AgentCycleSimulatorEventTrace[];
  readonly selectionEvidence: AgentCycleSelectionTraceEvidence;
  readonly replanningDecision: ReplanningTraceDecision;
  readonly subtaskReplanningDecisions: readonly AgentCycleSubtaskReplanningDecisionTrace[];
  readonly emittedCommandIds: readonly string[];
  readonly memoryContextIds: readonly string[];
  readonly memoryWriteIds: readonly string[];
};

export function createAgentCycleTrace(input: AgentCycleTrace): AgentCycleTrace {
  if (input.subtaskCandidates.length === 0) {
    throw new Error('agent cycle trace requires at least one subtask candidate');
  }
  if (
    input.actionSynthesis.acceptedActions.length === 0 &&
    input.actionSynthesis.rejectedActions.length === 0
  ) {
    throw new Error('agent cycle trace requires at least one action synthesis decision');
  }
  if (input.candidateActions.length === 0 && input.actionSynthesis.rejectedActions.length === 0) {
    throw new Error('agent cycle trace requires at least one candidate action');
  }
  return input;
}
