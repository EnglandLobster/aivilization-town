import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { scoreIntentionInfluence } from './index';

describe('intention influence scoring', () => {
  test('scores active objective and active schedule matches', () => {
    const agentId = asAgentId('agent-1');

    expect(
      scoreIntentionInfluence({
        intentionState: {
          agentId,
          updatedAt: 20,
          activeObjective: {
            id: 'objective-study',
            agentId,
            statement: 'Study before high-tech production.',
            priority: 2,
            source: 'human',
            affinityTags: ['education'],
            createdAt: 10,
            updatedAt: 20,
          },
          scheduledIntentions: [
            {
              id: 'current-study',
              agentId,
              description: 'Study current lessons.',
              priority: 1.5,
              startsAt: 100,
              endsAt: 200,
              status: 'active',
              affinityTags: ['study'],
              createdAt: 30,
              updatedAt: 30,
            },
          ],
        },
        affinityTags: ['education', 'study'],
        at: 150,
      }),
    ).toEqual({
      score: 12.5,
      matches: [
        {
          source: 'objective',
          id: 'objective-study',
          tag: 'education',
          contribution: 4,
        },
        {
          source: 'objective',
          id: 'objective-study',
          tag: 'study',
          contribution: 4,
        },
        {
          source: 'scheduled-intention',
          id: 'current-study',
          tag: 'study',
          contribution: 4.5,
        },
      ],
    });
  });

  test('ignores cancelled and out-of-window scheduled intentions', () => {
    const agentId = asAgentId('agent-1');

    expect(
      scoreIntentionInfluence({
        intentionState: {
          agentId,
          updatedAt: 20,
          scheduledIntentions: [
            {
              id: 'old-study',
              agentId,
              description: 'Past study.',
              priority: 10,
              startsAt: 1,
              endsAt: 2,
              status: 'completed',
              affinityTags: ['study'],
              createdAt: 1,
              updatedAt: 2,
            },
            {
              id: 'cancelled-study',
              agentId,
              description: 'Cancelled study.',
              priority: 10,
              startsAt: 100,
              endsAt: 200,
              status: 'cancelled',
              affinityTags: ['study'],
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        },
        affinityTags: ['study'],
        at: 150,
      }),
    ).toEqual({ score: 0, matches: [] });
  });

  test('sorts equal matches deterministically by source, id, and tag', () => {
    const agentId = asAgentId('agent-1');

    expect(
      scoreIntentionInfluence({
        intentionState: {
          agentId,
          updatedAt: 20,
          activeObjective: {
            id: 'objective-b',
            agentId,
            statement: 'Balance study and work.',
            priority: 1,
            source: 'human',
            affinityTags: ['work', 'study'],
            createdAt: 10,
            updatedAt: 20,
          },
          scheduledIntentions: [
            {
              id: 'schedule-a',
              agentId,
              description: 'Study then work.',
              priority: 1,
              startsAt: 100,
              endsAt: 200,
              status: 'planned',
              affinityTags: ['work', 'study'],
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        },
        affinityTags: ['study', 'work'],
        at: 150,
      }).matches.map((match) => `${match.source}:${match.id}:${match.tag}`),
    ).toEqual([
      'objective:objective-b:study',
      'objective:objective-b:work',
      'scheduled-intention:schedule-a:study',
      'scheduled-intention:schedule-a:work',
    ]);
  });
});
