import type { LongTermAgentProfile, ShortTermMemoryRecord } from '@aivilization/memory';
import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import type { WorldDecisionContext, WorldDecisionContextTrace } from './worldDecisionContext';

const DEFAULT_SOCIAL_OBSERVATION_REACTION_WINDOW_MS = 2 * 60 * 60 * 1000;
const DEFAULT_SOCIAL_OBSERVATION_PRIORITY = 4;
const SOCIAL_OBSERVATION_EVENT_TAGS = new Set([
  'ConversationRecorded',
  'SocialInteractionCompleted',
]);

export type ReactionDecisionKind = 'ignore' | 'follow-up';

export type IgnoreReactionDecision = {
  readonly kind: 'ignore';
  readonly confidence: number;
  readonly rationale: string;
};

export type FollowUpReactionDecision = {
  readonly kind: 'follow-up';
  readonly confidence: number;
  readonly rationale: string;
  readonly description: string;
  readonly priority: number;
  readonly reactionWindowMs: number;
  readonly affinityTags: readonly string[];
};

export type ReactionDecision = IgnoreReactionDecision | FollowUpReactionDecision;

export type ReactionEvaluatorInput = {
  readonly agentId: AgentId;
  readonly issuedAt: SimulationTimestamp;
  readonly memory: ShortTermMemoryRecord;
  readonly longTermProfile?: LongTermAgentProfile;
  readonly memoryContext?: readonly ShortTermMemoryRecord[];
  readonly worldDecisionContext?: WorldDecisionContext;
};

export type ReactionEvaluationUsage = {
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
  readonly usage: ReactionEvaluationUsage;
};

export type ReactionEvaluationTrace = {
  readonly status: 'accepted' | 'fallback' | 'deterministic';
  readonly source: 'llm' | 'deterministic-fallback' | 'deterministic';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly attempts?: readonly ReactionEvaluationAttemptTrace[];
  readonly usage?: ReactionEvaluationUsage;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type ReactionEvaluationResult = {
  readonly decision: ReactionDecision;
  readonly reactionTrace: ReactionEvaluationTrace;
};

export type ReactionEvaluatorOutput = ReactionDecision | ReactionEvaluationResult;

export type ReactionEvaluator = (
  input: ReactionEvaluatorInput,
) => ReactionEvaluatorOutput | Promise<ReactionEvaluatorOutput>;

export type NormalizedReactionEvaluation = {
  readonly decision: ReactionDecision;
  readonly reactionTrace?: ReactionEvaluationTrace;
};

export function evaluateDeterministicSocialObservationReaction(
  input: ReactionEvaluatorInput,
): ReactionEvaluationResult {
  assertFinite(input.issuedAt, 'reaction issuedAt');
  if (input.agentId !== input.memory.agentId) {
    throw new Error('reaction agentId must match memory agentId');
  }

  if (!isSocialObservationMemory(input.memory)) {
    return {
      decision: {
        kind: 'ignore',
        confidence: 1,
        rationale: 'Memory is not an observed ambient social event.',
      },
      reactionTrace: {
        status: 'deterministic',
        source: 'deterministic',
      },
    };
  }

  return {
    decision: {
      kind: 'follow-up',
      confidence: input.memory.importanceScore,
      rationale:
        'Observed social memory contains a conversation or completed social interaction event.',
      description: `Follow up on observed social event: ${ensureSentence(input.memory.summary)}`,
      priority: DEFAULT_SOCIAL_OBSERVATION_PRIORITY,
      reactionWindowMs: DEFAULT_SOCIAL_OBSERVATION_REACTION_WINDOW_MS,
      affinityTags: createSocialObservationAffinityTags(input.memory),
    },
    reactionTrace: {
      status: 'deterministic',
      source: 'deterministic',
    },
  };
}

export function normalizeReactionEvaluatorOutput(
  output: ReactionEvaluatorOutput,
): NormalizedReactionEvaluation {
  if (isReactionEvaluationResult(output)) {
    return {
      decision: normalizeReactionDecision(output.decision),
      reactionTrace: cloneReactionTrace(output.reactionTrace),
    };
  }

  return {
    decision: normalizeReactionDecision(output),
  };
}

export function normalizeReactionDecision(decision: ReactionDecision): ReactionDecision {
  assertConfidence(decision.confidence);
  assertNonEmpty(decision.rationale, 'reaction rationale');

  if (decision.kind === 'ignore') {
    return {
      kind: 'ignore',
      confidence: decision.confidence,
      rationale: decision.rationale.trim(),
    };
  }

  if (decision.kind !== 'follow-up') {
    throw new Error('reaction kind must be ignore or follow-up');
  }

  assertNonEmpty(decision.description, 'follow-up reaction description');
  assertFinite(decision.priority, 'follow-up reaction priority');
  assertPositiveFinite(decision.reactionWindowMs, 'follow-up reaction window');
  const affinityTags = stableUnique(decision.affinityTags);
  if (affinityTags.length === 0) {
    throw new Error('follow-up reaction affinityTags must not be empty');
  }

  return {
    kind: 'follow-up',
    confidence: decision.confidence,
    rationale: decision.rationale.trim(),
    description: decision.description.trim(),
    priority: decision.priority,
    reactionWindowMs: decision.reactionWindowMs,
    affinityTags,
  };
}

function isReactionEvaluationResult(
  output: ReactionEvaluatorOutput,
): output is ReactionEvaluationResult {
  return 'decision' in output;
}

function isSocialObservationMemory(record: ShortTermMemoryRecord): boolean {
  return (
    record.kind === 'observation' &&
    record.status === 'observed' &&
    record.tags.includes('ambient-observation') &&
    record.tags.some((tag) => SOCIAL_OBSERVATION_EVENT_TAGS.has(tag))
  );
}

function createSocialObservationAffinityTags(record: ShortTermMemoryRecord): readonly string[] {
  return stableUnique([
    'social',
    'community',
    'relationship',
    'observation-follow-up',
    ...record.tags.filter((tag) => tag !== 'ambient-observation'),
  ]);
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (trimmed.endsWith('.') || trimmed.endsWith('!') || trimmed.endsWith('?')) {
    return trimmed;
  }
  return `${trimmed}.`;
}

function stableUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function cloneReactionTrace(trace: ReactionEvaluationTrace): ReactionEvaluationTrace {
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
      : {
          attempts: trace.attempts.map((attempt) => ({
            ...attempt,
            usage: { ...attempt.usage },
          })),
        }),
    ...(trace.usage === undefined ? {} : { usage: { ...trace.usage } }),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: { ...trace.worldDecisionContext } }),
  };
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
