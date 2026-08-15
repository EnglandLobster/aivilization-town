import { describe, expect, it } from 'vitest';

import {
  assertValidWellbeingPolicy,
  DEFAULT_WELLBEING_BAND_THRESHOLDS,
  describeWellbeingBand,
  evaluateWellbeing,
  type WellbeingInputs,
  type WellbeingPolicy,
} from './index';

const policy: WellbeingPolicy = {
  policyVersion: 'town-wellbeing-v1',
  initialValue: 50,
  minValue: 0,
  maxValue: 100,
  baseline: 50,
  convergencePerHour: 2,
  coefficients: {
    health: 10,
    energy: 6,
    satiety: 6,
    employed: 4,
    unemployed: -6,
    residentialTier: [0, -4, -2, 0, 2, 4, 6],
    lifestyleTier: [-6, -2, 2, 6],
    upkeepArrearsPerUnit: -0.5,
    distress: -8,
    positiveRelation: 6,
    negativeRelation: -8,
  },
};

function createInputs(overrides: Partial<WellbeingInputs> = {}): WellbeingInputs {
  return {
    health: 50,
    energy: 50,
    satiety: 50,
    employed: true,
    residentialTier: 3,
    lifestyleTier: 'stable',
    upkeepArrears: 0,
    distressActive: false,
    meanPositiveRelation: 0,
    meanNegativeRelation: 0,
    elapsedMs: 3_600_000,
    ...overrides,
  };
}

