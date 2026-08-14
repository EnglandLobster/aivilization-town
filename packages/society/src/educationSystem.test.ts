import { describe, expect, test } from 'vitest';
import {
  applyStudyEfficiency,
  deriveEducationLevel,
  describeEducationStage,
  evaluateAutomaticPromotion,
  evaluateEffectiveEducationScoreForOccupation,
  evaluateStudyCost,
  isCompulsoryLevel,
  quoteStudyTuition,
  validateEducationSystemPolicy,
  type EducationSystemPolicy,
} from './educationSystem';

const policy: EducationSystemPolicy = {
  policyVersion: 'education-system-v2',
  enabled: true,
  levelScoreThresholds: [20, 70, 180, 320, 450],
  compulsoryLevels: [1, 2],
  levelTuitionPerHour: { 0: 20, 1: 20, 2: 20, 3: 25, 4: 30, 5: 40 },
  employedStudyEfficiencyRatio: 0.3,
  examCycleDurationMs: 86_400_000,
  admissionQuotaByLevel: { 3: 0.5, 4: 0.25, 5: 0.1 },
  vocationalTrackShare: 0.5,
  source: 'test-education-system',
};

describe('validateEducationSystemPolicy', () => {
  test('accepts the canonical policy', () => {
    expect(() => validateEducationSystemPolicy(policy)).not.toThrow();
  });

  test('rejects an empty policyVersion, a non-boolean enabled, and an empty source', () => {
    expect(() => validateEducationSystemPolicy({ ...policy, policyVersion: ' ' })).toThrow(
      /policyVersion/,
    );
    expect(() =>
      validateEducationSystemPolicy({ ...policy, enabled: 'yes' as unknown as boolean }),
    ).toThrow(/enabled/);
    expect(() => validateEducationSystemPolicy({ ...policy, source: '' })).toThrow(/source/);
  });

  test('rejects wrong-size and non-increasing threshold tables', () => {
    expect(() =>
      validateEducationSystemPolicy({
        ...policy,
        levelScoreThresholds: [20, 70, 180, 320],
      } as unknown as EducationSystemPolicy),
    ).toThrow(/levelScoreThresholds/);
    expect(() =>
      validateEducationSystemPolicy({ ...policy, levelScoreThresholds: [70, 20, 180, 320, 450] }),
    ).toThrow(/strictly increasing/);
    expect(() =>
      validateEducationSystemPolicy({ ...policy, levelScoreThresholds: [20, 70, 70, 320, 450] }),
    ).toThrow(/strictly increasing/);
    expect(() =>
      validateEducationSystemPolicy({ ...policy, levelScoreThresholds: [20, -70, 180, 320, 450] }),
    ).toThrow(/non-negative/);
  });

  test('rejects out-of-range and duplicated compulsory levels', () => {
    expect(() =>
      validateEducationSystemPolicy({
        ...policy,
        compulsoryLevels: [1, 6],
      } as unknown as EducationSystemPolicy),
    ).toThrow(/compulsory level/);
    expect(() =>
      validateEducationSystemPolicy({
        ...policy,
        compulsoryLevels: [-1],
      } as unknown as EducationSystemPolicy),
    ).toThrow(/compulsory level/);
    expect(() => validateEducationSystemPolicy({ ...policy, compulsoryLevels: [1, 1] })).toThrow(
      /duplicated/,
    );
  });

  test('rejects invalid tuition entries', () => {
    expect(() =>
      validateEducationSystemPolicy({
        ...policy,
        levelTuitionPerHour: { ' ': 20 },
      }),
    ).toThrow(/tuition level key/);
    expect(() =>
      validateEducationSystemPolicy({ ...policy, levelTuitionPerHour: { 1: -1 } }),
    ).toThrow(/tuition for level/);
  });

  test('rejects an out-of-range employed efficiency ratio', () => {
    expect(() =>
      validateEducationSystemPolicy({ ...policy, employedStudyEfficiencyRatio: 0 }),
    ).toThrow(/employedStudyEfficiencyRatio/);
    expect(() =>
      validateEducationSystemPolicy({ ...policy, employedStudyEfficiencyRatio: 1.5 }),
    ).toThrow(/employedStudyEfficiencyRatio/);
    expect(() =>
      validateEducationSystemPolicy({ ...policy, employedStudyEfficiencyRatio: Number.NaN }),
    ).toThrow(/employedStudyEfficiencyRatio/);
    expect(() =>
      validateEducationSystemPolicy({ ...policy, employedStudyEfficiencyRatio: 1 }),
    ).not.toThrow();
  });

  test('rejects invalid exam-cycle, quota, track-share, and attempt-cap entries', () => {
    expect(() => validateEducationSystemPolicy({ ...policy, examCycleDurationMs: 0 })).toThrow(
      /examCycleDurationMs/,
    );
    expect(() =>
      validateEducationSystemPolicy({ ...policy, admissionQuotaByLevel: { 2: 0.5 } }),
    ).toThrow(/admission quota level/);
    expect(() =>
      validateEducationSystemPolicy({ ...policy, admissionQuotaByLevel: { 3: 1.5 } }),
    ).toThrow(/admission quota for level/);
    expect(() => validateEducationSystemPolicy({ ...policy, vocationalTrackShare: -0.1 })).toThrow(
      /vocationalTrackShare/,
    );
    expect(() => validateEducationSystemPolicy({ ...policy, maxExamAttempts: 0 })).toThrow(
      /maxExamAttempts/,
    );
    expect(() => validateEducationSystemPolicy({ ...policy, maxExamAttempts: 2.5 })).toThrow(
      /maxExamAttempts/,
    );
    expect(() => validateEducationSystemPolicy({ ...policy, maxExamAttempts: 3 })).not.toThrow();
  });
});

