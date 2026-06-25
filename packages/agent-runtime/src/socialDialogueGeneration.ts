import type {
  AgentIntentionState,
  LongTermAgentProfile,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { AtomicActionProposal } from './actions';
import type { BranchPlan, ContextSignal, PrioritizedSubtask } from './planner';
import type { BranchPlanProgress } from './planProgress';
import type { WorldDecisionContext } from './worldDecisionContext';

export type SocialDialogueTurnProposal = {
  readonly speakerAgentId: AgentId;
  readonly utterance: string;
  readonly intent?: string;
};

export type SocialDialoguePayload = {
  readonly targetAgentId: AgentId;
  readonly topic: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly turns: readonly SocialDialogueTurnProposal[];
};

export type SocialDialogueProposal = {
  readonly topic: string;
  readonly turns: readonly SocialDialogueTurnProposal[];
  readonly relationDelta?: number;
  readonly attitudeDelta?: number;
  readonly rationale: string;
};

export type SocialDialogueGenerationUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
};

export type SocialDialogueGenerationTraceAttempt = {
  readonly attemptIndex: number;
  readonly status: string;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: SocialDialogueGenerationUsage;
};

export type SocialDialogueGenerationTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly selectedSubtask: {
    readonly branchId: string;
    readonly subtaskId: string;
  };
  readonly actionId: string;
  readonly targetAgentId: AgentId;
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly turnCount: number;
  readonly rationale: string;
  readonly attempts?: readonly SocialDialogueGenerationTraceAttempt[];
  readonly usage?: SocialDialogueGenerationUsage;
};

export type SocialDialogueGenerationResult = {
  readonly payload: SocialDialoguePayload;
  readonly trace: SocialDialogueGenerationTrace;
};

export type SocialDialogueGeneratorInput = {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly action: AtomicActionProposal<'AgentStartConversation', SocialDialoguePayload>;
  readonly deterministicPayload: SocialDialoguePayload;
  readonly signals: readonly ContextSignal[];
  readonly progress?: BranchPlanProgress;
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
};

export type SocialDialogueGenerator = (
  input: SocialDialogueGeneratorInput,
) => Promise<SocialDialogueGenerationResult>;

export function createDeterministicSocialDialogueGenerationResult(
  input: SocialDialogueGeneratorInput,
): SocialDialogueGenerationResult {
  return {
    payload: input.deterministicPayload,
    trace: {
      status: 'deterministic',
      source: 'deterministic',
      selectedSubtask: toTraceSubtask(input.selectedSubtask),
      actionId: input.action.id,
      targetAgentId: input.deterministicPayload.targetAgentId,
      turnCount: input.deterministicPayload.turns.length,
      rationale: 'deterministic social dialogue fallback payload',
    },
  };
}

export function applySocialDialogueProposal(input: {
  readonly agentId: AgentId;
  readonly action: AtomicActionProposal<'AgentStartConversation', SocialDialoguePayload>;
  readonly deterministicPayload: SocialDialoguePayload;
  readonly proposal: SocialDialogueProposal;
}): SocialDialoguePayload {
  const topic = normalizeNonEmpty(input.proposal.topic, 'social dialogue topic');
  normalizeNonEmpty(input.proposal.rationale, 'social dialogue rationale');
  const relationDelta =
    input.proposal.relationDelta === undefined
      ? input.deterministicPayload.relationDelta
      : assertFiniteNumber(input.proposal.relationDelta, 'social dialogue relationDelta');
  const attitudeDelta =
    input.proposal.attitudeDelta === undefined
      ? input.deterministicPayload.attitudeDelta
      : assertFiniteNumber(input.proposal.attitudeDelta, 'social dialogue attitudeDelta');
  const turns = validateTurns({
    agentId: input.agentId,
    targetAgentId: input.deterministicPayload.targetAgentId,
    turns: input.proposal.turns,
  });

  return {
    targetAgentId: input.deterministicPayload.targetAgentId,
    topic,
    relationDelta,
    attitudeDelta,
    turns,
  };
}

export function toSocialDialogueTraceSubtask(
  selectedSubtask: PrioritizedSubtask,
): SocialDialogueGenerationTrace['selectedSubtask'] {
  return toTraceSubtask(selectedSubtask);
}

function validateTurns(input: {
  readonly agentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly turns: readonly SocialDialogueTurnProposal[];
}): readonly SocialDialogueTurnProposal[] {
  if (input.turns.length < 2) {
    throw new Error('social dialogue turns must contain at least two entries');
  }

  const normalizedTurns = input.turns.map((turn, index): SocialDialogueTurnProposal => {
    const speakerAgentId = turn.speakerAgentId;
    if (speakerAgentId !== input.agentId && speakerAgentId !== input.targetAgentId) {
      throw new Error(
        `social dialogue turns[${index}].speakerAgentId must be ${input.agentId} or ${input.targetAgentId}`,
      );
    }
    const utterance = normalizeNonEmpty(
      turn.utterance,
      `social dialogue turns[${index}].utterance`,
    );
    const intent =
      turn.intent === undefined
        ? undefined
        : normalizeNonEmpty(turn.intent, `social dialogue turns[${index}].intent`);

    return {
      speakerAgentId,
      utterance,
      ...(intent === undefined ? {} : { intent }),
    };
  });

  const firstTurn = normalizedTurns[0];
  if (firstTurn?.speakerAgentId !== input.agentId) {
    throw new Error(`social dialogue first turn must be spoken by ${input.agentId}`);
  }
  if (!normalizedTurns.some((turn) => turn.speakerAgentId === input.agentId)) {
    throw new Error(`social dialogue must include at least one turn from ${input.agentId}`);
  }
  if (!normalizedTurns.some((turn) => turn.speakerAgentId === input.targetAgentId)) {
    throw new Error(`social dialogue must include at least one turn from ${input.targetAgentId}`);
  }

  return normalizedTurns;
}

function toTraceSubtask(
  selectedSubtask: PrioritizedSubtask,
): SocialDialogueGenerationTrace['selectedSubtask'] {
  return {
    branchId: selectedSubtask.branchId,
    subtaskId: selectedSubtask.subtaskId,
  };
}

function normalizeNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return normalized;
}

function assertFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}
