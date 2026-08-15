import { describe, expect, it } from 'vitest';

import {
  assertValidTownCalendarPolicy,
  listTownDayPhaseStarts,
  resolveTownDayPhase,
  type TownCalendarPolicy,
} from './index';

const DAY_MS = 86_400_000;

const policy: TownCalendarPolicy = {
  policyVersion: 'town-calendar-v1',
  dayLengthMs: DAY_MS,
  phases: [
    { phase: 'night', startFraction: 0 },
    { phase: 'dawn', startFraction: 0.175 },
    { phase: 'day', startFraction: 0.3 },
    { phase: 'dusk', startFraction: 0.8 },
    { phase: 'evening', startFraction: 0.875 },
  ],
  physiologicalDecay: { energyPerHour: 6.25, satietyPerHour: 12.5 },
};

describe('resolveTownDayPhase', () => {
  it('resolves simulation time zero to the first phase of day 0', () => {
    expect(resolveTownDayPhase({ atMs: 0, policy })).toEqual({
      dayIndex: 0,
      phase: 'night',
      phaseStartedAtMs: 0,
      phaseEndsAtMs: 15_120_000,
      dayFraction: 0,
    });
  });

  it('assigns an instant exactly on a phase start to the starting phase', () => {
    const at = 25_920_000;
    const resolved = resolveTownDayPhase({ atMs: at, policy });
    expect(resolved.phase).toBe('day');
    expect(resolved.phaseStartedAtMs).toBe(at);
    expect(resolved.phaseEndsAtMs).toBe(69_120_000);
    // One millisecond earlier still belongs to dawn.
    expect(resolveTownDayPhase({ atMs: at - 1, policy }).phase).toBe('dawn');
  });

  it('assigns an instant exactly on a day boundary to the new day', () => {
    const resolved = resolveTownDayPhase({ atMs: 2 * DAY_MS, policy });
    expect(resolved.dayIndex).toBe(2);
    expect(resolved.dayFraction).toBe(0);
    expect(resolved.phase).toBe('night');
    expect(resolved.phaseStartedAtMs).toBe(2 * DAY_MS);
    expect(resolved.phaseEndsAtMs).toBe(2 * DAY_MS + 15_120_000);
    // One millisecond earlier is the last phase of the previous day.
    const before = resolveTownDayPhase({ atMs: 2 * DAY_MS - 1, policy });
    expect(before.dayIndex).toBe(1);
    expect(before.phase).toBe('evening');
    expect(before.phaseEndsAtMs).toBe(2 * DAY_MS);
  });

  it('ends the last phase at the next day boundary', () => {
    const resolved = resolveTownDayPhase({ atMs: 77_760_000, policy });
    expect(resolved.phase).toBe('evening');
    expect(resolved.phaseStartedAtMs).toBe(75_600_000);
    expect(resolved.phaseEndsAtMs).toBe(DAY_MS);
  });

  it('is deterministic for identical inputs', () => {
    const first = resolveTownDayPhase({ atMs: 123_456_789, policy });
    const second = resolveTownDayPhase({ atMs: 123_456_789, policy });
    expect(first).toEqual(second);
  });

  it('rejects negative or non-finite instants', () => {
    expect(() => resolveTownDayPhase({ atMs: -1, policy })).toThrow(
      'atMs must be non-negative',
    );
    expect(() => resolveTownDayPhase({ atMs: Number.NaN, policy })).toThrow(
      'atMs must be non-negative',
    );
  });
});

