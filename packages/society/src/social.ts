import type { AgentId } from '@aivilization/sim-core';

export type SocialRelationLabel =
  | 'hostile'
  | 'strained'
  | 'acquaintance'
  | 'friend'
  | 'close-friend'
  | 'best-friend';

export type SocialRelationState = {
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly relationScore: number;
  readonly attitudeScore: number;
  readonly relationLabel: SocialRelationLabel;
  readonly interactionCount: number;
  readonly lastInteractionSummary: string | null;
};

export type SocialRelationKey = `${string}->${string}`;

export const SOCIAL_OUTCOME_POLICY_VERSION = 'conversation-outcome-v1';
export const SOCIAL_RELATION_DECAY_POLICY_VERSION = 'social-relation-decay-v1';
export const RESOURCE_TRANSFER_SOCIAL_OUTCOME_POLICY_VERSION =
  'resource-transfer-social-outcome-v1';

const SOCIAL_RELATION_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1_000;
const SOCIAL_ATTITUDE_HALF_LIFE_MS = 2 * 24 * 60 * 60 * 1_000;
const MAX_POSITIVE_CONVERSATION_DELTA = 0.2;
const MAX_NEGATIVE_CONVERSATION_DELTA = -0.35;

export type SocialDialogueTurnEvidence = {
  readonly speakerAgentId: AgentId;
  readonly utterance: string;
  readonly intent?: string;
};

export type DirectionalSocialOutcome = {
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly signals: readonly string[];
};

export type ConversationSocialOutcomes = {
  readonly policyVersion: typeof SOCIAL_OUTCOME_POLICY_VERSION;
  readonly initiatorToTarget: DirectionalSocialOutcome;
  readonly targetToInitiator: DirectionalSocialOutcome;
};

export type SocialCommitmentIntent = 'created' | 'fulfilled' | 'breached';

export function classifySocialCommitmentIntent(
  intent: string | undefined,
): SocialCommitmentIntent | undefined {
  const normalized = normalizeSignalText(intent ?? '');
  if (containsSignal(normalized, ['fulfill-commitment', 'honor-promise', 'follow-through'])) {
    return 'fulfilled';
  }
  if (containsSignal(normalized, ['break-promise', 'renege'])) {
    return 'breached';
  }
  if (containsSignal(normalized, ['make-commitment', 'promise-to', 'commit-to'])) {
    return 'created';
  }
  return undefined;
}

type SocialSignalRule = {
  readonly signal: string;
  readonly intentTokens: readonly string[];
  readonly utteranceTokens: readonly string[];
  readonly relationDelta: number;
  readonly attitudeDelta: number;
};

const socialSignalRules: readonly SocialSignalRule[] = [
  {
    signal: 'betrayal',
    intentTokens: ['betray', 'break-promise', 'renege'],
    utteranceTokens: ['betrayed you', 'broke my promise', 'will not honor'],
    relationDelta: -0.3,
    attitudeDelta: -0.24,
  },
  {
    signal: 'deception',
    intentTokens: ['deceive', 'misinform', 'lie'],
    utteranceTokens: ['lied to you', 'deceived you', 'false information'],
    relationDelta: -0.2,
    attitudeDelta: -0.25,
  },
  {
    signal: 'hostility',
    intentTokens: ['threaten', 'insult', 'hostile', 'intimidate'],
    utteranceTokens: ['i threaten', 'you are useless', 'stay away'],
    relationDelta: -0.12,
    attitudeDelta: -0.18,
  },
  {
    signal: 'rejection',
    intentTokens: ['refuse-cooperation', 'dismiss', 'reject-request'],
    utteranceTokens: ['i refuse to help', 'not my problem'],
    relationDelta: -0.06,
    attitudeDelta: -0.08,
  },
  {
    signal: 'repair',
    intentTokens: ['apologize', 'repair', 'make-amends', 'reconcile'],
    utteranceTokens: ['i apologize', 'make amends', 'repair the harm'],
    relationDelta: 0.02,
    attitudeDelta: 0.08,
  },
  {
    signal: 'fulfilled-commitment',
    intentTokens: ['fulfill-commitment', 'honor-promise', 'follow-through'],
    utteranceTokens: [],
    relationDelta: 0.12,
    attitudeDelta: 0.1,
  },
  {
    signal: 'cooperation',
    intentTokens: ['cooperate', 'coordinate', 'help', 'support', 'share-resource'],
    utteranceTokens: ['work together', 'study together', 'i can help', 'share with you'],
    relationDelta: 0.06,
    attitudeDelta: 0.06,
  },
  {
    signal: 'perspective-taking',
    intentTokens: ['invite-perspective', 'share-goal-and-listen'],
    utteranceTokens: ['your perspective', 'listen to you'],
    relationDelta: 0.03,
    attitudeDelta: 0.04,
  },
  {
    signal: 'relationship-continuation',
    intentTokens: ['continue-relationship', 'keep-informed'],
    utteranceTokens: ['keep each other informed', 'stay in touch'],
    relationDelta: 0.03,
    attitudeDelta: 0.04,
  },
  {
    signal: 'constructive-opening',
    intentTokens: ['open-contextual-topic'],
    utteranceTokens: ['compare notes'],
    relationDelta: 0.01,
    attitudeDelta: 0.02,
  },
] as const;

