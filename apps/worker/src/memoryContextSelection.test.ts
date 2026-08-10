import { createBranchPlan } from '@aivilization/agent-runtime';
import { createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { selectRelevantShortTermMemoryContext } from './memoryContextSelection';

const agentId = asAgentId('agent-1');

describe('worker memory context selection', () => {
  test('selects relevant lower-importance memories before unrelated high-importance memories', () => {
    const records = [
      createShortTermMemoryRecord({
        id: 'market-shock',
        agentId,
        kind: 'observation',
        status: 'observed',
        summary: 'Observed a major Apple price shock.',
        occurredAt: 1000,
        importanceScore: 1,
        source: { eventIds: [] },
        tags: ['market', 'trade'],
      }),
      createShortTermMemoryRecord({
        id: 'energy-failure',
        agentId,
        kind: 'action',
        status: 'failed',
        summary: 'Failed to work because energy was too low.',
        occurredAt: 1000,
        importanceScore: 0.8,
        source: { eventIds: [] },
        tags: ['work', 'energy'],
      }),
    ];

    const selected = selectRelevantShortTermMemoryContext({
      records,
      plan: createBranchPlan({
        objective: 'recover before work',
        branches: [
          {
            id: 'recovery',
            objective: 'restore energy',
            subtasks: [
              {
                id: 'sleep',
                description: 'sleep before work',
                basePriority: 1,
                memoryAffinityTags: ['energy'],
              },
            ],
          },
        ],
      }),
      signals: [],
      issuedAt: 1000,
      limit: 1,
    });

    expect(selected.map((record) => record.id)).toEqual(['energy-failure']);
  });

  test('falls back to importance, recency, and id when no affinity tags are available', () => {
    const records = [
      createShortTermMemoryRecord({
        id: 'medium-b',
        agentId,
        kind: 'observation',
        status: 'observed',
        summary: 'Medium priority observation B.',
        occurredAt: 500,
        importanceScore: 0.5,
        source: { eventIds: [] },
        tags: ['routine'],
      }),
      createShortTermMemoryRecord({
        id: 'high-old',
        agentId,
        kind: 'observation',
        status: 'observed',
        summary: 'High priority older observation.',
        occurredAt: 900,
        importanceScore: 0.9,
        source: { eventIds: [] },
        tags: ['routine'],
      }),
      createShortTermMemoryRecord({
        id: 'medium-a',
        agentId,
        kind: 'observation',
        status: 'observed',
        summary: 'Medium priority observation A.',
        occurredAt: 500,
        importanceScore: 0.5,
        source: { eventIds: [] },
        tags: ['routine'],
      }),
      createShortTermMemoryRecord({
        id: 'high-recent',
        agentId,
        kind: 'observation',
        status: 'observed',
        summary: 'High priority recent observation.',
        occurredAt: 1000,
        importanceScore: 0.9,
        source: { eventIds: [] },
        tags: ['routine'],
      }),
    ];

    const selected = selectRelevantShortTermMemoryContext({
      records,
      plan: createBranchPlan({
        objective: 'follow routine',
        branches: [
          {
            id: 'routine',
            objective: 'continue routine',
            subtasks: [{ id: 'continue', description: 'continue routine', basePriority: 1 }],
          },
        ],
      }),
      signals: [],
      issuedAt: 1000,
      limit: 4,
    });

    expect(selected.map((record) => record.id)).toEqual([
      'high-recent',
      'high-old',
      'medium-a',
      'medium-b',
    ]);
  });
});
