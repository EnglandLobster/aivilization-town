import {
  createShortTermMemoryRecord,
  type LongTermAgentProfile,
} from '@aivilization/memory';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  compileDeterministicDailyPlan,
  createDailyPlan,
  dailyPlanToScheduledIntentions,
} from './index';

const agentId = asAgentId('agent-a');
const hourMs = 60 * 60 * 1000;

describe('daily planning', () => {
  test('compiles a context-backed high-level daily plan from profile and recent memory', () => {
    const socialMemory = createShortTermMemoryRecord({
      id: 'memory-social-party',
      agentId,
      kind: 'social-interaction',
      status: 'observed',
      summary: 'Maria invited agent-a to coordinate the Valentine party at the town square.',
      occurredAt: 7 * hourMs,
      importanceScore: 0.9,
      source: { eventIds: [] },
      tags: ['social', 'party', 'agent-maria', 'town-square'],
    });

    const plan = compileDeterministicDailyPlan({
      agentId,
      issuedAt: 8 * hourMs,
      agent: {
        job: 'Stock Clerk',
        locationId: 'home',
        physiology: { energy: 65, satiety: 70, health: 100 },
      },
      longTermProfile: createProfile(agentId, {
        habits: [
          {
            key: 'study-routine',
            statement: 'Consistently engages in self-study after completing work tasks.',
            confidence: 0.9,
            updatedAt: 100,
            provenanceRecordIds: [],
          },
        ],
      }),
      memoryContext: [socialMemory],
    });

    expect(plan).toMatchObject({
      id: 'daily-plan:agent-a:0',
      agentId,
      dayStart: 0,
      generatedAt: 8 * hourMs,
      summary:
        'Plan the day around baseline routines, current world state, long-term profile, and recent memories.',
    });
    expect(plan.items.map((item) => item.id)).toEqual([
      'early-rest',
      'morning-study',
      'job-work-shift',
      'midday-meal',
      'afternoon-work',
      'memory-social-follow-up',
      'evening-social',
      'profile-evening-study',
      'night-rest',
    ]);
    expect(plan.items.find((item) => item.id === 'job-work-shift')).toMatchObject({
      description: 'Work the scheduled Stock Clerk shift.',
      source: 'world-state',
      priority: 3,
      affinityTags: ['routine', 'work', 'income', 'job', 'stock-clerk'],
    });
    expect(plan.items.find((item) => item.id === 'profile-evening-study')).toMatchObject({
      description: 'Follow the learned evening self-study habit.',
      source: 'long-term-profile',
      startsAtOffsetMs: 20 * hourMs,
      endsAtOffsetMs: 22 * hourMs,
    });
    expect(plan.items.find((item) => item.id === 'memory-social-follow-up')).toMatchObject({
      description: 'Follow up on recent social plans from memory: Maria invited agent-a to coordinate the Valentine party at the town square.',
      source: 'memory-context',
      startsAtOffsetMs: 18 * hourMs,
      endsAtOffsetMs: 20 * hourMs,
      evidenceRecordIds: [socialMemory.id],
    });

    const intentions = dailyPlanToScheduledIntentions({
      plan,
      createdAt: 8 * hourMs,
    });

    expect(intentions.find((intention) => intention.id.endsWith(':memory-social-follow-up'))).toEqual({
      id: 'daily-plan:agent-a:0:memory-social-follow-up',
      agentId,
      description:
        'Follow up on recent social plans from memory: Maria invited agent-a to coordinate the Valentine party at the town square.',
      priority: 3,
      startsAt: 18 * hourMs,
      endsAt: 20 * hourMs,
      status: 'planned',
      affinityTags: ['daily-plan', 'social', 'memory', 'party', 'agent-maria', 'town-square'],
      sourcePlanId: 'daily-plan:agent-a:0',
      provenanceRecordIds: [socialMemory.id],
      createdAt: 8 * hourMs,
      updatedAt: 8 * hourMs,
    });
  });

  test('rejects invalid daily plan item windows before scheduled intentions are created', () => {
    expect(() =>
      createDailyPlan({
        id: 'daily-plan:agent-a:0',
        agentId,
        dayStart: 0,
        generatedAt: 100,
        summary: 'Invalid plan.',
        items: [
          {
            id: 'invalid',
            description: 'Invalid backwards item.',
            priority: 1,
            startsAtOffsetMs: 10 * hourMs,
            endsAtOffsetMs: 9 * hourMs,
            affinityTags: ['invalid'],
            source: 'baseline-routine',
          },
        ],
      }),
    ).toThrow(/daily plan item invalid end offset must be greater than start offset/);
  });
});

function createProfile(
  agentId: AgentId,
  partial: Partial<Omit<LongTermAgentProfile, 'agentId'>> = {},
): LongTermAgentProfile {
  return {
    agentId,
    beliefs: [],
    habits: [],
    mood: [],
    values: [],
    personality: [],
    socialRecords: [],
    ...partial,
  };
}
