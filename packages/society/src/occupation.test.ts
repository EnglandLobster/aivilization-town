import { describe, expect, test } from 'vitest';
import {
  calculateApplicationQuota,
  calculateDynamicKnowledgeThreshold,
  calculateEffectiveKnowledgeThreshold,
  evaluateOccupationApplication,
  isEligibleForOccupation,
} from './index';

describe('occupation eligibility', () => {
  const educationScores = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450];

  test('calculates dynamic knowledge threshold from the top eligibility share quantile', () => {
    expect(
      calculateDynamicKnowledgeThreshold({
        educationScores,
        eligibilityShare: 0.2,
      }),
    ).toBe(350);
  });

  test('uses max of occupation floor and dynamic threshold as effective threshold', () => {
    expect(
      calculateEffectiveKnowledgeThreshold({
        educationScores,
        educationFloor: 604,
        eligibilityShare: 0.065,
      }),
    ).toBe(604);
    expect(
      calculateEffectiveKnowledgeThreshold({
        educationScores,
        educationFloor: 100,
        eligibilityShare: 0.2,
      }),
    ).toBe(350);
  });

  test('requires both residential tier and effective knowledge threshold for occupation eligibility', () => {
    expect(
      isEligibleForOccupation({
        occupationName: 'Doctor',
        agent: { residentialTier: 5, educationScore: 360 },
        populationEducationScores: educationScores,
      }),
    ).toBe(true);
    expect(
      isEligibleForOccupation({
        occupationName: 'Doctor',
        agent: { residentialTier: 4, educationScore: 320 },
        populationEducationScores: educationScores,
      }),
    ).toBe(false);
    expect(
      isEligibleForOccupation({
        occupationName: 'Doctor',
        agent: { residentialTier: 5, educationScore: 250 },
        populationEducationScores: educationScores,
      }),
    ).toBe(false);
  });

  test('uses a bounded non-decreasing residential-tier application quota policy', () => {
    const policy = [1, 1, 2, 3, 4, 5] as const;

    expect(calculateApplicationQuota({ residentialTier: 1, quotaByResidentialTier: policy })).toBe(
      1,
    );
    expect(calculateApplicationQuota({ residentialTier: 3, quotaByResidentialTier: policy })).toBe(
      2,
    );
    expect(calculateApplicationQuota({ residentialTier: 9, quotaByResidentialTier: policy })).toBe(
      5,
    );
  });

  test('evaluates occupation application job-tier education and prerequisite commodity requirements', () => {
    expect(
      evaluateOccupationApplication({
        occupationName: 'Stock Clerk',
        agent: {
          residentialTier: 2,
          educationScore: 20,
          inventory: { Beef: 1 },
        },
        populationEducationScores: [0, 10, 20],
      }),
    ).toEqual({
      status: 'accepted',
      occupationName: 'Stock Clerk',
      jobTier: 2,
      effectiveEducationThreshold: 20,
      consumedInventory: { Beef: 1 },
    });

    expect(
      evaluateOccupationApplication({
        occupationName: 'Stock Clerk',
        agent: {
          residentialTier: 2,
          educationScore: 19,
          inventory: { Beef: 1 },
        },
        populationEducationScores: [0, 10, 20],
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'education-too-low',
      detail: 'educationScore requires 20, available 19',
    });

    expect(
      evaluateOccupationApplication({
        occupationName: 'Stock Clerk',
        agent: {
          residentialTier: 2,
          educationScore: 20,
          inventory: {},
        },
        populationEducationScores: [0, 10, 20],
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'missing-prerequisite',
      detail: 'Beef requires 1, available 0',
    });
  });
});
