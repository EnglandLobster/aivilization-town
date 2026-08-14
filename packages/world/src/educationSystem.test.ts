import { asAgentId, createCommandEnvelope, replayEvents } from '@aivilization/sim-core';
import type { EducationSystemPolicy } from '@aivilization/society';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
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
  readonly balance?: number;
  readonly job?: string | null;
  readonly educationLevel?: 0 | 1 | 2 | 3 | 4 | 5;
}) {
  return {
    agentId: asAgentId(input.agentId),
    locationId: null,
    physiology: { energy: 100, satiety: 100, health: 100 },
    educationScore: input.educationScore ?? 0,
    balance: input.balance ?? 1000,
    residentialTier: 1,
    job: input.job ?? null,
    inventory: {},
    ...(input.educationLevel === undefined ? {} : { educationLevel: input.educationLevel }),
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

function studyCommand(
  agentId: string,
  options: {
    readonly rate?: number;
    readonly durationSeconds?: number;
    readonly key?: string;
  } = {},
) {
  return createCommandEnvelope({
    id: `command-${options.key ?? 'study'}`,
    simulationId: 'sim-education',
    actorId: agentId,
    type: 'AgentStudy',
    payload: {
      durationSeconds: options.durationSeconds ?? 3600,
      educationRatePerSecond: options.rate ?? 1,
    },
    issuedAt: 0,
  });
}

describe('education-system study settlement', () => {
  test('a compulsory level bills tuition to the treasury and keeps the agent balance', () => {
    const projection = createWorldProjection({
      agents: [createAgent({ agentId: 'agent-1', educationScore: 25, balance: 100 })],
      treasury: 1000,
      moneySupply: 1100,
    });
    const policies = createPolicies({ educationSystem });

    const events = dispatchWorldCommand({
      command: studyCommand('agent-1'),
      projection,
      policies,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'EducationCompulsoryFeeCovered',
      'EducationChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]).toMatchObject({
      payload: { level: 1, coveredAmount: 20, selfPaidAmount: 0, reason: 'compulsory-education' },
    });
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']).toMatchObject({ balance: 100, educationScore: 3600 + 25 });
    expect(updated.treasury).toBe(980);
    // Treasury-covered tuition is a transfer (PublicBudgetSpent treatment).
    expect(updated.moneySupply).toBe(1100);
  });

  test('credits the covered tuition to the public education service balance on replay', () => {
    const projection = createWorldProjection({
      agents: [createAgent({ agentId: 'agent-1', educationScore: 25, balance: 100 })],
      treasury: 1000,
      moneySupply: 1100,
    });
    const policies = createPolicies({ educationSystem });

    const first = dispatchWorldCommand({
      command: studyCommand('agent-1', { key: 'study-a', durationSeconds: 7_200, rate: 1 / 72_000 }),
      projection,
      policies,
      nextSequence: 1,
    });
    const afterFirst = first.reduce(applyWorldEvent, projection);
    // Advance past the committed study time so the second session is allowed.
    const advance = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-study-advance',
        simulationId: 'sim-education',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 7_200_000 },
        issuedAt: 7_200_000,
      }),
      projection: afterFirst,
      policies,
      nextSequence: first.length + 1,
    });
    const afterAdvance = advance.reduce(applyWorldEvent, afterFirst);
    const second = dispatchWorldCommand({
      command: studyCommand('agent-1', { key: 'study-b', durationSeconds: 7_200, rate: 1 / 72_000 }),
      projection: afterAdvance,
      policies,
      nextSequence: first.length + advance.length + 1,
    });
    const updated = second.reduce(applyWorldEvent, afterAdvance);

    // Each covered session transfers 40 from the treasury into the public
    // education service account, mirroring the PublicBudgetSpent treatment.
    expect(updated.publicBudget).toEqual({
      cumulativeSpendingByService: {},
      serviceBalances: { education: 80 },
      lastSettledAt: 0,
    });
    expect(updated.treasury).toBe(920);
    // Treasury transfers never move the money supply.
    expect(updated.moneySupply).toBe(1100);

    const replayed = replayEvents(projection, [...first, ...advance, ...second], applyWorldEvent);
    expect(replayed).toEqual(updated);
  });

  test('a short treasury covers partially and the agent pays the difference', () => {
    const projection = createWorldProjection({
      agents: [createAgent({ agentId: 'agent-1', educationScore: 25, balance: 100 })],
      treasury: 8,
      moneySupply: 1108,
    });

    const events = dispatchWorldCommand({
      command: studyCommand('agent-1'),
      projection,
      policies: createPolicies({ educationSystem }),
      nextSequence: 1,
    });

    expect(events[0]).toMatchObject({
      type: 'EducationCompulsoryFeeCovered',
      payload: { coveredAmount: 8, selfPaidAmount: 12 },
    });
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.balance).toBe(88);
    expect(updated.treasury).toBe(0);
    // Only the self-paid share leaves circulation.
    expect(updated.moneySupply).toBe(1108 - 12);
  });

  test('without a treasury the compulsory level falls back to self-pay', () => {
    const projection = createWorldProjection({
      agents: [createAgent({ agentId: 'agent-1', educationScore: 25, balance: 100 })],
      moneySupply: 100,
    });

    const events = dispatchWorldCommand({
      command: studyCommand('agent-1'),
      projection,
      policies: createPolicies({ educationSystem }),
      nextSequence: 1,
    });

    expect(events[0]).toMatchObject({
      type: 'EducationCompulsoryFeeCovered',
      payload: { coveredAmount: 0, selfPaidAmount: 20 },
    });
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.balance).toBe(80);
    expect(updated.treasury).toBeUndefined();
    expect(updated.moneySupply).toBe(80);
  });

  test('an employed agent studies at the reduced efficiency', () => {
    const projection = createWorldProjection({
      agents: [
        createAgent({ agentId: 'agent-1', educationScore: 25, job: 'Cleaner', balance: 100 }),
      ],
      treasury: 1000,
      moneySupply: 1100,
    });

    const events = dispatchWorldCommand({
      command: studyCommand('agent-1'),
      projection,
      policies: createPolicies({ educationSystem }),
      nextSequence: 1,
    });

    const educationChanged = events.find((event) => event.type === 'EducationChanged');
    expect(educationChanged).toMatchObject({
      payload: { previousEducationScore: 25, nextEducationScore: 25 + 3600 * 0.3 },
    });
  });

  test('a non-compulsory level pays its own tuition at the level rate', () => {
    const projection = createWorldProjection({
      agents: [
        createAgent({
          agentId: 'agent-1',
          educationScore: 400,
          educationLevel: 4,
          balance: 100,
        }),
      ],
      treasury: 1000,
      moneySupply: 1100,
    });

    const events = dispatchWorldCommand({
      command: studyCommand('agent-1'),
      projection,
      policies: createPolicies({ educationSystem }),
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'EducationInvestmentPaid',
      'EducationChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]).toMatchObject({
      payload: { currencyCost: 30, previousBalance: 100, nextBalance: 70 },
    });
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.balance).toBe(70);
    expect(updated.treasury).toBe(1000);
    expect(updated.moneySupply).toBe(1100 - 30);
  });

  test('an unaffordable self-pay share rejects the study without state changes', () => {
    const projection = createWorldProjection({
      agents: [createAgent({ agentId: 'agent-1', educationScore: 25, balance: 5 })],
      treasury: 0,
      moneySupply: 105,
    });

    const events = dispatchWorldCommand({
      command: studyCommand('agent-1'),
      projection,
      policies: createPolicies({ educationSystem }),
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.balance).toBe(5);
    expect(updated.moneySupply).toBe(105);
  });

  test('a disabled or absent education system keeps the legacy study path', () => {
    const legacyPolicies = createPolicies({
      educationInvestment: { currencyCostPerHour: 20, inventoryCostsPerHour: {} },
    });
    const disabledPolicies = createPolicies({
      ...legacyPolicies,
      educationSystem: { ...educationSystem, enabled: false },
    });

    for (const policies of [legacyPolicies, disabledPolicies]) {
      const projection = createWorldProjection({
        agents: [createAgent({ agentId: 'agent-1', educationScore: 25, balance: 100 })],
        treasury: 1000,
        moneySupply: 1100,
      });
      const events = dispatchWorldCommand({
        command: studyCommand('agent-1'),
        projection,
        policies,
        nextSequence: 1,
      });

      expect(events.map((event) => event.type)).toEqual([
        'EducationInvestmentPaid',
        'EducationChanged',
        'AgentActivityTimeCommitted',
        'ShortTermMemoryRecorded',
      ]);
      expect(events[0]).toMatchObject({ payload: { currencyCost: 20 } });
      const updated = events.reduce(applyWorldEvent, projection);
      expect(updated.agents['agent-1']?.balance).toBe(80);
      expect(updated.treasury).toBe(1000);
      expect(updated.moneySupply).toBe(1100 - 20);
    }
  });
});

