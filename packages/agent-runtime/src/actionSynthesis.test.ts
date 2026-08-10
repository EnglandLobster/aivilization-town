import { describe, expect, test } from 'vitest';
import type { ActionResourceEstimate, AtomicActionProposal } from './actions';
import { synthesizeActionCandidates } from './index';

describe('action synthesis', () => {
  test('prioritizes proposals before applying max action budget', () => {
    const study = createAction('study', 1);
    const sleep = createAction('sleep', 3);
    const work = createAction('work', 2);

    const result = synthesizeActionCandidates({
      actions: [study, sleep, work],
      policy: { maxActions: 2 },
    });

    expect(result.acceptedActions.map((action) => action.id)).toEqual(['sleep', 'work']);
    expect(result.rejectedActions).toEqual([
      { action: study, reason: 'maxActions exhausted' },
    ]);
  });

  test('rejects actions that would exceed shared resource budgets', () => {
    const bread = createAction('eat-bread', 1, {
      actionSeconds: 30,
      inventoryCosts: { Bread: 1 },
    });
    const work = createAction('work', 2, {
      actionSeconds: 3600,
      energyCost: 20,
    });
    const secondMeal = createAction('eat-second-bread', 1, {
      actionSeconds: 30,
      inventoryCosts: { Bread: 1 },
    });

    const result = synthesizeActionCandidates({
      actions: [bread, work, secondMeal],
      policy: {
        budget: {
          availableActionSeconds: 3630,
          energyBudget: 20,
          inventoryBudget: { Bread: 1 },
        },
      },
    });

    expect(result.acceptedActions.map((action) => action.id)).toEqual(['work', 'eat-bread']);
    expect(result.rejectedActions).toEqual([
      { action: secondMeal, reason: 'inventory budget exceeded for Bread' },
    ]);
  });

  test('enforces per-branch action caps before lower-priority branches are starved', () => {
    const produceFirst = createAction('produce-first', 5, undefined, {
      branchId: 'production',
      subtaskId: 'craft-circuit',
    });
    const produceSecond = createAction('produce-second', 4, undefined, {
      branchId: 'production',
      subtaskId: 'craft-transistor',
    });
    const recover = createAction('recover-energy', 3, undefined, {
      branchId: 'recovery',
      subtaskId: 'sleep',
    });

    const result = synthesizeActionCandidates({
      actions: [produceFirst, produceSecond, recover],
      policy: {
        maxActions: 2,
        branchLimits: { maxAcceptedActionsPerBranch: 1 },
      },
    });

    expect(result.acceptedActions.map((action) => action.id)).toEqual([
      'produce-first',
      'recover-energy',
    ]);
    expect(result.rejectedActions).toEqual([
      {
        action: produceSecond,
        reason: 'branch action budget exhausted for production',
      },
    ]);
  });

  test('scores strategic alignment and branch urgency alongside base priority', () => {
    const urgentRecovery = createAction('urgent-recovery', 1, undefined, {
      branchId: 'recovery',
      strategicAlignment: 2,
      branchUrgency: 4,
    });
    const highBasePriorityWork = createAction('high-base-priority-work', 5, undefined, {
      branchId: 'income',
      strategicAlignment: 0,
      branchUrgency: 0,
    });

    const result = synthesizeActionCandidates({
      actions: [highBasePriorityWork, urgentRecovery],
      policy: {
        maxActions: 1,
        scoring: {
          priorityWeight: 1,
          strategicAlignmentWeight: 2,
          branchUrgencyWeight: 1,
        },
      },
    });

    expect(result.acceptedActions.map((action) => action.id)).toEqual(['urgent-recovery']);
    expect(result.rejectedActions).toEqual([
      {
        action: highBasePriorityWork,
        reason: 'maxActions exhausted',
      },
    ]);
  });

  test('rejects non-positive candidate subtask limits', () => {
    expect(() =>
      synthesizeActionCandidates({
        actions: [createAction('study', 1)],
        policy: { candidateSubtasks: { maxSubtasks: 0 } },
      }),
    ).toThrow('action synthesis candidateSubtasks.maxSubtasks must be a positive integer');
  });
});

function createAction(
  id: string,
  priority: number,
  resourceEstimate?: ActionResourceEstimate,
  synthesisContext?: AtomicActionProposal['synthesisContext'],
): AtomicActionProposal {
  return {
    id,
    description: id,
    commandType: 'AgentWork',
    payload: { occupationName: 'Cleaner', laborSeconds: 60 },
    priority,
    ...(resourceEstimate === undefined ? {} : { resourceEstimate }),
    ...(synthesisContext === undefined ? {} : { synthesisContext }),
  };
}
