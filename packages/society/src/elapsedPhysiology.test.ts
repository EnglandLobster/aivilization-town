import { expect, test } from 'vitest';
import {
  advanceElapsedPhysiology as advance,
  type ElapsedPhysiologyInput,
} from './elapsedPhysiology';

const base: ElapsedPhysiologyInput = {
  previous: { energy: 10, satiety: 80, health: 100 },
  elapsedMs: 20000,
  decay: { energyPerHour: 3600, satietyPerHour: 360 },
  deprivation: { energyThreshold: 20, healthDecayPerSecond: 1, minHealth: 10 },
  sleep: { energyPerSecond: 2, maximum: 100 },
};
test('sleep recovery and decay act together, with harm only until the actual threshold crossing', () => {
  expect(advance(base)).toEqual({
    next: { energy: 30, satiety: 78, health: 90 },
    lowEnergyMs: 10000,
  });
  expect(advance({ ...base, elapsedMs: 0 })).toEqual({ next: base.previous, lowEnergyMs: 0 });
});
test('awake decay crosses the threshold mid-interval, and floors never heal already low health', () => {
  const { sleep: _sleep, ...awake } = base;
  void _sleep;
  expect(advance({ ...awake, previous: { energy: 30, satiety: 1, health: 100 } })).toEqual({
    next: { energy: 10, satiety: 0, health: 90 },
    lowEnergyMs: 10000,
  });
  expect(advance({ ...awake, previous: { energy: 0, satiety: 0, health: 2 } }).next.health).toBe(2);
});
test('recovery ceiling below a threshold stays in deprivation, and a lower ceiling cannot confiscate existing energy', () => {
  expect(advance({ ...base, sleep: { energyPerSecond: 2, maximum: 15 } })).toEqual({
    next: { energy: 15, satiety: 78, health: 80 },
    lowEnergyMs: 20000,
  });
  expect(
    advance({ ...base, previous: { ...base.previous, energy: 110 }, elapsedMs: 5000 }).next.energy,
  ).toBe(105);
  expect(advance({ ...base, previous: { ...base.previous, energy: 110 } }).next.energy).toBe(100);
});
test.each([-1, NaN, Infinity])('invalid physical input %s is rejected', (value) => {
  expect(() => advance({ ...base, elapsedMs: value })).toThrow('invalid-elapsed-physiology-input');
  expect(() => advance({ ...base, sleep: { energyPerSecond: value, maximum: 100 } })).toThrow(
    'invalid-elapsed-physiology-input',
  );
  expect(() => advance({ ...base, previous: { ...base.previous, health: value } })).toThrow(
    'invalid-elapsed-physiology-input',
  );
});
test('intermediate physical arithmetic cannot overflow silently', () => {
  expect(() =>
    advance({ ...base, sleep: { energyPerSecond: Number.MAX_VALUE, maximum: 100 } }),
  ).toThrow('elapsed-physiology-overflow');
});
test('all partitions preserve caps, thresholds, low-energy time and final state across rising/falling/steady trajectories', () => {
  for (const energy of [0, 10, 20, 99, 100, 110]) {
    for (const recovery of [0, 0.5, 1, 2]) {
      for (const maximum of [0, 15, 20, 100]) {
        const input = {
          ...base,
          previous: { energy, satiety: 80, health: 100 },
          elapsedMs: 90000,
          sleep: { energyPerSecond: recovery, maximum },
        };
        const whole = advance(input);
        let next = input.previous;
        let lowEnergyMs = 0;
        for (const elapsedMs of [1000, 17000, 500, 31500, 40000]) {
          const part = advance({ ...input, previous: next, elapsedMs });
          next = part.next;
          lowEnergyMs += part.lowEnergyMs;
        }
        for (const key of ['energy', 'satiety', 'health'] as const)
          expect(next[key], JSON.stringify({ energy, recovery, maximum, key })).toBeCloseTo(
            whole.next[key],
            9,
          );
        expect(lowEnergyMs).toBeCloseTo(whole.lowEnergyMs, 6);
      }
    }
  }
});
