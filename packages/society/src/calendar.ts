import type { PassivePhysiologicalDecayPolicy } from './physiology';

/**
 * Town calendar: an authoritative day/night phase clock plus the passive
 * physiological decay rates tied to it, inspired by the Cities: Skylines II
 * daily cycle (its citizen sleep window spans day fractions 0.875 → 0.175).
 * The phase of any simulation instant is a pure function of the clock and the
 * policy table — no RNG, no stored state — so every partition and every replay
 * derives the identical phase timeline from the same policy. The world settles
 * phase transitions as TownDayPhaseChanged events and applies the passive
 * decay per settlement interval during time advancement.
 *
 * Boundary semantics (exact, replay-critical):
 * - Day 0 starts at simulation time 0; `dayIndex = floor(atMs / dayLengthMs)`.
 * - Each phase start fraction maps onto an integer millisecond offset inside
 *   the day via round(startFraction × dayLengthMs) — the phase grid is integer
 *   milliseconds, so boundaries never carry floating-point drift (the default
 *   fractions land on exact integers).
 * - `dayFraction = (atMs mod dayLengthMs) / dayLengthMs` is in [0, 1) and is
 *   informational only; phase resolution compares against the integer offsets.
 * - An instant exactly on a phase start belongs to the STARTING phase (the
 *   entry with the greatest offset ≤ atMs-within-day wins); an instant exactly
 *   on a day boundary has dayFraction 0 of the NEW day.
 * - `listTownDayPhaseStarts` enumerates phase starts in the half-open window
 *   (fromMs, toMs]: a start exactly at fromMs is already in effect and is not
 *   re-emitted; a start exactly at toMs is reached by the advance and is
 *   emitted.
 */

/** One ordered phase-table entry; `startFraction` marks when the phase begins. */
export type TownCalendarPhaseEntry = {
  readonly phase: string;
  readonly startFraction: number;
};

export type TownCalendarPolicy = {
  readonly policyVersion: string;
  /** Simulation milliseconds in one full day. */
  readonly dayLengthMs: number;
  /**
   * Ordered phase table covering [0, 1): the first entry must start at
   * fraction 0 and startFractions must be strictly increasing. Phase names may
   * repeat (e.g. a night phase spanning midnight); a boundary whose two sides
   * share the same name produces no transition event.
   */
  readonly phases: readonly TownCalendarPhaseEntry[];
  readonly physiologicalDecay: PassivePhysiologicalDecayPolicy;
  readonly source?: string;
};

export type TownDayPhaseResolution = {
  /** Number of the day containing `atMs`; day 0 starts at simulation time 0. */
  readonly dayIndex: number;
  /** Name of the phase in effect at `atMs`. */
  readonly phase: string;
  /** Simulation instant the current phase started (≤ atMs). */
  readonly phaseStartedAtMs: number;
  /** Simulation instant the current phase ends (> atMs) and the next begins. */
  readonly phaseEndsAtMs: number;
  /** Position inside the day, in [0, 1). */
  readonly dayFraction: number;
};

export type TownDayPhaseStart = {
  /** Simulation instant the phase starts; inside the queried window. */
  readonly atMs: number;
  readonly dayIndex: number;
  readonly phase: string;
  readonly phaseEndsAtMs: number;
};

export function resolveTownDayPhase(input: {
  readonly atMs: number;
  readonly policy: TownCalendarPolicy;
}): TownDayPhaseResolution {
  // Composition roots validate at assembly; the decision function re-validates
  // so replays of persisted events stay guarded against malformed policies.
  assertValidTownCalendarPolicy(input.policy);
  assertNonNegativeFinite(input.atMs, 'atMs');

  const dayIndex = Math.floor(input.atMs / input.policy.dayLengthMs);
  const dayStartedAtMs = dayIndex * input.policy.dayLengthMs;
  const atMsWithinDay = input.atMs - dayStartedAtMs;
  const dayFraction = atMsWithinDay / input.policy.dayLengthMs;
  const phaseIndex = resolvePhaseIndex(input.policy, atMsWithinDay);
  const phaseEntry = input.policy.phases[phaseIndex] as TownCalendarPhaseEntry;
  return {
    dayIndex,
    phase: phaseEntry.phase,
    phaseStartedAtMs: dayStartedAtMs + phaseOffsetMs(phaseEntry, input.policy.dayLengthMs),
    phaseEndsAtMs: resolvePhaseEndsAtMs(input.policy, dayStartedAtMs, phaseIndex),
    dayFraction,
  };
}

/**
 * Enumerate every phase start inside (fromMs, toMs], in chronological order.
 * Each entry carries the resolution of the phase it starts; callers emit a
 * transition event when the phase name actually changes (adjacent entries can
 * share a name, e.g. a night phase spanning midnight).
 */
