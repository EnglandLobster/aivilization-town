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
    const readonlyRead = await repository.get({ planId: 'plan-1', agentId });

    expect(created).toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 100,
    });
    expect(firstRead).toEqual(blocked);
    expect(secondRead).toEqual(blocked);
    expect(readonlyRead).toEqual(blocked);
    expect(firstRead).not.toBe(secondRead);
    expect(readonlyRead).not.toBe(firstRead);
    await expect(repository.get({ planId: 'missing-plan', agentId })).resolves.toBeUndefined();
    await expect(
      repository.getOrCreate({ planId: 'missing-plan', agentId, createdAt: 777 }),
    ).resolves.toMatchObject({ planId: 'missing-plan', updatedAt: 777 });
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

    await expect(restarted.get({ planId: 'plan-1', agentId })).resolves.toEqual({
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

  test('file repository suppresses semantically unchanged saves', async () => {
    const rootDir = createTempRoot();
    const repository = new FileBranchPlanProgressRepository({ rootDir });
    const progress = await repository.getOrCreate({ planId: 'plan-1', agentId, createdAt: 100 });
    const bytesAfterCreate = repository.getStorageDiagnostics().fileBytes;

    await repository.save(structuredClone(progress));

    expect(repository.getStorageDiagnostics()).toMatchObject({
      completeRecordCount: 1,
      fileBytes: bytesAfterCreate,
      suppressedDuplicateSaveCount: 1,
    });
  });

  test('file repository atomically compacts latest progress in explicit single-writer mode', async () => {
    const rootDir = createTempRoot();
    const repository = new FileBranchPlanProgressRepository({
      rootDir,
      singleWriterCompactionMaximumBytes: 1,
    });
    const created = await repository.getOrCreate({ planId: 'plan-1', agentId, createdAt: 100 });
    const blocked = markSubtaskBlocked(created, {
      subtaskId: 'work',
      reason: 'repeated-failure: energy too low',
      blockedAt: 200,
    });

    await repository.save(blocked);

    expect(repository.getStorageDiagnostics()).toMatchObject({
      completeRecordCount: 1,
      hotRecordCount: 1,
      compactionCount: 2,
    });
    expect(repository.getStorageDiagnostics().compactionReclaimedBytes).toBeGreaterThan(0);
    await expect(repository.get({ planId: 'plan-1', agentId })).resolves.toEqual(blocked);
  });

  test('file repository refreshes its key index after another instance appends', async () => {
    const rootDir = createTempRoot();
    const reader = new FileBranchPlanProgressRepository({ rootDir });
    const writer = new FileBranchPlanProgressRepository({ rootDir });

    await expect(reader.get({ planId: 'external-plan', agentId })).resolves.toBeUndefined();
    const created = await writer.getOrCreate({
      planId: 'external-plan',
      agentId,
      createdAt: 500,
    });

    await expect(reader.get({ planId: 'external-plan', agentId })).resolves.toEqual(created);
  });

  test('file repository bounds hot progress and cold-reads an evicted plan after restart', async () => {
    const rootDir = createTempRoot();
    const repository = new FileBranchPlanProgressRepository({ rootDir });
    for (let index = 0; index < 10; index += 1) {
      await repository.getOrCreate({
        planId: `plan-${index}`,
        agentId,
        createdAt: 100 + index,
      });
    }

    const restarted = new FileBranchPlanProgressRepository({ rootDir });
    expect(restarted.getStorageDiagnostics()).toMatchObject({
      completeRecordCount: 10,
      hotAgentCount: 1,
      hotRecordCount: 4,
      hotRecordsPerAgent: 4,
      hasIncompleteTrailingRow: false,
    });
    await expect(restarted.get({ planId: 'plan-0', agentId })).resolves.toEqual({
      planId: 'plan-0',
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 100,
    });
    expect(restarted.getStorageDiagnostics().hotRecordCount).toBe(4);
  });
});

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-plan-progress-'));
  tempRoots.push(root);
  return root;
}
