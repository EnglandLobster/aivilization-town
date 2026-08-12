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
export const SOCIAL_OUTCOME_SUPPLIED_SIGNALS_POLICY_VERSION = 'conversation-outcome-v2';
export const SOCIAL_OUTCOME_SEVERITY_SIGNALS_POLICY_VERSION = 'conversation-outcome-v3';
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
  /**
   * Present only under the severity-weighted policy (conversation-outcome-v3): the severity each
   * counted signal was applied with, in the same order as `signals`.
   */
  readonly signalSeverities?: readonly {
    readonly signal: string;
    readonly severity: number;
  }[];
};

export type ConversationSocialOutcomePolicyVersion =
  | typeof SOCIAL_OUTCOME_POLICY_VERSION
  | typeof SOCIAL_OUTCOME_SUPPLIED_SIGNALS_POLICY_VERSION
  | typeof SOCIAL_OUTCOME_SEVERITY_SIGNALS_POLICY_VERSION;

export type ConversationSocialOutcomes = {
  readonly policyVersion: ConversationSocialOutcomePolicyVersion;
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
  readonly description: string;
  readonly intentTokens: readonly string[];
  readonly utteranceTokens: readonly string[];
  readonly relationDelta: number;
  readonly attitudeDelta: number;
};

const socialSignalRules: readonly SocialSignalRule[] = [
  {
    signal: 'betrayal',
    description:
      'The speaker breaks a promise, reneges on a commitment, or otherwise betrays the listener.',
    intentTokens: ['betray', 'break-promise', 'renege'],
    utteranceTokens: ['betrayed you', 'broke my promise', 'will not honor'],
    relationDelta: -0.3,
    attitudeDelta: -0.24,
  },
  {
    signal: 'deception',
    description: 'The speaker lies to, misinforms, or otherwise deceives the listener.',
    intentTokens: ['deceive', 'misinform', 'lie'],
    utteranceTokens: ['lied to you', 'deceived you', 'false information'],
    relationDelta: -0.2,
    attitudeDelta: -0.25,
  },
  {
    signal: 'hostility',
    description: 'The speaker threatens, insults, or intimidates the listener.',
    intentTokens: ['threaten', 'insult', 'hostile', 'intimidate'],
    utteranceTokens: ['i threaten', 'you are useless', 'stay away'],
    relationDelta: -0.12,
    attitudeDelta: -0.18,
  },
  {
    signal: 'rejection',
    description: "The speaker refuses cooperation or dismisses the listener's request.",
    intentTokens: ['refuse-cooperation', 'dismiss', 'reject-request'],
    utteranceTokens: ['i refuse to help', 'not my problem'],
    relationDelta: -0.06,
    attitudeDelta: -0.08,
  },
  {
    signal: 'repair',
    description: 'The speaker apologizes, makes amends, or tries to reconcile after harm.',
    intentTokens: ['apologize', 'repair', 'make-amends', 'reconcile'],
    utteranceTokens: ['i apologize', 'make amends', 'repair the harm'],
    relationDelta: 0.02,
    attitudeDelta: 0.08,
  },
  {
    signal: 'fulfilled-commitment',
    description: 'The speaker honors or follows through on a prior commitment.',
    intentTokens: ['fulfill-commitment', 'honor-promise', 'follow-through'],
    utteranceTokens: [],
    relationDelta: 0.12,
    attitudeDelta: 0.1,
  },
  {
    signal: 'cooperation',
    description: 'The speaker offers help, shares resources, or agrees to work together.',
    intentTokens: ['cooperate', 'coordinate', 'help', 'support', 'share-resource'],
    utteranceTokens: ['work together', 'study together', 'i can help', 'share with you'],
    relationDelta: 0.06,
    attitudeDelta: 0.06,
  },
  {
    signal: 'perspective-taking',
    description: "The speaker invites or engages with the listener's point of view.",
    intentTokens: ['invite-perspective', 'share-goal-and-listen'],
    utteranceTokens: ['your perspective', 'listen to you'],
    relationDelta: 0.03,
    attitudeDelta: 0.04,
  },
  {
    signal: 'relationship-continuation',
    description: 'The speaker wants to stay in touch and keep the relationship going.',
    intentTokens: ['continue-relationship', 'keep-informed'],
    utteranceTokens: ['keep each other informed', 'stay in touch'],
    relationDelta: 0.03,
    attitudeDelta: 0.04,
  },
  {
    signal: 'constructive-opening',
    description: 'The speaker opens a contextual topic in good faith.',
    intentTokens: ['open-contextual-topic'],
    utteranceTokens: ['compare notes'],
    relationDelta: 0.01,
    attitudeDelta: 0.02,
  },
] as const;

/**
 * Canonical social signal taxonomy shared by the deterministic keyword adjudicator, the optional
 * LLM signal extractor prompt, and world-side validation of supplied per-turn signals.
 */
