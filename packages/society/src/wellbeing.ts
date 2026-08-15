import type { LifestyleTier } from './lifestyle';

/**
 * Agent wellbeing (幸福感): a durable, authoritative scalar state variable per
 * agent, inspired by the Cities: Skylines II citizen Happiness system, where an
 * aggregated well-being value feeds citizen behavior and is itself fed by
 * health, wealth, employment, housing, and social factors. Here the value is
 * authoritative simulation state: the world settles it during time advancement
 * and persists every change as a WellbeingChanged event, so replays stay
 * deterministic.
 *
 * The evaluator is a pure function: previous value + factor snapshot + policy
 * -> next value. The instantaneous target is the policy baseline plus the sum
 * of per-factor contributions, clamped to [minValue, maxValue]; the durable
 * value converges toward that target by at most `convergencePerHour` per hour
 * of elapsed simulation time, snapping onto the target once the remaining gap
 * fits inside one step (so a settled agent reaches a fixed point and stops
 * emitting events instead of asymptotically approaching forever).
 */

/** Derived wellbeing band view for decision contexts; never stored. */
export type WellbeingBand = 'distressed' | 'low' | 'steady' | 'content' | 'thriving';

/**
 * Band cut points, strictly increasing: value < distressedBelow → 'distressed',
 * < lowBelow → 'low', < contentBelow → 'steady', < thrivingBelow → 'content',
 * otherwise 'thriving'.
 */
export type WellbeingBandThresholds = {
  readonly distressedBelow: number;
  readonly lowBelow: number;
  readonly contentBelow: number;
  readonly thrivingBelow: number;
};

export const DEFAULT_WELLBEING_BAND_THRESHOLDS: WellbeingBandThresholds = {
  distressedBelow: 20,
  lowBelow: 40,
  contentBelow: 60,
  thrivingBelow: 80,
};

/**
 * Per-factor coefficients of the wellbeing target. Physiology axes are
 * normalized around 50 ((axis − 50) / 50) so a mid-range axis contributes
 * nothing; relation inputs are means in [0, 1]; per-tier arrays are indexed by
 * tier (residential tiers start at 1, so index 0 is conventionally unused;
 * lifestyle tiers follow {@link WELLBEING_LIFESTYLE_TIER_ORDER}). Negative
 * coefficients mark factors that drag the target down.
 */
export type WellbeingFactorCoefficients = {
  /** × (health − 50) / 50. */
  readonly health: number;
  /** × (energy − 50) / 50. */
  readonly energy: number;
  /** × (satiety − 50) / 50. */
  readonly satiety: number;
  /** Additive when the agent holds a job (positive). */
  readonly employed: number;
  /** Additive when the agent is jobless (negative). */
  readonly unemployed: number;
  /** Per-tier additive, indexed by residentialTier; out-of-range tiers contribute 0. */
  readonly residentialTier: readonly number[];
  /** Per-tier additive, indexed by {@link WELLBEING_LIFESTYLE_TIER_ORDER}. */
  readonly lifestyleTier: readonly number[];
  /** × accumulated upkeep arrears (negative). */
  readonly upkeepArrearsPerUnit: number;
  /** Additive while the physiological safety-net distress is active (negative). */
  readonly distress: number;
  /** × mean positive social relation score ∈ [0, 1] (positive). */
  readonly positiveRelation: number;
  /** × mean negative social relation magnitude ∈ [0, 1] (negative). */
  readonly negativeRelation: number;
};

/** Canonical lifestyle tier order indexing WellbeingFactorCoefficients.lifestyleTier. */
export const WELLBEING_LIFESTYLE_TIER_ORDER: readonly LifestyleTier[] = [
  'struggling',
  'stable',
  'comfortable',
  'affluent',
];

export type WellbeingPolicy = {
  readonly policyVersion: string;
  /** Value agents start from when no settled value exists (legacy runs). */
  readonly initialValue: number;
  /** Inclusive clamp bounds for both the target and the durable value. */
  readonly minValue: number;
  readonly maxValue: number;
  /** Neutral point every factor contribution offsets. */
  readonly baseline: number;
  /** Maximum step toward the target per hour of elapsed simulation time. */
  readonly convergencePerHour: number;
  readonly coefficients: WellbeingFactorCoefficients;
  /**
   * Optional band thresholds for the derived {@link describeWellbeingBand}
   * view; absent uses {@link DEFAULT_WELLBEING_BAND_THRESHOLDS}.
   */
  readonly bandThresholds?: WellbeingBandThresholds;
  readonly source?: string;
};

