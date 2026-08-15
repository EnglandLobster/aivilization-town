/**
 * Collective action rules (collective-action-v1): the petition minimal set.
 * A petition aggregates individual signatures; crossing the policy threshold
 * is a pure counting rule consumed by the world settlement (which owns the
 * petition lifecycle and emits the town-wide threshold event). Strikes and
 * other ledger-touching collective action are deliberately out of scope
 * until their accounting impact is argued (roadmap P4b).
 */

export type CollectiveActionPolicy = {
  readonly policyVersion: string;
  /**
   * Signature count (the raiser's signature included) at which a petition
   * reaches its threshold. Positive integer; 1 means the raise alone fires.
   */
  readonly petitionSignatureThreshold: number;
  /**
   * Simulation milliseconds after raisedAt at which an open (not yet
   * threshold-reaching) petition expires.
   */
  readonly petitionExpiryMs: number;
  readonly source?: string;
};

/** Threshold decision for one petition's current signature count. */
export function evaluatePetitionThreshold(input: {
  readonly signatureCount: number;
  readonly policy: CollectiveActionPolicy;
}): boolean {
  assertValidCollectiveActionPolicy(input.policy);
  if (!Number.isInteger(input.signatureCount) || input.signatureCount < 0) {
    throw new Error('petition signatureCount must be a non-negative integer');
  }
  return input.signatureCount >= input.policy.petitionSignatureThreshold;
}

export function assertValidCollectiveActionPolicy(policy: CollectiveActionPolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('collective action policyVersion must not be empty');
  }
  if (
    !Number.isInteger(policy.petitionSignatureThreshold) ||
    policy.petitionSignatureThreshold < 1
  ) {
    throw new Error('collective action petitionSignatureThreshold must be a positive integer');
  }
  if (!Number.isFinite(policy.petitionExpiryMs) || policy.petitionExpiryMs <= 0) {
    throw new Error('collective action petitionExpiryMs must be a positive finite number');
  }
}
