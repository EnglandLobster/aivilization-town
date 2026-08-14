import { describe, expect, test } from 'vitest';
import {
  evaluateEducationExamCycle,
  evaluateEducationExamEligibility,
  type EducationExamApplication,
} from './educationExam';
import type { EducationSystemPolicy } from './educationSystem';

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

function application(input: {
  readonly applicationId: string;
  readonly agentId: string;
  readonly targetLevel: 3 | 4 | 5;
  readonly educationScore: number;
}): EducationExamApplication {
  return { ...input, submittedAt: 0 };
}

describe('evaluateEducationExamEligibility', () => {
  const eligibleAgent = {
    educationLevel: 2 as const,
    educationScore: 180,
    examAttempts: 0,
  };

  test('accepts an eligible 中考 application', () => {
    expect(
      evaluateEducationExamEligibility({ agent: eligibleAgent, targetLevel: 3, policy }),
    ).toEqual({ status: 'accepted', targetLevel: 3 });
  });

  test('rejects a disabled policy', () => {
    const decision = evaluateEducationExamEligibility({
      agent: eligibleAgent,
      targetLevel: 3,
      policy: { ...policy, enabled: false },
    });
    expect(decision).toMatchObject({ status: 'rejected', reason: 'policy-disabled' });
  });

  test('rejects non-exam-gated or out-of-range target levels', () => {
    for (const targetLevel of [0, 1, 2, 6, 3.5]) {
      const decision = evaluateEducationExamEligibility({
        agent: eligibleAgent,
        targetLevel,
        policy,
      });
      expect(decision).toMatchObject({ status: 'rejected', reason: 'unsupported-target-level' });
    }
  });

  test('rejects when the current level is not exactly one below the target', () => {
    expect(
      evaluateEducationExamEligibility({ agent: eligibleAgent, targetLevel: 4, policy }),
    ).toMatchObject({ status: 'rejected', reason: 'level-mismatch' });
    expect(
      evaluateEducationExamEligibility({
        agent: { ...eligibleAgent, educationLevel: 1 },
        targetLevel: 3,
        policy,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'level-mismatch' });
    // Skipping a level is not allowed even with a far-above-threshold score.
    expect(
      evaluateEducationExamEligibility({
        agent: { ...eligibleAgent, educationLevel: 2, educationScore: 500 },
        targetLevel: 4,
        policy,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'level-mismatch' });
  });

  test('rejects a score below the target entry threshold', () => {
    expect(
      evaluateEducationExamEligibility({
        agent: { ...eligibleAgent, educationScore: 179.999 },
        targetLevel: 3,
        policy,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'score-below-threshold' });
    // Boundary: exactly the threshold passes.
    expect(
      evaluateEducationExamEligibility({
        agent: { ...eligibleAgent, educationScore: 180 },
        targetLevel: 3,
        policy,
      }).status,
    ).toBe('accepted');
  });

  test('rejects a vocational-track (中职) agent applying for university (高考)', () => {
    const vocationalAgent = {
      educationLevel: 3 as const,
      educationTrack: 'vocational' as const,
      educationScore: 320,
      examAttempts: 0,
    };
    expect(
      evaluateEducationExamEligibility({ agent: vocationalAgent, targetLevel: 4, policy }),
    ).toMatchObject({ status: 'rejected', reason: 'track-ineligible' });
    // The academic track (and an absent legacy track, defaulting to academic) passes.
    expect(
      evaluateEducationExamEligibility({
        agent: { ...vocationalAgent, educationTrack: 'academic' as const },
        targetLevel: 4,
        policy,
      }).status,
    ).toBe('accepted');
    expect(
      evaluateEducationExamEligibility({
        agent: { educationLevel: 3 as const, educationScore: 320, examAttempts: 0 },
        targetLevel: 4,
        policy,
      }).status,
    ).toBe('accepted');
    // The track constraint does not apply to 中考/考研.
    expect(
      evaluateEducationExamEligibility({
        agent: {
          educationLevel: 4 as const,
          educationTrack: 'academic' as const,
          educationScore: 450,
          examAttempts: 0,
        },
        targetLevel: 5,
        policy,
      }).status,
    ).toBe('accepted');
  });

  test('rejects when the attempt cap is reached and allows retakes without a cap', () => {
    const cappedPolicy: EducationSystemPolicy = { ...policy, maxExamAttempts: 2 };
    expect(
      evaluateEducationExamEligibility({
        agent: { ...eligibleAgent, examAttempts: 2 },
        targetLevel: 3,
        policy: cappedPolicy,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'attempts-exhausted' });
    expect(
      evaluateEducationExamEligibility({
        agent: { ...eligibleAgent, examAttempts: 1 },
        targetLevel: 3,
        policy: cappedPolicy,
      }).status,
    ).toBe('accepted');
    // No cap: unlimited retakes.
    expect(
      evaluateEducationExamEligibility({
        agent: { ...eligibleAgent, examAttempts: 99 },
        targetLevel: 3,
        policy,
      }).status,
    ).toBe('accepted');
  });
});

describe('evaluateEducationExamCycle', () => {
  test('admits the top ceil(count × quota) candidates per level and reports cutoffs', () => {
    const applications = [
      application({ applicationId: 'a1', agentId: 'agent-1', targetLevel: 3, educationScore: 300 }),
      application({ applicationId: 'a2', agentId: 'agent-2', targetLevel: 3, educationScore: 250 }),
      application({ applicationId: 'a3', agentId: 'agent-3', targetLevel: 3, educationScore: 200 }),
      application({ applicationId: 'a4', agentId: 'agent-4', targetLevel: 3, educationScore: 190 }),
      // 高考 group: 4 applicants × 0.25 → 1 admitted.
      application({ applicationId: 'b1', agentId: 'agent-5', targetLevel: 4, educationScore: 400 }),
      application({ applicationId: 'b2', agentId: 'agent-6', targetLevel: 4, educationScore: 380 }),
      application({ applicationId: 'b3', agentId: 'agent-7', targetLevel: 4, educationScore: 360 }),
      application({ applicationId: 'b4', agentId: 'agent-8', targetLevel: 4, educationScore: 330 }),
    ];

    const decision = evaluateEducationExamCycle({ applications, cycleNumber: 0, policy });

    // 中考 group: 4 × 0.5 → 2 admitted, cutoff 250.
    const byId = new Map(
      decision.resolutions.map((resolution) => [resolution.applicationId, resolution]),
    );
    expect(byId.get('a1')).toMatchObject({
      status: 'admitted',
      reason: 'quota-admitted',
      cutoffScore: 250,
    });
    expect(byId.get('a2')).toMatchObject({ status: 'admitted', cutoffScore: 250 });
    expect(byId.get('a3')).toMatchObject({
      status: 'rejected',
      reason: 'below-cutoff',
      cutoffScore: 250,
    });
    expect(byId.get('a4')).toMatchObject({ status: 'rejected', cutoffScore: 250 });
    expect(byId.get('b1')).toMatchObject({ status: 'admitted', cutoffScore: 400 });
    expect(byId.get('b2')).toMatchObject({ status: 'rejected', cutoffScore: 400 });

    expect(decision.summaries).toEqual([
      { targetLevel: 3, applicationCount: 4, admittedCount: 2, cutoffScore: 250 },
      { targetLevel: 4, applicationCount: 4, admittedCount: 1, cutoffScore: 400 },
    ]);
  });

  test('rounds odd applicant counts up (ceil) and breaks score ties by agentId', () => {
    const applications = [
      application({ applicationId: 'a1', agentId: 'agent-b', targetLevel: 3, educationScore: 200 }),
      application({ applicationId: 'a2', agentId: 'agent-a', targetLevel: 3, educationScore: 200 }),
      application({ applicationId: 'a3', agentId: 'agent-c', targetLevel: 3, educationScore: 180 }),
    ];

    const decision = evaluateEducationExamCycle({ applications, cycleNumber: 1, policy });

    // ceil(3 × 0.5) = 2 admitted; the equal-score tie goes to agent-a (字典序).
    const byAgent = new Map(
      decision.resolutions.map((resolution) => [resolution.agentId, resolution]),
    );
    expect(byAgent.get('agent-a')).toMatchObject({ status: 'admitted', cutoffScore: 200 });
    expect(byAgent.get('agent-b')).toMatchObject({ status: 'admitted', cutoffScore: 200 });
    expect(byAgent.get('agent-c')).toMatchObject({ status: 'rejected' });
    expect(decision.summaries[0]).toMatchObject({ admittedCount: 2, cutoffScore: 200 });

    // Re-running with the inputs in a different order reproduces the identical
    // decision (deterministic ranking independent of submission order).
    const reshuffled = evaluateEducationExamCycle({
      applications: [...applications].reverse(),
      cycleNumber: 1,
      policy,
    });
    expect(reshuffled).toEqual(decision);
  });

  test('handles empty and single-application groups', () => {
    const empty = evaluateEducationExamCycle({ applications: [], cycleNumber: 0, policy });
    expect(empty.resolutions).toEqual([]);
    expect(empty.summaries).toEqual([]);

    // A sole applicant is admitted at any positive quota (ceil(1 × 0.5) = 1)
    // and forms their own cutoff.
    const single = evaluateEducationExamCycle({
      applications: [
        application({
          applicationId: 'a1',
          agentId: 'agent-1',
          targetLevel: 5,
          educationScore: 460,
        }),
      ],
      cycleNumber: 0,
      policy,
    });
    expect(single.resolutions).toEqual([
      {
        applicationId: 'a1',
        agentId: 'agent-1',
        targetLevel: 5,
        status: 'admitted',
        cutoffScore: 460,
        reason: 'quota-admitted',
      },
    ]);
    expect(single.summaries).toEqual([
      { targetLevel: 5, applicationCount: 1, admittedCount: 1, cutoffScore: 460 },
    ]);

    // A level without a configured quota admits nobody and carries no cutoff.
    const noQuota = evaluateEducationExamCycle({
      applications: [
        application({
          applicationId: 'a1',
          agentId: 'agent-1',
          targetLevel: 3,
          educationScore: 200,
        }),
      ],
      cycleNumber: 0,
      policy: { ...policy, admissionQuotaByLevel: {} },
    });
    expect(noQuota.resolutions[0]).toMatchObject({ status: 'rejected', reason: 'below-cutoff' });
    expect(noQuota.resolutions[0]?.cutoffScore).toBeUndefined();
    expect(noQuota.summaries).toEqual([{ targetLevel: 3, applicationCount: 1, admittedCount: 0 }]);
  });

  test('splits 中考 admittees into academic/vocational tracks by score with a fixed rounding direction', () => {
    const applications = [
      application({ applicationId: 'a1', agentId: 'agent-1', targetLevel: 3, educationScore: 300 }),
      application({ applicationId: 'a2', agentId: 'agent-2', targetLevel: 3, educationScore: 280 }),
      application({ applicationId: 'a3', agentId: 'agent-3', targetLevel: 3, educationScore: 260 }),
      application({ applicationId: 'a4', agentId: 'agent-4', targetLevel: 3, educationScore: 240 }),
      application({ applicationId: 'a5', agentId: 'agent-5', targetLevel: 3, educationScore: 220 }),
    ];
    // 5 applicants × 0.5 → 3 admitted; round(3 × (1 − 0.5)) = 2 academic, 1 vocational.
    const decision = evaluateEducationExamCycle({ applications, cycleNumber: 0, policy });
    const trackByAgent = new Map(
      decision.resolutions.map((resolution) => [resolution.agentId, resolution]),
    );
    expect(trackByAgent.get('agent-1')).toMatchObject({ status: 'admitted', track: 'academic' });
    expect(trackByAgent.get('agent-2')).toMatchObject({ status: 'admitted', track: 'academic' });
    expect(trackByAgent.get('agent-3')).toMatchObject({ status: 'admitted', track: 'vocational' });
    expect(trackByAgent.get('agent-4')).toMatchObject({ status: 'rejected' });
    expect(trackByAgent.get('agent-5')).toMatchObject({ status: 'rejected' });

    // Even admitted counts split exactly at the share boundary.
    const even = evaluateEducationExamCycle({
      applications: applications.slice(0, 4),
      cycleNumber: 0,
      policy,
    });
    // 2 admitted; round(2 × 0.5) = 1 academic, 1 vocational.
    const evenByAgent = new Map(
      even.resolutions.map((resolution) => [resolution.agentId, resolution]),
    );
    expect(evenByAgent.get('agent-1')).toMatchObject({ track: 'academic' });
    expect(evenByAgent.get('agent-2')).toMatchObject({ track: 'vocational' });

    // Track assignments carry only on 中考 admissions, never on rejections or
    // higher-level exams.
    const university = evaluateEducationExamCycle({
      applications: [
        application({
          applicationId: 'b1',
          agentId: 'agent-9',
          targetLevel: 4,
          educationScore: 400,
        }),
      ],
      cycleNumber: 0,
      policy,
    });
    expect(university.resolutions[0]?.track).toBeUndefined();
  });

  test('rejects invalid cycles and duplicate applications', () => {
    expect(() => evaluateEducationExamCycle({ applications: [], cycleNumber: -1, policy })).toThrow(
      /cycleNumber/,
    );
    expect(() =>
      evaluateEducationExamCycle({
        applications: [
          application({
            applicationId: 'a1',
            agentId: 'agent-1',
            targetLevel: 3,
            educationScore: 200,
          }),
          application({
            applicationId: 'a1',
            agentId: 'agent-2',
            targetLevel: 3,
            educationScore: 210,
          }),
        ],
        cycleNumber: 0,
        policy,
      }),
    ).toThrow(/duplicate education exam application id/);
    expect(() =>
      evaluateEducationExamCycle({
        applications: [
          application({
            applicationId: 'a1',
            agentId: 'agent-1',
            targetLevel: 3,
            educationScore: 200,
          }),
          application({
            applicationId: 'a2',
            agentId: 'agent-1',
            targetLevel: 3,
            educationScore: 210,
          }),
        ],
        cycleNumber: 0,
        policy,
      }),
    ).toThrow(/duplicate education exam application for/);
  });
});
