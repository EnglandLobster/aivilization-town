import {
  asAgentId,
  asEventId,
  createCommandEnvelope,
  createEventEnvelope,
  replayEvents,
} from '@aivilization/sim-core';
import type { EducationSystemPolicy, EducationTrack } from '@aivilization/society';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from './index';

const educationSystem: EducationSystemPolicy = {
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

function createAgent(input: {
  readonly agentId: string;
  readonly educationScore?: number;
  readonly educationLevel?: 0 | 1 | 2 | 3 | 4 | 5;
  readonly educationTrack?: EducationTrack;
  readonly examAttempts?: number;
}) {
  return {
    agentId: asAgentId(input.agentId),
    locationId: null,
    physiology: { energy: 100, satiety: 100, health: 100 },
    educationScore: input.educationScore ?? 0,
    balance: 1000,
    residentialTier: 1,
    job: null,
    inventory: {},
    ...(input.educationLevel === undefined ? {} : { educationLevel: input.educationLevel }),
    ...(input.educationTrack === undefined ? {} : { educationTrack: input.educationTrack }),
    ...(input.examAttempts === undefined ? {} : { examAttempts: input.examAttempts }),
  };
}

function createPolicies(overrides: Partial<WorldCommandPolicies> = {}): WorldCommandPolicies {
  return {
    satietyRecoveryByCommodity: {},
    maxSatiety: 100,
    wageCalculator: () => 0,
    laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
    criticalThresholds: { energy: 0, health: 0 },
    ...overrides,
  };
}

function applyExamCommand(agentId: string, targetLevel: number, key: string, issuedAt = 0) {
  return createCommandEnvelope({
    id: `command-apply-exam-${key}`,
    simulationId: 'sim-education-exam',
    actorId: agentId,
    type: 'AgentApplyEducationExam',
    payload: { targetLevel },
    issuedAt,
  });
}

function advanceCommand(key: string, issuedAt: number, deltaMs = 86_400_000) {
  return createCommandEnvelope({
    id: `command-advance-${key}`,
    simulationId: 'sim-education-exam',
    source: 'system',
    type: 'AdvanceSimulationTime',
    payload: { deltaMs },
    issuedAt,
  });
}

function dispatch(
  projection: WorldProjection,
  policies: WorldCommandPolicies,
  command: Parameters<typeof dispatchWorldCommand>[0]['command'],
  nextSequence: number,
): { readonly events: readonly WorldEvent[]; readonly projection: WorldProjection } {
  const events = dispatchWorldCommand({ command, projection, policies, nextSequence });
  return { events, projection: events.reduce(applyWorldEvent, projection) };
}

describe('education-exam application after departure', () => {
  test('a cross-partition departure cancels the pending application and never crashes the cycle', () => {
    const projection = createWorldProjection({
      agents: [createAgent({ agentId: 'agent-1', educationScore: 200, educationLevel: 2 })],
      moneySupply: 1000,
    });

    // Park the application for cycle 0.
    const submitted = dispatch(
      projection,
      createPolicies({ educationSystem }),
      applyExamCommand('agent-1', 3, 'park'),
      1,
    );
    expect(
      submitted.projection.educationExamApplications.filter(
        (application) => application.status === 'pending',
      ),
    ).toHaveLength(1);

    // The authority hands ownership to another partition: the departure event
    // lands on the source projection BEFORE the exam cycle settles here.
    const departed = applyWorldEvent(
      submitted.projection,
      createEventEnvelope({
        id: asEventId('event-departure-1'),
        simulationId: 'sim-education-exam',
        commandId: 'command-transfer-1',
        type: 'AgentOwnershipDeparted',
        payload: {
          agentId: asAgentId('agent-1'),
          toPartitionKey: 'partition-b',
          transferOperationId: 'transfer-1',
        },
        occurredAt: 0,
        sequence: 50,
      }),
    );
    // The pending application died with the departure; resolved history would stay.
    expect(departed.educationExamApplications).toEqual([]);

    // Crossing the exam cycle boundary must settle cleanly — no resolution and
    // no memory event for the departed agent (this used to throw
    // 'unknown agent' and fail the whole AdvanceSimulationTime).
    const settlement = dispatchWorldCommand({
      command: advanceCommand('cycle-after-departure', 0),
      projection: departed,
      policies: createPolicies({ educationSystem }),
      nextSequence: 100,
    });
    expect(
      settlement.filter((event) => event.type === 'EducationExamResolved'),
    ).toEqual([]);
    expect(
      settlement.filter(
        (event) => event.type === 'ShortTermMemoryRecorded' && event.payload.record.agentId === 'agent-1',
      ),
    ).toEqual([]);
  });
});

describe('education-exam application', () => {
  test('parks an eligible application for the current exam cycle', () => {
    const projection = createWorldProjection({
      agents: [createAgent({ agentId: 'agent-1', educationScore: 200, educationLevel: 2 })],
      moneySupply: 1000,
    });

    const { events, projection: updated } = dispatch(
      projection,
      createPolicies({ educationSystem }),
      applyExamCommand('agent-1', 3, 'a'),
      1,
    );

    expect(events.map((event) => event.type)).toEqual([
      'EducationExamApplicationSubmitted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]).toMatchObject({
      payload: {
        applicationId: 'command-apply-exam-a:application',
        cycleNumber: 0,
        agentId: 'agent-1',
        targetLevel: 3,
        educationScore: 200,
      },
    });
    expect(updated.educationExamApplications).toEqual([
      expect.objectContaining({
        applicationId: 'command-apply-exam-a:application',
        cycleNumber: 0,
        targetLevel: 3,
        status: 'pending',
      }),
    ]);
  });

  test('rejects ineligible applications with the domain reason', () => {
    const projection = createWorldProjection({
      agents: [
        // Score below the 中考 threshold (180).
        createAgent({ agentId: 'agent-1', educationScore: 100, educationLevel: 2 }),
        // Level mismatch: level 1 cannot take the 中考.
        createAgent({ agentId: 'agent-2', educationScore: 200, educationLevel: 1 }),
        // Vocational track (中职) cannot take the 高考.
        createAgent({
          agentId: 'agent-3',
          educationScore: 320,
          educationLevel: 3,
          educationTrack: 'vocational',
        }),
      ],
      moneySupply: 3000,
    });
    const policies = createPolicies({ educationSystem });

    const rejectedLowScore = dispatchWorldCommand({
      command: applyExamCommand('agent-1', 3, 'low-score'),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(rejectedLowScore[0]).toMatchObject({
      type: 'ActionRejected',
      payload: { commandType: 'AgentApplyEducationExam' },
    });
    expect(rejectedLowScore[0]?.payload).toMatchObject({
      reason: 'score-below-threshold: exam into level 3 requires score 180, got 100',
    });

    const rejectedLevel = dispatchWorldCommand({
      command: applyExamCommand('agent-2', 3, 'level'),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(rejectedLevel[0]?.payload).toMatchObject({
      reason: 'level-mismatch: exam into level 3 requires current level 2, got 1',
    });

    const rejectedTrack = dispatchWorldCommand({
      command: applyExamCommand('agent-3', 4, 'track'),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(rejectedTrack[0]?.payload).toMatchObject({
      reason:
        'track-ineligible: the university entrance exam (高考) requires the academic track; vocational-track (中职) agents cannot apply',
    });
  });

  test('rejects when the attempt cap is reached', () => {
    const capped: EducationSystemPolicy = { ...educationSystem, maxExamAttempts: 2 };
    const projection = createWorldProjection({
      agents: [
        createAgent({
          agentId: 'agent-1',
          educationScore: 200,
          educationLevel: 2,
          examAttempts: 2,
        }),
      ],
      moneySupply: 1000,
    });

    const events = dispatchWorldCommand({
      command: applyExamCommand('agent-1', 3, 'capped'),
      projection,
      policies: createPolicies({ educationSystem: capped }),
      nextSequence: 1,
    });
    expect(events[0]).toMatchObject({ type: 'ActionRejected' });
    expect(events[0]?.payload).toMatchObject({
      reason: 'attempts-exhausted: exam attempt cap 2 reached (2 attempts)',
    });
  });

  test('rejects a duplicate application inside the same cycle', () => {
    let projection = createWorldProjection({
      agents: [createAgent({ agentId: 'agent-1', educationScore: 200, educationLevel: 2 })],
      moneySupply: 1000,
    });
    const policies = createPolicies({ educationSystem });

    const first = dispatch(projection, policies, applyExamCommand('agent-1', 3, 'first'), 1);
    projection = first.projection;
    const duplicate = dispatchWorldCommand({
      command: applyExamCommand('agent-1', 3, 'duplicate'),
      projection,
      policies,
      nextSequence: first.events.length + 1,
    });
    expect(duplicate[0]).toMatchObject({ type: 'ActionRejected' });
    expect(duplicate[0]?.payload).toMatchObject({
      reason: 'duplicate education exam application in exam cycle 0',
    });
  });

  test('rejects the command when the policy is missing or disabled', () => {
    const projection = createWorldProjection({
      agents: [createAgent({ agentId: 'agent-1', educationScore: 200, educationLevel: 2 })],
      moneySupply: 1000,
    });

    const missing = dispatchWorldCommand({
      command: applyExamCommand('agent-1', 3, 'missing'),
      projection,
      policies: createPolicies(),
      nextSequence: 1,
    });
    expect(missing[0]?.payload).toMatchObject({
      reason: 'missing education system policy',
    });

    const disabled = dispatchWorldCommand({
      command: applyExamCommand('agent-1', 3, 'disabled'),
      projection,
      policies: createPolicies({ educationSystem: { ...educationSystem, enabled: false } }),
      nextSequence: 1,
    });
    expect(disabled[0]?.payload).toMatchObject({
      reason: 'education system policy is disabled',
    });
  });
});

describe('education-exam cycle release (放榜)', () => {
  test('admits the quantile cutoff, assigns 中考 tracks, and counts failed attempts', () => {
    let projection = createWorldProjection({
      agents: [
        createAgent({ agentId: 'agent-1', educationScore: 300, educationLevel: 2 }),
        createAgent({ agentId: 'agent-2', educationScore: 250, educationLevel: 2 }),
        createAgent({ agentId: 'agent-3', educationScore: 200, educationLevel: 2 }),
        createAgent({ agentId: 'agent-4', educationScore: 190, educationLevel: 2 }),
      ],
      moneySupply: 4000,
    });
    const policies = createPolicies({ educationSystem });

    let nextSequence = 1;
    for (const [index, agentId] of ['agent-1', 'agent-2', 'agent-3', 'agent-4'].entries()) {
      const applied = dispatch(
        projection,
        policies,
        applyExamCommand(agentId, 3, `apply-${index}`),
        nextSequence,
      );
      projection = applied.projection;
      nextSequence += applied.events.length;
    }

    const released = dispatch(
      projection,
      policies,
      advanceCommand('cycle-0', 86_400_000),
      nextSequence,
    );
    const resolutions = released.events.filter((event) => event.type === 'EducationExamResolved');
    expect(resolutions).toHaveLength(4);
    const resolutionByAgent = new Map(
      resolutions.map((event) => [event.payload.agentId, event.payload]),
    );
    // 4 applicants × quota 0.5 → 2 admitted, cutoff 250.
    expect(resolutionByAgent.get(asAgentId('agent-1'))).toMatchObject({
      status: 'admitted',
      track: 'academic',
      cutoffScore: 250,
      reason: 'quota-admitted',
    });
    expect(resolutionByAgent.get(asAgentId('agent-2'))).toMatchObject({
      status: 'admitted',
      track: 'vocational',
      cutoffScore: 250,
    });
    expect(resolutionByAgent.get(asAgentId('agent-3'))).toMatchObject({
      status: 'rejected',
      reason: 'below-cutoff',
    });
    expect(resolutionByAgent.get(asAgentId('agent-4'))).toMatchObject({ status: 'rejected' });

    const promotions = released.events.filter((event) => event.type === 'EducationLevelChanged');
    expect(promotions.map((event) => event.payload)).toEqual([
      expect.objectContaining({
        agentId: 'agent-1',
        previousLevel: 2,
        nextLevel: 3,
        track: 'academic',
      }),
      expect.objectContaining({
        agentId: 'agent-2',
        previousLevel: 2,
        nextLevel: 3,
        track: 'vocational',
      }),
    ]);

    const completed = released.events.find((event) => event.type === 'EducationExamCycleCompleted');
    expect(completed).toMatchObject({
      payload: {
        cycleNumber: 0,
        cycleStartedAt: 0,
        cycleEndedAt: 86_400_000,
        policyVersion: 'education-system-v2',
        applicationCount: 4,
        admittedCount: 2,
        rejectedCount: 2,
        applicationsByLevel: { 3: 4 },
        admittedByLevel: { 3: 2 },
        cutoffScoresByLevel: { 3: 250 },
      },
    });

    const updated = released.projection;
    expect(updated.agents['agent-1']).toMatchObject({
      educationLevel: 3,
      educationTrack: 'academic',
    });
    expect(updated.agents['agent-2']).toMatchObject({
      educationLevel: 3,
      educationTrack: 'vocational',
    });
    // Rejections bump examAttempts exactly once (reducer duty, not the handler's).
    expect(updated.agents['agent-3']?.examAttempts).toBe(1);
    expect(updated.agents['agent-4']?.examAttempts).toBe(1);
    expect(updated.agents['agent-1']?.examAttempts).toBeUndefined();
    expect(updated.educationExamApplications.map((application) => application.status)).toEqual([
      'admitted',
      'admitted',
      'rejected',
      'rejected',
    ]);
    expect(updated.educationExamCycles).toEqual([
      expect.objectContaining({ cycleNumber: 0, admittedCount: 2, rejectedCount: 2 }),
    ]);
  });

  test('settles multiple cycles: rejected agents retry in the next cycle', () => {
    let projection = createWorldProjection({
      agents: [
        createAgent({ agentId: 'agent-1', educationScore: 250, educationLevel: 2 }),
        createAgent({ agentId: 'agent-2', educationScore: 200, educationLevel: 2 }),
      ],
      moneySupply: 2000,
    });
    const policies = createPolicies({ educationSystem });

    // Cycle 0: both apply; only agent-1 clears the ceil(2 × 0.5) = 1 seat.
    let nextSequence = 1;
    for (const agentId of ['agent-1', 'agent-2']) {
      const applied = dispatch(
        projection,
        policies,
        applyExamCommand(agentId, 3, `cycle0-${agentId}`),
        nextSequence,
      );
      projection = applied.projection;
      nextSequence += applied.events.length;
    }
    const cycle0 = dispatch(
      projection,
      policies,
      advanceCommand('cycle-0', 86_400_000),
      nextSequence,
    );
    projection = cycle0.projection;
    nextSequence += cycle0.events.length;
    expect(projection.agents['agent-1']?.educationLevel).toBe(3);
    expect(projection.agents['agent-2']?.examAttempts).toBe(1);

    // Cycle 1: agent-2 retries (previous-cycle applications no longer block).
    const retry = dispatch(
      projection,
      policies,
      applyExamCommand('agent-2', 3, 'cycle1-agent-2', 86_400_000),
      nextSequence,
    );
    projection = retry.projection;
    nextSequence += retry.events.length;
    expect(retry.events[0]).toMatchObject({
      type: 'EducationExamApplicationSubmitted',
      payload: { cycleNumber: 1, agentId: 'agent-2' },
    });

    const cycle1 = dispatch(
      projection,
      policies,
      advanceCommand('cycle-1', 172_800_000),
      nextSequence,
    );
    projection = cycle1.projection;
    // The sole retry applicant is admitted; round(1 × 0.5) = 1 academic seat.
    expect(projection.agents['agent-2']).toMatchObject({
      educationLevel: 3,
      educationTrack: 'academic',
      examAttempts: 1,
    });
    expect(projection.educationExamCycles.map((cycle) => cycle.cycleNumber)).toEqual([0, 1]);
    expect(projection.educationExamCycles[1]).toMatchObject({
      applicationCount: 1,
      admittedCount: 1,
      cutoffScoresByLevel: { 3: 200 },
    });
  });

  test('admits into university without a track assignment', () => {
    const projection = createWorldProjection({
      agents: [
        createAgent({
          agentId: 'agent-1',
          educationScore: 400,
          educationLevel: 3,
          educationTrack: 'academic',
        }),
      ],
      moneySupply: 1000,
    });
    const policies = createPolicies({ educationSystem });

    const applied = dispatch(projection, policies, applyExamCommand('agent-1', 4, 'gaokao'), 1);
    const released = dispatch(
      applied.projection,
      policies,
      advanceCommand('cycle-0', 86_400_000),
      applied.events.length + 1,
    );

    const resolution = released.events.find((event) => event.type === 'EducationExamResolved');
    expect(resolution).toMatchObject({
      payload: { targetLevel: 4, status: 'admitted', cutoffScore: 400 },
    });
    expect(resolution?.payload).not.toHaveProperty('track');
    const promotion = released.events.find((event) => event.type === 'EducationLevelChanged');
    expect(promotion).toMatchObject({
      payload: { agentId: 'agent-1', previousLevel: 3, nextLevel: 4 },
    });
    expect(promotion?.payload).not.toHaveProperty('track');
    expect(released.projection.agents['agent-1']).toMatchObject({ educationLevel: 4 });
  });

  test('emits no exam events when the policy is disabled or absent', () => {
    const projection = createWorldProjection({
      agents: [createAgent({ agentId: 'agent-1', educationScore: 200, educationLevel: 2 })],
      moneySupply: 1000,
    });

    for (const policies of [
      createPolicies(),
      createPolicies({ educationSystem: { ...educationSystem, enabled: false } }),
    ]) {
      const events = dispatchWorldCommand({
        command: advanceCommand('disabled-cycle', 86_400_000),
        projection,
        policies,
        nextSequence: 1,
      });
      expect(events.filter((event) => event.type.startsWith('EducationExam'))).toEqual([]);
    }
  });

  test('replaying the application and release event stream reproduces the projection', () => {
    let projection = createWorldProjection({
      agents: [
        createAgent({ agentId: 'agent-1', educationScore: 250, educationLevel: 2 }),
        createAgent({ agentId: 'agent-2', educationScore: 200, educationLevel: 2 }),
      ],
      moneySupply: 2000,
    });
    const policies = createPolicies({ educationSystem });
    const initial = projection;

    const allEvents: WorldEvent[] = [];
    let nextSequence = 1;
    for (const agentId of ['agent-1', 'agent-2']) {
      const events = dispatchWorldCommand({
        command: applyExamCommand(agentId, 3, `replay-${agentId}`),
        projection,
        policies,
        nextSequence,
      });
      allEvents.push(...events);
      projection = events.reduce(applyWorldEvent, projection);
      nextSequence += events.length;
    }
    const releaseEvents = dispatchWorldCommand({
      command: advanceCommand('replay-cycle-0', 86_400_000),
      projection,
      policies,
      nextSequence,
    });
    allEvents.push(...releaseEvents);
    const settled = releaseEvents.reduce(applyWorldEvent, projection);

    const replayed = replayEvents(initial, allEvents, applyWorldEvent);
    expect(replayed).toEqual(settled);
    expect(replayed.agents['agent-1']).toMatchObject({
      educationLevel: 3,
      educationTrack: 'academic',
    });
    expect(replayed.agents['agent-2']?.examAttempts).toBe(1);
    expect(replayed.educationExamCycles).toHaveLength(1);
  });
});

describe('education-exam wellbeing bonus snapshot', () => {
  test('snapshots a wellbeing-adjusted ranking score only when both policies are present', () => {
    const projection = createWorldProjection({
      agents: [
        // No settled wellbeing: falls back to the policy initialValue (50),
        // so the bonus is exactly 0 — the snapshot records score + 0.
        createAgent({ agentId: 'agent-neutral', educationScore: 200, educationLevel: 2 }),
        // Settled distressed wellbeing 20: bonus −6 → snapshot 194.
        createAgent({ agentId: 'agent-sad', educationScore: 200, educationLevel: 2 }),
      ],
      moneySupply: 1000,
    });
    const withWellbeing = { ...projection };
    // Give the sad agent a settled wellbeing scalar via the projection input.
    const sadAgent = {
      ...withWellbeing.agents['agent-sad']!,
      wellbeing: 20,
    };
    const seeded = {
      ...withWellbeing,
      agents: { ...withWellbeing.agents, 'agent-sad': sadAgent },
    } as typeof projection;
    const policies = createPolicies({
      educationSystem: { ...educationSystem, wellbeingExamScoreBonus: { maxBonus: 10 } },
      wellbeing: {
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
          upkeepArrearsPerUnit: -0.05,
          distress: -8,
          positiveRelation: 6,
          negativeRelation: -8,
        },
      },
    });

    const neutral = dispatch(
      seeded,
      policies,
      applyExamCommand('agent-neutral', 3, 'wb-neutral'),
      1,
    );
    expect(neutral.events[0]).toMatchObject({
      type: 'EducationExamApplicationSubmitted',
      payload: { educationScore: 200, effectiveEducationScore: 200 },
    });

    const sad = dispatch(seeded, policies, applyExamCommand('agent-sad', 3, 'wb-sad'), 20);
    expect(sad.events[0]).toMatchObject({
      payload: { educationScore: 200, effectiveEducationScore: 194 },
    });
    expect(sad.projection.educationExamApplications[0]).toMatchObject({
      effectiveEducationScore: 194,
    });

    // Without the wellbeing policy the submission stays byte-for-byte legacy:
    // no snapshot field at all.
    const legacy = dispatch(
      seeded,
      createPolicies({ educationSystem }),
      applyExamCommand('agent-neutral', 3, 'wb-legacy'),
      40,
    );
    expect(legacy.events[0]).toMatchObject({
      payload: { educationScore: 200 },
    });
    expect(
      (legacy.events[0] as { payload: Record<string, unknown> }).payload
        .effectiveEducationScore,
    ).toBeUndefined();
  });
});
