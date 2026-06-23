import { describe, expect, test } from 'vitest';
import { createBranchPlan, selectPrioritizedSubtask } from './index';

describe('branch-thinking planner', () => {
  test('rejects empty branches and duplicate branch ids', () => {
    expect(() => createBranchPlan({ objective: 'survive', branches: [] })).toThrow(/branch/);

    expect(() =>
      createBranchPlan({
        objective: 'survive',
        branches: [
          {
            id: 'work',
            objective: 'earn money',
            subtasks: [{ id: 'shift', description: 'work', basePriority: 1 }],
          },
          {
            id: 'work',
            objective: 'study',
            subtasks: [{ id: 'study', description: 'study', basePriority: 1 }],
          },
        ],
      }),
    ).toThrow(/duplicate branch id work/);
  });

  test('selects the highest-scoring subtask from explicit context signals', () => {
    const plan = createBranchPlan({
      objective: 'stabilize life',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [
            {
              id: 'work',
              description: 'take a work shift',
              basePriority: 2,
              signalKeys: ['low-money'],
            },
          ],
        },
        {
          id: 'health',
          objective: 'recover',
          subtasks: [
            {
              id: 'eat',
              description: 'buy and eat food',
              basePriority: 1,
              signalKeys: ['low-satiety'],
            },
          ],
        },
      ],
    });

    expect(
      selectPrioritizedSubtask({ plan, signals: [{ key: 'low-satiety', weight: 5 }] }),
    ).toEqual({
      branchId: 'health',
      subtaskId: 'eat',
      description: 'buy and eat food',
      score: 6,
    });
  });
});