describe('education-system automatic promotion', () => {
  function advanceCommand(sequenceKey: string) {
    return createCommandEnvelope({
      id: `command-${sequenceKey}`,
      simulationId: 'sim-education',
      source: 'system',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs: 1000 },
      issuedAt: 1000,
    });
  }

  test('advances one level per tick inside the compulsory stage and stops at the exam gate', () => {
    const projection = createWorldProjection({
      agents: [
        // Recorded level 1, score 25: threshold 70 for level 2 not yet met.
        createAgent({
          agentId: 'agent-1',
          educationScore: 25,
          educationLevel: 1,
        }),
        // Recorded level 2, score 100: entering level 3 is exam-gated — must
        // NOT auto-promote even with a far-above-threshold score.
        createAgent({
          agentId: 'agent-2',
          educationScore: 100,
          educationLevel: 2,
        }),
      ],
      moneySupply: 2000,
    });
    const policies = createPolicies({ educationSystem });

    const firstTick = dispatchWorldCommand({
      command: advanceCommand('advance-1'),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(firstTick.filter((event) => event.type === 'EducationLevelChanged')).toEqual([]);

    // Study pushes agent-1 over the level-2 threshold (25 → 75).
    const studied = dispatchWorldCommand({
      command: studyCommand('agent-1', {
        rate: 50 / 1800,
        durationSeconds: 1800,
        key: 'study-promote',
      }),
      projection: firstTick.reduce(applyWorldEvent, projection),
      policies,
      nextSequence: firstTick.length + 1,
    });
    const afterStudy = studied.reduce(
      applyWorldEvent,
      firstTick.reduce(applyWorldEvent, projection),
    );

    const secondTick = dispatchWorldCommand({
      command: advanceCommand('advance-2'),
      projection: afterStudy,
      policies,
      nextSequence: firstTick.length + studied.length + 1,
    });
    const promotions = secondTick.filter((event) => event.type === 'EducationLevelChanged');
    expect(promotions).toHaveLength(1);
    expect(promotions[0]).toMatchObject({
      payload: { agentId: 'agent-1', previousLevel: 1, nextLevel: 2 },
    });

    const updated = secondTick.reduce(applyWorldEvent, afterStudy);
    expect(updated.agents['agent-1']?.educationLevel).toBe(2);
    expect(updated.agents['agent-2']?.educationLevel).toBe(2);

    // Further ticks never re-promote: the recorded level pins the state.
    const thirdTick = dispatchWorldCommand({
      command: advanceCommand('advance-3'),
      projection: updated,
      policies,
      nextSequence: firstTick.length + studied.length + secondTick.length + 1,
    });
    expect(thirdTick.filter((event) => event.type === 'EducationLevelChanged')).toEqual([]);
  });

  test('level-0 agents enroll into primary school once the entry threshold is met', () => {
    const projection = createWorldProjection({
      agents: [createAgent({ agentId: 'agent-1', educationScore: 20 })],
      moneySupply: 1000,
    });

    const events = dispatchWorldCommand({
      command: advanceCommand('advance-enroll'),
      projection,
      policies: createPolicies({ educationSystem }),
      nextSequence: 1,
    });

    const promotions = events.filter((event) => event.type === 'EducationLevelChanged');
    expect(promotions).toHaveLength(1);
    expect(promotions[0]).toMatchObject({
      payload: { agentId: 'agent-1', previousLevel: 0, nextLevel: 1 },
    });
  });

  test('a disabled or absent policy emits no promotion events', () => {
    const projection = createWorldProjection({
      agents: [createAgent({ agentId: 'agent-1', educationScore: 100 })],
      moneySupply: 1000,
    });

    for (const policies of [
      createPolicies({}),
      createPolicies({ educationSystem: { ...educationSystem, enabled: false } }),
    ]) {
      const events = dispatchWorldCommand({
        command: advanceCommand(
          `advance-${policies.educationSystem === undefined ? 'off' : 'disabled'}`,
        ),
        projection,
        policies,
        nextSequence: 1,
      });
      expect(events.filter((event) => event.type === 'EducationLevelChanged')).toEqual([]);
    }
  });
});

describe('education-system replay consistency', () => {
  test('replaying the study and promotion event stream reproduces the projection', () => {
    const projection = createWorldProjection({
      agents: [
        createAgent({
          agentId: 'agent-1',
          educationScore: 25,
          educationLevel: 1,
          balance: 100,
        }),
      ],
      treasury: 500,
      moneySupply: 600,
    });
    const policies = createPolicies({ educationSystem });

    const studyEvents = dispatchWorldCommand({
      command: studyCommand('agent-1', {
        rate: 50 / 1800,
        durationSeconds: 1800,
        key: 'replay-study',
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    const afterStudy = studyEvents.reduce(applyWorldEvent, projection);
    const advanceEvents = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-replay-advance',
        simulationId: 'sim-education',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1000 },
        issuedAt: 1000,
      }),
      projection: afterStudy,
      policies,
      nextSequence: studyEvents.length + 1,
    });

    const allEvents = [...studyEvents, ...advanceEvents];
    const settled = allEvents.reduce(applyWorldEvent, projection);
    const replayed = replayEvents(projection, allEvents, applyWorldEvent);
    // Replaying the same durable event stream reproduces the settled state
    // exactly — deterministic replay of the education-system semantics.
    expect(replayed).toEqual(settled);
    expect(replayed.agents['agent-1']).toMatchObject({ educationLevel: 2 });
    expect(replayed.treasury).toBe(settled.treasury);
    expect(replayed.moneySupply).toBe(settled.moneySupply);
  });
});
