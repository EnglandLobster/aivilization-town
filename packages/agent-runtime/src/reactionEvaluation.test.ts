import { createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId, asEventId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  evaluateDeterministicSocialObservationReaction,
  normalizeReactionEvaluatorOutput,
} from './reactionEvaluation';

const agentId = asAgentId('agent-bystander');
const hourMs = 60 * 60 * 1000;

describe('reaction evaluation', () => {
  test('creates a deterministic follow-up reaction from an observed conversation memory', () => {
    const memory = createShortTermMemoryRecord({
      id: 'memory-conversation-party',
      agentId,
      kind: 'observation',
      status: 'observed',
      summary: 'Observed agent-a and agent-c discuss Valentine party at Town Square.',
      occurredAt: 10 * hourMs,
      importanceScore: 0.7,
      source: { eventIds: [asEventId('event-conversation-1')] },
      tags: [
        'ambient-observation',
        'ConversationRecorded',
        'town-square',
        'agent-a',
        'agent-c',
        'valentine-party',
      ],
    });

    expect(
      evaluateDeterministicSocialObservationReaction({
        agentId,
        issuedAt: 10 * hourMs,
        memory,
      }),
    ).toEqual({
      decision: {
        kind: 'follow-up',
        confidence: 0.7,
        rationale:
          'Observed social memory contains a conversation or completed social interaction event.',
        description:
          'Follow up on observed social event: Observed agent-a and agent-c discuss Valentine party at Town Square.',
        priority: 4,
        reactionWindowMs: 2 * hourMs,
        affinityTags: [
          'social',
          'community',
          'relationship',
          'observation-follow-up',
          'ConversationRecorded',
          'town-square',
          'agent-a',
          'agent-c',
          'valentine-party',
        ],
      },
      reactionTrace: {
        status: 'deterministic',
        source: 'deterministic',
      },
    });
  });

  test('ignores non-social observations deterministically', () => {
    const memory = createShortTermMemoryRecord({
      id: 'memory-study-observation',
      agentId,
      kind: 'observation',
      status: 'observed',
      summary: 'Observed agent-a study at School.',
      occurredAt: 10 * hourMs,
      importanceScore: 0.55,
      source: { eventIds: [asEventId('event-study-1')] },
      tags: ['ambient-observation', 'EducationChanged', 'school', 'agent-a', 'study'],
    });

    expect(
      evaluateDeterministicSocialObservationReaction({
        agentId,
        issuedAt: 10 * hourMs,
        memory,
      }).decision,
    ).toEqual({
      kind: 'ignore',
      confidence: 1,
      rationale: 'Memory is not an observed ambient social event.',
    });
  });

  test('normalizes reaction evaluator output and rejects invalid candidates', () => {
    expect(() =>
      normalizeReactionEvaluatorOutput({
        kind: 'ignore',
        confidence: 1.2,
        rationale: 'Too confident.',
      }),
    ).toThrow('reaction confidence must be within [0, 1]');

    expect(() =>
      normalizeReactionEvaluatorOutput({
        kind: 'follow-up',
        confidence: 0.8,
        rationale: 'Missing description.',
        description: '',
        priority: 4,
        reactionWindowMs: hourMs,
        affinityTags: ['social'],
      }),
    ).toThrow('follow-up reaction description must not be empty');

    expect(
      normalizeReactionEvaluatorOutput({
        decision: {
          kind: 'follow-up',
          confidence: 0.8,
          rationale: 'The observation names a concrete social opportunity.',
          description: 'Ask agent-a about the party.',
          priority: 5,
          reactionWindowMs: hourMs,
          affinityTags: ['social', 'party', 'social'],
        },
        reactionTrace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'reaction-agent-bystander-memory-conversation-party',
        },
      }),
    ).toEqual({
      decision: {
        kind: 'follow-up',
        confidence: 0.8,
        rationale: 'The observation names a concrete social opportunity.',
        description: 'Ask agent-a about the party.',
        priority: 5,
        reactionWindowMs: hourMs,
        affinityTags: ['social', 'party'],
      },
      reactionTrace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'reaction-agent-bystander-memory-conversation-party',
      },
    });
  });
});
