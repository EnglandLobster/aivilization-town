import { createBranchPlan, type ActionSequenceGenerator } from '@aivilization/agent-runtime';
import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { applyWorldEvent, createWorldProjection, dispatchWorldCommand } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createEducationOpportunityCostAwareActionSequenceGenerator,
  createExecutedEducationOpportunityCostMetrics,
} from './index';

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