describe('listTownDayPhaseStarts', () => {
  it('enumerates every phase start of a full day in order', () => {
    const starts = listTownDayPhaseStarts({ fromMs: 0, toMs: DAY_MS, policy });
    expect(starts).toEqual([
      { atMs: 15_120_000, dayIndex: 0, phase: 'dawn', phaseEndsAtMs: 25_920_000 },
      { atMs: 25_920_000, dayIndex: 0, phase: 'day', phaseEndsAtMs: 69_120_000 },
      { atMs: 69_120_000, dayIndex: 0, phase: 'dusk', phaseEndsAtMs: 75_600_000 },
      { atMs: 75_600_000, dayIndex: 0, phase: 'evening', phaseEndsAtMs: DAY_MS },
      { atMs: DAY_MS, dayIndex: 1, phase: 'night', phaseEndsAtMs: DAY_MS + 15_120_000 },
    ]);
  });

  it('uses a half-open window: a start at fromMs is not re-emitted, one at toMs is', () => {
    const at = 25_920_000;
    expect(
      listTownDayPhaseStarts({ fromMs: at, toMs: at + 1, policy }).map((start) => start.phase),
    ).toEqual([]);
    expect(
      listTownDayPhaseStarts({ fromMs: at - 1, toMs: at, policy }).map((start) => start.phase),
    ).toEqual(['day']);
  });

  it('returns an empty list when no boundary is crossed', () => {
    expect(listTownDayPhaseStarts({ fromMs: 1000, toMs: 2000, policy })).toEqual([]);
  });

  it('crosses multiple days without merging or dropping starts', () => {
    const starts = listTownDayPhaseStarts({ fromMs: 0, toMs: 2 * DAY_MS, policy });
    expect(starts).toHaveLength(10);
    expect(starts.map((start) => start.phase)).toEqual([
      'dawn',
      'day',
      'dusk',
      'evening',
      'night',
      'dawn',
      'day',
      'dusk',
      'evening',
      'night',
    ]);
    expect(starts[9]?.dayIndex).toBe(2);
  });

  it('rejects an inverted window', () => {
    expect(() => listTownDayPhaseStarts({ fromMs: 2000, toMs: 1000, policy })).toThrow(
      'toMs must be greater than or equal to fromMs',
    );
  });
});

describe('assertValidTownCalendarPolicy', () => {
  it('accepts the canonical policy', () => {
    expect(() => assertValidTownCalendarPolicy(policy)).not.toThrow();
  });

  it('rejects an empty policyVersion', () => {
    expect(() => assertValidTownCalendarPolicy({ ...policy, policyVersion: ' ' })).toThrow(
      'policyVersion must not be empty',
    );
  });

  it('rejects a non-positive day length', () => {
    expect(() => assertValidTownCalendarPolicy({ ...policy, dayLengthMs: 0 })).toThrow(
      'dayLengthMs must be a positive finite number',
    );
  });

  it('rejects an empty phase table or one not covering [0, 1)', () => {
    expect(() => assertValidTownCalendarPolicy({ ...policy, phases: [] })).toThrow(
      'phases must not be empty',
    );
    expect(() =>
      assertValidTownCalendarPolicy({
        ...policy,
        phases: [
          { phase: 'day', startFraction: 0.3 },
          { phase: 'night', startFraction: 0.8 },
        ],
      }),
    ).toThrow('phases must start at fraction 0');
  });

  it('rejects out-of-range or non-monotonic start fractions', () => {
    expect(() =>
      assertValidTownCalendarPolicy({
        ...policy,
        phases: [
          { phase: 'night', startFraction: 0 },
          { phase: 'day', startFraction: 1 },
        ],
      }),
    ).toThrow('startFraction must be within [0, 1)');
    expect(() =>
      assertValidTownCalendarPolicy({
        ...policy,
        phases: [
          { phase: 'night', startFraction: 0 },
          { phase: 'day', startFraction: 0.3 },
          { phase: 'dusk', startFraction: 0.3 },
        ],
      }),
    ).toThrow('startFraction must be strictly increasing');
  });

  it('rejects empty phase names and negative decay rates', () => {
    expect(() =>
      assertValidTownCalendarPolicy({
        ...policy,
        phases: [{ phase: ' ', startFraction: 0 }],
      }),
    ).toThrow('phase must not be empty');
    expect(() =>
      assertValidTownCalendarPolicy({
        ...policy,
        physiologicalDecay: { energyPerHour: -1, satietyPerHour: 12.5 },
      }),
    ).toThrow('physiologicalDecay.energyPerHour must be non-negative');
  });

  it('allows repeated phase names (a night phase spanning midnight)', () => {
    expect(() =>
      assertValidTownCalendarPolicy({
        ...policy,
        phases: [
          { phase: 'night', startFraction: 0 },
          { phase: 'day', startFraction: 0.3 },
          { phase: 'night', startFraction: 0.875 },
        ],
      }),
    ).not.toThrow();
  });
});
