import {
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  createShortTermMemoryRecord,
} from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileMemoryConsolidationCursorStore,
  InMemoryMemoryConsolidationCursorStore,
  runWorkerMemoryConsolidation,
  runWorkerMemoryConsolidationBatch,
  runWorkerMemoryConsolidationSchedule,
} from './index';

const agentId = asAgentId('agent-1');
const otherAgentId = asAgentId('agent-2');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function createStudyMemory(index: number, input: { readonly agentId?: typeof agentId } = {}) {
  const ownerAgentId = input.agentId ?? agentId;
  return createShortTermMemoryRecord({
    id: `memory-${ownerAgentId}-${index}`,
    agentId: ownerAgentId,
    kind: 'action',
    status: 'succeeded',
    summary: 'Completed a focused study session.',
    occurredAt: index,
    importanceScore: 0.6,
    source: { eventIds: [] },
    tags: ['study'],
    consolidationHint: {
      kind: 'habit',
      patternKey: 'study-before-work',
      statement: 'Studies before starting work.',
    },
  });
}

function createUnhintedStudyMemory(
  index: number,
  input: { readonly agentId?: typeof agentId } = {},
) {
  const ownerAgentId = input.agentId ?? agentId;
  return createShortTermMemoryRecord({
    id: `reflection-study-${ownerAgentId}-${index}`,
    agentId: ownerAgentId,
    kind: 'action',
    status: 'succeeded',
    summary: 'Completed a focused study session.',
    occurredAt: index,
    importanceScore: 0.7,
    source: { eventIds: [] },
    tags: ['study', 'education'],
  });
}

