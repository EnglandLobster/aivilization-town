import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type { AtomicActionProposal } from './actions';
import { AGENT_ACTION_COMMAND_TYPES, simulateActionWithTieredRepair } from './actionRepair';
import { createBranchPlan } from './planner';

const agentId = asAgentId('agent-1');
const selectedSubtask = {
  branchId: 'income',
  subtaskId: 'work',
  description: 'work shift',
  score: 8,
};

describe('tiered action repair', () => {
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

function createReactiveInput() {
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
