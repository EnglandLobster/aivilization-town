import type { WorldDecisionOccupationRule } from '@aivilization/agent-runtime';
import { describe, expect, test } from 'vitest';
import { isEnterpriseOccupationQualified } from './enterprisePlanning';

function createOccupationRule(rejectionReasons: readonly string[]): WorldDecisionOccupationRule {
  return {
    occupationName: 'Cleaner',
    jobTier: 1,
    baseWage: 250,
    effectiveEducationThreshold: 0,
    requiredResidentialTier: 1,
    prerequisiteCommodity: null,
    eligible: rejectionReasons.length === 0,
    rejectionReasons,
    applicationQuota: {
      residentialTier: 1,
      limit: 1,
      currentApplications: 1,
      remaining: 0,
    },
  };
}

describe('enterprise employment planning', () => {
  test('does not apply the public recruitment quota to direct enterprise hiring', () => {
    expect(
      isEnterpriseOccupationQualified(createOccupationRule(['application-quota-exhausted'])),
    ).toBe(true);
  });

  test.each(['residential-tier-too-low', 'education-too-low', 'missing-prerequisite'])(
    'keeps the authoritative occupation qualification blocker %s',
    (reason) => {
      expect(isEnterpriseOccupationQualified(createOccupationRule([reason]))).toBe(false);
      expect(
        isEnterpriseOccupationQualified(
          createOccupationRule(['application-quota-exhausted', reason]),
        ),
      ).toBe(false);
    },
  );

  test('keeps legacy custom occupations eligible when no catalog rule exists', () => {
    expect(isEnterpriseOccupationQualified(undefined)).toBe(true);
  });
});
