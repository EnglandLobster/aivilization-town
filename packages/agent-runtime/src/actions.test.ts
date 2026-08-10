import { describe, expect, test } from 'vitest';
import { simulateActionWithRepair } from './index';

describe('action simulator repair', () => {
  test('returns accepted simulation results without repair', () => {
    const action = {
      id: 'eat-1',
      description: 'eat bread',
      commandType: 'AgentEat' as const,
      payload: { commodity: 'Bread' },
    };

    expect(
      simulateActionWithRepair({
        action,
        simulate: () => ({ status: 'accepted', action }),
      }),
    ).toEqual({
      status: 'accepted',
      action,
    });
  });

  test('repairs a rejected action when the repaired action validates', () => {
    const action = {
      id: 'work-1',
      description: 'work shift',
      commandType: 'AgentWork' as const,
      payload: { occupation: 'Cleaner' },
    };
    const repairedAction = {
      id: 'eat-before-work',
      description: 'eat before work',
      commandType: 'AgentEat' as const,
      payload: { commodity: 'Bread' },
    };

    expect(
      simulateActionWithRepair({
        action,
        simulate: (candidate) =>
          candidate.id === 'eat-before-work'
            ? { status: 'accepted', action: candidate }
            : { status: 'rejected', action: candidate, reason: 'satiety too low' },
        repair: ({ reason }) => (reason === 'satiety too low' ? repairedAction : undefined),
      }),
    ).toEqual({
      status: 'repaired',
      originalAction: action,
      repairedAction,
      reason: 'satiety too low',
    });
  });

  test('preserves simulator trace events across repaired attempts', () => {
    const action = {
      id: 'work-1',
      description: 'work shift',
      commandType: 'AgentWork' as const,
      payload: { occupation: 'Cleaner' },
    };
    const repairedAction = {
      id: 'eat-before-work',
      description: 'eat before work',
      commandType: 'AgentEat' as const,
      payload: { commodity: 'Bread' },
    };

    expect(
      simulateActionWithRepair({
        action,
        simulate: (candidate) =>
          candidate.id === 'eat-before-work'
            ? {
                status: 'accepted',
                action: candidate,
                traceEvents: [
                  { type: 'InventoryChanged', sequence: 11, summary: 'consumed Bread' },
                ],
              }
            : {
                status: 'rejected',
                action: candidate,
                reason: 'satiety too low',
                traceEvents: [
                  { type: 'ActionRejected', sequence: 10, summary: 'satiety too low' },
                ],
              },
        repair: ({ reason }) => (reason === 'satiety too low' ? repairedAction : undefined),
      }),
    ).toEqual({
      status: 'repaired',
      originalAction: action,
      repairedAction,
      reason: 'satiety too low',
      originalTraceEvents: [{ type: 'ActionRejected', sequence: 10, summary: 'satiety too low' }],
      repairedTraceEvents: [{ type: 'InventoryChanged', sequence: 11, summary: 'consumed Bread' }],
    });
  });

  test('escalates to replanning when a repaired action is also rejected', () => {
    const action = {
      id: 'work-1',
      description: 'work shift',
      commandType: 'AgentWork' as const,
      payload: { occupation: 'Cleaner' },
    };
    const repairedAction = {
      id: 'eat-before-work',
      description: 'eat before work',
      commandType: 'AgentEat' as const,
      payload: { commodity: 'Bread' },
    };

    expect(
      simulateActionWithRepair({
        action,
        simulate: (candidate) => ({
          status: 'rejected',
          action: candidate,
          reason: candidate.id === 'work-1' ? 'satiety too low' : 'no food inventory',
        }),
        repair: () => repairedAction,
      }),
    ).toEqual({
      status: 'needs-replan',
      action,
      attemptedRepair: repairedAction,
      reason: 'no food inventory',
    });
  });
});
