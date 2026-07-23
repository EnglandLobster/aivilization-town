import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT,
  InMemoryShortTermMemoryRepository,
  createShortTermMemoryRecord,
} from './index';

describe('in-memory short-term memory repository', () => {
  test('appends records and retrieves an agent-isolated defensive copy', async () => {
    const repository = new InMemoryShortTermMemoryRepository();
    await repository.append(
      createShortTermMemoryRecord({
        id: 'memory-1',
        agentId: asAgentId('agent-1'),
        kind: 'human-command',
        status: 'observed',
        summary: 'Human requested restaurant work.',
        occurredAt: 1000,
        importanceScore: 0.7,
        source: { eventIds: [] },
        tags: ['steering'],
      }),
    );

    const firstResult = await repository.retrieve({
      agentId: asAgentId('agent-1'),
      limit: 10,
    });
    firstResult.pop();

    const secondResult = await repository.retrieve({
      agentId: asAgentId('agent-1'),
      limit: 10,
    });
    expect(secondResult).toHaveLength(1);
  });

  test('bounds fast retrieval while retaining a lossless sequenced consolidation ledger', async () => {
    const repository = new InMemoryShortTermMemoryRepository();
    const agentId = asAgentId('agent-1');
    const recordCount = SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT + 6;
    await repository.appendMany(
      Array.from({ length: recordCount }, (_, index) => createMemory(index + 1, agentId)),
    );

    const recent = await repository.retrieve({
      agentId,
      limit: recordCount,
      orderBy: 'oldest-first',
    });
    const completeLedger = await repository.retrieveLedgerMany([{ agentId, limit: recordCount }]);
    const tail = await repository.retrieveLedgerMany([
      {
        agentId,
        appendedAfterSequence: SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT,
        limit: recordCount,
      },
    ]);

    expect(recent).toHaveLength(SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT);
    expect(recent[0]?.id).toBe('memory-7');
    expect(recent.at(-1)?.id).toBe(`memory-${recordCount}`);
    expect(completeLedger[0]?.entries).toHaveLength(recordCount);
    expect(completeLedger[0]?.entries[0]).toMatchObject({
      appendSequence: 1,
      record: { id: 'memory-1' },
    });
    expect(completeLedger[0]?.entries.at(-1)).toMatchObject({
      appendSequence: recordCount,
      record: { id: `memory-${recordCount}` },
    });
    expect(tail[0]?.entries.map((entry) => entry.record.id)).toEqual(
      Array.from({ length: 6 }, (_, index) => `memory-${index + 65}`),
    );
  });
});

function createMemory(index: number, agentId: ReturnType<typeof asAgentId>) {
  return createShortTermMemoryRecord({
    id: `memory-${index}`,
    agentId,
    kind: 'action',
    status: 'succeeded',
    summary: `Completed memory action ${index}.`,
    occurredAt: index,
    importanceScore: 0.6,
    source: { eventIds: [] },
    tags: ['study'],
  });
}
