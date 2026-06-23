import { asAgentId } from '@aivilization/sim-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileBranchPlanProgressRepository,
  InMemoryBranchPlanProgressRepository,
  markSubtaskBlocked,
} from './index';

const agentId = asAgentId('agent-1');
const otherAgentId = asAgentId('agent-2');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('branch plan progress repositories', () => {
  test('in-memory repository creates progress and returns defensive clones', async () => {
    const repository = new InMemoryBranchPlanProgressRepository();

    const created = await repository.getOrCreate({
      planId: 'plan-1',
      agentId,
      createdAt: 100,
    });
    const blocked = markSubtaskBlocked(created, {
      subtaskId: 'work',
      reason: 'repeated-failure: energy too low',
      blockedAt: 200,
    });
    await repository.save(blocked);

    const firstRead = await repository.getOrCreate({ planId: 'plan-1', agentId, createdAt: 999 });
    const secondRead = await repository.getOrCreate({ planId: 'plan-1', agentId, createdAt: 999 });

    expect(created).toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 100,
    });
    expect(firstRead).toEqual(blocked);
    expect(secondRead).toEqual(blocked);
    expect(firstRead).not.toBe(secondRead);
  });

  test('in-memory repository isolates agents and plan ids', async () => {
    const repository = new InMemoryBranchPlanProgressRepository();
    const blocked = markSubtaskBlocked(
      await repository.getOrCreate({ planId: 'plan-1', agentId, createdAt: 100 }),
      {
        subtaskId: 'work',
        reason: 'repeated-failure: energy too low',
        blockedAt: 200,
      },
    );
    await repository.save(blocked);

    await expect(
      repository.getOrCreate({ planId: 'plan-1', agentId: otherAgentId, createdAt: 300 }),
    ).resolves.toEqual({
      planId: 'plan-1',
      agentId: otherAgentId,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 300,
    });
    await expect(
      repository.getOrCreate({ planId: 'plan-2', agentId, createdAt: 400 }),
    ).resolves.toEqual({
      planId: 'plan-2',
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 400,
    });
  });

  test('file repository recovers latest saved progress after restart', async () => {
    const rootDir = createTempRoot();
    const repository = new FileBranchPlanProgressRepository({ rootDir });
    const created = await repository.getOrCreate({ planId: 'plan-1', agentId, createdAt: 100 });
    await repository.save(
      markSubtaskBlocked(created, {
        subtaskId: 'work',
        reason: 'repeated-failure: energy too low',
        blockedAt: 200,
      }),
    );
    await repository.save(
      markSubtaskBlocked(created, {
        subtaskId: 'study',
        reason: 'major-context-shift: market changed',
        blockedAt: 300,
      }),
    );

    const restarted = new FileBranchPlanProgressRepository({ rootDir });

    await expect(
      restarted.getOrCreate({ planId: 'plan-1', agentId, createdAt: 999 }),
    ).resolves.toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [
        {
          subtaskId: 'study',
          reason: 'major-context-shift: market changed',
          blockedAt: 300,
        },
      ],
      updatedAt: 300,
    });
  });
});

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-plan-progress-'));
  tempRoots.push(root);
  return root;
}
