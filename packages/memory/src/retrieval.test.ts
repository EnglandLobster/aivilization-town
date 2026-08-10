import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createShortTermMemoryRecord, retrieveShortTermMemory } from './index';

describe('short-term memory retrieval', () => {
  test('filters by agent, kind, status, and tags before ordering by importance then recency', () => {
    const agentId = asAgentId('agent-1');
    const records = [
      createShortTermMemoryRecord({
        id: 'low-recent',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Recent minor action.',
        occurredAt: 3000,
        importanceScore: 0.2,
        source: { eventIds: [] },
        tags: ['work'],
      }),
      createShortTermMemoryRecord({
        id: 'high-old',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Important older action.',
        occurredAt: 1000,
        importanceScore: 0.9,
        source: { eventIds: [] },
        tags: ['work'],
      }),
      createShortTermMemoryRecord({
        id: 'other-agent',
        agentId: asAgentId('agent-2'),
        kind: 'action',
        status: 'succeeded',
        summary: 'Other agent action.',
        occurredAt: 4000,
        importanceScore: 1,
        source: { eventIds: [] },
        tags: ['work'],
      }),
    ];

    expect(
      retrieveShortTermMemory(records, {
        agentId,
        kinds: ['action'],
        statuses: ['succeeded'],
        requiredTags: ['work'],
        limit: 2,
      }).map((record) => record.id),
    ).toEqual(['high-old', 'low-recent']);
  });

  test('filters by occurrence cursor and can return records oldest first', () => {
    const agentId = asAgentId('agent-1');
    const records = [
      createShortTermMemoryRecord({
        id: 'old',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Old action.',
        occurredAt: 1000,
        importanceScore: 1,
        source: { eventIds: [] },
        tags: ['study'],
      }),
      createShortTermMemoryRecord({
        id: 'newer-b',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Newer action B.',
        occurredAt: 3000,
        importanceScore: 0.1,
        source: { eventIds: [] },
        tags: ['study'],
      }),
      createShortTermMemoryRecord({
        id: 'newer-a',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Newer action A.',
        occurredAt: 2000,
        importanceScore: 0.9,
        source: { eventIds: [] },
        tags: ['study'],
      }),
    ];

    expect(
      retrieveShortTermMemory(records, {
        agentId,
        occurredAfter: 1000,
        orderBy: 'oldest-first',
        limit: 10,
      }).map((record) => record.id),
    ).toEqual(['newer-a', 'newer-b']);
  });
});
