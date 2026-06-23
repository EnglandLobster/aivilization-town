import {
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  createShortTermMemoryRecord,
} from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { runWorkerMemoryConsolidation, runWorkerMemoryConsolidationBatch } from './index';

const agentId = asAgentId('agent-1');
const otherAgentId = asAgentId('agent-2');

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
});
