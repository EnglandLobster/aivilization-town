import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createDeterministicSocialModelSynthesizer, createShortTermMemoryRecord } from './index';

const agentId = asAgentId('agent-1');
const targetAgentId = asAgentId('agent-2');

describe('social model synthesis', () => {
  test('deterministically synthesizes social profile patches and reflection artifacts', async () => {
    const synthesizer = createDeterministicSocialModelSynthesizer();
    const records = [
      createShortTermMemoryRecord({
        id: 'social-1',
        agentId,
        kind: 'social-interaction',
        status: 'succeeded',
        summary: 'Shared food after work.',
        occurredAt: 10,
        importanceScore: 0.8,
        source: { eventIds: [] },
        tags: ['conversation', 'community'],
        consolidationHint: {
          kind: 'social',
          targetAgentId,
          relationDelta: 0.25,
          attitudeDelta: 0.5,
          summary: 'Shared food after work.',
        },
      }),
    ];

    const result = await synthesizer({
      agentId,
      records,
      generatedAt: 100,
    });

    expect(result).toEqual({
      patches: [
        {
          id: 'ltm-patch-agent-1-social-agent-2-100',
          agentId,
          section: 'socialRecords',
          key: 'agent-2',
          statement: 'Shared food after work.',
          confidence: 0.8,
          provenanceRecordIds: ['social-1'],
          proposedAt: 100,
          relationDelta: 0.25,
          attitudeDelta: 0.5,
          provenance: { kind: 'firsthand', status: 'influencing' },
        },
      ],
      socialReflections: [
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
          tags: [
            'social',
            'post-interaction-reflection',
            'agent-2',
            'social-outcome-positive',
            'conversation',
            'community',
          ],
        },
      ],
      trace: {
        status: 'deterministic',
        source: 'deterministic',
        message: 'Deterministic social model synthesis',
      },
    });
  });
});