describe('evaluateWellbeing', () => {
  it('combines every factor contribution into the clamped target', () => {
    const result = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({
        health: 100, // +10
        energy: 0, // -6
        satiety: 75, // +3
        employed: true, // +4
        residentialTier: 6, // +6
        lifestyleTier: 'affluent', // +6
        upkeepArrears: 4, // -2
        distressActive: true, // -8
        meanPositiveRelation: 0.5, // +3
        meanNegativeRelation: 0.25, // -2
      }),
      policy,
    });
    // 50 + 10 - 6 + 3 + 4 + 6 + 6 - 2 - 8 + 3 - 2 = 64
    expect(result.target).toBeCloseTo(64);
    expect(result.factorContributions).toEqual({
      health: 10,
      energy: -6,
      satiety: 3,
      employment: 4,
      residentialTier: 6,
      lifestyleTier: 6,
      upkeepArrears: -2,
      distress: -8,
      positiveRelation: 3,
      negativeRelation: -2,
    });
  });

  it('normalizes physiology axes around 50', () => {
    const atMid = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ health: 50 }),
      policy,
    });
    expect(atMid.factorContributions.health).toBe(0);
    const atTop = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ health: 100 }),
      policy,
    });
    expect(atTop.factorContributions.health).toBe(10);
    const atBottom = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ health: 0 }),
      policy,
    });
    expect(atBottom.factorContributions.health).toBe(-10);
  });

  it('applies the employment contribution by job state', () => {
    const employed = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ employed: true }),
      policy,
    });
    expect(employed.factorContributions.employment).toBe(4);
    const unemployed = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ employed: false }),
      policy,
    });
    expect(unemployed.factorContributions.employment).toBe(-6);
  });

  it('indexes tier arrays by tier and contributes 0 out of range', () => {
    const tierOne = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ residentialTier: 1 }),
      policy,
    });
    expect(tierOne.factorContributions.residentialTier).toBe(-4);
    const tierSix = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ residentialTier: 6 }),
      policy,
    });
    expect(tierSix.factorContributions.residentialTier).toBe(6);
    const outOfRange = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ residentialTier: 7 }),
      policy,
    });
    expect(outOfRange.factorContributions.residentialTier).toBe(0);
  });

  it('maps lifestyle tiers through the canonical tier order and skips the absent tier', () => {
    const struggling = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ lifestyleTier: 'struggling' }),
      policy,
    });
    expect(struggling.factorContributions.lifestyleTier).toBe(-6);
    const affluent = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ lifestyleTier: 'affluent' }),
      policy,
    });
    expect(affluent.factorContributions.lifestyleTier).toBe(6);
    const withoutLifestyle = { ...createInputs() };
    delete withoutLifestyle.lifestyleTier;
    const absent = evaluateWellbeing({
      previous: 50,
      inputs: withoutLifestyle,
      policy,
    });
    expect(absent.factorContributions.lifestyleTier).toBe(0);
  });

  it('clamps the target to the configured bounds', () => {
    const high = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ health: 500, energy: 500, satiety: 500 }),
      policy,
    });
    expect(high.target).toBe(100);
    const low = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({
        health: 0,
        energy: 0,
        satiety: 0,
        employed: false,
        residentialTier: 1,
        lifestyleTier: 'struggling',
        upkeepArrears: 400,
        distressActive: true,
        meanNegativeRelation: 1,
      }),
      policy,
    });
    expect(low.target).toBe(0);
  });

  it('limits per-step movement to convergencePerHour scaled by elapsed time', () => {
    const result = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ health: 100, energy: 100, satiety: 100 }),
      policy,
    });
    // target = 50 + 10 + 6 + 6 + 4 + 0 + (-2) = 74; maxStep = 2 per hour.
    expect(result.target).toBeCloseTo(74);
    expect(result.next).toBeCloseTo(52);

    const halfHour = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ health: 100, energy: 100, satiety: 100, elapsedMs: 1_800_000 }),
      policy,
    });
    expect(halfHour.next).toBeCloseTo(51);
  });

  it('moves downward toward a lower target', () => {
    const result = evaluateWellbeing({
      previous: 60,
      inputs: createInputs({ employed: false, distressActive: true }),
      policy,
    });
    // target = 50 - 6 + 0 + (-2) - 8 = 34; maxStep = 2.
    expect(result.target).toBeCloseTo(34);
    expect(result.next).toBeCloseTo(58);
  });

  it('snaps onto the target once the remaining gap fits inside one step', () => {
    const result = evaluateWellbeing({
      previous: 73,
      inputs: createInputs({ health: 100, energy: 100, satiety: 100 }),
      policy,
    });
    // gap = 1 <= maxStep 2 → exact fixed point, no asymptotic tail.
    expect(result.next).toBe(result.target);

    const settled = evaluateWellbeing({
      previous: result.next,
      inputs: createInputs({ health: 100, energy: 100, satiety: 100 }),
      policy,
    });
    expect(settled.next).toBe(result.next);
  });

  it('reaches a fixed point after repeated settlements and stays there', () => {
    const inputs = createInputs({ health: 20, energy: 30, satiety: 10 });
    let value = 50;
    for (let step = 0; step < 100; step += 1) {
      value = evaluateWellbeing({ previous: value, inputs, policy }).next;
    }
    const target = evaluateWellbeing({ previous: value, inputs, policy }).target;
    expect(value).toBe(target);
    expect(evaluateWellbeing({ previous: value, inputs, policy }).next).toBe(value);
  });

  it('does not move when no time elapsed', () => {
    const result = evaluateWellbeing({
      previous: 50,
      inputs: createInputs({ health: 100, elapsedMs: 0 }),
      policy,
    });
    expect(result.next).toBe(50);
    expect(result.target).toBeGreaterThan(50);
  });

  it('is deterministic for identical inputs', () => {
    const first = evaluateWellbeing({ previous: 42.5, inputs: createInputs(), policy });
    const second = evaluateWellbeing({ previous: 42.5, inputs: createInputs(), policy });
    expect(first).toEqual(second);
  });

  it('rejects non-finite or out-of-range inputs', () => {
    expect(() =>
      evaluateWellbeing({ previous: Number.NaN, inputs: createInputs(), policy }),
    ).toThrow('previous must be within');
    expect(() =>
      evaluateWellbeing({ previous: 120, inputs: createInputs(), policy }),
    ).toThrow('previous must be within');
    expect(() =>
      evaluateWellbeing({
        previous: 50,
        inputs: createInputs({ health: Number.NaN }),
        policy,
      }),
    ).toThrow('health must be finite');
    expect(() =>
      evaluateWellbeing({
        previous: 50,
        inputs: createInputs({ residentialTier: 0 }),
        policy,
      }),
    ).toThrow('residentialTier must be a positive integer');
    expect(() =>
      evaluateWellbeing({
        previous: 50,
        inputs: createInputs({ upkeepArrears: -1 }),
        policy,
      }),
    ).toThrow('upkeepArrears must be non-negative');
    expect(() =>
      evaluateWellbeing({
        previous: 50,
        inputs: createInputs({ meanPositiveRelation: 1.5 }),
        policy,
      }),
    ).toThrow('meanPositiveRelation must be within');
    expect(() =>
      evaluateWellbeing({
        previous: 50,
        inputs: createInputs({ meanNegativeRelation: -0.1 }),
        policy,
      }),
    ).toThrow('meanNegativeRelation must be within');
    expect(() =>
      evaluateWellbeing({
        previous: 50,
        inputs: createInputs({ elapsedMs: -1 }),
        policy,
      }),
    ).toThrow('elapsedMs must be non-negative');
  });
});

