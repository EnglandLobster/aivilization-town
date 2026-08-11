import { describe, expect, test } from 'vitest';
import {
  assertTownConditionsPolicy,
  deriveAgentConditions,
  type TownConditionsPolicy,
} from './index';

const policy: TownConditionsPolicy = {
  policyVersion: 'town-conditions-v1',
  soaked: {
    outdoorSeverityByWeather: { rainy: 'moderate', stormy: 'severe' },
    need: 'shelter',
  },
  cold: {
    outdoorSeverityByWeather: { snowy: 'severe', foggy: 'moderate' },
    shelteredSeverity: 'mild',
    shelteredMaxResidentialTier: 1,
    need: 'warm-up',
  },
  overtired: { triggerBelow: 30, severeBelow: 10, need: 'sleep' },
  hungry: { triggerBelow: 30, severeBelow: 10, need: 'eat' },
  stressed: { triggerBelow: 40, severeBelow: 20, need: 'see-doctor' },
};

const healthyPhysiology = { energy: 100, satiety: 100, health: 100 };

function derive(input: {
  readonly physiology?: { energy: number; satiety: number; health: number };
  readonly residentialTier?: number;
  readonly outdoors?: boolean;
  readonly weather?: string;
  readonly policyOverride?: TownConditionsPolicy;
}) {
  return deriveAgentConditions({
    physiology: input.physiology ?? healthyPhysiology,
    residentialTier: input.residentialTier ?? 3,
    outdoors: input.outdoors ?? false,
    ...(input.weather === undefined ? {} : { weather: input.weather }),
    policy: input.policyOverride ?? policy,
  });
}

describe('town condition catalog derivation', () => {
  test('accepts the canonical catalog and derives nothing for a sheltered healthy agent', () => {
    expect(() => assertTownConditionsPolicy(policy)).not.toThrow();
    expect(derive({})).toEqual([]);
    expect(derive({ weather: 'sunny', outdoors: true })).toEqual([]);
  });

  test('grades physiology conditions by threshold distance in canonical order', () => {
    expect(derive({ physiology: { energy: 29, satiety: 9, health: 39 } })).toEqual([
      { kind: 'overtired', severity: 'moderate', need: 'sleep' },
      { kind: 'hungry', severity: 'severe', need: 'eat' },
      { kind: 'stressed', severity: 'moderate', need: 'see-doctor' },
    ]);
    expect(derive({ physiology: { energy: 9, satiety: 100, health: 19 } })).toEqual([
      { kind: 'overtired', severity: 'severe', need: 'sleep' },
      { kind: 'stressed', severity: 'severe', need: 'see-doctor' },
    ]);
    // Threshold boundaries are exclusive: at the threshold nothing triggers.
    expect(derive({ physiology: { energy: 30, satiety: 30, health: 40 } })).toEqual([]);
  });

  test('derives weather-exposure conditions only outdoors', () => {
    expect(derive({ weather: 'rainy', outdoors: true })).toEqual([
      { kind: 'soaked', severity: 'moderate', need: 'shelter' },
    ]);
    expect(derive({ weather: 'stormy', outdoors: true })).toEqual([
      { kind: 'soaked', severity: 'severe', need: 'shelter' },
    ]);
    // Sheltered agents stay dry.
    expect(derive({ weather: 'rainy', outdoors: false })).toEqual([]);
    expect(derive({ weather: 'stormy', outdoors: false })).toEqual([]);
  });

  test('derives cold outdoors, and a milder sheltered variant for low-tier residences', () => {
    expect(derive({ weather: 'snowy', outdoors: true, residentialTier: 4 })).toEqual([
      { kind: 'cold', severity: 'severe', need: 'warm-up' },
    ]);
    expect(derive({ weather: 'foggy', outdoors: true, residentialTier: 4 })).toEqual([
      { kind: 'cold', severity: 'moderate', need: 'warm-up' },
    ]);
    // Low-tier shelter still catches a mild cold; higher tiers stay warm.
    expect(derive({ weather: 'snowy', outdoors: false, residentialTier: 1 })).toEqual([
      { kind: 'cold', severity: 'mild', need: 'warm-up' },
    ]);
    expect(derive({ weather: 'snowy', outdoors: false, residentialTier: 2 })).toEqual([]);
    // Soaked has no sheltered variant.
    expect(derive({ weather: 'rainy', outdoors: false, residentialTier: 1 })).toEqual([]);
  });

  test('never derives weather-exposure conditions without a weather state', () => {
    expect(derive({ outdoors: true })).toEqual([]);
  });

  test('combines weather exposure and physiology conditions in canonical order', () => {
    expect(
      derive({ weather: 'stormy', outdoors: true, physiology: { energy: 5, satiety: 5, health: 5 } }),
    ).toEqual([
      { kind: 'soaked', severity: 'severe', need: 'shelter' },
      { kind: 'overtired', severity: 'severe', need: 'sleep' },
      { kind: 'hungry', severity: 'severe', need: 'eat' },
      { kind: 'stressed', severity: 'severe', need: 'see-doctor' },
    ]);
  });

  test('is a pure total function of its inputs', () => {
    const input = {
      physiology: { energy: 20, satiety: 80, health: 100 },
      residentialTier: 1,
      outdoors: true,
      weather: 'foggy',
    };
    expect(derive(input)).toEqual(derive(input));
  });

  test('rejects invalid physiology thresholds', () => {
    expect(() =>
      derive({
        policyOverride: {
          ...policy,
          overtired: { triggerBelow: 10, severeBelow: 30, need: 'sleep' },
        },
      }),
    ).toThrow(/overtired severeBelow/);
    expect(() =>
      derive({
        policyOverride: {
          ...policy,
          hungry: { triggerBelow: Number.NaN, severeBelow: 5, need: 'eat' },
        },
      }),
    ).toThrow(/hungry triggerBelow/);
  });

  test('rejects invalid weather-exposure rules', () => {
    expect(() =>
      derive({
        policyOverride: {
          ...policy,
          soaked: { outdoorSeverityByWeather: {}, need: 'shelter' },
        },
      }),
    ).toThrow(/soaked must list at least one trigger weather/);
    expect(() =>
      derive({
        policyOverride: {
          ...policy,
          cold: {
            outdoorSeverityByWeather: policy.cold.outdoorSeverityByWeather,
            shelteredSeverity: 'mild',
            need: 'warm-up',
          },
        },
      }),
    ).toThrow(/cold sheltered variant/);
    expect(() =>
      derive({
        policyOverride: {
          ...policy,
          cold: {
            ...policy.cold,
            shelteredSeverity: 'mild',
            shelteredMaxResidentialTier: 0,
          },
        },
      }),
    ).toThrow(/cold shelteredMaxResidentialTier/);
    expect(() =>
      derive({
        policyOverride: {
          ...policy,
          soaked: {
            outdoorSeverityByWeather: { rainy: 'extreme' as 'moderate' },
            need: 'shelter',
          },
        },
      }),
    ).toThrow(/soaked weather rainy has an invalid severity/);
  });
});