/**
 * Evaluates what each participant learns about the other participant from that participant's own
 * turns. This keeps the two directed relationships independent and makes the world, rather than an
 * agent-supplied score, authoritative for social outcomes.
 */
export function evaluateConversationSocialOutcomes(input: {
  readonly initiatorAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly turns: readonly SocialDialogueTurnEvidence[];
}): ConversationSocialOutcomes {
  if (input.initiatorAgentId === input.targetAgentId) {
    throw new Error('conversation participants must differ');
  }
  return {
    policyVersion: SOCIAL_OUTCOME_POLICY_VERSION,
    initiatorToTarget: evaluateParticipantOutcome({
      sourceAgentId: input.initiatorAgentId,
      targetAgentId: input.targetAgentId,
      turns: input.turns,
    }),
    targetToInitiator: evaluateParticipantOutcome({
      sourceAgentId: input.targetAgentId,
      targetAgentId: input.initiatorAgentId,
      turns: input.turns,
    }),
  };
}

export function decaySocialRelation(
  relation: SocialRelationState,
  elapsedMs: number,
): SocialRelationState {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error('social relation elapsedMs must be non-negative finite');
  }
  if (elapsedMs === 0) {
    return relation;
  }
  const relationScore = decayScore(relation.relationScore, elapsedMs, SOCIAL_RELATION_HALF_LIFE_MS);
  const attitudeScore = decayScore(relation.attitudeScore, elapsedMs, SOCIAL_ATTITUDE_HALF_LIFE_MS);
  return {
    ...relation,
    relationScore,
    attitudeScore,
    relationLabel: classifyRelation(relationScore),
  };
}

export function createSocialOutcomePolicyManifest() {
  return {
    outcomePolicyVersion: SOCIAL_OUTCOME_POLICY_VERSION,
    resourceTransferOutcomePolicyVersion: RESOURCE_TRANSFER_SOCIAL_OUTCOME_POLICY_VERSION,
    decayPolicyVersion: SOCIAL_RELATION_DECAY_POLICY_VERSION,
    authority: 'world-evaluates-transcript-agent-score-hints-ignored',
    directionality: 'each-observer-evaluates-the-other-participants-turns',
    maximumPositiveConversationDelta: MAX_POSITIVE_CONVERSATION_DELTA,
    maximumNegativeConversationDelta: MAX_NEGATIVE_CONVERSATION_DELTA,
    relationHalfLifeMs: SOCIAL_RELATION_HALF_LIFE_MS,
    attitudeHalfLifeMs: SOCIAL_ATTITUDE_HALF_LIFE_MS,
    signals: socialSignalRules.map((rule) => rule.signal),
  } as const;
}

export function evaluateResourceTransferSocialOutcome(input: {
  readonly recipientAgentId: AgentId;
  readonly providerAgentId: AgentId;
  readonly quantity: number;
}): DirectionalSocialOutcome & {
  readonly policyVersion: typeof RESOURCE_TRANSFER_SOCIAL_OUTCOME_POLICY_VERSION;
} {
  if (input.recipientAgentId === input.providerAgentId) {
    throw new Error('resource transfer participants must differ');
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('resource transfer quantity must be positive finite');
  }
  const scale = Math.log2(1 + input.quantity);
  return {
    policyVersion: RESOURCE_TRANSFER_SOCIAL_OUTCOME_POLICY_VERSION,
    sourceAgentId: input.recipientAgentId,
    targetAgentId: input.providerAgentId,
    relationDelta: Number(Math.min(0.12, 0.03 + 0.02 * scale).toFixed(6)),
    attitudeDelta: Number(Math.min(0.15, 0.04 + 0.025 * scale).toFixed(6)),
    signals: ['resource-help-received'],
  };
}

