import { expect, test } from 'vitest';
import { advanceServicePhysiology } from './servicePhysiology';
const base = {
  modelId: 'supportive-care-v1' as const,
  previousProgressMs: 0,
  provider: { energy: 25.05, satiety: 50, health: 50, educationScore: 20 },
  recipient: { energy: 22, satiety: 50, health: 99, educationScore: 10 },
  educationCeiling: 20,
  elapsedMs: 3600000,
  workLimitMs: 3600000,
  decay: { energyPerHour: 5, satietyPerHour: 1 },
  deprivation: { energyThreshold: 20, healthDecayPerSecond: 0.01, minHealth: 0 },
};
function parts(durations: readonly number[], input = base) {
  let provider = input.provider,
    recipient = input.recipient,
    progress = input.previousProgressMs;
  for (const elapsedMs of durations) {
    const next = advanceServicePhysiology({
      ...input,
      provider,
      recipient,
      previousProgressMs: progress,
      elapsedMs,
      workLimitMs: elapsedMs,
    });
    provider = next.provider;
    recipient = next.recipient;
    progress += next.workedMs;
  }
  return { provider, recipient, progress };
}
test('service effort, passive decay, low-energy harm and care caps integrate simultaneously across arbitrary partitions', () => {
  const expected = parts([3600000]);
  expect(expected.provider.health).toBeCloseTo(26.12, 9);
  expect(expected.recipient.health).toBeCloseTo(80.8, 9);
  for (const durations of [
    Array<number>(60).fill(60000),
    Array<number>(120).fill(30000),
    [1211999, 1, 1888777, 499223],
  ]) {
    const actual = parts(durations);
    expect(actual.progress).toBe(expected.progress);
    for (const role of ['provider', 'recipient'] as const)
      for (const axis of ['energy', 'satiety', 'health', 'educationScore'] as const)
        expect(actual[role][axis]).toBeCloseTo(expected[role][axis], 8);
  }
});
test('exhaustion stops actual service, leaves remaining passive time, and never heals a dead recipient', () => {
  const input = {
    ...base,
    provider: { ...base.provider, energy: 5 },
    deprivation: { ...base.deprivation, minHealth: 10 },
  };
  const actual = advanceServicePhysiology(input);
  expect(actual.workedMs).toBe(1200000);
  expect(actual.provider.energy).toBe(0);
  const split = parts([600000, 600000, 2400000], input);
  expect(split.progress).toBe(actual.workedMs);
  expect(split.recipient.health).toBeCloseTo(actual.recipient.health, 8);
  const dead = advanceServicePhysiology({ ...base, recipient: { ...base.recipient, health: 0 } });
  expect(dead.workedMs).toBe(0);
  expect(dead.recipient.health).toBe(0);
  expect(() => advanceServicePhysiology({ ...base, elapsedMs: NaN })).toThrow();
});
test('meal effects consume measured material and combine satiety gains with decay, rather than clamp after prepaid recovery', () => {
  const actual = advanceServicePhysiology({
    ...base,
    modelId: 'meal-assistance-v1',
    provider: { ...base.provider, energy: 100 },
    recipient: { ...base.recipient, satiety: 99 },
    deprivation: { ...base.deprivation, minHealth: 10 },
  });
  expect(actual.workedMs).toBe(3600000);
  expect(actual.recipient.satiety).toBe(100);
  expect(actual.consumed).toEqual({ Apple: 4 });
});

test('numerical cancellation tolerance is bounded far below a work millisecond and cannot give work to an empty body', () => {
  for (const energy of [0, 1e-15])
    expect(
      advanceServicePhysiology({
        ...base,
        elapsedMs: 1,
        workLimitMs: 1,
        provider: { ...base.provider, energy },
      }).workedMs,
    ).toBe(0);
  const input = { ...base, provider: { ...base.provider, energy: 5 } };
  const expected = advanceServicePhysiology({ ...input, elapsedMs: 1200000, workLimitMs: 1200000 });
  const split = parts([1199999, 1], input);
  expect(split.progress).toBe(expected.workedMs);
  expect(split.progress).toBe(1200000);
});
