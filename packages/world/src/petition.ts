import type { AgentId } from '@aivilization/sim-core';

/**
 * Town petition aggregate (collective-action-v1): one resident raises a
 * petition, every resident may sign once, and crossing the policy threshold
 * fires a town-wide PetitionThresholdReached. The threshold rule itself is
 * the society pure function `evaluatePetitionThreshold`; this module owns
 * the durable petition shape and construction-time invariants. Strikes and
 * other ledger-touching collective action are out of scope until their
 * accounting impact is argued (roadmap P4b).
 */

export type WorldPetitionState = {
  readonly petitionId: string;
  readonly topic: string;
  readonly statement: string;
  readonly raisedByAgentId: AgentId;
  readonly raisedAt: number;
  readonly expiresAt: number;
  /** Signatures in signing order; the raiser's signature is the first. */
  readonly signatureAgentIds: readonly AgentId[];
  readonly status: 'open' | 'threshold-reached' | 'expired';
  readonly thresholdReachedAt?: number;
};

export function createPetition(input: {
  readonly petitionId: string;
  readonly topic: string;
  readonly statement: string;
  readonly raisedByAgentId: AgentId;
  readonly raisedAt: number;
  readonly expiresAt: number;
}): WorldPetitionState {
  if (input.petitionId.trim().length === 0) {
    throw new Error('petitionId must not be empty');
  }
  if (input.topic.trim().length === 0 || input.topic.length > 100) {
    throw new Error('petition topic must be a non-empty string of at most 100 chars');
  }
  if (input.statement.trim().length === 0 || input.statement.length > 1000) {
    throw new Error('petition statement must be a non-empty string of at most 1000 chars');
  }
  if (!Number.isFinite(input.raisedAt) || input.raisedAt < 0) {
    throw new Error('petition raisedAt must be non-negative finite');
  }
  if (!Number.isFinite(input.expiresAt) || input.expiresAt <= input.raisedAt) {
    throw new Error('petition expiresAt must be a finite instant after raisedAt');
  }
  return {
    petitionId: input.petitionId,
    topic: input.topic,
    statement: input.statement,
    raisedByAgentId: input.raisedByAgentId,
    raisedAt: input.raisedAt,
    expiresAt: input.expiresAt,
    signatureAgentIds: [input.raisedByAgentId],
    status: 'open',
  };
}

export function clonePetition(petition: WorldPetitionState): WorldPetitionState {
  return {
    ...petition,
    signatureAgentIds: [...petition.signatureAgentIds],
  };
}
