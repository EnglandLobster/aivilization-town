import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { compileStrategicObjectiveToBranchPlan } from './index';

const agentId = asAgentId('agent-1');

describe('strategic objective planning', () => {
  test('compiles study-oriented human objectives into branch-thinking plans', () => {
    const plan = compileStrategicObjectiveToBranchPlan({
      objective: {
        id: 'objective-study',
        agentId,
        statement: 'Do not work yet; study until education score exceeds 100.',
        priority: 2,
        source: 'human',
        affinityTags: ['study', 'education'],
        createdAt: 100,
        updatedAt: 100,
      },
      issuedAt: 100,
    });

    expect(plan.objective).toBe('Do not work yet; study until education score exceeds 100.');
    expect(plan.branches.length).toBeGreaterThanOrEqual(2);
    expect(plan.branches.map((branch) => branch.id)).toEqual(['development', 'primary-objective']);
    expect(plan.branches[0]).toMatchObject({
      id: 'development',
      objective: 'Invest in education before short-term labor pressure dominates.',
      subtasks: [
        {
          id: 'study',
          description: 'Study toward the long-horizon objective.',
          basePriority: 12,
          intentionAffinityTags: ['study', 'education'],
          memoryAffinityTags: ['study', 'education'],
          profileAffinityTags: ['study', 'education'],
        },
      ],
    });
    expect(plan.branches[1]).toMatchObject({
      id: 'primary-objective',
      objective: 'Do not work yet; study until education score exceeds 100.',
      subtasks: [
        {
          id: 'pursue-objective',
          description: 'Pursue: Do not work yet; study until education score exceeds 100.',
          basePriority: 10,
          intentionAffinityTags: ['study', 'education'],
        },
      ],
    });
  });
});
