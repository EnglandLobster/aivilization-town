import { describe, expect, test } from 'vitest';
import { accumulateEducation } from './index';

describe('accumulateEducation', () => {
  test('applies H(t + dt) = H(t) + eta * dt', () => {
    expect(
      accumulateEducation({
        currentEducationScore: 70,
        educationRatePerSecond: 0.5,
        studyDurationSeconds: 120,
      }),
    ).toBe(130);
  });

  test('rejects negative study duration and education rate', () => {
    expect(() =>
      accumulateEducation({
        currentEducationScore: 0,
        educationRatePerSecond: 1,
        studyDurationSeconds: -1,
      }),
    ).toThrow('studyDurationSeconds must be non-negative');

    expect(() =>
      accumulateEducation({
        currentEducationScore: 0,
        educationRatePerSecond: -1,
        studyDurationSeconds: 1,
      }),
    ).toThrow('educationRatePerSecond must be non-negative');
  });
});