describe('assertValidWellbeingPolicy', () => {
  it('accepts the canonical policy', () => {
    expect(() => assertValidWellbeingPolicy(policy)).not.toThrow();
  });

  it('rejects an empty policyVersion', () => {
    expect(() => assertValidWellbeingPolicy({ ...policy, policyVersion: ' ' })).toThrow(
      'policyVersion must not be empty',
    );
  });

  it('rejects inverted or escaped bounds', () => {
    expect(() =>
      assertValidWellbeingPolicy({ ...policy, minValue: 60, maxValue: 40 }),
    ).toThrow('minValue must not exceed maxValue');
    expect(() => assertValidWellbeingPolicy({ ...policy, initialValue: 120 })).toThrow(
      'initialValue must be within',
    );
    expect(() => assertValidWellbeingPolicy({ ...policy, baseline: -1 })).toThrow(
      'baseline must be within',
    );
  });

  it('rejects a negative convergence rate', () => {
    expect(() => assertValidWellbeingPolicy({ ...policy, convergencePerHour: -1 })).toThrow(
      'convergencePerHour must be non-negative',
    );
  });

  it('rejects non-finite coefficients', () => {
    expect(() =>
      assertValidWellbeingPolicy({
        ...policy,
        coefficients: { ...policy.coefficients, health: Number.NaN },
      }),
    ).toThrow('coefficients.health must be finite');
    expect(() =>
      assertValidWellbeingPolicy({
        ...policy,
        coefficients: { ...policy.coefficients, residentialTier: [0, Number.NaN] },
      }),
    ).toThrow('coefficients.residentialTier[1] must be finite');
  });

  it('rejects non-increasing band thresholds', () => {
    expect(() =>
      assertValidWellbeingPolicy({
        ...policy,
        bandThresholds: { distressedBelow: 40, lowBelow: 40, contentBelow: 60, thrivingBelow: 80 },
      }),
    ).toThrow('bandThresholds must be strictly increasing');
  });

  it('rejects band thresholds outside the value bounds', () => {
    expect(() =>
      assertValidWellbeingPolicy({
        ...policy,
        bandThresholds: {
          distressedBelow: -5,
          lowBelow: 40,
          contentBelow: 60,
          thrivingBelow: 80,
        },
      }),
    ).toThrow('bandThresholds.distressedBelow must be within');
  });
});

describe('describeWellbeingBand', () => {
  it('maps values onto the canonical bands', () => {
    expect(describeWellbeingBand(10)).toBe('distressed');
    expect(describeWellbeingBand(30)).toBe('low');
    expect(describeWellbeingBand(50)).toBe('steady');
    expect(describeWellbeingBand(70)).toBe('content');
    expect(describeWellbeingBand(90)).toBe('thriving');
  });

  it('treats cut points as the start of the next band', () => {
    expect(describeWellbeingBand(20)).toBe('low');
    expect(describeWellbeingBand(40)).toBe('steady');
    expect(describeWellbeingBand(60)).toBe('content');
    expect(describeWellbeingBand(80)).toBe('thriving');
  });

  it('defaults to the package thresholds and accepts custom ones', () => {
    expect(DEFAULT_WELLBEING_BAND_THRESHOLDS).toEqual({
      distressedBelow: 20,
      lowBelow: 40,
      contentBelow: 60,
      thrivingBelow: 80,
    });
    expect(
      describeWellbeingBand(50, {
        distressedBelow: 45,
        lowBelow: 48,
        contentBelow: 52,
        thrivingBelow: 55,
      }),
    ).toBe('steady');
  });

  it('rejects non-finite values and invalid thresholds', () => {
    expect(() => describeWellbeingBand(Number.NaN)).toThrow('value must be finite');
    expect(() =>
      describeWellbeingBand(50, {
        distressedBelow: 80,
        lowBelow: 40,
        contentBelow: 60,
        thrivingBelow: 90,
      }),
    ).toThrow('bandThresholds must be strictly increasing');
  });
});