/**
 * Factor snapshot the world adapts from authoritative settlement state. All
 * values must already reflect the current tick (post physiology/safety-net
 * effects) so the settled value never reads stale inputs.
 */
export type WellbeingInputs = {
  readonly health: number;
  readonly energy: number;
  readonly satiety: number;
  readonly employed: boolean;
  readonly residentialTier: number;
  /**
   * Wealth lifestyle tier resolved with the same evaluateLifestyleTier policy
   * the read path uses. Absent when the run carries no lifestyle policy; the
   * lifestyle contribution is then 0.
   */
  readonly lifestyleTier?: LifestyleTier;
  readonly upkeepArrears: number;
  readonly distressActive: boolean;
  /** Mean of the agent's positive relation scores, ∈ [0, 1]; 0 when none. */
  readonly meanPositiveRelation: number;
  /** Mean of the agent's negative relation magnitudes, ∈ [0, 1]; 0 when none. */
  readonly meanNegativeRelation: number;
  /** Simulation milliseconds this settlement step covers. */
  readonly elapsedMs: number;
};

export type WellbeingEvaluation = {
  /** Durable value after this settlement step. */
  readonly next: number;
  /** Clamped instantaneous target for this step's inputs. */
  readonly target: number;
  /** Signed per-factor contributions to the target, for observability. */
  readonly factorContributions: Readonly<Record<string, number>>;
};

export function evaluateWellbeing(input: {
  readonly previous: number;
  readonly inputs: WellbeingInputs;
  readonly policy: WellbeingPolicy;
}): WellbeingEvaluation {
  // Composition roots validate at assembly; the decision function re-validates
  // so replays of persisted events stay guarded against malformed policies.
  assertValidWellbeingPolicy(input.policy);
  const { policy, inputs } = input;
  assertFiniteWithin(input.previous, policy.minValue, policy.maxValue, 'previous');
  assertFinite(inputs.health, 'health');
  assertFinite(inputs.energy, 'energy');
  assertFinite(inputs.satiety, 'satiety');
  assertPositiveInteger(inputs.residentialTier, 'residentialTier');
  assertNonNegativeFinite(inputs.upkeepArrears, 'upkeepArrears');
  assertFiniteWithin(inputs.meanPositiveRelation, 0, 1, 'meanPositiveRelation');
  assertFiniteWithin(inputs.meanNegativeRelation, 0, 1, 'meanNegativeRelation');
  assertNonNegativeFinite(inputs.elapsedMs, 'elapsedMs');

  const { coefficients } = policy;
  const factorContributions: Record<string, number> = {
    health: (coefficients.health * (inputs.health - 50)) / 50,
    energy: (coefficients.energy * (inputs.energy - 50)) / 50,
    satiety: (coefficients.satiety * (inputs.satiety - 50)) / 50,
    employment: inputs.employed ? coefficients.employed : coefficients.unemployed,
    residentialTier: coefficients.residentialTier[inputs.residentialTier] ?? 0,
    lifestyleTier:
      inputs.lifestyleTier === undefined
        ? 0
        : (coefficients.lifestyleTier[
            WELLBEING_LIFESTYLE_TIER_ORDER.indexOf(inputs.lifestyleTier)
          ] ?? 0),
    upkeepArrears: coefficients.upkeepArrearsPerUnit * inputs.upkeepArrears,
    distress: inputs.distressActive ? coefficients.distress : 0,
    positiveRelation: coefficients.positiveRelation * inputs.meanPositiveRelation,
    negativeRelation: coefficients.negativeRelation * inputs.meanNegativeRelation,
  };
  const target = clamp(
    policy.baseline +
      Object.values(factorContributions).reduce((total, contribution) => total + contribution, 0),
    policy.minValue,
    policy.maxValue,
  );
  // Normalize negative zero so recorded contributions survive a JSON
  // round-trip byte-for-byte (observability payload only; never read back).
  for (const [factor, contribution] of Object.entries(factorContributions)) {
    factorContributions[factor] = contribution === 0 ? 0 : contribution;
  }
  const maxStep = (policy.convergencePerHour * inputs.elapsedMs) / 3_600_000;
  const gap = target - input.previous;
  // Snap onto the target once it is reachable in one step so the value reaches
  // a fixed point and quiet agents stop emitting WellbeingChanged events.
  const next =
    Math.abs(gap) <= maxStep ? target : input.previous + Math.sign(gap) * maxStep;
  return { next, target, factorContributions };
}

