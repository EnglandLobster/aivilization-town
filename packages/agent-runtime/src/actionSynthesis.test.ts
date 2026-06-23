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
});

function createAction(
  id: string,
  priority: number,
  resourceEstimate?: ActionResourceEstimate,
): AtomicActionProposal {
  return {
    id,
    description: id,
    commandType: 'AgentWork',
    payload: { occupationName: 'Cleaner', laborSeconds: 60 },
    priority,
    ...(resourceEstimate === undefined ? {} : { resourceEstimate }),
  };
}
