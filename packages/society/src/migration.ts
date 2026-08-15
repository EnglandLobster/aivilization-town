/**
 * Out-migration rules (town-migration-v1): the happiness-driven departure
 * minimal set. CS2 (HouseholdBehaviorSystem) evaluates a per-tick departure
 * probability in permille as a polynomial of average happiness:
 *   −53.35·h + 5.408·√(95.96h² + 1013h + 6576) − 298.5
 * which crosses zero around h ≈ 48 — content citizens never leave, desperate
 * ones leave fast. Here the same shape maps onto a per-hour probability
 * percent (the permille value ÷ 10), clamped to the policy cap, and the
 * decision function is linear in the settlement interval with a caller-seeded
 * roll — the stochastic-illness/illness-death convention, so per-cadence
 * replay stays equivalent. In-migration (demand-driven entry) is a future
 * extension and will bump the policy version.
 */

export type OutMigrationPolicy = {
  readonly policyVersion: string;
  /**
   * Cap on the per-hour departure probability percent. The CS2 shape peaks
   * around 14%/h at wellbeing 0; the cap keeps small-town populations from
   * evaporating while preserving the shape's steep low-happiness gradient.
   */
  readonly maxProbabilityPerHour: number;
  /**
   * Wellbeing assumed for agents without a settled scalar. Default 50 (the
   * neutral point where the polynomial reads zero): runs without the
   * town-wellbeing flag stay migration-free, making the interlock explicit.
   */
  readonly fallbackWellbeing: number;
  /**
   * Maximum settlement interval length for the probabilistic departure roll:
   * advances spanning multiple cadences replay boundary by boundary.
   */
  readonly settlementCadenceMs: number;
  readonly source?: string;
};

export function evaluateOutMigrationProbabilityPercent(input: {
  readonly wellbeing: number;
  readonly elapsedMs: number;
  readonly policy: OutMigrationPolicy;
}): number {
  assertValidOutMigrationPolicy(input.policy);
  if (!Number.isFinite(input.wellbeing)) {
    throw new Error('out-migration requires a finite wellbeing value');
  }
  assertNonNegativeFinite(input.elapsedMs, 'elapsedMs');
  // CS2 permille-per-tick shape, read as percent-per-hour (÷10), floored at
  // zero: at or above the ~48 zero-crossing content citizens never leave.
  const permille =
    -53.35 * input.wellbeing +
    5.408 * Math.sqrt(95.96 * input.wellbeing ** 2 + 1013 * input.wellbeing + 6576) -
    298.5;
  const perHour = Math.max(0, Math.min(input.policy.maxProbabilityPerHour, permille / 10));
  return Math.min(100, (perHour * input.elapsedMs) / 3_600_000);
}

/** Departure decision with the roll supplied by the caller (world seeded RNG). */
export function evaluateOutMigrationDecision(input: {
  readonly wellbeing: number;
  readonly elapsedMs: number;
  readonly roll: number;
  readonly policy: OutMigrationPolicy;
}): boolean {
  if (!Number.isFinite(input.roll) || input.roll < 0 || input.roll >= 1) {
    throw new Error('out-migration roll must be within [0, 1)');
  }
  const probabilityPercent = evaluateOutMigrationProbabilityPercent({
    wellbeing: input.wellbeing,
    elapsedMs: input.elapsedMs,
    policy: input.policy,
  });
  return input.roll < probabilityPercent / 100;
}

export function assertValidOutMigrationPolicy(policy: OutMigrationPolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('out-migration policyVersion must not be empty');
  }
  if (
    !Number.isFinite(policy.maxProbabilityPerHour) ||
    policy.maxProbabilityPerHour <= 0 ||
    policy.maxProbabilityPerHour > 100
  ) {
    throw new Error('out-migration maxProbabilityPerHour must be within (0, 100]');
  }
  if (
    !Number.isFinite(policy.fallbackWellbeing) ||
    policy.fallbackWellbeing < 0 ||
    policy.fallbackWellbeing > 100
  ) {
    throw new Error('out-migration fallbackWellbeing must be within [0, 100]');
  }
  if (!Number.isFinite(policy.settlementCadenceMs) || policy.settlementCadenceMs <= 0) {
    throw new Error('out-migration settlementCadenceMs must be a positive finite number');
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative finite`);
  }
}
