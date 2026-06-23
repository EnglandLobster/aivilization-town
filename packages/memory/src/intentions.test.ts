import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  completeLongHorizonObjective,
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
      completedObjectives: [],
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
      completedObjectives: [],
      scheduledIntentions: [],
    });
  });

  test('completes the active objective and objective-linked scheduled intentions', () => {
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
    const state = upsertScheduledIntentions(
      setLongHorizonObjective(createEmptyAgentIntentionState(agentId), objective),
      [
        {
          id: 'study-block',
          agentId,
          objectiveId: 'objective-study',
          description: 'Study toward the objective.',
          priority: 2,
          startsAt: 100,
          endsAt: 200,
          status: 'active',
          affinityTags: ['study'],
          createdAt: 30,
          updatedAt: 30,
        },
        {
          id: 'work-block',
          agentId,
          objectiveId: 'objective-work',
          description: 'Unrelated work.',
          priority: 1,
          startsAt: 200,
          endsAt: 260,
          status: 'planned',
          affinityTags: ['work'],
          createdAt: 30,
          updatedAt: 30,
        },
      ],
    );

    const completed = completeLongHorizonObjective(state, {
      objectiveId: 'objective-study',
      completedAt: 300,
      reason: 'plan-completed',
      planId: 'objective-study',
    });

    expect(completed.activeObjective).toBeUndefined();
    expect(completed.completedObjectives).toEqual([
      {
        objective,
        completedAt: 300,
        reason: 'plan-completed',
        planId: 'objective-study',
      },
    ]);
    expect(completed.scheduledIntentions).toEqual([
      {
        id: 'study-block',
        agentId,
        objectiveId: 'objective-study',
        description: 'Study toward the objective.',
        priority: 2,
        startsAt: 100,
        endsAt: 200,
        status: 'completed',
        affinityTags: ['study'],
        createdAt: 30,
        updatedAt: 300,
      },
      {
        id: 'work-block',
        agentId,
        objectiveId: 'objective-work',
        description: 'Unrelated work.',
        priority: 1,
        startsAt: 200,
        endsAt: 260,
        status: 'planned',
        affinityTags: ['work'],
        createdAt: 30,
        updatedAt: 30,
      },
    ]);
    expect(completed.updatedAt).toBe(300);
    expect(() =>
      completeLongHorizonObjective(completed, {
        objectiveId: 'objective-study',
        completedAt: 400,
        reason: 'plan-completed',
      }),
    ).toThrow('active objective objective-study is required before completion');
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
