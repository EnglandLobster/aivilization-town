import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { InMemoryShortTermMemoryRepository, createShortTermMemoryRecord } from './index';

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
});
