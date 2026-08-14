import { createBranchPlan, type ActionSequenceGenerator } from '@aivilization/agent-runtime';
import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import type { EducationSystemPolicy } from '@aivilization/society';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldAgentState,
  type WorldCommandPolicies,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createEducationOpportunityCostAwareActionSequenceGenerator,
  createEducationOpportunityCostRule,
  createExecutedEducationOpportunityCostMetrics,
} from './index';

const ruleEducationSystemPolicy: EducationSystemPolicy = {
  policyVersion: 'education-system-v3',
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

function createRulePolicies(
  overrides: Partial<WorldCommandPolicies> = {},
): WorldCommandPolicies {
  return {
    satietyRecoveryByCommodity: {},
    maxSatiety: 100,
    wageCalculator: () => 10,
    laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
    criticalThresholds: { energy: 1, health: 1 },
    educationInvestment: { currencyCostPerHour: 20, inventoryCostsPerHour: {} },
    ...overrides,
  };
}

function createRuleAgent(input: {
  readonly balance: number;
  readonly educationScore?: number;
  readonly educationLevel?: WorldAgentState['educationLevel'];
}): WorldAgentState {
  return {
    agentId: asAgentId('agent-a'),
    locationId: null,
    physiology: { energy: 80, satiety: 80, health: 90 },
    educationScore: input.educationScore ?? 0,
    balance: input.balance,
    residentialTier: 1,
    job: null,
    inventory: {},
    ...(input.educationLevel === undefined ? {} : { educationLevel: input.educationLevel }),
  };
}

describe('education opportunity-cost rule', () => {
  test('prices compulsory-level study at the treasury-covered self-pay share', () => {
    const rule = createEducationOpportunityCostRule({
      agent: createRuleAgent({ balance: 5, educationScore: 25, educationLevel: 1 }),
      policies: createRulePolicies({ educationSystem: ruleEducationSystemPolicy }),
      treasuryBalance: 1000,
    });

    // The legacy flat estimate (10 for 1800s at 20/hour) would reject this
    // low-balance agent; the settlement-aligned quote is fully covered.
    expect(rule).toMatchObject({
      directCurrencyCost: 0,
      directInventoryCosts: {},
      balanceAfterDirectCost: 5,
      directlyAffordable: true,
    });
  });

  test('prices non-compulsory levels at the level tuition rate', () => {
    const rule = createEducationOpportunityCostRule({
      agent: createRuleAgent({ balance: 100, educationScore: 400, educationLevel: 4 }),
      policies: createRulePolicies({ educationSystem: ruleEducationSystemPolicy }),
      treasuryBalance: 1000,
    });

    // Level-4 tuition is 30/hour; the canonical study session is 1800s.
    expect(rule).toMatchObject({ directCurrencyCost: 15, directlyAffordable: true });
  });

  test('keeps the legacy flat estimate when the education system is disabled or absent', () => {
    for (const policies of [
      createRulePolicies(),
      createRulePolicies({
        educationSystem: { ...ruleEducationSystemPolicy, enabled: false },
      }),
    ]) {
      const rule = createEducationOpportunityCostRule({
        agent: createRuleAgent({ balance: 100 }),
        policies,
        treasuryBalance: 1000,
      });

      expect(rule).toMatchObject({ directCurrencyCost: 10, directlyAffordable: true });
    }
  });
});

describe('education opportunity-cost action authority', () => {
  test('replaces LLM-declared study costs with the authoritative duration-prorated estimate', async () => {
    const untrustedGenerator: ActionSequenceGenerator = (input) =>
      Promise.resolve({
        actions: [
          {
            id: 'llm-study',
            description: 'Study for fifteen minutes.',
            commandType: 'AgentStudy',
            payload: { durationSeconds: 900, educationRatePerSecond: 1 },
            resourceEstimate: { actionSeconds: 1, currencyCost: 0, inventoryCosts: {} },
          },
        ],
        trace: {
          status: 'accepted',
          source: 'llm',
          selectedSubtask: {
            branchId: input.selectedSubtask.branchId,
            subtaskId: input.selectedSubtask.subtaskId,
          },
        },
      });
    const generator =
      createEducationOpportunityCostAwareActionSequenceGenerator(untrustedGenerator);

    const result = await generator({
      agentId: asAgentId('agent-a'),
      issuedAt: 100,
      plan: createBranchPlan({
        objective: 'Balance education and income.',
        branches: [
          {
            id: 'development',
            objective: 'Study.',
            subtasks: [{ id: 'study', description: 'Study.', basePriority: 10 }],
          },
        ],
      }),
      selectedSubtask: {
        branchId: 'development',
        subtaskId: 'study',
        description: 'Study.',
        score: 10,
      },
      signals: [],
      deterministicActions: [],
      worldDecisionContext: {
        agent: {
          agentId: asAgentId('agent-a'),
          locationId: 'school',
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 100,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Books: 2 },
        },
        market: { spotPrices: [] },
        rules: {
          occupations: [],
          production: [],
          educationOpportunityCost: {
            policyVersion: 'education-opportunity-cost-v1',
            studyDurationSeconds: 1800,
            educationRatePerSecond: 1,
            expectedEducationGain: 1800,
            directCurrencyCost: 10,
            directInventoryCosts: { Books: 1 },
            workLaborSeconds: 3600,
            currentOccupationName: 'Cleaner',
            foregoneLaborIncome: 125,
            totalCurrencyOpportunityCost: 135,
            minimumBalanceReserve: 50,
            balanceAfterDirectCost: 90,
            directlyAffordable: true,
            preservesMinimumBalanceReserve: true,
          },
        },
      },
    });

    expect(result.actions[0]?.resourceEstimate).toEqual({
      actionSeconds: 900,
      currencyCost: 5,
      inventoryCosts: { Books: 0.5 },
    });
  });

  test('aggregates executed allocation, direct study cost, and exclusive-time conflicts from events', () => {
    const policies = {
      satietyRecoveryByCommodity: { Bread: 15 },
      maxSatiety: 100,
      wageCalculator: () => 10,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 1, health: 1 },
      educationInvestment: { currencyCostPerHour: 20, inventoryCostsPerHour: {} },
    } as const;
    let projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-a'),
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: { Bread: 1 },
        },
        {
          agentId: asAgentId('agent-b'),
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 0,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: { Bread: 1 },
        },
      ],
    });
    const studyEvents = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'metric-study',
        simulationId: 'sim-1',
        actorId: 'agent-a',
        type: 'AgentStudy',
        payload: { durationSeconds: 1_800, educationRatePerSecond: 1 },
        issuedAt: 10,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    projection = studyEvents.reduce(applyWorldEvent, projection);
    const busyEatEvents = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'metric-busy-eat',
        simulationId: 'sim-1',
        actorId: 'agent-a',
        type: 'AgentEat',
        payload: { commodityName: 'Bread', quantity: 1 },
        issuedAt: 11,
      }),
      projection,
      policies,
      nextSequence: 10,
    });
    const otherEatEvents = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'metric-other-eat',
        simulationId: 'sim-1',
        actorId: 'agent-b',
        type: 'AgentEat',
        payload: { commodityName: 'Bread', quantity: 1 },
        issuedAt: 11,
      }),
      projection,
      policies,
      nextSequence: 20,
    });

    expect(
      createExecutedEducationOpportunityCostMetrics([
        ...studyEvents,
        ...busyEatEvents,
        ...otherEatEvents,
      ]),
    ).toEqual({
      metricVersion: 'executed-education-opportunity-cost-v1',
      executedActivityAllocation: [
        { activity: 'study', actionCount: 1, activitySeconds: 1_800 },
        { activity: 'labor', actionCount: 0, activitySeconds: 0 },
        { activity: 'production', actionCount: 0, activitySeconds: 0 },
        { activity: 'consumption', actionCount: 1, activitySeconds: 0 },
        { activity: 'survival', actionCount: 0, activitySeconds: 0 },
        { activity: 'other', actionCount: 0, activitySeconds: 0 },
      ],
      directStudyCurrencyCost: 10,
      activityTimeConflictRejectionCount: 1,
    });
  });
});