/**
 * Derived band view over the durable value (mirrors how conditions.ts derives
 * severity buckets over durable physiology axes). Pure and total; the band is
 * never persisted, so threshold tweaks never invalidate event history.
 */
export function describeWellbeingBand(
  value: number,
  thresholds: WellbeingBandThresholds = DEFAULT_WELLBEING_BAND_THRESHOLDS,
): WellbeingBand {
  assertFinite(value, 'value');
  assertValidWellbeingBandThresholds(thresholds);
  if (value < thresholds.distressedBelow) {
    return 'distressed';
  }
  if (value < thresholds.lowBelow) {
    return 'low';
  }
  if (value < thresholds.contentBelow) {
    return 'steady';
  }
  if (value < thresholds.thrivingBelow) {
    return 'content';
  }
  return 'thriving';
}

/**
 * Composition-root validation for WellbeingPolicy (worker assembly fails fast);
 * evaluateWellbeing re-runs it for replay safety.
 */
export function assertValidWellbeingPolicy(policy: WellbeingPolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('wellbeing policyVersion must not be empty');
  }
  assertFinite(policy.minValue, 'minValue');
  assertFinite(policy.maxValue, 'maxValue');
  if (policy.minValue > policy.maxValue) {
    throw new Error('minValue must not exceed maxValue');
  }
  assertFiniteWithin(policy.initialValue, policy.minValue, policy.maxValue, 'initialValue');
  assertFiniteWithin(policy.baseline, policy.minValue, policy.maxValue, 'baseline');
  assertNonNegativeFinite(policy.convergencePerHour, 'convergencePerHour');
  const { coefficients } = policy;
  assertFinite(coefficients.health, 'coefficients.health');
  assertFinite(coefficients.energy, 'coefficients.energy');
  assertFinite(coefficients.satiety, 'coefficients.satiety');
  assertFinite(coefficients.employed, 'coefficients.employed');
  assertFinite(coefficients.unemployed, 'coefficients.unemployed');
  coefficients.residentialTier.forEach((value, index) =>
    assertFinite(value, `coefficients.residentialTier[${index}]`),
  );
  coefficients.lifestyleTier.forEach((value, index) =>
    assertFinite(value, `coefficients.lifestyleTier[${index}]`),
  );
  assertFinite(coefficients.upkeepArrearsPerUnit, 'coefficients.upkeepArrearsPerUnit');
  assertFinite(coefficients.distress, 'coefficients.distress');
  assertFinite(coefficients.positiveRelation, 'coefficients.positiveRelation');
  assertFinite(coefficients.negativeRelation, 'coefficients.negativeRelation');
  if (policy.bandThresholds !== undefined) {
    assertValidWellbeingBandThresholds(policy.bandThresholds);
    assertFiniteWithin(
      policy.bandThresholds.distressedBelow,
      policy.minValue,
      policy.maxValue,
      'bandThresholds.distressedBelow',
    );
    assertFiniteWithin(
      policy.bandThresholds.thrivingBelow,
      policy.minValue,
      policy.maxValue,
      'bandThresholds.thrivingBelow',
    );
  }
}

function assertValidWellbeingBandThresholds(thresholds: WellbeingBandThresholds): void {
  assertFinite(thresholds.distressedBelow, 'bandThresholds.distressedBelow');
  assertFinite(thresholds.lowBelow, 'bandThresholds.lowBelow');
  assertFinite(thresholds.contentBelow, 'bandThresholds.contentBelow');
  assertFinite(thresholds.thrivingBelow, 'bandThresholds.thrivingBelow');
  if (
    !(
      thresholds.distressedBelow < thresholds.lowBelow &&
      thresholds.lowBelow < thresholds.contentBelow &&
      thresholds.contentBelow < thresholds.thrivingBelow
    )
  ) {
    throw new Error('wellbeing bandThresholds must be strictly increasing');
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}

function assertFiniteWithin(value: number, min: number, max: number, name: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be within [${min}, ${max}]`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}