export function listTownDayPhaseStarts(input: {
  readonly fromMs: number;
  readonly toMs: number;
  readonly policy: TownCalendarPolicy;
}): readonly TownDayPhaseStart[] {
  assertValidTownCalendarPolicy(input.policy);
  assertNonNegativeFinite(input.fromMs, 'fromMs');
  assertNonNegativeFinite(input.toMs, 'toMs');
  if (input.toMs < input.fromMs) {
    throw new Error('toMs must be greater than or equal to fromMs');
  }
  const { dayLengthMs, phases } = input.policy;
  const starts: TownDayPhaseStart[] = [];
  const firstDay = Math.floor(input.fromMs / dayLengthMs);
  const lastDay = Math.floor(input.toMs / dayLengthMs);
  for (let dayIndex = firstDay; dayIndex <= lastDay; dayIndex += 1) {
    const dayStartedAtMs = dayIndex * dayLengthMs;
    for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
      const entry = phases[phaseIndex] as TownCalendarPhaseEntry;
      const atMs = dayStartedAtMs + phaseOffsetMs(entry, dayLengthMs);
      if (atMs <= input.fromMs || atMs > input.toMs) {
        continue;
      }
      starts.push({
        atMs,
        dayIndex,
        phase: entry.phase,
        phaseEndsAtMs: resolvePhaseEndsAtMs(input.policy, dayStartedAtMs, phaseIndex),
      });
    }
  }
  return starts;
}

export function assertValidTownCalendarPolicy(policy: TownCalendarPolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('town calendar policyVersion must not be empty');
  }
  if (!Number.isFinite(policy.dayLengthMs) || policy.dayLengthMs <= 0) {
    throw new Error('town calendar dayLengthMs must be a positive finite number');
  }
  if (policy.phases.length === 0) {
    throw new Error('town calendar phases must not be empty');
  }
  let previousStartFraction = -1;
  policy.phases.forEach((entry, index) => {
    if (entry.phase.trim().length === 0) {
      throw new Error(`town calendar phases[${index}] phase must not be empty`);
    }
    if (
      !Number.isFinite(entry.startFraction) ||
      entry.startFraction < 0 ||
      entry.startFraction >= 1
    ) {
      throw new Error(`town calendar phases[${index}] startFraction must be within [0, 1)`);
    }
    if (entry.startFraction <= previousStartFraction) {
      throw new Error('town calendar phases startFraction must be strictly increasing');
    }
    previousStartFraction = entry.startFraction;
  });
  const first = policy.phases[0] as TownCalendarPhaseEntry;
  if (first.startFraction !== 0) {
    throw new Error('town calendar phases must start at fraction 0 to cover [0, 1)');
  }
  // The phase grid is integer milliseconds; fractions that round onto the same
  // millisecond (or onto the day end) would create a zero-length phase.
  let previousOffsetMs = -1;
  for (const entry of policy.phases) {
    const offsetMs = phaseOffsetMs(entry, policy.dayLengthMs);
    if (offsetMs <= previousOffsetMs || offsetMs >= policy.dayLengthMs) {
      throw new Error(
        'town calendar phases must round onto strictly increasing millisecond offsets within the day',
      );
    }
    previousOffsetMs = offsetMs;
  }
  assertNonNegativeFinite(
    policy.physiologicalDecay.energyPerHour,
    'physiologicalDecay.energyPerHour',
  );
  assertNonNegativeFinite(
    policy.physiologicalDecay.satietyPerHour,
    'physiologicalDecay.satietyPerHour',
  );
}

function resolvePhaseIndex(policy: TownCalendarPolicy, atMsWithinDay: number): number {
  let phaseIndex = 0;
  for (let index = 1; index < policy.phases.length; index += 1) {
    const entry = policy.phases[index] as TownCalendarPhaseEntry;
    if (phaseOffsetMs(entry, policy.dayLengthMs) > atMsWithinDay) {
      break;
    }
    phaseIndex = index;
  }
  return phaseIndex;
}

function resolvePhaseEndsAtMs(
  policy: TownCalendarPolicy,
  dayStartedAtMs: number,
  phaseIndex: number,
): number {
  const next = policy.phases[phaseIndex + 1];
  return next === undefined
    ? dayStartedAtMs + policy.dayLengthMs
    : dayStartedAtMs + phaseOffsetMs(next, policy.dayLengthMs);
}

/** Phase start as an integer millisecond offset inside the day. */
function phaseOffsetMs(entry: TownCalendarPhaseEntry, dayLengthMs: number): number {
  return Math.round(entry.startFraction * dayLengthMs);
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}
