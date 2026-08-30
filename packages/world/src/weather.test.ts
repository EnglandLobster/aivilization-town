import { asAgentId, createCommandEnvelope, createSeededRandom } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  assertTownWeatherPolicy,
  createWorldProjection,
  dispatchWorldCommand,
  isTownWeatherKind,
  isTownWeatherTransitionDue,
  listTownWeatherTransitionBoundaries,
  sampleTownWeatherTransition,
  TOWN_WEATHER_KINDS,
  type TownWeatherKind,
  type TownWeatherPolicy,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from './index';

const basePolicies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
};

function row(overrides: Partial<Record<TownWeatherKind, number>>): Record<TownWeatherKind, number> {
  const result = {} as Record<TownWeatherKind, number>;
  for (const kind of TOWN_WEATHER_KINDS) {
    result[kind] = overrides[kind] ?? 0;
  }
  return result;
}

function createPolicy(input: {
  readonly transitionCadenceMs?: number;
  readonly initialWeather?: TownWeatherKind;
  readonly rows: Readonly<Record<TownWeatherKind, Record<TownWeatherKind, number>>>;
}): TownWeatherPolicy {
  return {
    policyVersion: 'town-weather-v2',
    initialWeather: input.initialWeather ?? 'sunny',
    transitionCadenceMs: input.transitionCadenceMs ?? 1_000,
    transitions: input.rows,
  };
}

/** Every state transitions somewhere with real uncertainty (50/50 splits). */
const volatilePolicy = createPolicy({
  rows: {
    sunny: row({ sunny: 0.5, cloudy: 0.5 }),
    cloudy: row({ cloudy: 0.5, windy: 0.5 }),
    windy: row({ windy: 0.5, rainy: 0.5 }),
    rainy: row({ rainy: 0.5, sunny: 0.5 }),
    stormy: row({ stormy: 0.5, snowy: 0.5 }),
    snowy: row({ snowy: 0.5, foggy: 0.5 }),
    foggy: row({ foggy: 0.5, sunny: 0.5 }),
  },
});

/** sunny always clears to cloudy; every other state persists. */
const alwaysClearingPolicy = createPolicy({
  rows: {
    sunny: row({ cloudy: 1 }),
    cloudy: row({ cloudy: 1 }),
    windy: row({ windy: 1 }),
    rainy: row({ rainy: 1 }),
    stormy: row({ stormy: 1 }),
    snowy: row({ snowy: 1 }),
    foggy: row({ foggy: 1 }),
  },
});

/** Every state persists forever: valid matrix, never emits an event. */
const persistentPolicy = createPolicy({
  rows: {
    sunny: row({ sunny: 1 }),
    cloudy: row({ cloudy: 1 }),
    windy: row({ windy: 1 }),
    rainy: row({ rainy: 1 }),
    stormy: row({ stormy: 1 }),
    snowy: row({ snowy: 1 }),
    foggy: row({ foggy: 1 }),
  },
});

const cyclingPolicy = createPolicy({
  rows: {
    sunny: row({ cloudy: 1 }),
    cloudy: row({ windy: 1 }),
    windy: row({ rainy: 1 }),
    rainy: row({ sunny: 1 }),
    stormy: row({ snowy: 1 }),
    snowy: row({ foggy: 1 }),
    foggy: row({ stormy: 1 }),
  },
});

