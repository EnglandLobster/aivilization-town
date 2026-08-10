import { describe, expect, test } from 'vitest';
import { calculateDynamicWage, calculateStaticWage } from './index';

describe('occupation wages', () => {
  const educationScores = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450];

  test('applies the overall price change ratio to static wage occupations', () => {
    expect(
      calculateStaticWage({
        occupationName: 'Cleaner',
        overallPriceChangeRatio: 1.2,
      }),
    ).toBe(300);
  });

  test('calculates dynamic wages from knowledge premium, price change, and short-term adjustment', () => {
    expect(
      calculateDynamicWage({
        occupationName: 'Doctor',
        populationEducationScores: educationScores,
        overallPriceChangeRatio: 1.1,
        shortTermAdjustment: 0.05,
        maxShortTermAdjustment: 0.1,
        knowledgePremium: (effectiveKnowledgeThreshold) => 1 + effectiveKnowledgeThreshold / 1000,
      }),
    ).toBeCloseTo(668.91825);
  });

  test('rejects occupation wage calculations that cross static and dynamic regimes', () => {
    expect(() =>
      calculateStaticWage({
        occupationName: 'Doctor',
        overallPriceChangeRatio: 1,
      }),
    ).toThrow(/dynamic wage/i);

    expect(() =>
      calculateDynamicWage({
        occupationName: 'Cleaner',
        populationEducationScores: educationScores,
        overallPriceChangeRatio: 1,
        shortTermAdjustment: 0,
        maxShortTermAdjustment: 0.1,
        knowledgePremium: () => 1,
      }),
    ).toThrow(/static wage/i);
  });

  test('bounds short-term wage adjustments', () => {
    expect(() =>
      calculateDynamicWage({
        occupationName: 'Doctor',
        populationEducationScores: educationScores,
        overallPriceChangeRatio: 1,
        shortTermAdjustment: 0.2,
        maxShortTermAdjustment: 0.1,
        knowledgePremium: () => 1,
      }),
    ).toThrow(/shortTermAdjustment/);
  });

  test('rejects unknown occupations at the wage boundary', () => {
    expect(() =>
      calculateStaticWage({
        occupationName: 'Ghost Writer',
        overallPriceChangeRatio: 1,
      }),
    ).toThrow(/unknown occupation Ghost Writer/);
  });
});
