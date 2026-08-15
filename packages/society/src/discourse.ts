/**
 * Town discourse propagation (town-discourse-v1): when a conversation
 * settles, each direction can carry one of the speaker's recent memories to
 * the listener as a hearsay copy with a deterministically distorted
 * importance. The rule here is a pure decision function: candidates + policy
 * + caller-supplied rolls -> what propagates. The world layer owns the
 * rolls (seeded per command and direction) and maps memory records onto the
 * minimal candidate shape below; the memory package owns the resulting
 * record and already ranks hearsay below firsthand on retrieval.
 *
 * Determinism: candidate SELECTION is a pure sort (importance descending,
 * id ascending as the tiebreak) — no RNG. RNG participates only in (a) the
 * propagation gate and (b) the importance-distortion multiplier, both from
 * caller-seeded rolls in [0, 1).
 */

export type TownDiscoursePolicy = {
  readonly policyVersion: string;
  /**
   * Probability percent that one conversation direction carries a memory
   * from speaker to listener. 0 disables propagation entirely.
   */
  readonly propagationProbabilityPercent: number;
  /**
   * Importance multiplier range for the hearsay copy, [min, max]; the
   * distortion roll lerps inside it. Gossip can inflate or deflate what the
   * listener ends up weighting.
   */
  readonly importanceMultiplierRange: readonly [number, number];
  /**
   * Maximum hearsay chain depth: firsthand memories are depth 0, each hop
   * adds one. Candidates at or beyond this depth no longer re-share, so
   * rumors die out instead of circulating forever.
   */
  readonly maxChainDepth: number;
  readonly source?: string;
};

/**
 * Minimal speaker-memory candidate the world adapter derives from memory
 * records. Provenance fields mirror the memory package's vocabulary without
 * importing it (society must not depend on memory).
 */
export type DiscoursePropagationCandidate = {
  /** Stable id used only as the deterministic selection tiebreak. */
  readonly recordId: string;
  readonly importanceScore: number;
  readonly tags: readonly string[];
  /** Provenance kind; undefined marks a legacy untagged record. */
  readonly provenanceKind?: 'firsthand' | 'hearsay' | 'implanted';
  readonly provenanceStatus?: 'influencing' | 'doubtful' | 'corrected' | 'past';
  /** Hearsay hops already taken; 0 (or absent) marks a firsthand record. */
  readonly chainDepth: number;
};

/** The propagation decision for one conversation direction. */
export type DiscoursePropagationDecision = {
  /** The selected source candidate (highest eligible importance). */
  readonly candidate: DiscoursePropagationCandidate;
  /** Distorted importance for the hearsay copy, clamped to [0, 1]. */
  readonly distortedImportance: number;
  /** Chain depth of the copy (candidate depth + 1). */
  readonly nextChainDepth: number;
};

export const HEARSAY_CHAIN_TAG_PREFIX = 'hearsay-chain:';

/** Parses the hearsay chain depth off a candidate's tags (0 when absent). */
export function parseHearsayChainDepth(tags: readonly string[]): number {
  for (const tag of tags) {
    if (!tag.startsWith(HEARSAY_CHAIN_TAG_PREFIX)) {
      continue;
    }
    const depth = Number.parseInt(tag.slice(HEARSAY_CHAIN_TAG_PREFIX.length), 10);
    if (Number.isInteger(depth) && depth >= 0) {
      return depth;
    }
  }
  return 0;
}

/**
 * One direction's propagation decision. Returns null when the gate roll
 * misses the probability, when no candidate is eligible (implanted and
 * corrected/doubtful/past provenance never travels; hearsay at or beyond
 * maxChainDepth stays put), or when the distorted importance collapses to
 * zero — silence is a valid outcome, not an error.
 */
export function evaluateDiscoursePropagation(input: {
  readonly candidates: readonly DiscoursePropagationCandidate[];
  readonly policy: TownDiscoursePolicy;
  /** Caller-seeded roll in [0, 1) for the propagation gate. */
  readonly gateRoll: number;
  /** Caller-seeded roll in [0, 1) for the importance distortion. */
  readonly distortionRoll: number;
}): DiscoursePropagationDecision | null {
  assertValidTownDiscoursePolicy(input.policy);
  assertUnitRoll(input.gateRoll, 'gateRoll');
  assertUnitRoll(input.distortionRoll, 'distortionRoll');

  if (
    input.policy.propagationProbabilityPercent <= 0 ||
    input.gateRoll >= input.policy.propagationProbabilityPercent / 100
  ) {
    return null;
  }
  const eligible = input.candidates
    .filter((candidate) => isEligible(candidate, input.policy))
    .sort(
      (left, right) =>
        right.importanceScore - left.importanceScore || left.recordId.localeCompare(right.recordId),
    );
  const candidate = eligible[0];
  if (candidate === undefined) {
    return null;
  }
  const [minMultiplier, maxMultiplier] = input.policy.importanceMultiplierRange;
  const multiplier = minMultiplier + (maxMultiplier - minMultiplier) * input.distortionRoll;
  const distortedImportance = Math.max(0, Math.min(1, candidate.importanceScore * multiplier));
  if (distortedImportance === 0) {
    return null;
  }
  return {
    candidate,
    distortedImportance,
    nextChainDepth: candidate.chainDepth + 1,
  };
}

function isEligible(
  candidate: DiscoursePropagationCandidate,
  policy: TownDiscoursePolicy,
): boolean {
  if (candidate.provenanceKind === 'implanted') {
    return false;
  }
  if (
    candidate.provenanceStatus === 'doubtful' ||
    candidate.provenanceStatus === 'corrected' ||
    candidate.provenanceStatus === 'past'
  ) {
    return false;
  }
  if (candidate.chainDepth >= policy.maxChainDepth) {
    return false;
  }
  return candidate.importanceScore > 0;
}

export function assertValidTownDiscoursePolicy(policy: TownDiscoursePolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('town discourse policyVersion must not be empty');
  }
  if (
    !Number.isFinite(policy.propagationProbabilityPercent) ||
    policy.propagationProbabilityPercent < 0 ||
    policy.propagationProbabilityPercent > 100
  ) {
    throw new Error('town discourse propagationProbabilityPercent must be within [0, 100]');
  }
  const [minMultiplier, maxMultiplier] = policy.importanceMultiplierRange;
  if (
    !Number.isFinite(minMultiplier) ||
    !Number.isFinite(maxMultiplier) ||
    minMultiplier <= 0 ||
    maxMultiplier < minMultiplier
  ) {
    throw new Error('town discourse importanceMultiplierRange must be [positive min, max ≥ min]');
  }
  if (!Number.isInteger(policy.maxChainDepth) || policy.maxChainDepth < 1) {
    throw new Error('town discourse maxChainDepth must be a positive integer');
  }
}

function assertUnitRoll(roll: number, name: string): void {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new Error(`${name} must be within [0, 1)`);
  }
}
