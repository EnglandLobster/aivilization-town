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
