import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createShortTermMemoryRecord, proposeSocialInteractionReflections } from './index';

const agentId = asAgentId('agent-1');
const targetAgentId = asAgentId('agent-2');
const otherAgentId = asAgentId('agent-3');

describe('social interaction reflection artifacts', () => {
  test('creates a deterministic reflection artifact from a successful social interaction memory', () => {
    const records = [
      createSocialMemory({
        id: 'social-1',
        occurredAt: 10,
        relationDelta: 0.25,
        attitudeDelta: 0.5,
        importanceScore: 0.8,
        summary: 'Shared food after work.',
      }),
    ];

    expect(
      proposeSocialInteractionReflections({
        agentId,
        records,
        generatedAt: 100,
      }),
    ).toEqual([
      {
        id: 'social-reflection-agent-1-agent-2-social-1-100',
        agentId,
        targetAgentId,
        statement:
          'Interaction with agent-2 changed relation by 0.25 and attitude by 0.5: Shared food after work.',
        relationDelta: 0.25,
        attitudeDelta: 0.5,
        confidence: 0.8,
        evidenceRecordIds: ['social-1'],
        generatedAt: 100,
        tags: ['social', 'post-interaction-reflection', 'agent-2', 'conversation', 'community'],
      },
    ]);
  });

  test('ignores failed social records, other agents, and ordinary action memories', () => {
    const records = [
      createSocialMemory({
        id: 'failed-social',
        status: 'failed',
        summary: 'Tried to coordinate but the meeting collapsed.',
      }),
      createSocialMemory({
        id: 'other-agent-social',
        agentId: otherAgentId,
        summary: 'Other agent had a useful social interaction.',
      }),
      createShortTermMemoryRecord({
        id: 'action-memory',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Studied after breakfast.',
        occurredAt: 3,
        importanceScore: 0.7,
        source: { eventIds: [] },
        tags: ['study'],
      }),
    ];

    expect(
      proposeSocialInteractionReflections({
        agentId,
        records,
        generatedAt: 100,
      }),
    ).toEqual([]);
  });

  test('sorts reflections by memory occurrence for stable replay output', () => {
    const records = [
      createSocialMemory({ id: 'social-late', occurredAt: 20, summary: 'Late chat.' }),
      createSocialMemory({ id: 'social-early', occurredAt: 10, summary: 'Early chat.' }),
    ];

    expect(
      proposeSocialInteractionReflections({
        agentId,
        records,
        generatedAt: 100,
      }).map((reflection) => reflection.id),
    ).toEqual([
      'social-reflection-agent-1-agent-2-social-early-100',
      'social-reflection-agent-1-agent-2-social-late-100',
    ]);
  });
});

function createSocialMemory(input: {
  readonly id: string;
  readonly agentId?: typeof agentId;
  readonly status?: 'succeeded' | 'failed';
  readonly occurredAt?: number;
  readonly relationDelta?: number;
  readonly attitudeDelta?: number;
  readonly importanceScore?: number;
  readonly summary: string;
}) {
  return createShortTermMemoryRecord({
    id: input.id,
    agentId: input.agentId ?? agentId,
    kind: 'social-interaction',
    status: input.status ?? 'succeeded',
    summary: input.summary,
    occurredAt: input.occurredAt ?? 1,
    importanceScore: input.importanceScore ?? 0.7,
    source: { eventIds: [] },
    tags: ['conversation', 'community'],
    consolidationHint: {
      kind: 'social',
      targetAgentId,
      relationDelta: input.relationDelta ?? 0.2,
      attitudeDelta: input.attitudeDelta ?? 0.3,
      summary: input.summary,
    },
  });
}
