import { describe, expect, test } from 'vitest';
import { createSeededRandom, rollProbabilityPercent } from './index';

describe('seeded random', () => {
  test('produces a repeatable sequence for the same seed', () => {
    const first = createSeededRandom('production:agent-1:chip:1');
    const second = createSeededRandom('production:agent-1:chip:1');

    expect([first.nextFloat(), first.nextFloat(), first.nextFloat()]).toEqual([
      second.nextFloat(),
      second.nextFloat(),
      second.nextFloat(),
    ]);
  });

  test('different seeds produce different sequences', () => {
    const first = createSeededRandom('production:agent-1:chip:1');
    const second = createSeededRandom('production:agent-2:chip:1');

    expect([first.nextFloat(), first.nextFloat(), first.nextFloat()]).not.toEqual([
      second.nextFloat(),
      second.nextFloat(),
      second.nextFloat(),
    ]);
  });

  test('rolls probability percentages with deterministic bounds', () => {
    const rng = createSeededRandom('reward-roll');

    expect(rollProbabilityPercent(100, rng)).toBe(true);
    expect(rollProbabilityPercent(0, rng)).toBe(false);
  });
});
