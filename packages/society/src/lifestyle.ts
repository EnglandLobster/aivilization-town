/**
 * Lifestyle tiers and pure evaluators for wealth-tiered consumption. An
 * agent's net worth (balance plus inventory valued at spot prices) maps onto
 * one of four tiers; the struggling tier caps non-survival spending at a
 * fraction of the spendable balance, benchmarked against the CS2 consumption
 * multiplier `0.3 + 10*smoothstep(wealth)`. All evaluation is pure and
 * deterministic — the world settles nothing from it; it feeds decision
 * contexts and planning budget guardrails only.
 */
export type LifestyleTier = 'struggling' | 'stable' | 'comfortable' | 'affluent';

export type LifestylePolicy = {
  readonly policyVersion: string;
  // Strictly increasing net-worth ceilings, exactly 3 entries:
  // netWorth < boundaries[0] → struggling; < boundaries[1] → stable;
  // < boundaries[2] → comfortable; otherwise affluent.
  readonly netWorthBoundaries: readonly [number, number, number];
  // Struggling-tier cap on non-survival spending, as a share (0..1) of the
  // spendable balance. Survival spending (food purchases, medical treatment)
  // is exempt.
  readonly strugglingNonSurvivalSpendCapRatio: number;
  /**
   * Optional wellbeing modulation range for the cap (town-wellbeing
   * interlock): the effective ratio = base × multiplier, the multiplier
   * lerping inside this range by (wellbeing − 50)/100. The FINAL ratio is
   * clamped to [0, 1] so a valid base can never produce a downstream-invalid
   * share. Absent keeps the static ratio.
   */
  readonly wellbeingSpendCapMultiplierRange?: readonly [number, number];
  readonly source: string;
};

/**
 * Wellbeing-modulated non-survival spend-cap ratio (town-wellbeing ×
 * lifestyle interlock): the struggling-tier cap tightens for distressed
 * agents (survival mode) and loosens slightly for content ones — a ×[0.5,
 * 1.5] multiplier linear in (wellbeing − 50)/100. Absent wellbeing returns
 * the base ratio unchanged (read-path only; settlement never consumes this).
 */
export function evaluateNonSurvivalSpendCapRatio(input: {
  readonly baseRatio: number;
  readonly wellbeing?: number;
  readonly multiplierRange?: readonly [number, number];
}): number {
  if (!Number.isFinite(input.baseRatio) || input.baseRatio < 0) {
    throw new Error('non-survival spend cap ratio must be non-negative finite');
  }
  if (input.wellbeing === undefined) {
    return input.baseRatio;
  }
  if (!Number.isFinite(input.wellbeing)) {
    throw new Error('wellbeing must be finite');
  }
  const [minMultiplier, maxMultiplier] = input.multiplierRange ?? [0.5, 1.5];
  if (
    !Number.isFinite(minMultiplier) ||
    !Number.isFinite(maxMultiplier) ||
    minMultiplier <= 0 ||
    maxMultiplier < minMultiplier
  ) {
    throw new Error('wellbeing spend-cap multiplier range must be [positive min, max ≥ min]');
  }
  const multiplier = Math.max(
    minMultiplier,
    Math.min(maxMultiplier, 1 + (input.wellbeing - 50) / 100),
  );
  // The final value is a share of the spendable balance: clamp to [0, 1] so a
  // valid base ratio can never produce a share the action-synthesis budget
  // guardrails reject.
  return Math.max(0, Math.min(1, input.baseRatio * multiplier));
}

export function evaluateLifestyleTier(input: {
  readonly netWorth: number;
  readonly policy: LifestylePolicy;
}): LifestyleTier {
  if (!Number.isFinite(input.netWorth)) {
    throw new Error('netWorth must be finite');
  }
  assertValidLifestylePolicy(input.policy);

  const [strugglingBoundary, stableBoundary, comfortableBoundary] = input.policy.netWorthBoundaries;
  if (input.netWorth < strugglingBoundary) {
    return 'struggling';
  }
  if (input.netWorth < stableBoundary) {
    return 'stable';
  }
  if (input.netWorth < comfortableBoundary) {
    return 'comfortable';
  }
  return 'affluent';
}

function assertValidLifestylePolicy(policy: LifestylePolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('lifestyle policyVersion must not be empty');
  }
  const boundaries = policy.netWorthBoundaries;
  if (boundaries.length !== 3) {
    throw new Error('lifestyle netWorthBoundaries must contain exactly 3 boundaries');
  }
  boundaries.forEach((boundary, index) => {
    if (!Number.isFinite(boundary)) {
      throw new Error('lifestyle netWorthBoundaries must be finite');
    }
    if (index > 0 && boundary <= (boundaries[index - 1] ?? Number.NEGATIVE_INFINITY)) {
      throw new Error('lifestyle netWorthBoundaries must be strictly increasing');
    }
  });
  const ratio = policy.strugglingNonSurvivalSpendCapRatio;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error('lifestyle strugglingNonSurvivalSpendCapRatio must be between 0 and 1');
  }
  const range = policy.wellbeingSpendCapMultiplierRange;
  if (
    range !== undefined &&
    (!Number.isFinite(range[0]) ||
      !Number.isFinite(range[1]) ||
      range[0] <= 0 ||
      range[1] < range[0])
  ) {
    throw new Error('lifestyle wellbeingSpendCapMultiplierRange must be [positive min, max ≥ min]');
  }
}
