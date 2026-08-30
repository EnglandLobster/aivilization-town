/**
 * Migration rules (town-migration-v3). CS2 (HouseholdBehaviorSystem)
 * evaluates a per-tick departure
 * probability in permille as a polynomial of average happiness:
 *   −53.35·h + 5.408·√(95.96h² + 1013h + 6576) − 298.5
 * which crosses zero around h ≈ 48 — content citizens never leave, desperate
 * ones leave fast. Here the same shape maps onto a per-hour probability
 * percent (the permille value ÷ 10), clamped to the policy cap, and the
 * decision function is linear in the settlement interval with a caller-seeded
 * roll — the stochastic-illness/illness-death convention, so per-cadence
 * replay stays equivalent. Demand-driven in-migration is intentionally a
 * separate pure decision: the society domain evaluates housing, jobs and
 * wellbeing, while the application layer owns identity, partition placement
 * and accounting.
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
  /** Optional demand-driven arrival policy, absent for legacy v1/v2 configs. */
  readonly inMigration?: InMigrationPolicy;
  readonly source?: string;
};

export type InMigrationPolicy = {
  readonly settlementCadenceMs: number;
  readonly maximumArrivalsPerCadence: number;
  readonly minimumAttractiveWellbeing: number;
  readonly housingDemandWeight: number;
  readonly jobDemandWeight: number;
};

export type InMigrationDemandDecision = {
  readonly arrivalCount: number;
  readonly housingVacancies: number;
  readonly housingPressure: number;
  readonly laborPressure: number;
  readonly wellbeingAttractiveness: number;
  readonly demandScore: number;
  readonly fractionalArrivalProbability: number;
};

/**
 * Evaluate how many residents the town attracts at one migration cadence.
 * Housing is a hard capacity boundary. Jobs and wellbeing affect demand but
 * can never create an arrival when no residence slot exists.
 */
export function evaluateInMigrationDemand(input: {
  readonly population: number;
  readonly residentialCapacity: number;
  readonly openJobSlots: number;
  readonly averageWellbeing: number;
  /** Caller-seeded roll used only for the fractional remainder. */
  readonly roll: number;
  readonly policy: InMigrationPolicy;
}): InMigrationDemandDecision {
  assertValidInMigrationPolicy(input.policy);
  assertNonNegativeInteger(input.population, 'population');
  assertNonNegativeInteger(input.residentialCapacity, 'residentialCapacity');
  assertNonNegativeInteger(input.openJobSlots, 'openJobSlots');
  if (
    !Number.isFinite(input.averageWellbeing) ||
    input.averageWellbeing < 0 ||
    input.averageWellbeing > 100
  ) {
    throw new Error('in-migration averageWellbeing must be within [0, 100]');
  }
  if (!Number.isFinite(input.roll) || input.roll < 0 || input.roll >= 1) {
    throw new Error('in-migration roll must be within [0, 1)');
  }

  const housingVacancies = Math.max(0, input.residentialCapacity - input.population);
  const housingPressure =
    input.residentialCapacity === 0 ? 0 : housingVacancies / input.residentialCapacity;
  const laborPressure = Math.min(1, input.openJobSlots / Math.max(1, input.population));
  const wellbeingRange = 100 - input.policy.minimumAttractiveWellbeing;
  const wellbeingAttractiveness = Math.max(
    0,
    Math.min(
      1,
      (input.averageWellbeing - input.policy.minimumAttractiveWellbeing) / wellbeingRange,
    ),
  );
  const demandScore =
    wellbeingAttractiveness *
    (input.policy.housingDemandWeight * housingPressure +
      input.policy.jobDemandWeight * laborPressure);
  const unconstrainedArrivals = input.policy.maximumArrivalsPerCadence * demandScore;
  const certainArrivals = Math.floor(unconstrainedArrivals);
  const fractionalArrivalProbability = unconstrainedArrivals - certainArrivals;
  const stochasticArrival = input.roll < fractionalArrivalProbability ? 1 : 0;
  const arrivalCount = Math.min(
    housingVacancies,
    input.policy.maximumArrivalsPerCadence,
    certainArrivals + stochasticArrival,
  );

  return {
    arrivalCount,
    housingVacancies,
    housingPressure,
    laborPressure,
    wellbeingAttractiveness,
    demandScore,
    fractionalArrivalProbability,
  };
}

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
  if (policy.inMigration !== undefined) {
    assertValidInMigrationPolicy(policy.inMigration);
  }
}

export function assertValidInMigrationPolicy(policy: InMigrationPolicy): void {
  if (!Number.isFinite(policy.settlementCadenceMs) || policy.settlementCadenceMs <= 0) {
    throw new Error('in-migration settlementCadenceMs must be a positive finite number');
  }
  if (!Number.isInteger(policy.maximumArrivalsPerCadence) || policy.maximumArrivalsPerCadence < 1) {
    throw new Error('in-migration maximumArrivalsPerCadence must be a positive integer');
  }
  if (
    !Number.isFinite(policy.minimumAttractiveWellbeing) ||
    policy.minimumAttractiveWellbeing < 0 ||
    policy.minimumAttractiveWellbeing >= 100
  ) {
    throw new Error('in-migration minimumAttractiveWellbeing must be within [0, 100)');
  }
  assertUnitInterval(policy.housingDemandWeight, 'housingDemandWeight');
  assertUnitInterval(policy.jobDemandWeight, 'jobDemandWeight');
  if (Math.abs(policy.housingDemandWeight + policy.jobDemandWeight - 1) > 1e-9) {
    throw new Error('in-migration demand weights must sum to 1');
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative finite`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertUnitInterval(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`in-migration ${name} must be within [0, 1]`);
  }
}
