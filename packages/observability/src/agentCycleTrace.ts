import type { WorldDecisionContextTrace } from './worldDecisionContextTrace';

export type AgentCycleShortTermMemoryContextTrace = {
  readonly recordCount: number;
};

export type AgentCycleLongTermProfileContextTrace = {
  readonly entryCount: number;
};

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

export type AgentCycleReplanningDecisionTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly decision: ReplanningTraceDecision;
  readonly attempts?: readonly {
    readonly attemptIndex: number;
    readonly status: string;
    readonly providerId: string;
    readonly model: string;
    readonly message: string;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly estimatedCostMicros: number;
    };
  }[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostMicros: number;
  };
  readonly shortTermMemoryContext?: AgentCycleShortTermMemoryContextTrace;
  readonly longTermProfileContext?: AgentCycleLongTermProfileContextTrace;
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type AgentCycleReplanMaterializationTrace =
  | {
      readonly status: 'replanned';
      readonly objectiveId: string;
      readonly planId: string;
      readonly progressReset: boolean;
      readonly trigger: 'major-context-shift' | 'repeated-failure';
      readonly failedActionIds: readonly string[];
      readonly evidenceRecordIds: readonly string[];
      readonly matchingFailureCount: number;
    }
  | {
      readonly status: 'skipped';
      readonly planId: string;
      readonly reason: 'missing-active-objective' | 'plan-id-mismatch';
      readonly objectiveId?: string;
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
    readonly contextualReasoningScore?: number;
  };
};

export type AgentCycleContextualPrioritizationTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly choices?: readonly {
    readonly branchId: string;
    readonly subtaskId: string;
    readonly priorityScore: number;
    readonly rationale: string;
  }[];
  readonly attempts?: readonly {
    readonly attemptIndex: number;
    readonly status: string;
    readonly providerId: string;
    readonly model: string;
    readonly message: string;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly estimatedCostMicros: number;
    };
  }[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostMicros: number;
  };
  readonly shortTermMemoryContext?: AgentCycleShortTermMemoryContextTrace;
  readonly longTermProfileContext?: AgentCycleLongTermProfileContextTrace;
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type AgentCycleActionSequenceGenerationTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly selectedSubtask: {
    readonly branchId: string;
    readonly subtaskId: string;
  };
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly actions?: readonly {
    readonly id: string;
    readonly commandType: string;
    readonly rationale: string;
  }[];
  readonly attempts?: readonly {
    readonly attemptIndex: number;
    readonly status: string;
    readonly providerId: string;
    readonly model: string;
    readonly message: string;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly estimatedCostMicros: number;
    };
  }[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostMicros: number;
  };
  readonly shortTermMemoryContext?: AgentCycleShortTermMemoryContextTrace;
  readonly longTermProfileContext?: AgentCycleLongTermProfileContextTrace;
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type AgentCycleSocialDialogueGenerationTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly selectedSubtask: {
    readonly branchId: string;
    readonly subtaskId: string;
  };
  readonly actionId: string;
  readonly targetAgentId: string;
  readonly topic?: string;
  readonly policyVersion?: string;
  readonly planningContext?: {
    readonly policyVersion: string;
    readonly targetSelection: {
      readonly selectedAgentId: string;
      readonly candidates: readonly {
        readonly agentId: string;
        readonly score: {
          readonly relationshipHistory: number;
          readonly goalRelevance: number;
          readonly economicNeed: number;
          readonly personalityFit: number;
          readonly worldContext: number;
          readonly total: number;
        };
      }[];
      readonly tieBreak: 'agent-id-ascending';
    };
    readonly topicSelection: {
      readonly topic: string;
      readonly source: 'config' | 'economic-need' | 'goal' | 'profile' | 'world-context';
      readonly rationale: string;
    };
  };
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly turnCount: number;
  readonly rationale: string;
  readonly attempts?: readonly {
    readonly attemptIndex: number;
    readonly status: string;
    readonly providerId: string;
    readonly model: string;
    readonly message: string;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly estimatedCostMicros: number;
    };
  }[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostMicros: number;
  };
  readonly shortTermMemoryContext?: AgentCycleShortTermMemoryContextTrace;
  readonly longTermProfileContext?: AgentCycleLongTermProfileContextTrace;
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type AgentCycleGlobalSynthesisTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly choices?: readonly {
    readonly actionId: string;
    readonly priorityScore: number;
    readonly rationale: string;
    readonly strategicAlignment?: number;
    readonly branchUrgency?: number;
  }[];
  readonly attempts?: readonly {
    readonly attemptIndex: number;
    readonly status: string;
    readonly providerId: string;
    readonly model: string;
    readonly message: string;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly estimatedCostMicros: number;
    };
  }[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostMicros: number;
  };
  readonly shortTermMemoryContext?: AgentCycleShortTermMemoryContextTrace;
  readonly longTermProfileContext?: AgentCycleLongTermProfileContextTrace;
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type AgentCycleActionRepairTrace = {
  readonly actionId: string;
  readonly rejectionReason: string;
  readonly selectedSubtask: {
    readonly branchId: string;
    readonly subtaskId: string;
  };
  readonly localRepair: {
    readonly status: 'skipped' | 'accepted' | 'rejected';
    readonly attemptedAction?: {
      readonly id: string;
      readonly description: string;
      readonly commandType: string;
    };
    readonly rejectionReason?: string;
  };
  readonly reactiveCorrection?: {
    readonly status: 'accepted' | 'fallback';
    readonly source: 'llm' | 'deterministic-fallback';
    readonly requestId?: string;
    readonly providerId?: string;
    readonly model?: string;
    readonly failureReason?: string;
    readonly message?: string;
    readonly decision:
      | {
          readonly kind: 'propose-action';
          readonly rationale: string;
          readonly evidenceRecordIds: readonly string[];
          readonly action: {
            readonly id: string;
            readonly description: string;
            readonly commandType: string;
          };
        }
      | {
          readonly kind: 'no-correction';
          readonly rationale: string;
          readonly evidenceRecordIds: readonly string[];
        };
    readonly attempts?: readonly {
      readonly attemptIndex: number;
      readonly status: string;
      readonly providerId: string;
      readonly model: string;
      readonly message: string;
      readonly usage: {
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly totalTokens: number;
        readonly estimatedCostMicros: number;
      };
    }[];
    readonly usage?: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly estimatedCostMicros: number;
    };
    readonly shortTermMemoryContext?: AgentCycleShortTermMemoryContextTrace;
    readonly longTermProfileContext?: AgentCycleLongTermProfileContextTrace;
    readonly observedStateSummary?: string;
    readonly worldDecisionContext?: WorldDecisionContextTrace;
    readonly simulatorResult?: {
      readonly status: 'accepted' | 'rejected';
      readonly reason?: string;
      readonly traceEvents?: readonly AgentCycleSimulatorTraceEvent[];
    };
  };
  readonly outcome: 'repaired' | 'needs-replan';
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
  readonly counterfactualStep?: number;
  readonly projectionEventCountBefore?: number;
  readonly projectionEventCountAfter?: number;
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
  readonly contextualPrioritization?: AgentCycleContextualPrioritizationTrace;
  readonly actionSequenceGeneration?: readonly AgentCycleActionSequenceGenerationTrace[];
  readonly socialDialogueGeneration?: readonly AgentCycleSocialDialogueGenerationTrace[];
  readonly globalSynthesis?: AgentCycleGlobalSynthesisTrace;
  readonly actionRepair?: readonly AgentCycleActionRepairTrace[];
  readonly subtaskCandidates: readonly AgentCycleSubtaskCandidateTrace[];
  readonly actionSynthesis: AgentCycleActionSynthesisTrace;
  readonly candidateActions: readonly string[];
  readonly simulatorResult: SimulatorTraceResult;
  readonly simulatorEvents: readonly AgentCycleSimulatorEventTrace[];
  readonly selectionEvidence: AgentCycleSelectionTraceEvidence;
  readonly replanningDecision: ReplanningTraceDecision;
  readonly replanningDecisionTrace?: AgentCycleReplanningDecisionTrace;
  readonly replanMaterialization?: AgentCycleReplanMaterializationTrace;
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
