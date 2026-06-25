import { createShortTermMemoryRecord, type ScheduledIntention } from '@aivilization/memory';
import { asAgentId, asCommandId, asEventId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createSocialObservationScheduledIntentions } from './socialObservationIntentions';

const agentId = asAgentId('agent-bystander');
const hourMs = 60 * 60 * 1000;

describe('social observation intentions', () => {
  test('creates a scheduled follow-up intention from an observed conversation memory', () => {
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
      createSocialObservationScheduledIntentions({
        records: [memory],
        reactionWindowMs: 3 * hourMs,
        createdAt: 10 * hourMs,
      }),
    ).toEqual([
      {
        id: 'social-observation:agent-bystander:memory-conversation-party',
        agentId,
        description:
          'Follow up on observed social event: Observed agent-a and agent-c discuss Valentine party at Town Square.',
        priority: 4,
        startsAt: 10 * hourMs,
        endsAt: 13 * hourMs,
        status: 'planned',
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
        provenanceRecordIds: [memory.id],
        createdAt: 10 * hourMs,
        updatedAt: 10 * hourMs,
      },
    ] satisfies ScheduledIntention[]);
  });

  test('creates a scheduled follow-up intention from an observed social interaction memory', () => {
    const memory = createShortTermMemoryRecord({
      id: 'memory-social-help',
      agentId,
      kind: 'observation',
      status: 'observed',
      summary: 'Observed agent-a interact with agent-c: shared study advice.',
      occurredAt: 11 * hourMs,
      importanceScore: 0.65,
      source: { eventIds: [asEventId('event-social-1')] },
      tags: [
        'ambient-observation',
        'SocialInteractionCompleted',
        'school',
        'agent-a',
        'agent-c',
        'social',
      ],
    });

    const [intention] = createSocialObservationScheduledIntentions({ records: [memory] });

    expect(intention).toMatchObject({
      id: 'social-observation:agent-bystander:memory-social-help',
      agentId,
      startsAt: 11 * hourMs,
      endsAt: 13 * hourMs,
      provenanceRecordIds: [memory.id],
    });
    expect(intention?.affinityTags).toEqual(
      expect.arrayContaining([
        'social',
        'community',
        'relationship',
        'observation-follow-up',
        'SocialInteractionCompleted',
        'school',
        'agent-a',
        'agent-c',
      ]),
    );
  });

  test('ignores non-social ambient observations and non-observation memories', () => {
    const studyObservation = createShortTermMemoryRecord({
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
    const directSocialMemory = createShortTermMemoryRecord({
      id: 'memory-direct-social',
      agentId,
      kind: 'social-interaction',
      status: 'succeeded',
      summary: 'Talked with agent-a.',
      occurredAt: 10 * hourMs,
      importanceScore: 0.8,
      source: { eventIds: [asEventId('event-direct-social')] },
      tags: ['social', 'agent-a'],
    });

    expect(
      createSocialObservationScheduledIntentions({
        records: [studyObservation, directSocialMemory],
      }),
    ).toEqual([]);
  });

  test('deduplicates duplicate memory inputs by scheduled intention id', () => {
    const memory = createShortTermMemoryRecord({
      id: 'memory-conversation-party',
      agentId,
      kind: 'observation',
      status: 'observed',
      summary: 'Observed agent-a and agent-c discuss Valentine party at Town Square.',
      occurredAt: 10 * hourMs,
      importanceScore: 0.7,
      source: { eventIds: [asEventId('event-conversation-1')] },
      tags: ['ambient-observation', 'ConversationRecorded', 'agent-a', 'agent-c'],
    });

    const intentions = createSocialObservationScheduledIntentions({
      records: [memory, memory],
    });

    expect(intentions.map((intention) => intention.id)).toEqual([
      'social-observation:agent-bystander:memory-conversation-party',
    ]);
  });

  test('deduplicates conversation and social impact memories from the same command', () => {
    const commandId = asCommandId('command-conversation-party');
    const conversation = createShortTermMemoryRecord({
      id: 'memory-conversation-party',
      agentId,
      kind: 'observation',
      status: 'observed',
      summary: 'Observed agent-a and agent-c discuss Valentine party at Town Square.',
      occurredAt: 10 * hourMs,
      importanceScore: 0.7,
      source: {
        commandId,
        eventIds: [asEventId('event-conversation-1')],
      },
      tags: ['ambient-observation', 'ConversationRecorded', 'agent-a', 'agent-c'],
    });
    const socialImpact = createShortTermMemoryRecord({
      id: 'memory-social-impact-party',
      agentId,
      kind: 'observation',
      status: 'observed',
      summary: 'Observed agent-a interact with agent-c: discussed party planning.',
      occurredAt: 10 * hourMs,
      importanceScore: 0.7,
      source: {
        commandId,
        eventIds: [asEventId('event-social-1')],
      },
      tags: ['ambient-observation', 'SocialInteractionCompleted', 'agent-a', 'agent-c'],
    });

    expect(
      createSocialObservationScheduledIntentions({
        records: [socialImpact, conversation],
      }).map((intention) => intention.id),
    ).toEqual(['social-observation:agent-bystander:memory-conversation-party']);
  });
});