function createProjection(): WorldProjection {
  return createWorldProjection({
    agents: [
      {
        agentId: asAgentId('agent-1'),
        locationId: null,
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 0,
        balance: 0,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
    clock: { now: 0, tickDurationMs: 1_000 },
  });
}

function advance(input: {
  readonly projection: WorldProjection;
  readonly tickIndex: number;
  readonly deltaMs?: number;
  readonly policies: WorldCommandPolicies;
  readonly nextSequence: number;
}): readonly WorldEvent[] {
  return dispatchWorldCommand({
    command: createCommandEnvelope({
      id: `command-weather-${input.tickIndex}`,
      simulationId: 'sim-1',
      source: 'system',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs: input.deltaMs ?? 1_000 },
      issuedAt: input.tickIndex,
    }),
    projection: input.projection,
    policies: input.policies,
    nextSequence: input.nextSequence,
  });
}

function runWeatherSequence(input: {
  readonly randomSeed?: string;
  readonly ticks: number;
  readonly policy: TownWeatherPolicy;
}): { readonly events: readonly WorldEvent[]; readonly projection: WorldProjection } {
  const policies: WorldCommandPolicies = {
    ...basePolicies,
    ...(input.randomSeed === undefined ? {} : { randomSeed: input.randomSeed }),
    weather: input.policy,
  };
  let projection = createProjection();
  const events: WorldEvent[] = [];
  for (let tick = 0; tick < input.ticks; tick += 1) {
    const tickEvents = advance({
      projection,
      tickIndex: tick,
      policies,
      nextSequence: events.length + 1,
    });
    events.push(...tickEvents);
    projection = tickEvents.reduce(applyWorldEvent, projection);
  }
  return { events, projection };
}

describe('town weather policy validation', () => {
  test('accepts the canonical volatile test policy and identifies weather kinds', () => {
    expect(() => assertTownWeatherPolicy(volatilePolicy)).not.toThrow();
    expect(isTownWeatherKind('stormy')).toBe(true);
    expect(isTownWeatherKind('hailing')).toBe(false);
    expect(isTownWeatherKind(42)).toBe(false);
  });

  test('enumerates every crossed cadence boundary with half-open start semantics', () => {
    expect(
      listTownWeatherTransitionBoundaries({
        transitionCadenceMs: 1_000,
        previousSimulationTime: 400,
        nextSimulationTime: 3_000,
      }),
    ).toEqual([1_000, 2_000, 3_000]);
  });

  test('rejects a matrix whose row does not sum to 1', () => {
    const invalid = createPolicy({
      rows: { ...volatilePolicy.transitions, sunny: row({ sunny: 0.9 }) },
    });
    expect(() => assertTownWeatherPolicy(invalid)).toThrow(/row sunny must sum to 1/);
  });

  test('rejects out-of-range probabilities and incomplete matrices', () => {
    const negative = createPolicy({
      rows: { ...volatilePolicy.transitions, sunny: row({ sunny: 1.5, cloudy: -0.5 }) },
    });
    expect(() => assertTownWeatherPolicy(negative)).toThrow(/sunny -> sunny/);
    const missing = createPolicy({
      rows: {
        sunny: row({ sunny: 1 }),
        cloudy: row({ cloudy: 1 }),
        windy: row({ windy: 1 }),
        rainy: row({ rainy: 1 }),
        stormy: row({ stormy: 1 }),
        snowy: row({ snowy: 1 }),
        // foggy row intentionally missing.
      } as unknown as TownWeatherPolicy['transitions'],
    });
    expect(() => assertTownWeatherPolicy(missing)).toThrow(/missing the foggy row/);
  });

  test('rejects an invalid cadence and initial weather', () => {
    expect(() => assertTownWeatherPolicy({ ...volatilePolicy, transitionCadenceMs: 0 })).toThrow(
      /transitionCadenceMs/,
    );
    expect(() =>
      assertTownWeatherPolicy({
        ...volatilePolicy,
        initialWeather: 'hailing' as TownWeatherKind,
      }),
    ).toThrow(/initialWeather/);
  });
});

describe('town weather sampling and cadence', () => {
  test('samples transition rows by cumulative probability in canonical order', () => {
    const policy = createPolicy({
      rows: {
        sunny: row({ sunny: 0.5, cloudy: 0.25, foggy: 0.25 }),
        cloudy: row({ cloudy: 1 }),
        windy: row({ windy: 1 }),
        rainy: row({ rainy: 1 }),
        stormy: row({ stormy: 1 }),
        snowy: row({ snowy: 1 }),
        foggy: row({ foggy: 1 }),
      },
    });
    const sample = (draw: number) =>
      sampleTownWeatherTransition({
        policy,
        current: 'sunny',
        rng: { seed: 'test', nextFloat: () => draw },
      });
    expect(sample(0)).toBe('sunny');
    expect(sample(0.49)).toBe('sunny');
    expect(sample(0.5)).toBe('cloudy');
    expect(sample(0.74)).toBe('cloudy');
    expect(sample(0.75)).toBe('foggy');
    expect(sample(0.999)).toBe('foggy');
  });

  test('evaluates transitions only when the clock crosses a cadence boundary', () => {
    const due = (previousSimulationTime: number, nextSimulationTime: number) =>
      isTownWeatherTransitionDue({
        transitionCadenceMs: 1_000,
        previousSimulationTime,
        nextSimulationTime,
      });
    expect(due(0, 400)).toBe(false);
    expect(due(400, 800)).toBe(false);
    expect(due(800, 1_200)).toBe(true);
    expect(due(0, 5_000)).toBe(true);
    expect(due(1_000, 2_000)).toBe(true);
    expect(due(1_001, 1_999)).toBe(false);
  });

  test('uses the seeded RNG for the sample draw', () => {
    const rng = createSeededRandom('seed-1');
    const replay = createSeededRandom('seed-1');
    expect(sampleTownWeatherTransition({ policy: volatilePolicy, current: 'sunny', rng })).toBe(
      sampleTownWeatherTransition({ policy: volatilePolicy, current: 'sunny', rng: replay }),
    );
  });
});

describe('town weather settlement in AdvanceSimulationTime', () => {
  test('emits no weather events or state when the weather policy is absent', () => {
    // Baseline without the policy: only SimulationTimeAdvanced, never weather.
    let legacyProjection = createProjection();
    const legacyEvents: WorldEvent[] = [];
    for (let tick = 0; tick < 8; tick += 1) {
      const tickEvents = advance({
        projection: legacyProjection,
        tickIndex: tick,
        policies: basePolicies,
        nextSequence: legacyEvents.length + 1,
      });
      legacyEvents.push(...tickEvents);
      legacyProjection = tickEvents.reduce(applyWorldEvent, legacyProjection);
    }
    expect(legacyEvents.every((event) => event.type === 'SimulationTimeAdvanced')).toBe(true);
    expect(legacyProjection.weather).toBeUndefined();
    expect('weather' in legacyProjection).toBe(false);
  });

  test('settles a deterministic WeatherChanged event when the cadence boundary is crossed', () => {
    const policies: WorldCommandPolicies = { ...basePolicies, weather: alwaysClearingPolicy };
    const events = advance({
      projection: createProjection(),
      tickIndex: 0,
      policies,
      nextSequence: 1,
    });
    expect(events.map((event) => event.type)).toEqual(['SimulationTimeAdvanced', 'WeatherChanged']);
    expect(events[1]).toMatchObject({
      id: 'command-weather-0:event:1',
      type: 'WeatherChanged',
      payload: {
        policyVersion: 'town-weather-v2',
        from: 'sunny',
        to: 'cloudy',
        transitionedAt: 1_000,
      },
      sequence: 2,
    });
    const updated = events.reduce(applyWorldEvent, createProjection());
    expect(updated.weather).toEqual({ current: 'cloudy', since: 1_000 });
  });

  test('keeps weather silent until the cadence boundary is crossed', () => {
    const policies: WorldCommandPolicies = { ...basePolicies, weather: alwaysClearingPolicy };
    let projection = createProjection();
    const seen: string[][] = [];
    let sequence = 1;
    for (let tick = 0; tick < 3; tick += 1) {
      const events = advance({
        projection,
        tickIndex: tick,
        deltaMs: 400,
        policies,
        nextSequence: sequence,
      });
      seen.push(events.map((event) => event.type));
      sequence += events.length;
      projection = events.reduce(applyWorldEvent, projection);
    }
    expect(seen).toEqual([
      ['SimulationTimeAdvanced'],
      ['SimulationTimeAdvanced'],
      ['SimulationTimeAdvanced', 'WeatherChanged'],
    ]);
    expect(projection.weather).toEqual({ current: 'cloudy', since: 1_000 });
  });

  test('settles every crossed weather cadence in a merged advance', () => {
    const events = advance({
      projection: createProjection(),
      tickIndex: 0,
      deltaMs: 3_000,
      policies: { ...basePolicies, weather: cyclingPolicy },
      nextSequence: 1,
    });
    expect(
      events.filter((event) => event.type === 'WeatherChanged').map((event) => event.payload),
    ).toEqual([
      { policyVersion: 'town-weather-v2', from: 'sunny', to: 'cloudy', transitionedAt: 1_000 },
      { policyVersion: 'town-weather-v2', from: 'cloudy', to: 'windy', transitionedAt: 2_000 },
      { policyVersion: 'town-weather-v2', from: 'windy', to: 'rainy', transitionedAt: 3_000 },
    ]);
  });

  test('preserves the v1 one-draw-per-command compatibility branch', () => {
    const events = advance({
      projection: createProjection(),
      tickIndex: 0,
      deltaMs: 3_000,
      policies: {
        ...basePolicies,
        weather: { ...cyclingPolicy, policyVersion: 'town-weather-v1' },
      },
      nextSequence: 1,
    });
    expect(
      events.filter((event) => event.type === 'WeatherChanged').map((event) => event.payload),
    ).toEqual([
      { policyVersion: 'town-weather-v1', from: 'sunny', to: 'cloudy', transitionedAt: 3_000 },
    ]);
  });

  test('produces the same boundary weather trajectory for merged and stepped advances', () => {
    const payloads = (events: readonly WorldEvent[]) =>
      events
        .filter((event) => event.type === 'WeatherChanged')
        .map((event) => ({ ...event.payload }));
    for (let seedIndex = 0; seedIndex < 12; seedIndex += 1) {
      const randomSeed = `weather-cadence-seed-${seedIndex}`;
      const stepped = runWeatherSequence({ randomSeed, ticks: 12, policy: volatilePolicy });
      const mergedEvents = advance({
        projection: createProjection(),
        tickIndex: 0,
        deltaMs: 12_000,
        policies: { ...basePolicies, randomSeed, weather: volatilePolicy },
        nextSequence: 1,
      });
      expect(payloads(mergedEvents)).toEqual(payloads(stepped.events));
    }
  });

  test('emits nothing while the sampled weather persists', () => {
    const { events, projection } = runWeatherSequence({ ticks: 4, policy: persistentPolicy });
    expect(events.every((event) => event.type === 'SimulationTimeAdvanced')).toBe(true);
    expect(projection.weather).toBeUndefined();
  });

  test('produces an identical weather sequence for the same seed and a different one for another seed', () => {
    const weatherPayloads = (events: readonly WorldEvent[]) =>
      events
        .filter((event) => event.type === 'WeatherChanged')
        .map((event) => event.payload as unknown as { from: string; to: string });
    const first = runWeatherSequence({ randomSeed: 'seed-a', ticks: 48, policy: volatilePolicy });
    const replay = runWeatherSequence({ randomSeed: 'seed-a', ticks: 48, policy: volatilePolicy });
    const other = runWeatherSequence({ randomSeed: 'seed-b', ticks: 48, policy: volatilePolicy });

    expect(replay.events).toEqual(first.events);
    expect(replay.projection).toEqual(first.projection);
    expect(weatherPayloads(first.events).length).toBeGreaterThan(0);
    expect(weatherPayloads(other.events)).not.toEqual(weatherPayloads(first.events));
  });

  test('round-trips weather state through snapshot serialization and replay', () => {
    const { events, projection } = runWeatherSequence({
      randomSeed: 'seed-snapshot',
      ticks: 12,
      policy: volatilePolicy,
    });
    expect(projection.weather).toBeDefined();

    // Snapshot round-trip: the serialized projection hydrates identically.
    const hydrated = JSON.parse(JSON.stringify(projection)) as WorldProjection;
    expect(hydrated).toEqual(projection);
    expect(hydrated.weather).toEqual(projection.weather);

    // Replay from scratch: applying the full event stream to a fresh
    // projection reproduces the incremental projection exactly.
    const replayed = events.reduce(applyWorldEvent, createProjection());
    expect(replayed).toEqual(projection);
  });

  test('throws on an invalid weather policy instead of settling silently', () => {
    const invalid = createPolicy({
      rows: { ...volatilePolicy.transitions, sunny: row({ sunny: 0.9 }) },
    });
    expect(() =>
      advance({
        projection: createProjection(),
        tickIndex: 0,
        policies: { ...basePolicies, weather: invalid },
        nextSequence: 1,
      }),
    ).toThrow(/row sunny must sum to 1/);
  });
});