export const SOCIAL_SIGNAL_TAXONOMY: readonly {
  readonly signal: string;
  readonly description: string;
}[] = socialSignalRules.map((rule) => ({ signal: rule.signal, description: rule.description }));

export function isSocialSignalName(value: string): boolean {
  return socialSignalRules.some((rule) => rule.signal === value);
}

/**
 * Look up the canonical relation/attitude deltas for a signal in the rule
 * table, so non-conversation adjudications (e.g. social-matter closures) reuse
 * the same scoring instead of inventing new numbers.
 */
export function resolveSocialSignalDeltas(
  signal: string,
): { readonly relationDelta: number; readonly attitudeDelta: number } | undefined {
  const rule = socialSignalRules.find((candidate) => candidate.signal === signal);
  return rule === undefined
    ? undefined
    : { relationDelta: rule.relationDelta, attitudeDelta: rule.attitudeDelta };
}

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
      resolveTurnSignals: resolveKeywordTurnSignals,
    }),
    targetToInitiator: evaluateParticipantOutcome({
      sourceAgentId: input.targetAgentId,
      targetAgentId: input.initiatorAgentId,
      turns: input.turns,
      resolveTurnSignals: resolveKeywordTurnSignals,
    }),
  };
}

export type SuppliedConversationTurnSignals = {
  readonly turnIndex: number;
  readonly signals: readonly string[];
};

export type SuppliedConversationSignalSeverity = {
  readonly signal: string;
  readonly severity?: number;
};

export type SuppliedConversationTurnSignalSeverities = {
  readonly turnIndex: number;
  readonly signals: readonly SuppliedConversationSignalSeverity[];
};

/**
 * Same adjudication as {@link evaluateConversationSocialOutcomes} — identical rule table, per-signal
 * once-only accounting, directionality, and clamp — but signals come from an externally supplied
 * per-turn list (recorded in the command payload) instead of deterministic keyword matching. Signal
 * names outside {@link SOCIAL_SIGNAL_TAXONOMY} and out-of-range turn indexes contribute nothing.
 */
export function evaluateConversationSocialOutcomesFromSignals(input: {
  readonly initiatorAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly turns: readonly SocialDialogueTurnEvidence[];
  readonly turnSignals: readonly SuppliedConversationTurnSignals[];
}): ConversationSocialOutcomes {
  if (input.initiatorAgentId === input.targetAgentId) {
    throw new Error('conversation participants must differ');
  }
  const resolveTurnSignals = createSuppliedTurnSignalResolver(
    input.turnSignals.map((entry) => ({
      turnIndex: entry.turnIndex,
      signals: entry.signals.map((signal) => ({ signal })),
    })),
  );
  return {
    policyVersion: SOCIAL_OUTCOME_SUPPLIED_SIGNALS_POLICY_VERSION,
    initiatorToTarget: evaluateParticipantOutcome({
      sourceAgentId: input.initiatorAgentId,
      targetAgentId: input.targetAgentId,
      turns: input.turns,
      resolveTurnSignals,
    }),
    targetToInitiator: evaluateParticipantOutcome({
      sourceAgentId: input.targetAgentId,
      targetAgentId: input.initiatorAgentId,
      turns: input.turns,
      resolveTurnSignals,
    }),
  };
}

/**
 * Severity-weighted variant of {@link evaluateConversationSocialOutcomesFromSignals}: each supplied
 * signal carries a severity in [0, 1] (omitted means 1) and the applied delta is the rule-table
 * base delta multiplied by that severity — a mild broken promise and a public betrayal share the
 * 'betrayal' base but scale differently. The per-conversation clamp and once-per-signal accounting
 * are unchanged; the first in-range occurrence of a signal supplies its severity. Entries with an
 * out-of-range or non-finite severity contribute nothing (callers are expected to reject such
 * proposals before they reach the world).
 */
