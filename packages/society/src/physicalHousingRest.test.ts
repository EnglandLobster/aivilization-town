import { expect, test } from 'vitest';
import { PHYSICAL_HOUSING_REST_POLICY, physicalHousingRestEffect } from './physicalHousingRest';
const effect = (
  source: Parameters<typeof physicalHousingRestEffect>[0]['source'],
  at = 0,
  rate = 0.2,
) =>
  physicalHousingRestEffect({
    policy: PHYSICAL_HOUSING_REST_POLICY,
    source,
    at,
    baseEnergyPerSecond: rate,
  });
test('physical condition, baseline and explicit initial endowment determine rate; no social values are inputs', () => {
  expect(effect({ kind: 'unsheltered', locationId: 'street' }).energyPerSecond).toBe(0.1);
  expect(effect({ kind: 'initial-world-residence', locationId: 'old-home' }).energyPerSecond).toBe(
    0.2,
  );
  const source = {
    kind: 'resident-built-residence' as const,
    locationId: 'new-home',
    buildingId: 'home',
    revision: 2,
    condition: 500,
  };
  expect(effect(source).multiplier).toBe(0.75);
  expect(effect(source).energyPerSecond).toBeCloseTo(0.15, 14);
  expect(effect({ ...source, condition: 1000 }).multiplier).toBe(1);
  expect(effect({ ...source, condition: 1 }).multiplier).toBeCloseTo(0.5005);
  expect(source.condition).toBe(500);
});
test('malformed or unsupported physical assumptions and source facts reject rather than generating effects', () => {
  const source = {
    kind: 'resident-built-residence' as const,
    locationId: 'home',
    buildingId: 'h',
    revision: 1,
    condition: 1000,
  };
  for (const condition of [0, -1, 1001, NaN, Infinity, 1.5])
    expect(() => effect({ ...source, condition })).toThrow('invalid-physical-rest-source-or-rate');
  for (const rate of [-1, NaN, Infinity]) expect(() => effect(source, 0, rate)).toThrow();
  expect(() => effect({ ...source, revision: 0 })).toThrow();
  expect(() => effect(source, -1)).toThrow();
  expect(() =>
    physicalHousingRestEffect({
      policy: { ...PHYSICAL_HOUSING_REST_POLICY, extra: 1 },
      source,
      at: 0,
      baseEnergyPerSecond: 1,
    } as Parameters<typeof physicalHousingRestEffect>[0]),
  ).toThrow('unsupported-physical-housing-rest-policy');
});