describe('worker memory consolidation', () => {
  test('synthesizes unhinted short-term memories into reflective long-term profile entries', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    await shortTermMemoryRepository.appendMany([
      createUnhintedStudyMemory(1),
      createUnhintedStudyMemory(2),
      createUnhintedStudyMemory(3),
    ]);

    const result = await runWorkerMemoryConsolidation({
      agentId,
      shortTermMemoryRepository,
      longTermProfileRepository,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 1000,
    });

    expect(result.reflectiveInsights).toEqual([
      {
        id: 'reflection-agent-1-habit-study-routine-1000',
        agentId,
        kind: 'habit',
        topicKey: 'study-routine',
        statement: 'Repeated successful study sessions suggest a reliable study routine.',
        confidence: 0.7,
        evidenceRecordIds: [
          'reflection-study-agent-1-1',
          'reflection-study-agent-1-2',
          'reflection-study-agent-1-3',
        ],
        generatedAt: 1000,
        tags: ['study', 'education', 'routine'],
      },
    ]);
    expect(result.patches).toEqual([
      {
        id: 'ltm-patch-agent-1-reflection-habit-study-routine-1000',
        agentId,
        section: 'habits',
        key: 'study-routine',
        statement: 'Repeated successful study sessions suggest a reliable study routine.',
        confidence: 0.7,
        provenanceRecordIds: [
          'reflection-study-agent-1-1',
          'reflection-study-agent-1-2',
          'reflection-study-agent-1-3',
        ],
        proposedAt: 1000,
      },
    ]);
    expect(result.profile.habits).toEqual([
      {
        key: 'study-routine',
        statement: 'Repeated successful study sessions suggest a reliable study routine.',
        confidence: 0.7,
        provenanceRecordIds: [
          'reflection-study-agent-1-1',
          'reflection-study-agent-1-2',
          'reflection-study-agent-1-3',
        ],
        updatedAt: 1000,
      },
    ]);
    await expect(longTermProfileRepository.getOrCreate(agentId)).resolves.toEqual(result.profile);
  });

  test('promotes repeated short-term memory patterns into long-term profile entries', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    await shortTermMemoryRepository.appendMany([
      createStudyMemory(1),
      createStudyMemory(2),
      createStudyMemory(3),
    ]);

    const result = await runWorkerMemoryConsolidation({
      agentId,
      shortTermMemoryRepository,
      longTermProfileRepository,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 1000,
    });

    expect(result.records.map((record) => record.id)).toEqual([
      'memory-agent-1-3',
      'memory-agent-1-2',
      'memory-agent-1-1',
    ]);
    expect(result.patches).toEqual([
      {
        id: 'ltm-patch-agent-1-habit-study-before-work-1000',
        agentId,
        section: 'habits',
        key: 'study-before-work',
        statement: 'Studies before starting work.',
        confidence: 0.6,
        provenanceRecordIds: ['memory-agent-1-1', 'memory-agent-1-2', 'memory-agent-1-3'],
        proposedAt: 1000,
      },
    ]);
    expect(result.profile.habits).toEqual([
      {
        key: 'study-before-work',
        statement: 'Studies before starting work.',
        confidence: 0.6,
        provenanceRecordIds: ['memory-agent-1-1', 'memory-agent-1-2', 'memory-agent-1-3'],
        updatedAt: 1000,
      },
    ]);
    await expect(longTermProfileRepository.getOrCreate(agentId)).resolves.toEqual(result.profile);
  });

  test('leaves the profile unchanged when not enough records match a consolidation pattern', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    await shortTermMemoryRepository.appendMany([createStudyMemory(1), createStudyMemory(2)]);

    const result = await runWorkerMemoryConsolidation({
      agentId,
      shortTermMemoryRepository,
      longTermProfileRepository,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 1000,
    });

    expect(result.records).toHaveLength(2);
    expect(result.patches).toEqual([]);
    expect(result.profile.habits).toEqual([]);
  });

  test('runs consolidation once per unique agent in first-seen order', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    await shortTermMemoryRepository.appendMany([
      createStudyMemory(1, { agentId }),
      createStudyMemory(2, { agentId }),
      createStudyMemory(3, { agentId }),
      createStudyMemory(1, { agentId: otherAgentId }),
      createStudyMemory(2, { agentId: otherAgentId }),
      createStudyMemory(3, { agentId: otherAgentId }),
    ]);

    const result = await runWorkerMemoryConsolidationBatch({
      agentIds: [otherAgentId, agentId, otherAgentId],
      shortTermMemoryRepository,
      longTermProfileRepository,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 1000,
    });

    expect(result.agentIds).toEqual([otherAgentId, agentId]);
    expect(result.results.map((agentResult) => agentResult.agentId)).toEqual([
      otherAgentId,
      agentId,
    ]);
    expect(result.patchCount).toBe(2);
    await expect(longTermProfileRepository.getOrCreate(agentId)).resolves.toMatchObject({
      habits: [{ key: 'study-before-work' }],
    });
    await expect(longTermProfileRepository.getOrCreate(otherAgentId)).resolves.toMatchObject({
      habits: [{ key: 'study-before-work' }],
    });
  });

  test('runs scheduled consolidation only for records after each agent cursor', async () => {
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const cursorStore = new InMemoryMemoryConsolidationCursorStore();
    await shortTermMemoryRepository.appendMany([
      createStudyMemory(1),
      createStudyMemory(2),
      createStudyMemory(3),
    ]);

    const first = await runWorkerMemoryConsolidationSchedule({
      agentIds: [agentId],
      shortTermMemoryRepository,
      longTermProfileRepository,
      cursorStore,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 1000,
    });

    expect(first.results[0]?.records.map((record) => record.id)).toEqual([
      'memory-agent-1-1',
      'memory-agent-1-2',
      'memory-agent-1-3',
    ]);
    expect(first.patchCount).toBe(1);
    expect(first.cursors).toEqual([
      {
        agentId,
        lastProcessedOccurredAt: 3,
        updatedAt: 1000,
      },
    ]);

    const second = await runWorkerMemoryConsolidationSchedule({
      agentIds: [agentId],
      shortTermMemoryRepository,
      longTermProfileRepository,
      cursorStore,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 2000,
    });

    expect(second.results[0]?.records).toEqual([]);
    expect(second.patchCount).toBe(0);
    expect(second.cursors).toEqual([]);

    await shortTermMemoryRepository.appendMany([
      createStudyMemory(4),
      createStudyMemory(5),
      createStudyMemory(6),
    ]);

    const third = await runWorkerMemoryConsolidationSchedule({
      agentIds: [agentId],
      shortTermMemoryRepository,
      longTermProfileRepository,
      cursorStore,
      retrievalLimit: 10,
      minPatternCount: 3,
      proposedAt: 3000,
    });

    expect(third.results[0]?.records.map((record) => record.id)).toEqual([
      'memory-agent-1-4',
      'memory-agent-1-5',
      'memory-agent-1-6',
    ]);
    expect(third.patchCount).toBe(1);
    expect(third.cursors).toEqual([
      {
        agentId,
        lastProcessedOccurredAt: 6,
        updatedAt: 3000,
      },
    ]);
  });

  test('persists consolidation cursors across store restarts', async () => {
    const rootDir = createTempRoot();
    const store = new FileMemoryConsolidationCursorStore({ rootDir });

    await store.saveCursor({ agentId, lastProcessedOccurredAt: 3, updatedAt: 1000 });
    await store.saveCursor({ agentId, lastProcessedOccurredAt: 6, updatedAt: 2000 });
    await store.saveCursor({ agentId: otherAgentId, lastProcessedOccurredAt: 2, updatedAt: 1500 });

    const restarted = new FileMemoryConsolidationCursorStore({ rootDir });

    await expect(restarted.getCursor(agentId)).resolves.toEqual({
      agentId,
      lastProcessedOccurredAt: 6,
      updatedAt: 2000,
    });
    await expect(restarted.getCursor(otherAgentId)).resolves.toEqual({
      agentId: otherAgentId,
      lastProcessedOccurredAt: 2,
      updatedAt: 1500,
    });
  });
});

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-memory-cursor-'));
  tempRoots.push(root);
  return root;
}
