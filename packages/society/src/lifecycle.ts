import { createSeededRandom, type AgentId } from '@aivilization/sim-core';

/**
 * Population lifecycle (town-lifecycle-v1): age stages, pre-rolled lifespan,
 * old-age and illness death, and forced retirement with a pension — the
 * minimal Cities: Skylines II citizen lifecycle set (birth, households,
 * childhood simulation, funerals, and mourning are deliberately out of scope;
 * the 'child'/'teen' stages are reserved enum slots for the future birth
 * mechanism).
 *
 * Everything here is a pure decision function: no RNG state, no wall clock,
 * no storage. The world layer settles stage transitions, retirements, deaths,
 * and the estate liquidation during time advancement and persists them as
 * events, so replays stay deterministic.
 *
 * Age semantics: every registered agent is an adult at registration, so
 * `ageMs = (nowMs − registeredAtMs) + adultThresholdMs` — age counts from the
 * adult threshold at registration. Scenario-seeded legacy agents without a
 * registration timestamp are treated as registered at simulation time 0. When
 * a future birth mechanism lands, a real bornAt fact overrides this
 * derivation (the world adapter owns that mapping).
 */

/** Lifecycle stages; 'child' and 'teen' are reserved for the future birth mechanism. */
export type LifecycleStage = 'child' | 'teen' | 'adult' | 'elderly';

export type LifecycleStageThresholdsDays = {
  readonly teen: number;
  readonly adult: number;
  readonly elderly: number;
};

export type LifecyclePolicy = {
  readonly policyVersion: string;
  /**
   * Simulation milliseconds per day for the stage/lifespan day values. Kept on
   * this policy (same default grid as town-calendar) so the lifecycle flag
   * stays self-contained when the calendar switch is off.
   */
  readonly dayLengthMs: number;
  /** Stage start ages in simulation days, strictly increasing. */
  readonly stageThresholdsDays: LifecycleStageThresholdsDays;
  /** Pre-rolled lifespan window in simulation days, min ≤ max. */
  readonly minLifespanDays: number;
  readonly maxLifespanDays: number;
  /**
   * Illness death risk exists only while health is strictly below this
   * threshold; the per-hour probability scales with the squared normalized
   * gap (CS2's `(10 − health/10)² + 8` shape: risk concentrated at low health).
   */
  readonly illnessDeathHealthThreshold: number;
  /**
   * Illness death probability percent per hour at maximum risk (health 0),
   * scaled down quadratically as health approaches the threshold.
   */
  readonly illnessDeathProbabilityPerSettlementScale: number;
  /** Hourly pension paid to retired agents from the public treasury. */
  readonly pensionPerHour: number;
  readonly source?: string;
};

/**
 * Age derivation from the registration fact: every registered agent is an
 * adult at registration, so age counts from the adult threshold forward.
 * Scenario-seeded legacy agents carry no registration timestamp; the world
 * adapter passes 0 so they count from simulation time 0 (same convention as
 * the time-settlement fallback).
 */
export function deriveAgentAgeMs(input: {
  readonly nowMs: number;
  readonly registeredAtMs: number;
  readonly policy: LifecyclePolicy;
}): number {
  assertValidLifecyclePolicy(input.policy);
  assertNonNegativeFinite(input.nowMs, 'nowMs');
  assertNonNegativeFinite(input.registeredAtMs, 'registeredAtMs');
  if (input.registeredAtMs > input.nowMs) {
    throw new Error('registeredAtMs must not exceed nowMs');
  }
  return (
    input.nowMs -
    input.registeredAtMs +
    input.policy.stageThresholdsDays.adult * input.policy.dayLengthMs
  );
}

/**
 * Pension accrued over one settlement interval: linear in elapsed time at the
 * policy's hourly rate. Strictly additive, so merged and interval-by-interval
 * settlement agree exactly (AGENTS.md §6).
 */
export function calculatePensionAccrual(input: {
  readonly elapsedMs: number;
  readonly policy: LifecyclePolicy;
}): number {
  assertValidLifecyclePolicy(input.policy);
  assertNonNegativeFinite(input.elapsedMs, 'elapsedMs');
  return (input.policy.pensionPerHour * input.elapsedMs) / 3_600_000;
}

export function deriveLifecycleStage(input: {
  readonly ageMs: number;
  readonly policy: LifecyclePolicy;
}): LifecycleStage {
  assertValidLifecyclePolicy(input.policy);
  assertNonNegativeFinite(input.ageMs, 'ageMs');
  const ageDays = input.ageMs / input.policy.dayLengthMs;
  const thresholds = input.policy.stageThresholdsDays;
  if (ageDays < thresholds.teen) {
    return 'child';
  }
  if (ageDays < thresholds.adult) {
    return 'teen';
  }
  if (ageDays < thresholds.elderly) {
    return 'adult';
  }
  return 'elderly';
}

