import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createBranchPlan,
  createBranchPlanProgress,
  hasSelectableSubtasks,
  markSubtaskCompleted,
  scorePrioritizedSubtaskCandidates,
  selectPrioritizedSubtask,
} from './index';

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

  test('adds profile influence when selecting prioritized subtasks', () => {
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
              basePriority: 4,
            },
          ],
        },
        {
          id: 'development',
          objective: 'improve education',
          subtasks: [
            {
              id: 'study',
              description: 'self study',
              basePriority: 2,
              profileAffinityTags: ['study'],
            },
          ],
        },
      ],
    });

    expect(
      selectPrioritizedSubtask({
        plan,
        signals: [],
        profileInfluence: {
          study: {
            score: 3,
            matches: [],
          },
        },
      }),
    ).toEqual({
      branchId: 'development',
      subtaskId: 'study',
      description: 'self study',
      score: 5,
    });
  });

  test('adds intention influence when selecting prioritized subtasks', () => {
    const plan = createBranchPlan({
      objective: 'follow long-term goal',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 4 }],
        },
        {
          id: 'development',
          objective: 'study',
          subtasks: [
            {
              id: 'study',
              description: 'study now',
              basePriority: 2,
              intentionAffinityTags: ['study'],
            },
          ],
        },
      ],
    });

    expect(
      selectPrioritizedSubtask({
        plan,
        signals: [],
        intentionInfluence: {
          study: { score: 3, matches: [] },
        },
      }),
    ).toMatchObject({ branchId: 'development', subtaskId: 'study', score: 5 });
  });

  test('scores selectable subtask candidates with deterministic breakdowns', () => {
    const plan = createBranchPlan({
      objective: 'balance survival and growth',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [
            { id: 'work', description: 'work shift', basePriority: 3, signalKeys: ['low-money'] },
          ],
        },
        {
          id: 'recovery',
          objective: 'recover energy',
          subtasks: [
            {
              id: 'sleep',
              description: 'rest before work',
              basePriority: 1,
              signalKeys: ['low-energy'],
            },
          ],
        },
        {
          id: 'development',
          objective: 'improve education',
          subtasks: [
            {
              id: 'study',
              description: 'self study',
              basePriority: 2,
            },
          ],
        },
      ],
    });

    expect(
      scorePrioritizedSubtaskCandidates({
        plan,
        signals: [
          { key: 'low-energy', weight: 2 },
          { key: 'low-energy', weight: 0.5 },
        ],
        intentionInfluence: {
          study: { score: 3, matches: [] },
        },
        memoryInfluence: {
          sleep: { score: 1.5, matches: [] },
        },
        profileInfluence: {
          study: { score: 0.75, matches: [] },
        },
      }),
    ).toEqual([
      {
        branchId: 'development',
        subtaskId: 'study',
        description: 'self study',
        score: 5.75,
        scoreBreakdown: {
          basePriorityScore: 2,
          signalInfluenceScore: 0,
          intentionInfluenceScore: 3,
          memoryInfluenceScore: 0,
          profileInfluenceScore: 0.75,
        },
      },
      {
        branchId: 'recovery',
        subtaskId: 'sleep',
        description: 'rest before work',
        score: 5,
        scoreBreakdown: {
          basePriorityScore: 1,
          signalInfluenceScore: 2.5,
          intentionInfluenceScore: 0,
          memoryInfluenceScore: 1.5,
          profileInfluenceScore: 0,
        },
      },
      {
        branchId: 'income',
        subtaskId: 'work',
        description: 'work shift',
        score: 3,
        scoreBreakdown: {
          basePriorityScore: 3,
          signalInfluenceScore: 0,
          intentionInfluenceScore: 0,
          memoryInfluenceScore: 0,
          profileInfluenceScore: 0,
        },
      },
    ]);
  });

  test('selects only runnable subtasks after applying progress and dependencies', () => {
    const plan = createBranchPlan({
      objective: 'produce copper ingot',
      branches: [
        {
          id: 'production',
          objective: 'craft components',
          subtasks: [
            {
              id: 'gather-ore',
              description: 'gather copper ore',
              basePriority: 2,
            },
            {
              id: 'craft-ingot',
              description: 'craft copper ingot',
              basePriority: 10,
              dependsOnSubtaskIds: ['gather-ore'],
            },
          ],
        },
      ],
    });
    const progress = createBranchPlanProgress({
      planId: 'plan-1',
      agentId: asAgentId('agent-1'),
      createdAt: 100,
    });

    expect(selectPrioritizedSubtask({ plan, signals: [], progress })).toEqual({
      branchId: 'production',
      subtaskId: 'gather-ore',
      description: 'gather copper ore',
      score: 2,
    });

    expect(
      selectPrioritizedSubtask({
        plan,
        signals: [],
        progress: markSubtaskCompleted(progress, {
          subtaskId: 'gather-ore',
          completedAt: 200,
        }),
      }),
    ).toEqual({
      branchId: 'production',
      subtaskId: 'craft-ingot',
      description: 'craft copper ingot',
      score: 10,
    });
  });

  test('reports whether progress leaves any selectable subtasks', () => {
    const plan = createBranchPlan({
      objective: 'produce copper ingot',
      branches: [
        {
          id: 'production',
          objective: 'craft components',
          subtasks: [
            { id: 'gather-ore', description: 'gather copper ore', basePriority: 2 },
            {
              id: 'craft-ingot',
              description: 'craft copper ingot',
              basePriority: 10,
              dependsOnSubtaskIds: ['gather-ore'],
            },
          ],
        },
      ],
    });
    const initial = createBranchPlanProgress({
      planId: 'plan-1',
      agentId: asAgentId('agent-1'),
      createdAt: 100,
    });
    const gathered = markSubtaskCompleted(initial, {
      subtaskId: 'gather-ore',
      completedAt: 200,
    });
    const completed = markSubtaskCompleted(gathered, {
      subtaskId: 'craft-ingot',
      completedAt: 300,
    });

    expect(hasSelectableSubtasks({ plan, progress: initial })).toBe(true);
    expect(hasSelectableSubtasks({ plan, progress: gathered })).toBe(true);
    expect(hasSelectableSubtasks({ plan, progress: completed })).toBe(false);
  });

  test('rejects dependency ids outside the current branch or ahead in sequence', () => {
    expect(() =>
      createBranchPlan({
        objective: 'bad dependencies',
        branches: [
          {
            id: 'production',
            objective: 'craft components',
            subtasks: [
              {
                id: 'craft-ingot',
                description: 'craft ingot',
                basePriority: 10,
                dependsOnSubtaskIds: ['gather-ore'],
              },
              {
                id: 'gather-ore',
                description: 'gather ore',
                basePriority: 1,
              },
            ],
          },
        ],
      }),
    ).toThrow(/dependency gather-ore must appear earlier in branch production/);

    expect(() =>
      createBranchPlan({
        objective: 'bad dependencies',
        branches: [
          {
            id: 'production',
            objective: 'craft components',
            subtasks: [
              {
                id: 'craft-ingot',
                description: 'craft ingot',
                basePriority: 10,
                dependsOnSubtaskIds: ['market-scan'],
              },
            ],
          },
          {
            id: 'market',
            objective: 'inspect prices',
            subtasks: [
              {
                id: 'market-scan',
                description: 'scan market',
                basePriority: 1,
              },
            ],
          },
        ],
      }),
    ).toThrow(/dependency market-scan must appear earlier in branch production/);
  });
});
