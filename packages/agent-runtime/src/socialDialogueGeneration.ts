import type {
  AgentIntentionState,
  LongTermAgentProfile,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import type { AtomicActionProposal } from './actions';
import type {
  LlmLongTermProfileContextTrace,
  LlmShortTermMemoryContextTrace,
} from './llmContextTrace';
import type { BranchPlan, ContextSignal, PrioritizedSubtask } from './planner';
import type { BranchPlanProgress } from './planProgress';
import type { WorldDecisionContext, WorldDecisionContextTrace } from './worldDecisionContext';

export type SocialDialogueTurnProposal = {
  readonly speakerAgentId: AgentId;
  readonly utterance: string;
  readonly intent?: string;
};

export const SOCIAL_DIALOGUE_POLICY_VERSION = 'bounded-social-dialogue-v1';
export const SOCIAL_DIALOGUE_MIN_TURNS = 4;
export const SOCIAL_DIALOGUE_MAX_TURNS = 8;
export const SOCIAL_DIALOGUE_MAX_UTTERANCE_LENGTH = 500;

export type SocialTargetScoreBreakdown = {
  readonly relationshipHistory: number;
  readonly goalRelevance: number;
  readonly economicNeed: number;
  readonly personalityFit: number;
  readonly worldContext: number;
  readonly total: number;
};

export type SocialPlanningContextTrace = {
  readonly policyVersion: string;
  readonly targetSelection: {
    readonly selectedAgentId: AgentId;
    readonly candidates: readonly {
      readonly agentId: AgentId;
      readonly score: SocialTargetScoreBreakdown;
    }[];
    readonly tieBreak: 'agent-id-ascending';
  };
  readonly topicSelection: {
    readonly topic: string;
    readonly source: 'config' | 'economic-need' | 'goal' | 'profile' | 'world-context';
    readonly rationale: string;
  };
};

export type SocialDialoguePayload = {
  readonly targetAgentId: AgentId;
  readonly topic: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly turns: readonly SocialDialogueTurnProposal[];
  readonly planningContext?: SocialPlanningContextTrace;
};

export type SocialDialogueProposal = {
  readonly topic: string;
  readonly turns: readonly SocialDialogueTurnProposal[];
  /** @deprecated The world derives authoritative directional outcomes from the transcript. */
  readonly relationDelta?: number;
  /** @deprecated The world derives authoritative directional outcomes from the transcript. */
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
  readonly topic?: string;
  readonly policyVersion?: typeof SOCIAL_DIALOGUE_POLICY_VERSION;
  readonly planningContext?: SocialPlanningContextTrace;
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly turnCount: number;
  readonly rationale: string;
  readonly attempts?: readonly SocialDialogueGenerationTraceAttempt[];
  readonly usage?: SocialDialogueGenerationUsage;
  readonly shortTermMemoryContext?: LlmShortTermMemoryContextTrace;
  readonly longTermProfileContext?: LlmLongTermProfileContextTrace;
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
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
  readonly observedStateSummary?: string;
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
  const turns = validateTurns({
    agentId: input.agentId,
    targetAgentId: input.deterministicPayload.targetAgentId,
    turns: input.deterministicPayload.turns,
  });
  const payload = { ...input.deterministicPayload, turns };
  return {
    payload,
    trace: {
      status: 'deterministic',
      source: 'deterministic',
      selectedSubtask: toTraceSubtask(input.selectedSubtask),
      actionId: input.action.id,
      targetAgentId: input.deterministicPayload.targetAgentId,
      topic: input.deterministicPayload.topic,
      policyVersion: SOCIAL_DIALOGUE_POLICY_VERSION,
      ...(input.deterministicPayload.planningContext === undefined
        ? {}
        : {
            planningContext: cloneSocialPlanningContext(input.deterministicPayload.planningContext),
          }),
      turnCount: turns.length,
      rationale: `${SOCIAL_DIALOGUE_POLICY_VERSION}; deterministic bounded dialogue`,
    },
  };
}

export function createDeterministicSocialDialogueGenerator(): SocialDialogueGenerator {
  return (input) => Promise.resolve(createDeterministicSocialDialogueGenerationResult(input));
}

export function createSocialDialoguePolicyManifest() {
  return {
    policyVersion: SOCIAL_DIALOGUE_POLICY_VERSION,
    minimumTurns: SOCIAL_DIALOGUE_MIN_TURNS,
    maximumTurns: SOCIAL_DIALOGUE_MAX_TURNS,
    maximumUtteranceLength: SOCIAL_DIALOGUE_MAX_UTTERANCE_LENGTH,
    speakerRule: 'acting-agent-starts-and-speakers-strictly-alternate',
    participantRule: 'exactly-acting-and-target-agent',
    outcomeAuthority: 'world-evaluates-transcript-proposal-deltas-are-compatibility-only',
    failureRule: 'versioned-deterministic-bounded-dialogue-fallback',
  } as const;
}

export function parseSocialPlanningContextTrace(
  value: unknown,
): SocialPlanningContextTrace | undefined {
  if (!isRecord(value) || !isRecord(value.targetSelection) || !isRecord(value.topicSelection)) {
    return undefined;
  }
  const targetSelection = value.targetSelection;
  const topicSelection = value.topicSelection;
  if (
    typeof value.policyVersion !== 'string' ||
    typeof targetSelection.selectedAgentId !== 'string' ||
    !Array.isArray(targetSelection.candidates) ||
    targetSelection.tieBreak !== 'agent-id-ascending' ||
    typeof topicSelection.topic !== 'string' ||
    !isSocialTopicSource(topicSelection.source) ||
    typeof topicSelection.rationale !== 'string'
  ) {
    return undefined;
  }
  const candidates: SocialPlanningContextTrace['targetSelection']['candidates'][number][] = [];
  for (const candidate of targetSelection.candidates) {
    if (
      !isRecord(candidate) ||
      typeof candidate.agentId !== 'string' ||
      !isRecord(candidate.score)
    ) {
      return undefined;
    }
    const score = candidate.score;
    if (!hasFiniteSocialTargetScores(score)) {
      return undefined;
    }
    candidates.push({
      agentId: asAgentId(candidate.agentId),
      score: {
        relationshipHistory: score.relationshipHistory,
        goalRelevance: score.goalRelevance,
        economicNeed: score.economicNeed,
        personalityFit: score.personalityFit,
        worldContext: score.worldContext,
        total: score.total,
      },
    });
  }
  return {
    policyVersion: value.policyVersion,
    targetSelection: {
      selectedAgentId: asAgentId(targetSelection.selectedAgentId),
      candidates,
      tieBreak: 'agent-id-ascending',
    },
    topicSelection: {
      topic: topicSelection.topic,
      source: topicSelection.source,
      rationale: topicSelection.rationale,
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
  if (input.proposal.relationDelta !== undefined) {
    assertFiniteNumber(input.proposal.relationDelta, 'social dialogue relationDelta');
  }
  if (input.proposal.attitudeDelta !== undefined) {
    assertFiniteNumber(input.proposal.attitudeDelta, 'social dialogue attitudeDelta');
  }
  const turns = validateTurns({
    agentId: input.agentId,
    targetAgentId: input.deterministicPayload.targetAgentId,
    turns: input.proposal.turns,
  });

  return {
    targetAgentId: input.deterministicPayload.targetAgentId,
    topic,
    relationDelta: input.deterministicPayload.relationDelta,
    attitudeDelta: input.deterministicPayload.attitudeDelta,
    turns,
    ...(input.deterministicPayload.planningContext === undefined
      ? {}
      : {
          planningContext: cloneSocialPlanningContext(input.deterministicPayload.planningContext),
        }),
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
  if (input.turns.length < SOCIAL_DIALOGUE_MIN_TURNS) {
    throw new Error(
      `social dialogue turns must contain at least ${SOCIAL_DIALOGUE_MIN_TURNS} entries`,
    );
  }
  if (input.turns.length > SOCIAL_DIALOGUE_MAX_TURNS) {
    throw new Error(
      `social dialogue turns must contain at most ${SOCIAL_DIALOGUE_MAX_TURNS} entries`,
    );
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
    if (utterance.length > SOCIAL_DIALOGUE_MAX_UTTERANCE_LENGTH) {
      throw new Error(
        `social dialogue turns[${index}].utterance must contain at most ${SOCIAL_DIALOGUE_MAX_UTTERANCE_LENGTH} characters`,
      );
    }
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
  for (let index = 1; index < normalizedTurns.length; index += 1) {
    if (normalizedTurns[index]?.speakerAgentId === normalizedTurns[index - 1]?.speakerAgentId) {
      throw new Error(`social dialogue turns[${index}] must alternate speakers`);
    }
  }
  if (!normalizedTurns.some((turn) => turn.speakerAgentId === input.agentId)) {
    throw new Error(`social dialogue must include at least one turn from ${input.agentId}`);
  }
  if (!normalizedTurns.some((turn) => turn.speakerAgentId === input.targetAgentId)) {
    throw new Error(`social dialogue must include at least one turn from ${input.targetAgentId}`);
  }

  return normalizedTurns;
}

function cloneSocialPlanningContext(
  context: SocialPlanningContextTrace,
): SocialPlanningContextTrace {
  return {
    policyVersion: context.policyVersion,
    targetSelection: {
      selectedAgentId: context.targetSelection.selectedAgentId,
      candidates: context.targetSelection.candidates.map((candidate) => ({
        agentId: candidate.agentId,
        score: { ...candidate.score },
      })),
      tieBreak: context.targetSelection.tieBreak,
    },
    topicSelection: { ...context.topicSelection },
  };
}

function hasFiniteSocialTargetScores(
  score: Record<string, unknown>,
): score is Record<keyof SocialTargetScoreBreakdown, number> {
  return [
    score.relationshipHistory,
    score.goalRelevance,
    score.economicNeed,
    score.personalityFit,
    score.worldContext,
    score.total,
  ].every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isSocialTopicSource(
  value: unknown,
): value is SocialPlanningContextTrace['topicSelection']['source'] {
  return (
    value === 'config' ||
    value === 'economic-need' ||
    value === 'goal' ||
    value === 'profile' ||
    value === 'world-context'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