describe('deriveEducationLevel', () => {
  test('maps scores onto levels at the exact thresholds', () => {
    expect(deriveEducationLevel(0, policy)).toBe(0);
    expect(deriveEducationLevel(19.999, policy)).toBe(0);
    expect(deriveEducationLevel(20, policy)).toBe(1);
    expect(deriveEducationLevel(69.999, policy)).toBe(1);
    expect(deriveEducationLevel(70, policy)).toBe(2);
    expect(deriveEducationLevel(180, policy)).toBe(3);
    expect(deriveEducationLevel(320, policy)).toBe(4);
    expect(deriveEducationLevel(450, policy)).toBe(5);
    expect(deriveEducationLevel(10_000, policy)).toBe(5);
  });

  test('rejects negative or non-finite scores', () => {
    expect(() => deriveEducationLevel(-1, policy)).toThrow(/non-negative/);
    expect(() => deriveEducationLevel(Number.POSITIVE_INFINITY, policy)).toThrow(/non-negative/);
  });
});

describe('isCompulsoryLevel', () => {
  test('marks exactly the configured compulsory levels', () => {
    expect([0, 1, 2, 3, 4, 5].map((level) => isCompulsoryLevel(level as 0, policy))).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe('quoteStudyTuition', () => {
  test('splits a compulsory-level session between the treasury and the agent', () => {
    expect(
      quoteStudyTuition({ level: 1, durationSeconds: 3600, treasuryBalance: 1000, policy }),
    ).toEqual({ tuition: 20, treasuryCoveredCost: 20, selfPayCost: 0 });
    expect(
      quoteStudyTuition({ level: 2, durationSeconds: 1800, treasuryBalance: 5, policy }),
    ).toEqual({ tuition: 10, treasuryCoveredCost: 5, selfPayCost: 5 });
  });

  test('bills non-compulsory levels and treasury-free towns fully to the agent', () => {
    expect(
      quoteStudyTuition({ level: 4, durationSeconds: 1800, treasuryBalance: 1000, policy }),
    ).toEqual({ tuition: 15, treasuryCoveredCost: 0, selfPayCost: 15 });
    expect(
      quoteStudyTuition({ level: 1, durationSeconds: 3600, treasuryBalance: null, policy }),
    ).toEqual({ tuition: 20, treasuryCoveredCost: 0, selfPayCost: 20 });
  });

  test('returns undefined for unusable inputs', () => {
    expect(
      quoteStudyTuition({
        level: 1,
        durationSeconds: 3600,
        treasuryBalance: 1000,
        policy: { ...policy, levelTuitionPerHour: { 0: 20 } },
      }),
    ).toBeUndefined();
    expect(
      quoteStudyTuition({ level: 1, durationSeconds: -1, treasuryBalance: 1000, policy }),
    ).toBeUndefined();
    expect(
      quoteStudyTuition({ level: 1, durationSeconds: 3600, treasuryBalance: -5, policy }),
    ).toBeUndefined();
  });
});

describe('evaluateStudyCost', () => {
  test('fully covers a compulsory level from the treasury', () => {
    const decision = evaluateStudyCost({
      level: 1,
      durationSeconds: 3600,
      balance: 0,
      inventory: {},
      treasuryBalance: 1000,
      policy,
    });
    expect(decision).toEqual({
      status: 'accepted',
      selfPayCost: 0,
      treasuryCoveredCost: 20,
      consumedInventory: {},
    });
  });

  test('partially covers when the treasury is short; the agent pays the difference', () => {
    const decision = evaluateStudyCost({
      level: 2,
      durationSeconds: 3600,
      balance: 100,
      inventory: {},
      treasuryBalance: 5,
      policy,
    });
    expect(decision).toEqual({
      status: 'accepted',
      selfPayCost: 15,
      treasuryCoveredCost: 5,
      consumedInventory: {},
    });
  });

  test('falls back to full self-pay when the treasury feature is off (null)', () => {
    const decision = evaluateStudyCost({
      level: 1,
      durationSeconds: 1800,
      balance: 100,
      inventory: {},
      treasuryBalance: null,
      policy,
    });
    expect(decision).toEqual({
      status: 'accepted',
      selfPayCost: 10,
      treasuryCoveredCost: 0,
      consumedInventory: {},
    });
  });

  test('charges the full tuition for non-compulsory levels', () => {
    const decision = evaluateStudyCost({
      level: 4,
      durationSeconds: 3600,
      balance: 100,
      inventory: {},
      treasuryBalance: 1000,
      policy,
    });
    expect(decision).toEqual({
      status: 'accepted',
      selfPayCost: 30,
      treasuryCoveredCost: 0,
      consumedInventory: {},
    });
  });

  test('rejects when the self-pay share exceeds the balance', () => {
    const decision = evaluateStudyCost({
      level: 3,
      durationSeconds: 3600,
      balance: 10,
      inventory: {},
      treasuryBalance: 1000,
      policy,
    });
    expect(decision).toEqual({
      status: 'rejected',
      reason: 'insufficient-balance',
      detail: 'study tuition requires 25, available 10',
    });
    expect(
      evaluateStudyCost({
        level: 1,
        durationSeconds: 3600,
        balance: 5,
        inventory: {},
        treasuryBalance: 10,
        policy,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'insufficient-balance' });
  });

  test('rejects a level without a configured tuition and invalid inputs', () => {
    const noTuition: EducationSystemPolicy = {
      ...policy,
      levelTuitionPerHour: { 1: 20, 2: 20 },
    };
    expect(
      evaluateStudyCost({
        level: 5,
        durationSeconds: 3600,
        balance: 100,
        inventory: {},
        treasuryBalance: null,
        policy: noTuition,
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'policy-invalid',
      detail: 'education system policy defines no tuition for level 5',
    });
    expect(
      evaluateStudyCost({
        level: 1,
        durationSeconds: -1,
        balance: 100,
        inventory: {},
        treasuryBalance: null,
        policy,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'policy-invalid' });
    expect(
      evaluateStudyCost({
        level: 1,
        durationSeconds: 3600,
        balance: -5,
        inventory: {},
        treasuryBalance: null,
        policy,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'policy-invalid' });
    expect(
      evaluateStudyCost({
        level: 1,
        durationSeconds: 3600,
        balance: 100,
        inventory: {},
        treasuryBalance: -5,
        policy,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'policy-invalid' });
  });

  test('accepts a zero-duration session with zero cost', () => {
    expect(
      evaluateStudyCost({
        level: 2,
        durationSeconds: 0,
        balance: 0,
        inventory: {},
        treasuryBalance: 0,
        policy,
      }),
    ).toEqual({
      status: 'accepted',
      selfPayCost: 0,
      treasuryCoveredCost: 0,
      consumedInventory: {},
    });
  });
});

describe('applyStudyEfficiency', () => {
  test('keeps the full rate when unemployed and scales it when employed', () => {
    expect(applyStudyEfficiency({ educationRatePerSecond: 2, employed: false, policy })).toBe(2);
    expect(applyStudyEfficiency({ educationRatePerSecond: 2, employed: true, policy })).toBeCloseTo(
      0.6,
    );
    expect(() =>
      applyStudyEfficiency({ educationRatePerSecond: -1, employed: false, policy }),
    ).toThrow(/non-negative/);
  });
});

describe('evaluateAutomaticPromotion', () => {
  test('promotes automatically into compulsory levels once the threshold is met', () => {
    expect(evaluateAutomaticPromotion({ level: 0, score: 19, policy })).toBeNull();
    expect(evaluateAutomaticPromotion({ level: 0, score: 20, policy })).toBe(1);
    expect(evaluateAutomaticPromotion({ level: 1, score: 69, policy })).toBeNull();
    expect(evaluateAutomaticPromotion({ level: 1, score: 70, policy })).toBe(2);
  });

  test('never auto-promotes into exam-gated levels (中考/高考, later stage)', () => {
    expect(evaluateAutomaticPromotion({ level: 2, score: 1000, policy })).toBeNull();
    expect(evaluateAutomaticPromotion({ level: 3, score: 1000, policy })).toBeNull();
    expect(evaluateAutomaticPromotion({ level: 4, score: 1000, policy })).toBeNull();
    expect(evaluateAutomaticPromotion({ level: 5, score: 1000, policy })).toBeNull();
  });

  test('respects the configured compulsory window', () => {
    const widerWindow: EducationSystemPolicy = { ...policy, compulsoryLevels: [1, 2, 3] };
    expect(evaluateAutomaticPromotion({ level: 2, score: 180, policy: widerWindow })).toBe(3);
    expect(evaluateAutomaticPromotion({ level: 3, score: 320, policy: widerWindow })).toBeNull();
  });
});

describe('describeEducationStage', () => {
  test('labels every level in Chinese and splits the high-school track', () => {
    expect(describeEducationStage({ level: 0 })).toBe('未受教育');
    expect(describeEducationStage({ level: 1 })).toBe('小学(义务教育)');
    expect(describeEducationStage({ level: 2 })).toBe('初中(义务教育)');
    expect(describeEducationStage({ level: 3 })).toBe('高中(普高)');
    expect(describeEducationStage({ level: 3, track: 'vocational' })).toBe('高中(中职)');
    expect(describeEducationStage({ level: 4 })).toBe('大学');
    expect(describeEducationStage({ level: 5 })).toBe('研究生');
  });
});

describe('evaluateEffectiveEducationScoreForOccupation', () => {
  const v3Policy: EducationSystemPolicy = {
    ...policy,
    policyVersion: 'education-system-v3',
    vocationalTrackJobTierBonus: { 2: 20, 3: 10 },
  };

  test('adds the tier bonus for vocational-track level-3 applicants (中职)', () => {
    expect(
      evaluateEffectiveEducationScoreForOccupation({
        score: 200,
        level: 3,
        track: 'vocational',
        occupationTier: 2,
        policy: v3Policy,
      }),
    ).toBe(220);
    expect(
      evaluateEffectiveEducationScoreForOccupation({
        score: 200,
        level: 3,
        track: 'vocational',
        occupationTier: 3,
        policy: v3Policy,
      }),
    ).toBe(210);
  });

  test('keeps the raw score for tiers without a configured bonus', () => {
    expect(
      evaluateEffectiveEducationScoreForOccupation({
        score: 200,
        level: 3,
        track: 'vocational',
        occupationTier: 1,
        policy: v3Policy,
      }),
    ).toBe(200);
    expect(
      evaluateEffectiveEducationScoreForOccupation({
        score: 200,
        level: 3,
        track: 'vocational',
        occupationTier: 4,
        policy: v3Policy,
      }),
    ).toBe(200);
  });

  test('never bonuses the academic track or non-vocational levels', () => {
    expect(
      evaluateEffectiveEducationScoreForOccupation({
        score: 200,
        level: 3,
        track: 'academic',
        occupationTier: 2,
        policy: v3Policy,
      }),
    ).toBe(200);
    // Absent track defaults to academic.
    expect(
      evaluateEffectiveEducationScoreForOccupation({
        score: 200,
        level: 3,
        occupationTier: 2,
        policy: v3Policy,
      }),
    ).toBe(200);
    expect(
      evaluateEffectiveEducationScoreForOccupation({
        score: 400,
        level: 4,
        track: 'vocational',
        occupationTier: 2,
        policy: v3Policy,
      }),
    ).toBe(400);
    expect(
      evaluateEffectiveEducationScoreForOccupation({
        score: 100,
        level: 2,
        track: 'vocational',
        occupationTier: 2,
        policy: v3Policy,
      }),
    ).toBe(100);
  });

  test('keeps the raw score when the policy is disabled or has no bonus table', () => {
    expect(
      evaluateEffectiveEducationScoreForOccupation({
        score: 200,
        level: 3,
        track: 'vocational',
        occupationTier: 2,
        policy: { ...v3Policy, enabled: false },
      }),
    ).toBe(200);
    // education-system-v2 policies carry no bonus table: no bonus.
    expect(
      evaluateEffectiveEducationScoreForOccupation({
        score: 200,
        level: 3,
        track: 'vocational',
        occupationTier: 2,
        policy,
      }),
    ).toBe(200);
  });

  test('rejects a negative or non-finite score', () => {
    expect(() =>
      evaluateEffectiveEducationScoreForOccupation({
        score: -1,
        level: 3,
        track: 'vocational',
        occupationTier: 2,
        policy: v3Policy,
      }),
    ).toThrow(/non-negative/);
  });

  test('validation rejects malformed bonus tables', () => {
    expect(() =>
      validateEducationSystemPolicy({
        ...v3Policy,
        vocationalTrackJobTierBonus: { 2: -5 },
      }),
    ).toThrow(/non-negative/);
    expect(() =>
      validateEducationSystemPolicy({
        ...v3Policy,
        vocationalTrackJobTierBonus: { 2: Number.NaN },
      }),
    ).toThrow(/non-negative/);
    expect(() =>
      validateEducationSystemPolicy({
        ...v3Policy,
        vocationalTrackJobTierBonus: { skilled: 10 },
      }),
    ).toThrow(/positive integer/);
    expect(() => validateEducationSystemPolicy(v3Policy)).not.toThrow();
  });
});
