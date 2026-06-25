import {
  createShortTermMemoryRecord,
  type LongTermAgentProfile,
  type ScheduledIntention,
  type ShortTermMemoryRecord,
} from '@aivilization/memory';
import { asAgentId, asCommandId, asEventId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createSocialObservationScheduledIntentions,
  createTraceableSocialObservationScheduledIntentions,
} from './socialObservationIntentions';

const agentId = asAgentId('agent-bystander');
const hourMs = 60 * 60 * 1000;

type CapturedReactionContext = {
  readonly longTermProfile: LongTermAgentProfile | undefined;
  readonly memoryContext: readonly ShortTermMemoryRecord[] | undefined;
};

describe('social observation intentions', () => {
  test('creates a scheduled follow-up intention from an observed conversation memory', async () => {
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
      await createSocialObservationScheduledIntentions({
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

  test('creates a scheduled follow-up intention from an observed social interaction memory', async () => {
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

    const [intention] = await createSocialObservationScheduledIntentions({ records: [memory] });

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

  test('ignores non-social ambient observations and non-observation memories', async () => {
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
      await createSocialObservationScheduledIntentions({
        records: [studyObservation, directSocialMemory],
      }),
    ).toEqual([]);
  });

  test('deduplicates duplicate memory inputs by scheduled intention id', async () => {
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

    const intentions = await createSocialObservationScheduledIntentions({
      records: [memory, memory],
    });

    expect(intentions.map((intention) => intention.id)).toEqual([
      'social-observation:agent-bystander:memory-conversation-party',
    ]);
  });

  test('deduplicates conversation and social impact memories from the same command', async () => {
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
      (
        await createSocialObservationScheduledIntentions({
          records: [socialImpact, conversation],
        })
      ).map((intention) => intention.id),
    ).toEqual(['social-observation:agent-bystander:memory-conversation-party']);
  });

  test('uses an injected evaluator to ignore an otherwise social observation', async () => {
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

    await expect(
      createSocialObservationScheduledIntentions({
        records: [memory],
        reactionEvaluator: () => ({
          kind: 'ignore',
          confidence: 0.9,
          rationale: 'The agent is focused on another objective.',
        }),
      }),
    ).resolves.toEqual([]);
  });

  test('passes profile and memory context into injected reaction evaluators', async () => {
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
    const priorMemory = createShortTermMemoryRecord({
      id: 'memory-prior-party',
      agentId,
      kind: 'observation',
      status: 'observed',
      summary: 'agent-bystander heard agent-a needs help preparing food.',
      occurredAt: 9 * hourMs,
      importanceScore: 0.6,
      source: { eventIds: [asEventId('event-prior-party')] },
      tags: ['party', 'agent-a'],
    });

    const seen: CapturedReactionContext[] = [];
    await createSocialObservationScheduledIntentions({
      records: [memory],
      longTermProfileByAgentId: {
        [agentId]: {
          agentId,
          beliefs: [],
          habits: [],
          mood: [],
          values: [
            {
              key: 'community-helper',
              statement: 'Help neighbors coordinate social gatherings.',
              confidence: 0.9,
              updatedAt: 9 * hourMs,
              provenanceRecordIds: [priorMemory.id],
            },
          ],
          personality: [],
          socialRecords: [],
        },
      },
      memoryContextByAgentId: { [agentId]: [priorMemory] },
      reactionEvaluator: (input) => {
        seen.push({
          longTermProfile: input.longTermProfile,
          memoryContext: input.memoryContext,
        });
        return { kind: 'ignore', confidence: 0.9, rationale: 'captured context' };
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.longTermProfile?.values.map((entry) => entry.key)).toEqual([
      'community-helper',
    ]);
    expect(seen[0]?.memoryContext).toEqual([priorMemory]);
  });

  test('uses an injected evaluator to customize follow-up scheduling metadata', async () => {
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

    await expect(
      createSocialObservationScheduledIntentions({
        records: [memory],
        createdAt: 12 * hourMs,
        reactionEvaluator: () => ({
          decision: {
            kind: 'follow-up',
            confidence: 0.8,
            rationale: 'The event is relevant to the party goal.',
            description: 'Ask agent-a how to help with the Valentine party.',
            priority: 6,
            reactionWindowMs: 30 * 60 * 1000,
            affinityTags: ['social', 'party', 'agent-a', 'party'],
          },
          reactionTrace: {
            status: 'accepted',
            source: 'llm',
            requestId: 'reaction-custom',
          },
        }),
      }),
    ).resolves.toEqual([
      {
        id: 'social-observation:agent-bystander:memory-conversation-party',
        agentId,
        description: 'Ask agent-a how to help with the Valentine party.',
        priority: 6,
        startsAt: 10 * hourMs,
        endsAt: 10 * hourMs + 30 * 60 * 1000,
        status: 'planned',
        affinityTags: ['social', 'party', 'agent-a'],
        provenanceRecordIds: [memory.id],
        createdAt: 12 * hourMs,
        updatedAt: 12 * hourMs,
      },
    ] satisfies ScheduledIntention[]);
  });

  test('returns traceable reaction evaluations for follow-up and ignored social observations', async () => {
    const followUpMemory = createShortTermMemoryRecord({
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
    const ignoredMemory = createShortTermMemoryRecord({
      id: 'memory-conversation-study',
      agentId,
      kind: 'observation',
      status: 'observed',
      summary: 'Observed agent-d and agent-e discuss a quiet study routine.',
      occurredAt: 11 * hourMs,
      importanceScore: 0.4,
      source: { eventIds: [asEventId('event-conversation-2')] },
      tags: ['ambient-observation', 'ConversationRecorded', 'agent-d', 'agent-e'],
    });

    const result = await createTraceableSocialObservationScheduledIntentions({
      records: [followUpMemory, ignoredMemory],
      createdAt: 12 * hourMs,
      reactionEvaluator: ({ memory }) =>
        memory.id === ignoredMemory.id
          ? {
              decision: {
                kind: 'ignore',
                confidence: 0.92,
                rationale: 'The study routine is not relevant to the bystander.',
              },
              reactionTrace: {
                status: 'accepted',
                source: 'llm',
                requestId: 'reaction-ignore-study',
                providerId: 'scripted-reaction',
                model: 'reaction-model',
              },
            }
          : {
              decision: {
                kind: 'follow-up',
                confidence: 0.86,
                rationale: 'The party topic matches the agent social plan.',
                description: 'Ask agent-a how to help with the Valentine party.',
                priority: 6,
                reactionWindowMs: 30 * 60 * 1000,
                affinityTags: ['social', 'party', 'agent-a', 'party'],
              },
              reactionTrace: {
                status: 'accepted',
                source: 'llm',
                requestId: 'reaction-follow-up-party',
                providerId: 'scripted-reaction',
                model: 'reaction-model',
              },
            },
    });

    expect(result.intentions).toEqual([
      {
        id: 'social-observation:agent-bystander:memory-conversation-party',
        agentId,
        description: 'Ask agent-a how to help with the Valentine party.',
        priority: 6,
        startsAt: 10 * hourMs,
        endsAt: 10 * hourMs + 30 * 60 * 1000,
        status: 'planned',
        affinityTags: ['social', 'party', 'agent-a'],
        provenanceRecordIds: [followUpMemory.id],
        createdAt: 12 * hourMs,
        updatedAt: 12 * hourMs,
      },
    ] satisfies ScheduledIntention[]);
    expect(result.evaluations).toEqual([
      {
        memoryRecord: followUpMemory,
        decision: {
          kind: 'follow-up',
          confidence: 0.86,
          rationale: 'The party topic matches the agent social plan.',
          description: 'Ask agent-a how to help with the Valentine party.',
          priority: 6,
          reactionWindowMs: 30 * 60 * 1000,
          affinityTags: ['social', 'party', 'agent-a'],
        },
        reactionTrace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'reaction-follow-up-party',
          providerId: 'scripted-reaction',
          model: 'reaction-model',
        },
        scheduledIntention: result.intentions[0],
      },
      {
        memoryRecord: ignoredMemory,
        decision: {
          kind: 'ignore',
          confidence: 0.92,
          rationale: 'The study routine is not relevant to the bystander.',
        },
        reactionTrace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'reaction-ignore-study',
          providerId: 'scripted-reaction',
          model: 'reaction-model',
        },
      },
    ]);
  });
});