export function evaluateConversationSocialOutcomesFromSignalSeverities(input: {
  readonly initiatorAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly turns: readonly SocialDialogueTurnEvidence[];
  readonly turnSignals: readonly SuppliedConversationTurnSignalSeverities[];
}): ConversationSocialOutcomes {
  if (input.initiatorAgentId === input.targetAgentId) {
    throw new Error('conversation participants must differ');
  }
  const resolveTurnSignals = createSuppliedTurnSignalResolver(input.turnSignals);
  return {
    policyVersion: SOCIAL_OUTCOME_SEVERITY_SIGNALS_POLICY_VERSION,
    initiatorToTarget: evaluateParticipantOutcome({
      sourceAgentId: input.initiatorAgentId,
      targetAgentId: input.targetAgentId,
      turns: input.turns,
      resolveTurnSignals,
      withSignalSeverities: true,
    }),
    targetToInitiator: evaluateParticipantOutcome({
      sourceAgentId: input.targetAgentId,
      targetAgentId: input.initiatorAgentId,
      turns: input.turns,
      resolveTurnSignals,
      withSignalSeverities: true,
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
    suppliedSignalsOutcomePolicyVersion: SOCIAL_OUTCOME_SUPPLIED_SIGNALS_POLICY_VERSION,
    severitySignalsOutcomePolicyVersion: SOCIAL_OUTCOME_SEVERITY_SIGNALS_POLICY_VERSION,
    resourceTransferOutcomePolicyVersion: RESOURCE_TRANSFER_SOCIAL_OUTCOME_POLICY_VERSION,
    decayPolicyVersion: SOCIAL_RELATION_DECAY_POLICY_VERSION,
    authority: 'world-evaluates-transcript-agent-score-hints-ignored',
    directionality: 'each-observer-evaluates-the-other-participants-turns',
    maximumPositiveConversationDelta: MAX_POSITIVE_CONVERSATION_DELTA,
    maximumNegativeConversationDelta: MAX_NEGATIVE_CONVERSATION_DELTA,
    relationHalfLifeMs: SOCIAL_RELATION_HALF_LIFE_MS,
    attitudeHalfLifeMs: SOCIAL_ATTITUDE_HALF_LIFE_MS,
    signals: socialSignalRules.map((rule) => rule.signal),
    signalTaxonomy: SOCIAL_SIGNAL_TAXONOMY.map((entry) => ({ ...entry })),
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

type ResolvedTurnSignal = {
  readonly signal: string;
  readonly severity?: number;
};

function evaluateParticipantOutcome(input: {
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly turns: readonly SocialDialogueTurnEvidence[];
  readonly resolveTurnSignals: (
    turn: SocialDialogueTurnEvidence,
    turnIndex: number,
  ) => readonly ResolvedTurnSignal[];
  readonly withSignalSeverities?: boolean;
}): DirectionalSocialOutcome {
  const targetTurns = input.turns
    .map((turn, turnIndex) => ({ turn, turnIndex }))
    .filter(({ turn }) => turn.speakerAgentId === input.targetAgentId);
  const matchedSignals = new Set<string>();
  const signalSeverities: { readonly signal: string; readonly severity: number }[] = [];
  let relationDelta = 0;
  let attitudeDelta = 0;
  for (const { turn, turnIndex } of targetTurns) {
    const turnSignals = input.resolveTurnSignals(turn, turnIndex);
    for (const rule of socialSignalRules) {
      const match = turnSignals.find((candidate) => candidate.signal === rule.signal);
      if (matchedSignals.has(rule.signal) || match === undefined) {
        continue;
      }
      const severity = match.severity ?? 1;
      if (!Number.isFinite(severity) || severity < 0 || severity > 1) {
        continue;
      }
      matchedSignals.add(rule.signal);
      relationDelta += rule.relationDelta * severity;
      attitudeDelta += rule.attitudeDelta * severity;
      signalSeverities.push({ signal: rule.signal, severity });
    }
  }
  return {
    sourceAgentId: input.sourceAgentId,
    targetAgentId: input.targetAgentId,
    relationDelta: clampConversationDelta(relationDelta),
    attitudeDelta: clampConversationDelta(attitudeDelta),
    signals: [...matchedSignals],
    ...(input.withSignalSeverities === true ? { signalSeverities } : {}),
  };
}

function resolveKeywordTurnSignals(turn: SocialDialogueTurnEvidence): readonly ResolvedTurnSignal[] {
  const intent = normalizeSignalText(turn.intent ?? '');
  const utterance = normalizeSignalText(turn.utterance);
  return socialSignalRules
    .filter(
      (rule) =>
        containsSignal(intent, rule.intentTokens) || containsSignal(utterance, rule.utteranceTokens),
    )
    .map((rule) => ({ signal: rule.signal }));
}

function createSuppliedTurnSignalResolver(
  turnSignals: readonly SuppliedConversationTurnSignalSeverities[],
): (turn: SocialDialogueTurnEvidence, turnIndex: number) => readonly ResolvedTurnSignal[] {
  const signalsByTurnIndex = new Map<number, readonly ResolvedTurnSignal[]>();
  for (const entry of turnSignals) {
    if (!Number.isInteger(entry.turnIndex) || entry.turnIndex < 0) {
      continue;
    }
    const knownSignals = entry.signals.filter((signal) => isSocialSignalName(signal.signal));
    if (knownSignals.length === 0) {
      continue;
    }
    const existing = signalsByTurnIndex.get(entry.turnIndex) ?? [];
    signalsByTurnIndex.set(entry.turnIndex, [...existing, ...knownSignals]);
  }
  return (_turn, turnIndex) => signalsByTurnIndex.get(turnIndex) ?? [];
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
