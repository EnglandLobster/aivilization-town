import { createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { scoreMemoryInfluence } from './index';

const agentId = asAgentId('agent-1');

describe('short-term memory influence scoring', () => {
  test('scores relevant memory by importance, failure status, and recency', () => {
    const result = scoreMemoryInfluence({
      records: [
        createShortTermMemoryRecord({
          id: 'energy-fail',
          agentId,
          kind: 'action',
          status: 'failed',
          summary: 'Failed to work because energy was too low.',
          occurredAt: 1000,
          importanceScore: 0.8,
          source: { eventIds: [] },
          tags: ['work', 'energy'],
        }),
        createShortTermMemoryRecord({
          id: 'study-success',
          agentId,
          kind: 'action',
          status: 'succeeded',
          summary: 'Studied effectively after breakfast.',
          occurredAt: 400,
          importanceScore: 0.5,
          source: { eventIds: [] },
          tags: ['study'],
        }),
        createShortTermMemoryRecord({
          id: 'unrelated',
          agentId,
          kind: 'observation',
          status: 'observed',
          summary: 'Market price changed.',
          occurredAt: 1000,
          importanceScore: 1,
          source: { eventIds: [] },
          tags: ['market'],
        }),
      ],
      affinityTags: ['energy', 'study'],
      at: 1000,
    });

    expect(result).toEqual({
      score: 3.7,
      matches: [
        {
          recordId: 'energy-fail',
          tag: 'energy',
          contribution: 3.2,
        },
        {
          recordId: 'study-success',
          tag: 'study',
          contribution: 0.5,
        },
      ],
    });
  });

  test('returns zero influence for empty affinity tags', () => {
    expect(
      scoreMemoryInfluence({
        records: [
          createShortTermMemoryRecord({
            id: 'energy-fail',
            agentId,
            kind: 'action',
            status: 'failed',
            summary: 'Failed because energy was too low.',
            occurredAt: 1000,
            importanceScore: 1,
            source: { eventIds: [] },
            tags: ['energy'],
          }),
        ],
        affinityTags: [],
        at: 1000,
      }),
    ).toEqual({ score: 0, matches: [] });
  });

  test('sorts equal matches deterministically by record id and tag', () => {
    const result = scoreMemoryInfluence({
      records: [
        createShortTermMemoryRecord({
          id: 'memory-b',
          agentId,
          kind: 'observation',
          status: 'observed',
          summary: 'Observed study and work options.',
          occurredAt: 1000,
          importanceScore: 0.5,
          source: { eventIds: [] },
          tags: ['study', 'work'],
        }),
        createShortTermMemoryRecord({
          id: 'memory-a',
          agentId,
          kind: 'observation',
          status: 'observed',
          summary: 'Observed study and work options.',
          occurredAt: 1000,
          importanceScore: 0.5,
          source: { eventIds: [] },
          tags: ['study', 'work'],
        }),
      ],
      affinityTags: ['work', 'study'],
      at: 1000,
    });

    expect(result.matches.map((match) => `${match.recordId}:${match.tag}`)).toEqual([
      'memory-a:study',
      'memory-a:work',
      'memory-b:study',
      'memory-b:work',
    ]);
  });
});