export function applySocialInteraction(input: {
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly current?: SocialRelationState;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly summary: string;
}): SocialRelationState {
  createDirectedSocialRelationKey(input);
  assertBoundedDelta(input.relationDelta, 'relationDelta');
  assertBoundedDelta(input.attitudeDelta, 'attitudeDelta');

  const summary = input.summary.trim();
  if (summary.length === 0) {
    throw new Error('social interaction summary must not be empty');
  }

  const relationScore = clampScore((input.current?.relationScore ?? 0) + input.relationDelta);
  const attitudeScore = clampScore((input.current?.attitudeScore ?? 0) + input.attitudeDelta);

  return {
    sourceAgentId: input.sourceAgentId,
    targetAgentId: input.targetAgentId,
    relationScore,
    attitudeScore,
    relationLabel: classifyRelation(relationScore),
    interactionCount: (input.current?.interactionCount ?? 0) + 1,
    lastInteractionSummary: summary,
  };
}

export function classifyRelation(relationScore: number): SocialRelationLabel {
  assertFiniteNumber(relationScore, 'relationScore');
  if (relationScore <= -0.5) {
    return 'hostile';
  }
  if (relationScore < 0) {
    return 'strained';
  }
  if (relationScore < 0.3) {
    return 'acquaintance';
  }
  if (relationScore < 0.6) {
    return 'friend';
  }
  if (relationScore < 0.85) {
    return 'close-friend';
  }
  return 'best-friend';
}

export function createDirectedSocialRelationKey(input: {
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
}): SocialRelationKey {
  if (input.sourceAgentId === input.targetAgentId) {
    throw new Error('social relation target must differ from source');
  }
  return `${input.sourceAgentId}->${input.targetAgentId}`;
}

function clampScore(value: number): number {
  assertFiniteNumber(value, 'score');
  return Math.max(-1, Math.min(1, value));
}

function evaluateParticipantOutcome(input: {
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly turns: readonly SocialDialogueTurnEvidence[];
}): DirectionalSocialOutcome {
  const targetTurns = input.turns.filter((turn) => turn.speakerAgentId === input.targetAgentId);
  const matchedSignals = new Set<string>();
  let relationDelta = 0;
  let attitudeDelta = 0;
  for (const turn of targetTurns) {
    const intent = normalizeSignalText(turn.intent ?? '');
    const utterance = normalizeSignalText(turn.utterance);
    for (const rule of socialSignalRules) {
      if (
        matchedSignals.has(rule.signal) ||
        (!containsSignal(intent, rule.intentTokens) &&
          !containsSignal(utterance, rule.utteranceTokens))
      ) {
        continue;
      }
      matchedSignals.add(rule.signal);
      relationDelta += rule.relationDelta;
      attitudeDelta += rule.attitudeDelta;
    }
  }
  return {
    sourceAgentId: input.sourceAgentId,
    targetAgentId: input.targetAgentId,
    relationDelta: clampConversationDelta(relationDelta),
    attitudeDelta: clampConversationDelta(attitudeDelta),
    signals: [...matchedSignals],
  };
}

function clampConversationDelta(value: number): number {
  return Number(
    Math.max(
      MAX_NEGATIVE_CONVERSATION_DELTA,
      Math.min(MAX_POSITIVE_CONVERSATION_DELTA, value),
    ).toFixed(6),
  );
}

function containsSignal(value: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

function normalizeSignalText(value: string): string {
  return value.trim().toLowerCase().replaceAll('_', '-').replace(/\s+/gu, ' ');
}

function decayScore(score: number, elapsedMs: number, halfLifeMs: number): number {
  assertFiniteNumber(score, 'social relation score');
  return Number((score * 2 ** (-elapsedMs / halfLifeMs)).toFixed(12));
}

function assertBoundedDelta(value: number, name: string): void {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new Error(`${name} must be within [-1, 1]`);
  }
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
