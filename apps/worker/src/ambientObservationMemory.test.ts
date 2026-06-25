import {
  asAgentId,
  asConversationId,
  asLocationId,
  createEventEnvelope,
  type AgentId,
  type LocationId,
} from '@aivilization/sim-core';
import { createWorldProjection, type WorldEvent } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { createAmbientObservationMemoryRecords } from './ambientObservationMemory';

const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');
const agentThree = asAgentId('agent-3');
const agentFour = asAgentId('agent-4');
const townSquare = asLocationId('town-square');
const market = asLocationId('market');

describe('ambient observation memory', () => {
  test('records conversations for co-located non-participants only', () => {
    const projection = createProjection();

    const result = createAmbientObservationMemoryRecords({
      tickId: 'tick-ambient',
      events: [
        createEventEnvelope({
          id: 'event-conversation',
          simulationId: 'sim-1',
          type: 'ConversationRecorded',
          occurredAt: 100,
          sequence: 1,
          payload: {
            conversationId: asConversationId('conversation-1'),
            initiatorAgentId: agentOne,
            participantAgentIds: [agentOne, agentTwo],
            locationId: townSquare,
            topic: 'market prices',
            turns: [
              {
                turnIndex: 0,
                speakerAgentId: agentOne,
                utterance: 'Apples are expensive today.',
              },
              {
                turnIndex: 1,
                speakerAgentId: agentTwo,
                utterance: 'I will buy fewer apples.',
              },
            ],
          },
        }) satisfies WorldEvent,
      ],
      projection,
      occurredAt: 125,
    });

    expect(result.observedEventCount).toBe(1);
    expect(result.recordCount).toBe(1);
    expect(result.records).toEqual([
      expect.objectContaining({
        id: 'tick-ambient:ambient:event-conversation:agent-3',
        agentId: agentThree,
        kind: 'observation',
        status: 'observed',
        occurredAt: 125,
        source: { eventIds: ['event-conversation'] },
      }),
    ]);
    expect(result.records[0]?.tags).toEqual([
      'ambient-observation',
      'ConversationRecorded',
      'town-square',
      'agent-1',
      'agent-2',
      'market prices',
    ]);
    expect(result.records[0]?.summary).toContain(
      'Observed agent-1 and agent-2 discuss market prices at Town Square.',
    );
  });

  test('records trade events for nearby non-traders', () => {
    const result = createAmbientObservationMemoryRecords({
      tickId: 'tick-trade',
      events: [
        createEventEnvelope({
          id: 'event-trade',
          simulationId: 'sim-1',
          type: 'TradeExecuted',
          occurredAt: 200,
          sequence: 1,
          payload: {
            agentId: agentOne,
            side: 'buy' as const,
            commodityName: 'Apple',
            commodityQuantity: 2,
            currencyQuantity: 25,
            poolAfter: {
              commodity: 'Apple',
              commodityReserve: 98,
              currencyReserve: 1025,
            },
            moneySupplyDelta: 0,
          },
        }) satisfies WorldEvent,
      ],
      projection: createProjection({ agentOneLocation: market, agentThreeLocation: market }),
      occurredAt: 225,
    });

    expect(result).toMatchObject({
      observedEventCount: 1,
      recordCount: 1,
    });
    expect(result.records[0]).toMatchObject({
      id: 'tick-trade:ambient:event-trade:agent-3',
      agentId: agentThree,
      kind: 'observation',
      status: 'observed',
      summary: 'Observed agent-1 buy 2 Apple at Market.',
      source: { eventIds: ['event-trade'] },
    });
    expect(result.records[0]?.tags).toEqual([
      'ambient-observation',
      'TradeExecuted',
      'market',
      'agent-1',
      'Apple',
      'buy',
    ]);
  });

  test('returns an empty result when visible events have no co-located observers', () => {
    const result = createAmbientObservationMemoryRecords({
      tickId: 'tick-empty',
      events: [
        createEventEnvelope({
          id: 'event-study',
          simulationId: 'sim-1',
          type: 'EducationChanged',
          occurredAt: 300,
          sequence: 1,
          payload: {
            agentId: agentOne,
            previousEducationScore: 10,
            nextEducationScore: 20,
            reason: 'study',
          },
        }) satisfies WorldEvent,
      ],
      projection: createProjection({ agentTwoLocation: market, agentThreeLocation: market }),
      occurredAt: 325,
    });

    expect(result).toEqual({
      observedEventCount: 1,
      recordCount: 0,
      records: [],
    });
  });
});

function createProjection(
  input: {
    readonly agentOneLocation?: LocationId;
    readonly agentTwoLocation?: LocationId;
    readonly agentThreeLocation?: LocationId;
  } = {},
) {
  return createWorldProjection({
    locations: [
      {
        locationId: townSquare,
        name: 'Town Square',
        kind: 'social',
        activityAffinities: ['socialize', 'trade'],
        capacity: null,
      },
      {
        locationId: market,
        name: 'Market',
        kind: 'market',
        activityAffinities: ['trade', 'socialize'],
        capacity: null,
      },
    ],
    agents: [
      createAgent(agentOne, input.agentOneLocation ?? townSquare),
      createAgent(agentTwo, input.agentTwoLocation ?? townSquare),
      createAgent(agentThree, input.agentThreeLocation ?? townSquare),
      createAgent(agentFour, null),
    ],
  });
}

function createAgent(agentId: AgentId, locationId: LocationId | null) {
  return {
    agentId,
    locationId,
    physiology: { energy: 80, satiety: 80, health: 100 },
    educationScore: 10,
    balance: 100,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}
