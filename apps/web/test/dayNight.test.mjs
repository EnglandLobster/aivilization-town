/**
 * Unit tests for the day/night layer math (dayNight.js) — pure module.
 */
import { describe, expect, test } from 'vitest';
import {
  daytimeOverlays,
  describeDaytime,
  isNightlightTime,
  resolveDaytime,
} from '../public/ui/map/dayNight.js';

const HOUR = 3_600_000;

describe('resolveDaytime', () => {
  test('is idle without a calendar slice (flag-gated)', () => {
    expect(resolveDaytime(undefined, 10 * HOUR)).toBeNull();
    expect(resolveDaytime({}, 10 * HOUR)).toBeNull();
  });

  test('is idle for unknown phases — never guesses', () => {
    expect(resolveDaytime({ dayIndex: 3, phase: 'eclipse', since: 0 }, 0)).toBeNull();
  });

  test('darkness ramps smoothly from each phase toward the next', () => {
    const nightStart = resolveDaytime({ dayIndex: 0, phase: 'night', since: 0 }, 0);
    expect(nightStart.darkness).toBeCloseTo(1);
    const nightLate = resolveDaytime({ dayIndex: 0, phase: 'night', since: 0 }, 2 * HOUR);
    // Deep night, hours in: still dark but easing toward dawn.
    expect(nightLate.darkness).toBeLessThan(1);
    expect(nightLate.darkness).toBeGreaterThan(0.8);

    const dawnStart = resolveDaytime({ dayIndex: 0, phase: 'dawn', since: 0 }, 0);
    expect(dawnStart.darkness).toBeCloseTo(0.62);
    const dawnMid = resolveDaytime({ dayIndex: 0, phase: 'dawn', since: 0 }, 1.5 * HOUR);
    expect(dawnMid.darkness).toBeLessThan(0.62);
    expect(dawnMid.warmth).toBeGreaterThan(0);

    const dayEarly = resolveDaytime({ dayIndex: 0, phase: 'day', since: 0 }, 1 * HOUR);
    expect(dayEarly.darkness).toBeLessThan(0.05);
    expect(dayEarly.warmth).toBe(0);
  });

  test('phase progress clamps at the phase boundaries', () => {
    const overdue = resolveDaytime({ dayIndex: 2, phase: 'dawn', since: 0 }, 999 * HOUR);
    expect(overdue.phaseProgress).toBe(1);
    expect(overdue.dayIndex).toBe(2);
    const before = resolveDaytime({ dayIndex: 2, phase: 'day', since: 10 * HOUR }, 0);
    expect(before.phaseProgress).toBe(0);
  });
});

describe('isNightlightTime', () => {
  test('lights windows and lamps only from dusk onward', () => {
    expect(isNightlightTime(resolveDaytime({ phase: 'day', since: 0 }, 0))).toBe(false);
    expect(isNightlightTime(resolveDaytime({ phase: 'night', since: 0 }, 0))).toBe(true);
    expect(isNightlightTime(null)).toBe(false);
  });
});

describe('daytimeOverlays', () => {
  test('returns nothing in bright day', () => {
    expect(daytimeOverlays(resolveDaytime({ phase: 'day', since: 0 }, 1 * HOUR))).toBeNull();
  });

  test('returns a cool overlay at night and a warm wash at dawn/dusk', () => {
    const night = daytimeOverlays(resolveDaytime({ phase: 'night', since: 0 }, 0));
    expect(night).toHaveLength(1);
    expect(night[0].color).toContain('24, 32, 74');

    const dawnMid = daytimeOverlays(resolveDaytime({ phase: 'dawn', since: 0 }, 1.5 * HOUR));
    expect(dawnMid).toHaveLength(2);
    expect(dawnMid[1].color).toContain('255, 150, 70');
  });
});

describe('describeDaytime', () => {
  test('labels the day index and capitalized phase', () => {
    expect(describeDaytime(resolveDaytime({ dayIndex: 2, phase: 'dusk', since: 0 }, 0))).toBe(
      'Day 3 · Dusk',
    );
    expect(describeDaytime(null)).toBe('');
  });
});
