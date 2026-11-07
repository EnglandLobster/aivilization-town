import { expect, test } from 'vitest';
import { advanceProductivePhysiology } from './productivePhysiology';
const policy = {
  decay: { energyPerHour: 2, satietyPerHour: 1 },
  effort: { energyCostPerHour: 10, satietyCostPerHour: 4 },
  deprivation: { energyThreshold: 25, healthDecayPerSecond: 0.001, minHealth: 0 },
};
test('productive effort and natural decay integrate once across deprivation thresholds and arbitrary partitions', () => {
  const previous = { energy: 30, satiety: 50, health: 100 };
  const whole = advanceProductivePhysiology({
    ...policy,
    previous,
    elapsedMs: 3600000,
    workLimitMs: 3600000,
  });
  let state = previous,
    time = 0,
    work = 0,
    low = 0;
  for (const ms of [17777, 900003, 1234567, 1447653]) {
    const step = advanceProductivePhysiology({
      ...policy,
      previous: state,
      elapsedMs: ms,
      workLimitMs: ms,
    });
    state = step.next;
    time += ms;
    work += step.workedMs;
    low += step.lowEnergyMs;
  }
  expect(time).toBe(3600000);
  expect(work).toBe(3600000);
  expect(state.energy).toBeCloseTo(18, 9);
  expect(state.satiety).toBeCloseTo(45, 9);
  expect(state.health).toBeCloseTo(whole.next.health, 9);
  expect(low).toBeCloseTo(whole.lowEnergyMs, 6);
  expect(whole.lowEnergyMs).toBeCloseTo(2100000, 6);
});
test('physical exhaustion stops productive time, not passive time; zero resources and invalid limits cannot grant effort', () => {
  const previous = { energy: 1, satiety: 10, health: 100 };
  const whole = advanceProductivePhysiology({
    ...policy,
    previous,
    elapsedMs: 600000,
    workLimitMs: 600000,
  });
  expect(whole.workedMs).toBe(300000);
  expect(whole.next.energy).toBe(0);
  expect(whole.next.satiety).toBeCloseTo(9.5, 9);
  const first = advanceProductivePhysiology({
    ...policy,
    previous,
    elapsedMs: 125000,
    workLimitMs: 125000,
  });
  const second = advanceProductivePhysiology({
    ...policy,
    previous: first.next,
    elapsedMs: 475000,
    workLimitMs: 475000,
  });
  expect(first.workedMs + second.workedMs).toBe(whole.workedMs);
  expect(second.next.health).toBeCloseTo(whole.next.health, 9);
  expect(
    advanceProductivePhysiology({
      ...policy,
      previous: { ...previous, health: 0 },
      elapsedMs: 600000,
      workLimitMs: 600000,
    }).workedMs,
  ).toBe(0);
  for (const workLimitMs of [-1, 1.5, Infinity, 600001])
    expect(() =>
      advanceProductivePhysiology({ ...policy, previous, elapsedMs: 600000, workLimitMs }),
    ).toThrow('invalid-productive-physiology-input');
});