/**
 * Deterministic pre-rolled lifespan in simulation ms, derived ONLY from the
 * agent id and stable seed material (never the command id or the clock), so
 * re-deriving it at any moment — on any partition, on replay — yields the
 * same value.
 */
export function resolveAgentLifespanMs(input: {
  readonly agentId: AgentId;
  readonly simulationSeedMaterial: string;
  readonly policy: LifecyclePolicy;
}): number {
  assertValidLifecyclePolicy(input.policy);
  const roll = createSeededRandom(
    ['agent-lifespan', input.simulationSeedMaterial, input.agentId].join(':'),
  ).nextFloat();
  const minMs = input.policy.minLifespanDays * input.policy.dayLengthMs;
  const maxMs = input.policy.maxLifespanDays * input.policy.dayLengthMs;
  return minMs + roll * (maxMs - minMs);
}

/** Old-age death fires once the agent's age reaches the pre-rolled lifespan. */
export function evaluateOldAgeDeath(input: {
  readonly ageMs: number;
  readonly lifespanMs: number;
}): boolean {
  assertNonNegativeFinite(input.ageMs, 'ageMs');
  assertNonNegativeFinite(input.lifespanMs, 'lifespanMs');
  return input.ageMs >= input.lifespanMs;
}

/**
 * Illness death probability percent for one settlement interval: zero at or
 * above the health threshold, otherwise the per-hour scale times the squared
 * normalized health gap, linear in the interval length (the stochastic-illness
 * convention) and capped at 100.
 */
export function calculateIllnessDeathProbabilityPercent(input: {
  readonly health: number;
  readonly elapsedMs: number;
  readonly policy: LifecyclePolicy;
}): number {
  assertValidLifecyclePolicy(input.policy);
  assertNonNegativeFinite(input.health, 'health');
  assertNonNegativeFinite(input.elapsedMs, 'elapsedMs');
  const threshold = input.policy.illnessDeathHealthThreshold;
  if (input.health >= threshold) {
    return 0;
  }
  const gap = (threshold - input.health) / threshold;
  return Math.min(
    100,
    input.policy.illnessDeathProbabilityPerSettlementScale *
      gap *
      gap *
      (input.elapsedMs / 3_600_000),
  );
}

/**
 * Illness death decision with the roll supplied by the caller (world seeded
 * RNG per agent and interval) — probability and state stay separate, matching
 * the applyStochasticIllnessHealthDecay pattern.
 */
export function evaluateIllnessDeath(input: {
  readonly health: number;
  readonly elapsedMs: number;
  readonly roll: number;
  readonly policy: LifecyclePolicy;
}): boolean {
  if (!Number.isFinite(input.roll) || input.roll < 0 || input.roll >= 1) {
    throw new Error('illness death roll must be within [0, 1)');
  }
  const probabilityPercent = calculateIllnessDeathProbabilityPercent({
    health: input.health,
    elapsedMs: input.elapsedMs,
    policy: input.policy,
  });
  return input.roll < probabilityPercent / 100;
}

/** Forced retirement: elderly agents still holding a job must retire. */
export function evaluateRetirement(input: {
  readonly stage: LifecycleStage;
  readonly hasJob: boolean;
}): boolean {
  return input.stage === 'elderly' && input.hasJob;
}

export function assertValidLifecyclePolicy(policy: LifecyclePolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('lifecycle policyVersion must not be empty');
  }
  if (!Number.isFinite(policy.dayLengthMs) || policy.dayLengthMs <= 0) {
    throw new Error('lifecycle dayLengthMs must be a positive finite number');
  }
  const thresholds = policy.stageThresholdsDays;
  assertPositiveFinite(thresholds.teen, 'stageThresholdsDays.teen');
  assertPositiveFinite(thresholds.adult, 'stageThresholdsDays.adult');
  assertPositiveFinite(thresholds.elderly, 'stageThresholdsDays.elderly');
  if (!(thresholds.teen < thresholds.adult && thresholds.adult < thresholds.elderly)) {
    throw new Error('lifecycle stageThresholdsDays must be strictly increasing');
  }
  assertPositiveFinite(policy.minLifespanDays, 'minLifespanDays');
  assertPositiveFinite(policy.maxLifespanDays, 'maxLifespanDays');
  if (policy.minLifespanDays > policy.maxLifespanDays) {
    throw new Error('minLifespanDays must not exceed maxLifespanDays');
  }
  assertNonNegativeFinite(policy.illnessDeathHealthThreshold, 'illnessDeathHealthThreshold');
  assertNonNegativeFinite(
    policy.illnessDeathProbabilityPerSettlementScale,
    'illnessDeathProbabilityPerSettlementScale',
  );
  assertNonNegativeFinite(policy.pensionPerHour, 'pensionPerHour');
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}
