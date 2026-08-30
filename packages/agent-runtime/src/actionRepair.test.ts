import { asMemoryRecordId, createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type { AtomicActionProposal } from './actions';
import {
  AGENT_ACTION_COMMAND_TYPES,
  simulateActionWithTieredRepair,
  type ReactiveCorrectorInput,
} from './actionRepair';
import { createBranchPlan } from './planner';

const agentId = asAgentId('agent-1');
const selectedSubtask = {
  branchId: 'income',
  subtaskId: 'work',
  description: 'work shift',
  score: 8,
};

describe('tiered action repair', () => {
  test('passes decision context into local repair before reactive correction', async () => {
    const rejectedAction = createWorkAction();
    const memory = createShortTermMemoryRecord({
      id: 'memory-work-failed-hungry',
      agentId,
      kind: 'action',
      status: 'failed',
      summary: 'Working while hungry failed; eating before work succeeded.',
      occurredAt: 480,
      importanceScore: 0.9,
      source: { eventIds: [] },
      tags: ['work', 'satiety', 'repair'],
    });
    const repairInputs: unknown[] = [];

    await simulateActionWithTieredRepair({
      action: rejectedAction,
      selectedSubtask,
      simulate: (action) => ({
        status: 'rejected',
        action,
        reason: 'satiety too low',
      }),
      localRepair: (input) => {
        repairInputs.push(input);
        return undefined;
      },
      reactiveCorrector: undefined,
      reactiveCorrectorInput: createReactiveInput({
        observedStateSummary:
          'energy=40 satiety=12 health=95 education=10 balance=50 tier=1 job=Cleaner inventory=Fish:1',
        shortTermMemoryContext: [memory],
        longTermProfile: {
          agentId,
          beliefs: [
            {
              key: 'eat-before-work',
              statement: 'Eat before working when satiety is low.',
              confidence: 0.8,
              updatedAt: 490,
              provenanceRecordIds: [asMemoryRecordId('memory-work-failed-hungry')],
            },
          ],
          habits: [],
          mood: [],
          values: [],
          personality: [],
          socialRecords: [],
        },
        worldDecisionContext: {
          agent: {
            agentId,
            locationId: 'market',
            physiology: { energy: 40, satiety: 12, health: 95 },
            educationScore: 10,
            balance: 50,
            residentialTier: 1,
            job: 'Cleaner',
            inventory: { Fish: 1 },
          },
          market: {
            spotPrices: [{ commodity: 'Fish', spotPrice: 12 }],
            latestPriceIndex: {
              baselineAt: 1,
              recordedAt: 500,
              overall: 1.2,
              ratios: { Fish: 1.2 },
            },
          },
        },
      }),
    });

    expect(repairInputs).toHaveLength(1);
    expect(repairInputs[0]).toMatchObject({
      agentId,
      issuedAt: 500,
      plan: {
        objective: 'Earn income without collapsing physiology.',
      },
      signals: [],
      selectedSubtask,
      rejectedAction,
      reason: 'satiety too low',
      observedStateSummary:
        'energy=40 satiety=12 health=95 education=10 balance=50 tier=1 job=Cleaner inventory=Fish:1',
      shortTermMemoryContext: [{ id: 'memory-work-failed-hungry' }],
      longTermProfile: { beliefs: [{ key: 'eat-before-work' }] },
      worldDecisionContext: {
        agent: {
          balance: 50,
          inventory: { Fish: 1 },
          physiology: { satiety: 12 },
        },
        market: {
          spotPrices: [{ commodity: 'Fish', spotPrice: 12 }],
          latestPriceIndex: { ratios: { Fish: 1.2 } },
        },
      },
    });
  });

  test('short-circuits reactive correction when local repair validates', async () => {
    const rejectedAction = createWorkAction();
    const localAction = {
      ...rejectedAction,
      id: 'work-short-shift',
      description: 'work a short shift',
      payload: { occupationName: 'Stock Clerk', laborSeconds: 60 },
    };
    let reactiveCalls = 0;

    const result = await simulateActionWithTieredRepair({
      action: rejectedAction,
      selectedSubtask,
      simulate: (action) =>
        action.id === 'work-short-shift'
          ? { status: 'accepted', action, traceEvents: [{ type: 'ActionAccepted', sequence: 2 }] }
          : {
              status: 'rejected',
              action,
              reason: 'satiety too low',
              traceEvents: [{ type: 'ActionRejected', sequence: 1 }],
            },
      localRepair: () => localAction,
      reactiveCorrector: async () => {
        await Promise.resolve();
        reactiveCalls += 1;
        return {
          action: undefined,
          trace: {
            status: 'accepted',
            source: 'llm',
            decision: {
              kind: 'no-correction',
              rationale: 'should not be called',
              evidenceRecordIds: [],
            },
          },
        };
      },
      reactiveCorrectorInput: createReactiveInput(),
    });

    expect(reactiveCalls).toBe(0);
    expect(result.result).toEqual({
      status: 'repaired',
      originalAction: rejectedAction,
      repairedAction: localAction,
      reason: 'satiety too low',
      originalTraceEvents: [{ type: 'ActionRejected', sequence: 1 }],
      repairedTraceEvents: [{ type: 'ActionAccepted', sequence: 2 }],
    });
    expect(result.trace).toEqual({
      actionId: 'work-hungry',
      rejectionReason: 'satiety too low',
      selectedSubtask: { branchId: 'income', subtaskId: 'work' },
      localRepair: {
        status: 'accepted',
        attemptedAction: {
          id: 'work-short-shift',
          description: 'work a short shift',
          commandType: 'AgentWork',
        },
      },
      outcome: 'repaired',
    });
  });

  test('passes local repair failure evidence into reactive correction', async () => {
    const rejectedAction = createWorkAction();
    const localAction = {
      ...rejectedAction,
      id: 'work-short-shift',
      description: 'work a short shift',
      payload: { occupationName: 'Stock Clerk', laborSeconds: 60 },
    };
    const reactiveAction = createEatAction();
    const calls: unknown[] = [];

    const result = await simulateActionWithTieredRepair({
      action: rejectedAction,
      selectedSubtask,
      simulate: (action) => {
        if (action.id === 'eat-fish-before-work') {
          return { status: 'accepted', action };
        }
        return {
          status: 'rejected',
          action,
          reason: action.id === 'work-short-shift' ? 'satiety remains too low' : 'satiety too low',
        };
      },
      localRepair: () => localAction,
      reactiveCorrector: async (input) => {
        await Promise.resolve();
        calls.push(input);
        return {
          action: reactiveAction,
          trace: {
            status: 'accepted',
            source: 'llm',
            requestId: 'repair-request',
            decision: {
              kind: 'propose-action',
              rationale: 'Use cached experience: eat before work.',
              evidenceRecordIds: ['memory-work-failed-hungry'],
              action: {
                id: 'eat-fish-before-work',
                description: 'eat Fish before retrying work',
                commandType: 'AgentEat',
              },
            },
          },
        };
      },
      reactiveCorrectorInput: createReactiveInput(),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      selectedSubtask,
      rejectedAction,
      rejectionReason: 'satiety too low',
      localRepairAttempt: localAction,
      localRepairRejectionReason: 'satiety remains too low',
      allowedCommandTypes: AGENT_ACTION_COMMAND_TYPES,
    });
    expect(result.result).toEqual({
      status: 'repaired',
      originalAction: rejectedAction,
      repairedAction: reactiveAction,
      reason: 'satiety too low',
    });
    expect(result.trace).toMatchObject({
      actionId: 'work-hungry',
      localRepair: {
        status: 'rejected',
        attemptedAction: { id: 'work-short-shift', commandType: 'AgentWork' },
        rejectionReason: 'satiety remains too low',
      },
      reactiveCorrection: {
        status: 'accepted',
        source: 'llm',
        requestId: 'repair-request',
        simulatorResult: { status: 'accepted' },
      },
      outcome: 'repaired',
    });
  });

  test('returns needs-replan when reactive correction fails simulator validation', async () => {
    const rejectedAction = createWorkAction();
    const reactiveAction = createEatAction();

    const result = await simulateActionWithTieredRepair({
      action: rejectedAction,
      selectedSubtask,
      simulate: (action) => ({
        status: 'rejected',
        action,
        reason: action.id === 'eat-fish-before-work' ? 'Fish missing' : 'satiety too low',
      }),
      reactiveCorrector: () =>
        Promise.resolve({
          action: reactiveAction,
          trace: {
            status: 'accepted',
            source: 'llm',
            decision: {
              kind: 'propose-action',
              rationale: 'Try to eat before work.',
              evidenceRecordIds: ['memory-work-failed-hungry'],
              action: {
                id: 'eat-fish-before-work',
                description: 'eat Fish before retrying work',
                commandType: 'AgentEat',
              },
            },
          },
        }),
      reactiveCorrectorInput: createReactiveInput(),
    });

    expect(result.result).toEqual({
      status: 'needs-replan',
      action: rejectedAction,
      attemptedRepair: reactiveAction,
      reason: 'Fish missing',
    });
    expect(result.trace).toMatchObject({
      localRepair: { status: 'skipped' },
      reactiveCorrection: {
        simulatorResult: { status: 'rejected', reason: 'Fish missing' },
      },
      outcome: 'needs-replan',
    });
  });
});

type TieredRepairReactiveInput = Omit<
  ReactiveCorrectorInput,
  | 'selectedSubtask'
  | 'rejectedAction'
  | 'rejectionReason'
  | 'localRepairAttempt'
  | 'localRepairRejectionReason'
>;

function createReactiveInput(overrides: Partial<TieredRepairReactiveInput> = {}) {
  return {
    ...createBaseReactiveInput(),
    ...overrides,
  };
}

function createBaseReactiveInput(): TieredRepairReactiveInput {
  return {
    agentId,
    issuedAt: 500,
    plan: createBranchPlan({
      objective: 'Earn income without collapsing physiology.',
      branches: [
        {
          id: 'income',
          objective: 'Earn wages.',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 8 }],
        },
      ],
    }),
    signals: [],
    allowedCommandTypes: AGENT_ACTION_COMMAND_TYPES,
  };
}

function createWorkAction(): AtomicActionProposal {
  return {
    id: 'work-hungry',
    description: 'work while hungry',
    commandType: 'AgentWork',
    payload: { occupationName: 'Stock Clerk', laborSeconds: 3600 },
  };
}

function createEatAction(): AtomicActionProposal {
  return {
    id: 'eat-fish-before-work',
    description: 'eat Fish before retrying work',
    commandType: 'AgentEat',
    payload: { commodityName: 'Fish', quantity: 1 },
  };
}

describe('AGENT_ACTION_COMMAND_TYPES', () => {
  test('exposes canonical education and external-trade actions to synthesis and repair', () => {
    expect(AGENT_ACTION_COMMAND_TYPES).toContain('AgentApplyEducationExam');
    expect(AGENT_ACTION_COMMAND_TYPES).toContain('AgentApplyJob');
    expect(AGENT_ACTION_COMMAND_TYPES).toContain('AgentExportCommodity');
    expect(AGENT_ACTION_COMMAND_TYPES).toContain('AgentImportCommodity');
    expect(new Set(AGENT_ACTION_COMMAND_TYPES).size).toBe(AGENT_ACTION_COMMAND_TYPES.length);
  });
});
