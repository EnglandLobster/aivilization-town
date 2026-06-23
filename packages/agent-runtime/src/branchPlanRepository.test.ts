import { asAgentId } from '@aivilization/sim-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createBranchPlan,
  FileBranchPlanRepository,
  InMemoryBranchPlanRepository,
  type BranchPlanRecord,
} from './index';

const agentId = asAgentId('agent-1');
const otherAgentId = asAgentId('agent-2');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('branch plan repositories', () => {
  test('in-memory repository saves plans and returns defensive clones', async () => {
    const repository = new InMemoryBranchPlanRepository();
    const record = createPlanRecord({ planId: 'plan-1', basePriority: 5, updatedAt: 100 });

    await repository.save(record);

    const firstRead = await repository.require({ planId: 'plan-1', agentId });
    const secondRead = await repository.require({ planId: 'plan-1', agentId });

    expect(firstRead).toEqual(record);
    expect(secondRead).toEqual(record);
    expect(firstRead).not.toBe(secondRead);
    expect(firstRead.plan).not.toBe(secondRead.plan);
    expect(firstRead.plan.branches).not.toBe(secondRead.plan.branches);
  });

  test('in-memory repository isolates agents and plan ids', async () => {
    const repository = new InMemoryBranchPlanRepository();
    await repository.save(createPlanRecord({ planId: 'plan-1', basePriority: 5, updatedAt: 100 }));

    await expect(
      repository.get({ planId: 'plan-1', agentId: otherAgentId }),
    ).resolves.toBeUndefined();
    await expect(repository.get({ planId: 'plan-2', agentId })).resolves.toBeUndefined();
    await expect(repository.require({ planId: 'missing-plan', agentId })).rejects.toThrow(
      'branch plan missing-plan for agent agent-1 was not found',
    );
  });

  test('file repository recovers latest saved plan after restart', async () => {
    const rootDir = createTempRoot();
    const repository = new FileBranchPlanRepository({ rootDir });
    await repository.save(createPlanRecord({ planId: 'plan-1', basePriority: 1, updatedAt: 100 }));
    await repository.save(createPlanRecord({ planId: 'plan-1', basePriority: 9, updatedAt: 200 }));

    const restarted = new FileBranchPlanRepository({ rootDir });

    await expect(restarted.require({ planId: 'plan-1', agentId })).resolves.toEqual(
      createPlanRecord({ planId: 'plan-1', basePriority: 9, updatedAt: 200 }),
    );
  });
});

function createPlanRecord(input: {
  readonly planId: string;
  readonly basePriority: number;
  readonly updatedAt: number;
}): BranchPlanRecord {
  return {
    planId: input.planId,
    agentId,
    plan: createBranchPlan({
      objective: 'develop education',
      branches: [
        {
          id: 'development',
          objective: 'improve education',
          subtasks: [
            {
              id: 'study',
              description: 'self study',
              basePriority: input.basePriority,
            },
          ],
        },
      ],
    }),
    createdAt: 50,
    updatedAt: input.updatedAt,
  };
}

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-branch-plans-'));
  tempRoots.push(root);
  return root;
}
