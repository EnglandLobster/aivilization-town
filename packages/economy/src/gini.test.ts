import { describe, expect, test } from 'vitest';
import { calculateGiniCoefficient } from './index';

describe('calculateGiniCoefficient', () => {
  test('returns 0 for an empty distribution', () => {
    expect(calculateGiniCoefficient([])).toBe(0);
  });

  test('returns 0 for a single holder regardless of wealth', () => {
    expect(calculateGiniCoefficient([0])).toBe(0);
    expect(calculateGiniCoefficient([42])).toBe(0);
  });

  test('returns 0 when everyone holds the same amount', () => {
    expect(calculateGiniCoefficient([10, 10, 10, 10])).toBe(0);
  });

  test('returns 0 when nobody holds anything', () => {
    expect(calculateGiniCoefficient([0, 0, 0])).toBe(0);
  });

  test('approaches (n-1)/n when one holder concentrates everything', () => {
    expect(calculateGiniCoefficient([0, 0, 0, 100])).toBeCloseTo(0.75, 12);
    expect(calculateGiniCoefficient([0, 100])).toBeCloseTo(0.5, 12);
  });

  test('computes the standard value for an uneven distribution', () => {
    // sorted [10, 20, 30, 40]: weighted sum −30 −20 +30 +120 = 100, n·total = 400.
    expect(calculateGiniCoefficient([40, 10, 30, 20])).toBeCloseTo(0.25, 12);
  });

  test('rejects non-finite values', () => {
    expect(() => calculateGiniCoefficient([1, Number.NaN])).toThrow('gini values must be finite');
    expect(() => calculateGiniCoefficient([Number.POSITIVE_INFINITY])).toThrow(
      'gini values must be finite',
    );
  });
});
