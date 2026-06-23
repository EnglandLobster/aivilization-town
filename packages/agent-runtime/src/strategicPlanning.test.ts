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
    expect(plan.branches.map((branch) => branch.id)).toEqual(['development']);
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
  });

  test('compiles complex town objectives into explicit executable domain branches', () => {
    const statement =
      'Upgrade residential tier, apply for Stock Clerk work, then craft Chip for the electronics market.';
    const plan = compileStrategicObjectiveToBranchPlan({
      objective: {
        id: 'objective-town-stack',
        agentId,
        statement,
        priority: 3,
        source: 'human',
        affinityTags: ['residential', 'work', 'production'],
        createdAt: 100,
        updatedAt: 100,
      },
      issuedAt: 100,
    });

    expect(plan.objective).toBe(statement);
    expect(plan.branches.map((branch) => branch.id)).toEqual([
      'residential-readiness',
      'employment',
      'production',
    ]);
    expect(plan.branches.map((branch) => branch.id)).not.toContain('primary-objective');
    expect(plan.branches[0]).toMatchObject({
      id: 'residential-readiness',
      subtasks: [
        {
          id: 'upgrade-residential-tier',
          description: `Upgrade residential tier toward: ${statement}`,
          intentionAffinityTags: ['residential'],
          memoryAffinityTags: ['residential'],
          profileAffinityTags: ['residential'],
          signalKeys: ['production', 'residential', 'work'],
        },
      ],
    });
    expect(plan.branches[1]).toMatchObject({
      id: 'employment',
      subtasks: [
        {
          id: 'apply-for-work',
          description: `Apply for work toward: ${statement}`,
          intentionAffinityTags: ['work'],
          memoryAffinityTags: ['work'],
          profileAffinityTags: ['work'],
          signalKeys: ['production', 'residential', 'work'],
        },
      ],
    });
    expect(plan.branches[2]).toMatchObject({
      id: 'production',
      subtasks: [
        {
          id: 'produce-target',
          description: `Produce toward: ${statement}`,
          intentionAffinityTags: ['production'],
          memoryAffinityTags: ['production'],
          profileAffinityTags: ['production'],
          signalKeys: ['production', 'residential', 'work'],
        },
      ],
    });
  });

  test('keeps a generic primary fallback for objectives without executable domain intent', () => {
    const plan = compileStrategicObjectiveToBranchPlan({
      objective: {
        id: 'objective-reflect',
        agentId,
        statement: 'Reflect on the shape of the town square.',
        priority: 1,
        source: 'human',
        affinityTags: ['reflection'],
        createdAt: 100,
        updatedAt: 100,
      },
      issuedAt: 100,
    });

    expect(plan.branches).toEqual([
      {
        id: 'primary-objective',
        objective: 'Reflect on the shape of the town square.',
        subtasks: [
          {
            id: 'pursue-objective',
            description: 'Pursue: Reflect on the shape of the town square.',
            basePriority: 9,
            signalKeys: ['reflection'],
            intentionAffinityTags: ['reflection'],
            memoryAffinityTags: ['reflection'],
            profileAffinityTags: ['reflection'],
          },
        ],
      },
    ]);
  });
});
