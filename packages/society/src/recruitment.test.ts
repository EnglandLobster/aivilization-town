import { describe, expect, test } from 'vitest';
import {
  calculateCompletedRecruitmentCycleNumbers,
  calculateRecruitmentCycleNumber,
  resolveRecruitmentCycle,
  type RecruitmentApplication,
  type RecruitmentCyclePolicy,
} from './index';

const policy: RecruitmentCyclePolicy = {
  policyVersion: 'recruitment-cycle-test',
  cycleDurationMs: 100,
  defaultOccupationCapacity: 1,
  occupationCapacityOverrides: {},
};

describe('recruitment cycles', () => {
  test('maps simulation time to cycles and reports every crossed cycle boundary', () => {
    expect(calculateRecruitmentCycleNumber({ simulationTime: 0, cycleDurationMs: 100 })).toBe(0);
    expect(calculateRecruitmentCycleNumber({ simulationTime: 100, cycleDurationMs: 100 })).toBe(1);
    expect(
      calculateCompletedRecruitmentCycleNumbers({
        previousSimulationTime: 50,
        nextSimulationTime: 310,
        cycleDurationMs: 100,
      }),
    ).toEqual([0, 1, 2]);
    expect(
      calculateCompletedRecruitmentCycleNumbers({
        previousSimulationTime: 100,
        nextSimulationTime: 199,
        cycleDurationMs: 100,
      }),
    ).toEqual([]);
  });

  test('selects the strongest candidate within occupation capacity', () => {
    const decision = resolveRecruitmentCycle({
      policy,
      applications: [
        application({ applicationId: 'lower', agentId: 'agent-lower', educationScore: 100 }),
        application({ applicationId: 'higher', agentId: 'agent-higher', educationScore: 200 }),
      ],
    });

    expect(decision.acceptedApplications.map((entry) => entry.applicationId)).toEqual(['higher']);
    expect(decision.resolutions).toEqual([
      {
        applicationId: 'higher',
        agentId: 'agent-higher',
        occupationName: 'Doctor',
        status: 'accepted',
        reason: 'competitive-match',
      },
      {
        applicationId: 'lower',
        agentId: 'agent-lower',
        occupationName: 'Doctor',
        status: 'rejected',
        reason: 'capacity-exhausted',
      },
    ]);
  });

  test('moves a displaced applicant to their next preference and assigns at most one job', () => {
    const decision = resolveRecruitmentCycle({
      policy,
      applications: [
        application({
          applicationId: 'agent-a-doctor',
          agentId: 'agent-a',
          occupationName: 'Doctor',
          educationScore: 200,
          submittedAt: 1,
        }),
        application({
          applicationId: 'agent-a-teacher',
          agentId: 'agent-a',
          occupationName: 'Teacher',
          educationScore: 200,
          submittedAt: 2,
        }),
        application({
          applicationId: 'agent-b-doctor',
          agentId: 'agent-b',
          occupationName: 'Doctor',
          educationScore: 300,
          submittedAt: 3,
        }),
      ],
    });

    expect(decision.acceptedApplications.map((entry) => entry.applicationId)).toEqual([
      'agent-b-doctor',
      'agent-a-teacher',
    ]);
    expect(decision.resolutions).toContainEqual({
      applicationId: 'agent-a-doctor',
      agentId: 'agent-a',
      occupationName: 'Doctor',
      status: 'rejected',
      reason: 'agent-matched-elsewhere',
    });
  });

  test('honors zero and overridden occupation capacities', () => {
    const decision = resolveRecruitmentCycle({
      policy: {
        ...policy,
        defaultOccupationCapacity: 0,
        occupationCapacityOverrides: { Doctor: 2 },
      },
      applications: [
        application({ applicationId: 'doctor-a', agentId: 'agent-a' }),
        application({ applicationId: 'doctor-b', agentId: 'agent-b' }),
        application({
          applicationId: 'teacher',
          agentId: 'agent-c',
          occupationName: 'Teacher',
        }),
      ],
    });

    expect(decision.acceptedApplications.map((entry) => entry.applicationId)).toEqual([
      'doctor-a',
      'doctor-b',
    ]);
    expect(decision.resolutions).toContainEqual({
      applicationId: 'teacher',
      agentId: 'agent-c',
      occupationName: 'Teacher',
      status: 'rejected',
      reason: 'capacity-exhausted',
    });
  });

  test('rejects duplicate agent-occupation applications and invalid policies', () => {
    expect(() =>
      resolveRecruitmentCycle({
        policy,
        applications: [
          application({ applicationId: 'one', agentId: 'agent-a' }),
          application({ applicationId: 'two', agentId: 'agent-a' }),
        ],
      }),
    ).toThrow(/duplicate recruitment application/);
    expect(() =>
      resolveRecruitmentCycle({
        policy: { ...policy, defaultOccupationCapacity: -1 },
        applications: [],
      }),
    ).toThrow(/defaultOccupationCapacity/);
  });
});

function application(
  overrides: Partial<RecruitmentApplication> &
    Pick<RecruitmentApplication, 'applicationId' | 'agentId'>,
): RecruitmentApplication {
  return {
    occupationName: 'Doctor',
    educationScore: 100,
    residentialTier: 5,
    submittedAt: 0,
    ...overrides,
  };
}
