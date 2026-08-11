import type { SeededRandom } from '@aivilization/sim-core';

export const TOWN_WEATHER_KINDS = [
  'sunny',
  'cloudy',
  'windy',
  'rainy',
  'stormy',
  'snowy',
  'foggy',
] as const;

export type TownWeatherKind = (typeof TOWN_WEATHER_KINDS)[number];

export type TownWeatherTransitionMatrix = Readonly<
  Record<TownWeatherKind, Readonly<Record<TownWeatherKind, number>>>
>;

/**
 * Versioned town-weather policy (borrowed-mechanics adoption plan #1). Weather
 * is a simulation-wide Markov chain settled inside AdvanceSimulationTime: every
 * `transitionCadenceMs` of simulation time the current state's transition row
 * is sampled with the seeded RNG and a WeatherChanged event is emitted when the
 * sampled state differs. The policy is opt-in; when it is absent no weather
 * state or events exist at all.
 */
export type TownWeatherPolicy = {
  readonly policyVersion: string;
  readonly initialWeather: TownWeatherKind;
  readonly transitionCadenceMs: number;
  readonly transitions: TownWeatherTransitionMatrix;
};

/**
 * Optional weather slice of the world projection. `since` is the simulation
 * time at which the current weather started (the transitionedAt of the last
 * WeatherChanged event, or 0 for the policy's initial weather).
 */
export type WorldWeatherState = {
  readonly current: TownWeatherKind;
  readonly since: number;
};

const WEATHER_ROW_SUM_TOLERANCE = 1e-9;

export function isTownWeatherKind(value: unknown): value is TownWeatherKind {
  return (
    typeof value === 'string' && (TOWN_WEATHER_KINDS as readonly string[]).includes(value)
  );
}

export function assertTownWeatherPolicy(policy: TownWeatherPolicy): void {
  if (!Number.isFinite(policy.transitionCadenceMs) || policy.transitionCadenceMs <= 0) {
    throw new Error(
      `town weather transitionCadenceMs must be a positive finite number, received ${policy.transitionCadenceMs}`,
    );
  }
  if (!isTownWeatherKind(policy.initialWeather)) {
    throw new Error('town weather initialWeather is not a weather kind');
  }
  for (const from of TOWN_WEATHER_KINDS) {
    const row = policy.transitions[from];
    if (row === undefined) {
      throw new Error(`town weather transition matrix is missing the ${from} row`);
    }
    let rowSum = 0;
    for (const to of TOWN_WEATHER_KINDS) {
      const probability = row[to];
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new Error(
          `town weather transition ${from} -> ${to} must be a probability between 0 and 1, received ${probability}`,
        );
      }
      rowSum += probability;
    }
    if (Math.abs(rowSum - 1) > WEATHER_ROW_SUM_TOLERANCE) {
      throw new Error(
        `town weather transition row ${from} must sum to 1, received ${rowSum}`,
      );
    }
  }
}

/**
 * A transition is evaluated when advancing the simulation clock crosses a
 * cadence boundary counted from simulation time zero. Scheduling on the clock
 * grid (instead of on the last change) keeps the evaluation cadence exact even
 * when the sampled weather stays the same, and keeps replay deterministic
 * because the grid depends only on the policy and the clock.
 */
export function isTownWeatherTransitionDue(input: {
  readonly transitionCadenceMs: number;
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
}): boolean {
  return (
    Math.floor(input.previousSimulationTime / input.transitionCadenceMs) !==
    Math.floor(input.nextSimulationTime / input.transitionCadenceMs)
  );
}

/**
 * Sample the next weather from the current state's transition row by walking
 * the cumulative probabilities in canonical kind order. One RNG draw per
 * evaluation keeps the seeded sequence easy to reason about.
 */
export function sampleTownWeatherTransition(input: {
  readonly policy: TownWeatherPolicy;
  readonly current: TownWeatherKind;
  readonly rng: SeededRandom;
}): TownWeatherKind {
  const draw = input.rng.nextFloat();
  const row = input.policy.transitions[input.current];
  let cumulative = 0;
  for (const kind of TOWN_WEATHER_KINDS) {
    cumulative += row[kind];
    if (draw < cumulative) {
      return kind;
    }
  }
  // Floating-point rounding can leave the draw above the final cumulative sum;
  // fall back to the last kind so the sample is always a valid state.
  const fallback = TOWN_WEATHER_KINDS[TOWN_WEATHER_KINDS.length - 1];
  if (fallback === undefined) {
    throw new Error('town weather kinds must not be empty');
  }
  return fallback;
}
