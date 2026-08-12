import type { AgentId } from '@aivilization/sim-core';

export const SOCIAL_MATTERS_POLICY_VERSION = 'social-matters-v1';

/**
 * Versioned social-matters policy.
 * Opt-in via the social-matters switch: without the policy every matter
 * command is rejected and no matter state or events exist.
 */
export type SocialMattersPolicy = {
  readonly policyVersion: string;
  /** Default lifetime (simulation ms) before an unresolved matter expires. */
  readonly defaultExpiryMs: number;
};

export type SocialMatterKind = 'help-request' | 'commitment';

export type SocialMatterStatus =
  | 'latent'
  | 'open'
  | 'collecting'
  | 'assigned'
  | 'executing'
  | 'closed';

export type SocialMatterClosure = 'fulfilled' | 'breached' | 'expired' | 'withdrawn';

export type SocialMatterResponseDecision = 'accept' | 'reject' | 'defer' | 'withdraw';

export type SocialMatterResponse = {
  readonly responderAgentId: AgentId;
  readonly decision: Exclude<SocialMatterResponseDecision, 'withdraw'>;
  readonly respondedAt: number;
};

/**
 * A durable social matter (social-matters-v1). Lifecycle:
 * latent → open → collecting → assigned → executing → closed.
 *
 * - `help-request` matters are raised `open`, move to `collecting` on the
 *   first accept response, to `assigned` when the initiator picks a candidate,
 *   to `executing` on partial world-verified delivery, and to `closed` on
 *   fulfillment, breach, expiry, or withdrawal.
 * - `commitment` matters are the escalation of a conversation commitment
 *   (make-commitment intent): they enter `latent` pre-bound to the promisor
 *   and close when the world adjudicates fulfillment/breach — never on
 *   self-report alone.
 *
 * Expiry is deterministic: latent/open/collecting matters close `expired`;
 * assigned/executing matters close `breached` (the assignee defaulted).
 */
export type WorldSocialMatterState = {
  readonly matterId: string;
  readonly kind: SocialMatterKind;
  readonly status: SocialMatterStatus;
  readonly closure?: SocialMatterClosure;
  readonly initiatorAgentId: AgentId;
  readonly topic: string;
  readonly statement: string;
  readonly requiredCommodity?: {
    readonly commodityName: string;
    readonly quantity: number;
  };
  readonly assigneeAgentId?: AgentId;
  readonly responses: readonly SocialMatterResponse[];
  readonly deliveredQuantity?: number;
  readonly sourceCommitmentId?: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly assignedAt?: number;
  readonly closedAt?: number;
  readonly fulfillmentEventId?: string;
};

export function cloneSocialMatter(matter: WorldSocialMatterState): WorldSocialMatterState {
  return {
    ...matter,
    ...(matter.requiredCommodity === undefined
      ? {}
      : { requiredCommodity: { ...matter.requiredCommodity } }),
    responses: matter.responses.map((response) => ({ ...response })),
  };
}

/** Matter statuses in which the initiator may assign a candidate. */
export function isMatterAssignable(status: SocialMatterStatus): boolean {
  return status === 'open' || status === 'collecting';
}

/** Matter statuses that expire as `expired` (nobody committed yet). */
export function isMatterExpiryWithoutBreach(status: SocialMatterStatus): boolean {
  return status === 'latent' || status === 'open' || status === 'collecting';
}
