import {
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  createShortTermMemoryRecord,
} from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { runWorkerMemoryConsolidation } from './index';

const agentId = asAgentId('agent-1');

function createStudyMemory(index: number) {
  return createShortTermMemoryRecord({
    id: `memory-${index}`,
    agentId,
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

describe('worker memory consolidation', () => {
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

    expect(result.records.map((record) => record.id)).toEqual(['memory-3', 'memory-2', 'memory-1']);
    expect(result.patches).toEqual([
      {
        id: 'ltm-patch-agent-1-habit-study-before-work-1000',
        agentId,
        section: 'habits',
        key: 'study-before-work',
        statement: 'Studies before starting work.',
        confidence: 0.6,
        provenanceRecordIds: ['memory-1', 'memory-2', 'memory-3'],
        proposedAt: 1000,
      },
    ]);
    expect(result.profile.habits).toEqual([
      {
        key: 'study-before-work',
        statement: 'Studies before starting work.',
        confidence: 0.6,
        provenanceRecordIds: ['memory-1', 'memory-2', 'memory-3'],
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
});
