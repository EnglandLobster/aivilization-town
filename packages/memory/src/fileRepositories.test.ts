import { asAgentId } from '@aivilization/sim-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileAgentIntentionRepository,
  FileLongTermProfileRepository,
  FileShortTermMemoryRepository,
  asMemoryRecordId,
  createShortTermMemoryRecord,
  type LongHorizonObjective,
} from './index';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-memory-repository-'));
  tmpRoots.push(root);
  return root;
}

describe('file short-term memory repository', () => {
  test('persists appended records across repository instances', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const firstRepository = new FileShortTermMemoryRepository({ rootDir });

    await firstRepository.append(
      createShortTermMemoryRecord({
        id: 'memory-1',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Studied before work.',
        occurredAt: 100,
        importanceScore: 0.8,
        source: { eventIds: [] },
        tags: ['study'],
      }),
    );
    const restartedRepository = new FileShortTermMemoryRepository({ rootDir });

    await expect(
      restartedRepository.retrieve({
        agentId,
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toMatchObject([
      {
        id: 'memory-1',
        agentId: 'agent-1',
        summary: 'Studied before work.',
      },
    ]);
  });
});

describe('file agent intention repository', () => {
  test('persists objective and scheduled intentions across repository instances', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const objective: LongHorizonObjective = {
      id: 'objective-study',
      agentId,
      statement: 'Study enough to qualify for better jobs.',
      priority: 3,
      source: 'agent',
      affinityTags: ['study'],
      createdAt: 100,
      updatedAt: 100,
    };
    const firstRepository = new FileAgentIntentionRepository({ rootDir });

    await firstRepository.setObjective(agentId, objective);
    await firstRepository.upsertScheduledIntentions(agentId, [
      {
        id: 'study-block',
        agentId,
        objectiveId: objective.id,
        description: 'Study at the library.',
        priority: 2,
        startsAt: 200,
        endsAt: 300,
        status: 'planned',
        affinityTags: ['study'],
        createdAt: 150,
        updatedAt: 150,
      },
    ]);
    const restartedRepository = new FileAgentIntentionRepository({ rootDir });

    await expect(restartedRepository.getOrCreate(agentId)).resolves.toMatchObject({
      activeObjective: objective,
      scheduledIntentions: [{ id: 'study-block', description: 'Study at the library.' }],
      updatedAt: 150,
    });
  });
});

describe('file long-term profile repository', () => {
  test('persists applied profile patches across repository instances', async () => {
    const rootDir = createRootDir();
    const agentId = asAgentId('agent-1');
    const firstRepository = new FileLongTermProfileRepository({ rootDir });

    await firstRepository.applyPatches(agentId, [
      {
        id: 'patch-habit',
        agentId,
        section: 'habits',
        key: 'study-before-work',
        statement: 'Studies before starting work.',
        confidence: 0.7,
        provenanceRecordIds: [asMemoryRecordId('memory-1')],
        proposedAt: 200,
      },
    ]);
    const restartedRepository = new FileLongTermProfileRepository({ rootDir });

    await expect(restartedRepository.getOrCreate(agentId)).resolves.toMatchObject({
      agentId: 'agent-1',
      habits: [
        {
          key: 'study-before-work',
          statement: 'Studies before starting work.',
          confidence: 0.7,
          provenanceRecordIds: ['memory-1'],
          updatedAt: 200,
        },
      ],
    });
  });
});
