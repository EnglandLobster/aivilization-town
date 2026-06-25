import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  compileStrategicObjectiveToBranchPlan,
  compileStrategicObjectiveWithoutObjectiveDecomposition,
} from './index';

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

  test('compiles without-objective-decomposition ablations into direct domain action branches', () => {
    const statement =
      'Study, earn money, craft Chip, trade resources, and maintain health for long-term growth.';
    const result = compileStrategicObjectiveWithoutObjectiveDecomposition({
      objective: {
        id: 'objective-without-od',
        agentId,
        statement,
        priority: 3,
        source: 'system',
        affinityTags: ['study', 'work', 'production', 'trade', 'health'],
        createdAt: 100,
        updatedAt: 100,
      },
      issuedAt: 100,
    });

    expect(result.planningTrace).toEqual({
      status: 'deterministic',
      source: 'deterministic',
      message: 'Planner ablation without objective decomposition',
    });
    expect(result.plan.objective).toBe(statement);
    expect(result.plan.branches.map((branch) => branch.id)).toEqual([
      'without-objective-decomposition-development',
      'without-objective-decomposition-health',
      'without-objective-decomposition-employment',
      'without-objective-decomposition-production',
      'without-objective-decomposition-market',
    ]);
    expect(result.plan.branches.every((branch) => branch.subtasks.length === 1)).toBe(true);
    expect(
      result.plan.branches.flatMap((branch) => branch.subtasks.map((subtask) => subtask.id)),
    ).toEqual([
      'study-direct-action',
      'health-direct-action',
      'work-direct-action',
      'production-direct-action',
      'trade-direct-action',
    ]);
    expect(result.plan.branches[0]?.subtasks[0]).toMatchObject({
      description:
        'Directly generate study actions without structured objective decomposition: Study toward the long-horizon objective.',
      basePriority: 13,
      signalKeys: ['health', 'production', 'study', 'trade', 'work'],
      intentionAffinityTags: ['study'],
      memoryAffinityTags: ['study'],
      profileAffinityTags: ['study'],
    });
    expect(
      result.plan.branches.flatMap((branch) =>
        branch.subtasks.flatMap((subtask) => subtask.dependsOnSubtaskIds ?? []),
      ),
    ).toEqual([]);
  });

  test('compiles health recovery objectives into see-doctor branches', () => {
    const statement = 'Recover health by seeing a doctor before returning to work.';
    const plan = compileStrategicObjectiveToBranchPlan({
      objective: {
        id: 'objective-health',
        agentId,
        statement,
        priority: 2,
        source: 'human',
        affinityTags: ['health'],
        createdAt: 100,
        updatedAt: 100,
      },
      issuedAt: 100,
    });

    expect(plan.branches.map((branch) => branch.id)).toEqual(['health']);
    expect(plan.branches[0]).toMatchObject({
      id: 'health',
      objective: 'Recover health before pursuing the long-horizon objective.',
      subtasks: [
        {
          id: 'see-doctor',
          description: `See doctor toward: ${statement}`,
          intentionAffinityTags: ['health'],
          memoryAffinityTags: ['health'],
          profileAffinityTags: ['health'],
          signalKeys: ['health'],
        },
      ],
    });
  });

  test('compiles satiety recovery objectives into eat branches', () => {
    const statement = 'Recover satiety by eating food before walking around town.';
    const plan = compileStrategicObjectiveToBranchPlan({
      objective: {
        id: 'objective-satiety',
        agentId,
        statement,
        priority: 2,
        source: 'human',
        affinityTags: ['satiety'],
        createdAt: 100,
        updatedAt: 100,
      },
      issuedAt: 100,
    });

    expect(plan.branches.map((branch) => branch.id)).toEqual(['satiety']);
    expect(plan.branches[0]).toMatchObject({
      id: 'satiety',
      objective: 'Recover satiety before pursuing the long-horizon objective.',
      subtasks: [
        {
          id: 'eat',
          description: `Eat toward: ${statement}`,
          intentionAffinityTags: ['eat', 'satiety'],
          memoryAffinityTags: ['eat', 'satiety'],
          profileAffinityTags: ['eat', 'satiety'],
          signalKeys: ['eat', 'satiety'],
        },
      ],
    });
  });

  test('compiles recovery objectives with eat affinity into satiety branches', () => {
    const statement = 'Recover from recent setbacks before pursuing new growth.';
    const plan = compileStrategicObjectiveToBranchPlan({
      objective: {
        id: 'objective-recent-hunger',
        agentId,
        statement,
        priority: 3,
        source: 'agent',
        affinityTags: ['recover', 'maintain', 'eat', 'satiety'],
        createdAt: 100,
        updatedAt: 100,
      },
      issuedAt: 100,
    });

    expect(plan.branches.map((branch) => branch.id)).toEqual(['satiety']);
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
