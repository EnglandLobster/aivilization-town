import type {
  AgentIntentionState,
  LongTermAgentProfile,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { AtomicActionProposal } from './actions';
import type { ActionSynthesisPolicy, ActionSynthesisResult } from './actionSynthesis';
import type {
  LlmLongTermProfileContextTrace,
  LlmShortTermMemoryContextTrace,
} from './llmContextTrace';
import type { BranchPlan, ContextSignal } from './planner';
import type { WorldDecisionContext, WorldDecisionContextTrace } from './worldDecisionContext';

export type GlobalSynthesisChoice = {
  readonly actionId: string;
  readonly priorityScore: number;
  readonly rationale: string;
  readonly strategicAlignment?: number;
  readonly branchUrgency?: number;
};

export type GlobalSynthesisTraceAttempt = {
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

export type GlobalSynthesisTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly choices?: readonly GlobalSynthesisChoice[];
  readonly attempts?: readonly GlobalSynthesisTraceAttempt[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostMicros: number;
  };
  readonly shortTermMemoryContext?: LlmShortTermMemoryContextTrace;
  readonly longTermProfileContext?: LlmLongTermProfileContextTrace;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type GlobalSynthesisResult = {
  readonly actions: readonly AtomicActionProposal[];
  readonly trace: GlobalSynthesisTrace;
};

export type GlobalSynthesizerInput = {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
  readonly candidateActions: readonly AtomicActionProposal[];
  readonly deterministicSynthesisResult: ActionSynthesisResult;
  readonly actionSynthesisPolicy?: ActionSynthesisPolicy;
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
};

export type GlobalActionSynthesizer = (
  input: GlobalSynthesizerInput,
) => Promise<GlobalSynthesisResult>;

export function createDeterministicGlobalSynthesisResult(input: {
  readonly candidateActions: readonly AtomicActionProposal[];
}): GlobalSynthesisResult {
  return {
    actions: input.candidateActions,
    trace: {
      status: 'deterministic',
      source: 'deterministic',
      choices: input.candidateActions.map((action) => ({
        actionId: action.id,
        priorityScore: action.priority ?? 0,
        rationale: 'deterministic action synthesis input order',
      })),
    },
  };
}

export function applyGlobalSynthesisChoices(input: {
  readonly candidateActions: readonly AtomicActionProposal[];
  readonly choices: readonly GlobalSynthesisChoice[];
}): readonly AtomicActionProposal[] {
  if (input.candidateActions.length === 0) {
    throw new Error('global synthesis requires at least one candidate action');
  }
  if (input.choices.length !== input.candidateActions.length) {
    throw new Error('global synthesis choices must cover every candidate action exactly once');
  }

  const candidateActionsById = new Map(input.candidateActions.map((action) => [action.id, action]));
  const seenActionIds = new Set<string>();

  return input.choices.map((choice, index) => {
    assertNonEmpty(choice.actionId, `rankedActions[${index}].actionId`);
    assertNonEmpty(choice.rationale, `rankedActions[${index}].rationale`);
    const priorityScore = assertFiniteNumber(
      choice.priorityScore,
      `rankedActions[${index}].priorityScore`,
    );
    const strategicAlignment =
      choice.strategicAlignment === undefined
        ? undefined
        : assertFiniteNumber(
            choice.strategicAlignment,
            `rankedActions[${index}].strategicAlignment`,
          );
    const branchUrgency =
      choice.branchUrgency === undefined
        ? undefined
        : assertFiniteNumber(choice.branchUrgency, `rankedActions[${index}].branchUrgency`);
    if (seenActionIds.has(choice.actionId)) {
      throw new Error(`duplicate action id ${choice.actionId}`);
    }
    seenActionIds.add(choice.actionId);

    const action = candidateActionsById.get(choice.actionId);
    if (action === undefined) {
      throw new Error(`unknown action id ${choice.actionId}`);
    }

    return {
      ...action,
      priority: priorityScore,
      synthesisContext: {
        ...(action.synthesisContext ?? {}),
        ...(strategicAlignment === undefined ? {} : { strategicAlignment }),
        ...(branchUrgency === undefined ? {} : { branchUrgency }),
      },
    };
  });
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
  return value;
}
