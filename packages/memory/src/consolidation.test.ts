import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createShortTermMemoryRecord,
  proposeLongTermMemoryPatches,
  proposeNonSocialLongTermMemoryPatches,
} from './index';

describe('long-term memory consolidation', () => {
  test('promotes repeated successful patterns into habit patches', () => {
    const agentId = asAgentId('agent-1');
    const records = [1, 2, 3].map((index) =>
      createShortTermMemoryRecord({
        id: `memory-${index}`,
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Completed study session.',
        occurredAt: index,
        importanceScore: 0.6,
        source: { eventIds: [] },
        consolidationHint: {
          kind: 'habit',
          patternKey: 'study-before-work',
          statement: 'Studies before starting work.',
        },
      }),
    );

    expect(
      proposeLongTermMemoryPatches({
        agentId,
        records,
        minPatternCount: 3,
        proposedAt: 10,
      }),
    ).toEqual([
      {
        id: 'ltm-patch-agent-1-habit-study-before-work-10',
        agentId,
        section: 'habits',
        key: 'study-before-work',
        statement: 'Studies before starting work.',
        confidence: 0.6,
        provenanceRecordIds: ['memory-1', 'memory-2', 'memory-3'],
        proposedAt: 10,
      },
    ]);
  });

  test('promotes repeated failed patterns into caution belief patches', () => {
    const agentId = asAgentId('agent-1');
    const records = [1, 2].map((index) =>
      createShortTermMemoryRecord({
        id: `failure-${index}`,
        agentId,
        kind: 'action',
        status: 'failed',
        summary: 'Failed to work with depleted energy.',
        occurredAt: index,
        importanceScore: 0.8,
        source: { eventIds: [] },
        consolidationHint: {
          kind: 'caution',
          patternKey: 'work-with-low-energy',
          statement: 'Avoid working when energy is critically low.',
        },
      }),
    );

    expect(
      proposeLongTermMemoryPatches({
        agentId,
        records,
        minPatternCount: 2,
        proposedAt: 20,
      }),
    ).toEqual([
      {
        id: 'ltm-patch-agent-1-belief-work-with-low-energy-20',
        agentId,
        section: 'beliefs',
        key: 'caution:work-with-low-energy',
        statement: 'Avoid working when energy is critically low.',
        confidence: 0.8,
        provenanceRecordIds: ['failure-1', 'failure-2'],
        proposedAt: 20,
      },
    ]);
  });

  test('aggregates social interaction hints into social record patches', () => {
    const agentId = asAgentId('agent-1');
    const targetAgentId = asAgentId('agent-2');
    const records = [
      createShortTermMemoryRecord({
        id: 'social-1',
        agentId,
        kind: 'social-interaction',
        status: 'succeeded',
        summary: 'Shared food after work.',
        occurredAt: 1,
        importanceScore: 0.4,
        source: { eventIds: [] },
        consolidationHint: {
          kind: 'social',
          targetAgentId,
          relationDelta: 0.25,
          attitudeDelta: 0.5,
          summary: 'Shared food after work.',
        },
      }),
      createShortTermMemoryRecord({
        id: 'social-2',
        agentId,
        kind: 'social-interaction',
        status: 'succeeded',
        summary: 'Studied together.',
        occurredAt: 2,
        importanceScore: 0.6,
        source: { eventIds: [] },
        consolidationHint: {
          kind: 'social',
          targetAgentId,
          relationDelta: 0.5,
          attitudeDelta: -0.25,
          summary: 'Studied together.',
        },
      }),
    ];

    expect(
      proposeLongTermMemoryPatches({
        agentId,
        records,
        minPatternCount: 3,
        proposedAt: 30,
      }),
    ).toEqual([
      {
        id: 'ltm-patch-agent-1-social-agent-2-30',
        agentId,
        section: 'socialRecords',
        key: 'agent-2',
        statement: 'Studied together.',
        confidence: 0.5,
        provenanceRecordIds: ['social-1', 'social-2'],
        proposedAt: 30,
        relationDelta: 0.75,
        attitudeDelta: 0.25,
      },
    ]);
  });

  test('preserves received claims as source-qualified beliefs without treating them as facts', () => {
    const agentId = asAgentId('agent-1');
    const targetAgentId = asAgentId('agent-2');
    const record = createShortTermMemoryRecord({
      id: 'social-claim-1',
      agentId,
      kind: 'social-interaction',
      status: 'succeeded',
      summary: 'Agent-2 discussed the harvest.',
      occurredAt: 1,
      importanceScore: 0.6,
      source: { eventIds: [] },
      consolidationHint: {
        kind: 'social',
        targetAgentId,
        relationDelta: -0.2,
        attitudeDelta: -0.25,
        summary: 'Agent-2 discussed the harvest.',
        knowledgeClaims: [
          {
            sourceAgentId: targetAgentId,
            topic: 'wheat harvest',
            statement: 'The wheat harvest has failed.',
            status: 'suspected-misinformation',
          },
        ],
      },
    });

    expect(
      proposeLongTermMemoryPatches({
        agentId,
        records: [record],
        minPatternCount: 3,
        proposedAt: 35,
      }),
    ).toEqual([
      {
        id: 'ltm-patch-agent-1-belief-social-knowledge-agent-2:wheat-harvest-35',
        agentId,
        section: 'beliefs',
        key: 'social-knowledge:agent-2:wheat-harvest',
        statement:
          'agent-2 supplied suspected misinformation about wheat harvest: "The wheat harvest has failed.".',
        confidence: 0.6,
        provenanceRecordIds: ['social-claim-1'],
        proposedAt: 35,
      },
      {
        id: 'ltm-patch-agent-1-social-agent-2-35',
        agentId,
        section: 'socialRecords',
        key: 'agent-2',
        statement: 'Agent-2 discussed the harvest.',
        confidence: 0.6,
        provenanceRecordIds: ['social-claim-1'],
        proposedAt: 35,
        relationDelta: -0.2,
        attitudeDelta: -0.25,
      },
    ]);
  });

  test('can propose non-social patches without leaking social records', () => {
    const agentId = asAgentId('agent-1');
    const targetAgentId = asAgentId('agent-2');
    const records = [
      createShortTermMemoryRecord({
        id: 'habit-1',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Completed study session.',
        occurredAt: 1,
        importanceScore: 0.6,
        source: { eventIds: [] },
        consolidationHint: {
          kind: 'habit',
          patternKey: 'study-before-work',
          statement: 'Studies before starting work.',
        },
      }),
      createShortTermMemoryRecord({
        id: 'social-1',
        agentId,
        kind: 'social-interaction',
        status: 'succeeded',
        summary: 'Shared food after work.',
        occurredAt: 2,
        importanceScore: 0.8,
        source: { eventIds: [] },
        consolidationHint: {
          kind: 'social',
          targetAgentId,
          relationDelta: 0.25,
          attitudeDelta: 0.5,
          summary: 'Shared food after work.',
        },
      }),
    ];

    expect(
      proposeNonSocialLongTermMemoryPatches({
        agentId,
        records,
        minPatternCount: 1,
        proposedAt: 40,
      }),
    ).toEqual([
      {
        id: 'ltm-patch-agent-1-habit-study-before-work-40',
        agentId,
        section: 'habits',
        key: 'study-before-work',
        statement: 'Studies before starting work.',
        confidence: 0.6,
        provenanceRecordIds: ['habit-1'],
        proposedAt: 40,
      },
    ]);
  });
});
