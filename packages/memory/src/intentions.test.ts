import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createEmptyAgentIntentionState,
  selectActiveScheduledIntentions,
  setLongHorizonObjective,
  upsertScheduledIntentions,
  type LongHorizonObjective,
  type ScheduledIntention,
} from './index';

describe('agent intention state', () => {
  test('creates empty intention state for an agent', () => {
    expect(createEmptyAgentIntentionState(asAgentId('agent-1'))).toEqual({
      agentId: 'agent-1',
      updatedAt: 0,
      scheduledIntentions: [],
    });
  });

  test('sets a long-horizon objective as durable goal context', () => {
    const agentId = asAgentId('agent-1');
    const objective: LongHorizonObjective = {
      id: 'objective-study',
      agentId,
      statement: 'Study before taking advanced production work.',
      priority: 2,
      source: 'human',
      affinityTags: ['study', 'education'],
      createdAt: 10,
      updatedAt: 20,
    };

    expect(setLongHorizonObjective(createEmptyAgentIntentionState(agentId), objective)).toEqual({
      agentId: 'agent-1',
      activeObjective: objective,
      updatedAt: 20,
      scheduledIntentions: [],
    });
  });

  test('upserts and sorts scheduled intentions deterministically', () => {
    const agentId = asAgentId('agent-1');
    const scheduled: readonly ScheduledIntention[] = [
      {
        id: 'evening-study',
        agentId,
        description: 'Study after dinner.',
        priority: 1,
        startsAt: 200,
        endsAt: 260,
        status: 'planned',
        affinityTags: ['study'],
        createdAt: 20,
        updatedAt: 20,
      },
      {
        id: 'morning-work',
        agentId,
        description: 'Work a short morning shift.',
        priority: 3,
        startsAt: 100,
        endsAt: 160,
        status: 'planned',
        affinityTags: ['work'],
        createdAt: 10,
        updatedAt: 10,
      },
    ];

    expect(
      upsertScheduledIntentions(createEmptyAgentIntentionState(agentId), scheduled)
        .scheduledIntentions,
    ).toEqual([scheduled[1], scheduled[0]]);
  });

  test('selects currently active non-cancelled schedule windows', () => {
    const agentId = asAgentId('agent-1');
    const state = upsertScheduledIntentions(createEmptyAgentIntentionState(agentId), [
      {
        id: 'active-study',
        agentId,
        description: 'Current study block.',
        priority: 2,
        startsAt: 100,
        endsAt: 200,
        status: 'active',
        affinityTags: ['study'],
        createdAt: 10,
        updatedAt: 10,
      },
      {
        id: 'cancelled-work',
        agentId,
        description: 'Cancelled work block.',
        priority: 5,
        startsAt: 100,
        endsAt: 200,
        status: 'cancelled',
        affinityTags: ['work'],
        createdAt: 10,
        updatedAt: 10,
      },
    ]);

    expect(selectActiveScheduledIntentions(state, 150).map((item) => item.id)).toEqual([
      'active-study',
    ]);
  });
});
