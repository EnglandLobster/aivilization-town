import type {
  AgentIntentionState,
  LongTermAgentProfile,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { BranchPlan, ContextSignal, PrioritizedSubtaskCandidate } from './planner';
import type { BranchPlanProgress } from './planProgress';
import type { WorldDecisionContext } from './worldDecisionContext';

export type SubtaskPrioritizationChoice = {
  readonly branchId: string;
  readonly subtaskId: string;
  readonly priorityScore: number;
  readonly rationale: string;
};

export type SubtaskPrioritizationTraceAttempt = {
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
};

export type SubtaskPrioritizationTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly choices?: readonly SubtaskPrioritizationChoice[];
  readonly attempts?: readonly SubtaskPrioritizationTraceAttempt[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostMicros: number;
  };
};

export type SubtaskPrioritizationResult = {
  readonly candidates: readonly PrioritizedSubtaskCandidate[];
  readonly trace: SubtaskPrioritizationTrace;
};

export type SubtaskPrioritizerInput = {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
  readonly candidates: readonly PrioritizedSubtaskCandidate[];
  readonly progress?: BranchPlanProgress;
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
};

export type SubtaskPrioritizer = (
  input: SubtaskPrioritizerInput,
) => SubtaskPrioritizationResult | Promise<SubtaskPrioritizationResult>;

export function createDeterministicSubtaskPrioritizationResult(input: {
  readonly candidates: readonly PrioritizedSubtaskCandidate[];
}): SubtaskPrioritizationResult {
  return {
    candidates: input.candidates,
    trace: {
      status: 'deterministic',
      source: 'deterministic',
    },
  };
}

export function applySubtaskPrioritizationChoices(input: {
  readonly candidates: readonly PrioritizedSubtaskCandidate[];
  readonly choices: readonly SubtaskPrioritizationChoice[];
}): readonly PrioritizedSubtaskCandidate[] {
  if (input.candidates.length === 0) {
    throw new Error('subtask prioritization requires at least one candidate');
  }
  if (input.choices.length !== input.candidates.length) {
    throw new Error(
      `subtask prioritization must rank every candidate: expected ${input.candidates.length}, received ${input.choices.length}`,
    );
  }

  const candidatesByKey = new Map(
    input.candidates.map((candidate) => [
      createSubtaskChoiceKey(candidate.branchId, candidate.subtaskId),
      candidate,
    ]),
  );
  const seenChoiceKeys = new Set<string>();

  return input.choices.map((choice, index) => {
    assertNonEmpty(choice.branchId, `rankedSubtasks[${index}].branchId`);
    assertNonEmpty(choice.subtaskId, `rankedSubtasks[${index}].subtaskId`);
    assertFiniteNumber(choice.priorityScore, `rankedSubtasks[${index}].priorityScore`);
    assertNonEmpty(choice.rationale, `rankedSubtasks[${index}].rationale`);

    const key = createSubtaskChoiceKey(choice.branchId, choice.subtaskId);
    if (seenChoiceKeys.has(key)) {
      throw new Error(
        `subtask prioritization ranked duplicate candidate ${choice.branchId}/${choice.subtaskId}`,
      );
    }
    seenChoiceKeys.add(key);

    const candidate = candidatesByKey.get(key);
    if (candidate === undefined) {
      throw new Error(
        `subtask prioritization referenced unknown candidate ${choice.branchId}/${choice.subtaskId}`,
      );
    }

    const deterministicScore =
      candidate.score - (candidate.scoreBreakdown.contextualReasoningScore ?? 0);
    return {
      ...candidate,
      score: choice.priorityScore,
      scoreBreakdown: {
        ...candidate.scoreBreakdown,
        contextualReasoningScore: choice.priorityScore - deterministicScore,
      },
    };
  });
}

export function createSubtaskChoiceKey(branchId: string, subtaskId: string): string {
  return `${branchId}\u0000${subtaskId}`;
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
