import { InMemoryAgentIntentionRepository } from '@aivilization/memory';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import { createWorldProjection, type WorldAgentState } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createDailyRoutineScheduledIntentions,
  renewDailyRoutineScheduledIntentions,
} from './index';

const agentId = asAgentId('agent-a');
const hourMs = 60 * 60 * 1000;

describe('daily routine scheduling', () => {
  test('creates stable morning study routine windows for the current simulation day', () => {
    const intentions = createDailyRoutineScheduledIntentions({
      agentId,
      at: 8.5 * hourMs,
      createdAt: 8.5 * hourMs,
    });

    expect(intentions.find((intention) => intention.id.endsWith(':morning-study'))).toEqual({
      id: 'daily-routine:agent-a:0:morning-study',
      agentId,
      description: 'Attend the morning study routine at school.',
      priority: 2,
      startsAt: 8 * hourMs,
      endsAt: 12 * hourMs,
      status: 'planned',
      affinityTags: ['routine', 'study', 'education', 'school'],
      createdAt: 8.5 * hourMs,
      updatedAt: 8.5 * hourMs,
    });
  });

  test('creates midday meal and social routine windows from the same day anchor', () => {
    const intentions = createDailyRoutineScheduledIntentions({
      agentId,
      at: 12.5 * hourMs,
      createdAt: 12.5 * hourMs,
    });

    expect(intentions.find((intention) => intention.id.endsWith(':midday-meal'))).toMatchObject({
      id: 'daily-routine:agent-a:0:midday-meal',
      description: 'Take a midday meal and social break at the restaurant.',
      startsAt: 12 * hourMs,
      endsAt: 14 * hourMs,
      affinityTags: ['routine', 'eat', 'satiety', 'social', 'restaurant'],
    });
  });

  test('upserts a daily routine once per agent and day', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const projection = createWorldProjection({ agents: [createAgent(agentId)] });

    await renewDailyRoutineScheduledIntentions({
      projection,
      intentionRepository,
      issuedAt: 8.5 * hourMs,
    });
    await renewDailyRoutineScheduledIntentions({
      projection,
      intentionRepository,
      issuedAt: 8.75 * hourMs,
    });

    const state = await intentionRepository.getOrCreate(agentId);
    const ids = state.scheduledIntentions.map((intention) => intention.id);
    expect(ids).toEqual([
      'daily-routine:agent-a:0:early-rest',
      'daily-routine:agent-a:0:morning-study',
      'daily-routine:agent-a:0:midday-meal',
      'daily-routine:agent-a:0:afternoon-work',
      'daily-routine:agent-a:0:evening-social',
      'daily-routine:agent-a:0:night-rest',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

function createAgent(agentId: AgentId): WorldAgentState {
  return {
    agentId,
    locationId: null,
    physiology: { energy: 90, satiety: 90, health: 100 },
    educationScore: 150,
    balance: 200,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}
