import { createAmmPool } from '@aivilization/economy';
import {
  asAgentId,
  asConversationId,
  asLocationId,
  createEventEnvelope,
  replayEvents,
} from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { applyWorldEvent, createWorldProjection } from './index';

describe('world projection', () => {
  test('stores locations and normalizes omitted agent location to null', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
        {
          agentId: asAgentId('agent-2'),
          locationId: asLocationId('school'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 20,
          balance: 60,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
      ],
    });

    expect(projection.locations['school']).toMatchObject({
      name: 'School',
      kind: 'education',
      activityAffinities: ['study', 'socialize'],
    });
    expect(projection.agents['agent-1']?.locationId).toBeNull();
    expect(projection.agents['agent-2']?.locationId).toBe(asLocationId('school'));
  });

  test('rejects agent seed locations that are absent from the projection', () => {
    expect(() =>
      createWorldProjection({
        agents: [
          {
            agentId: asAgentId('agent-1'),
            locationId: asLocationId('missing-location'),
            physiology: { energy: 100, satiety: 40, health: 100 },
            educationScore: 10,
            balance: 50,
            residentialTier: 1,
            job: 'Cleaner',
            inventory: { Bread: 2 },
          },
        ],
        locations: [],
      }),
    ).toThrow('agent agent-1 location missing-location is not in projection locations');
  });

  test('replays agent location changes into projection state', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('residential-block'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
      ],
      locations: [
        {
          locationId: asLocationId('residential-block'),
          name: 'Residential Block',
          kind: 'residence',
          activityAffinities: ['sleep', 'socialize'],
          capacity: null,
        },
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events = [
      createEventEnvelope({
        id: 'event-location',
        simulationId: 'sim-1',
        commandId: 'command-move',
        type: 'AgentLocationChanged',
        payload: {
          agentId: asAgentId('agent-1'),
          previousLocationId: asLocationId('residential-block'),
          nextLocationId: asLocationId('school'),
          reason: 'study',
        },
        occurredAt: 15,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.locationId).toBe(asLocationId('school'));
  });

  test('replays location observations without mutating agent state', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('school'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
      ],
      locations: [
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events = [
      createEventEnvelope({
        id: 'event-observation',
        simulationId: 'sim-1',
        commandId: 'command-observe',
        type: 'LocationObserved',
        payload: {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('school'),
          locationName: 'School',
          observedAgentIds: [asAgentId('agent-2')],
          activityAffinities: ['study', 'socialize'],
          focus: 'classmates',
        },
        occurredAt: 16,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.locationObservations).toEqual([
      {
        agentId: 'agent-1',
        locationId: 'school',
        locationName: 'School',
        observedAgentIds: ['agent-2'],
        activityAffinities: ['study', 'socialize'],
        focus: 'classmates',
        observedAt: 16,
      },
    ]);
    expect(projection.agents['agent-1']).toEqual(initial.agents['agent-1']);
  });

  test('replays conversation records without mutating agent state', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('school'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
        {
          agentId: asAgentId('agent-2'),
          locationId: asLocationId('school'),
          physiology: { energy: 90, satiety: 70, health: 100 },
          educationScore: 20,
          balance: 80,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events = [
      createEventEnvelope({
        id: 'event-conversation',
        simulationId: 'sim-1',
        commandId: 'command-conversation',
        type: 'ConversationRecorded',
        payload: {
          conversationId: asConversationId('conversation-command-conversation'),
          initiatorAgentId: asAgentId('agent-1'),
          participantAgentIds: [asAgentId('agent-1'), asAgentId('agent-2')],
          locationId: asLocationId('school'),
          topic: 'homework',
          turns: [
            {
              turnIndex: 0,
              speakerAgentId: asAgentId('agent-1'),
              utterance: 'Do you want to study together?',
              intent: 'invite-study',
            },
            {
              turnIndex: 1,
              speakerAgentId: asAgentId('agent-2'),
              utterance: 'Yes, let us review after class.',
            },
          ],
        },
        occurredAt: 20,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.conversationRecords).toEqual([
      {
        conversationId: 'conversation-command-conversation',
        initiatorAgentId: 'agent-1',
        participantAgentIds: ['agent-1', 'agent-2'],
        locationId: 'school',
        topic: 'homework',
        turns: [
          {
            turnIndex: 0,
            speakerAgentId: 'agent-1',
            utterance: 'Do you want to study together?',
            intent: 'invite-study',
          },
          {
            turnIndex: 1,
            speakerAgentId: 'agent-2',
            utterance: 'Yes, let us review after class.',
          },
        ],
        recordedAt: 20,
      },
    ]);
    expect(projection.agents['agent-1']).toEqual(initial.agents['agent-1']);
    expect(projection.agents['agent-2']).toEqual(initial.agents['agent-2']);
  });

  test('replays agent state and memory events deterministically', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
      ],
    });

    const events = [
      createEventEnvelope({
        id: 'event-2',
        simulationId: 'sim-1',
        commandId: 'command-1',
        type: 'PhysiologyChanged',
        payload: {
          agentId: asAgentId('agent-1'),
          previous: { energy: 100, satiety: 40, health: 100 },
          next: { energy: 95, satiety: 55, health: 100 },
          reason: 'eat',
        },
        occurredAt: 10,
        sequence: 2,
      }),
      createEventEnvelope({
        id: 'event-1',
        simulationId: 'sim-1',
        commandId: 'command-1',
        type: 'InventoryChanged',
        payload: {
          agentId: asAgentId('agent-1'),
          itemName: 'Bread',
          delta: -1,
          reason: 'eat',
        },
        occurredAt: 10,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.inventory).toEqual({ Bread: 1 });
    expect(projection.agents['agent-1']?.physiology.satiety).toBe(55);
  });
});

describe('world economy projection', () => {
  test('replays commodity production into inventory and physiology state', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = [
      createEventEnvelope({
        id: 'event-produced',
        simulationId: 'sim-1',
        commandId: 'command-produce',
        type: 'CommodityProduced',
        payload: {
          agentId: asAgentId('agent-1'),
          produced: { Apple: 2 },
          consumedInputs: {},
          energyCost: 4,
          satietyCost: 0,
          laborSeconds: 0.2,
        },
        occurredAt: 10,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.inventory).toEqual({ Apple: 2 });
    expect(projection.agents['agent-1']?.physiology.energy).toBe(96);
  });

  test('replays subsidy payments into agent balance and money supply', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 10,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      moneySupply: 100,
    });

    const events = [
      createEventEnvelope({
        id: 'event-subsidy',
        simulationId: 'sim-1',
        commandId: 'command-time',
        type: 'SubsidyPaid',
        payload: {
          agentId: asAgentId('agent-1'),
          amount: 25,
          previousBalance: 10,
          nextBalance: 35,
          reason: 'safety-net',
        },
        occurredAt: 20,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.balance).toBe(35);
    expect(projection.moneySupply).toBe(125);
  });

  test('replays residential upkeep charges into agent balance and money supply', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 100,
          residentialTier: 2,
          job: null,
          inventory: {},
        },
      ],
      moneySupply: 1000,
    });

    const events = [
      createEventEnvelope({
        id: 'event-upkeep',
        simulationId: 'sim-1',
        commandId: 'command-time',
        type: 'ResidentialUpkeepCharged',
        payload: {
          agentId: asAgentId('agent-1'),
          residentialTier: 2,
          amount: 10,
          unpaidAmount: 0,
          previousBalance: 100,
          nextBalance: 90,
          reason: 'residential-upkeep',
        },
        occurredAt: 20,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.balance).toBe(90);
    expect(projection.moneySupply).toBe(990);
  });

  test('replays AMM trade into agent balance, inventory, pool state, and money supply', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 1000,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
      moneySupply: 1000,
    });

    const events = [
      createEventEnvelope({
        id: 'event-trade',
        simulationId: 'sim-1',
        commandId: 'command-trade',
        type: 'TradeExecuted',
        payload: {
          agentId: asAgentId('agent-1'),
          side: 'buy' as const,
          commodityName: 'Apple',
          commodityQuantity: 10,
          currencyQuantity: 111.1111111111,
          poolAfter: createAmmPool({
            commodity: 'Apple',
            commodityReserve: 90,
            currencyReserve: 1111.1111111111,
          }),
          moneySupplyDelta: -111.1111111111,
        },
        occurredAt: 20,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.inventory).toEqual({ Apple: 10 });
    expect(projection.agents['agent-1']?.balance).toBeCloseTo(888.8888888889);
    expect(projection.marketPools['Apple']?.commodityReserve).toBe(90);
    expect(projection.moneySupply).toBeCloseTo(888.8888888889);
  });

  test('replays market price index records into projection state', () => {
    const initial = createWorldProjection({ agents: [] });
    const events = [
      createEventEnvelope({
        id: 'event-market-index',
        simulationId: 'sim-1',
        type: 'MarketPriceIndexRecorded',
        payload: {
          baselineAt: 0,
          food: 4,
          nonFood: 2,
          overall: 3,
          foodCount: 2,
          nonFoodCount: 2,
          ratios: { Apple: 2, Bread: 8, Wood: 4, Book: 1 },
        },
        occurredAt: 100,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);

    expect(projection.marketPriceIndices).toEqual([
      {
        baselineAt: 0,
        recordedAt: 100,
        food: 4,
        nonFood: 2,
        overall: 3,
        foodCount: 2,
        nonFoodCount: 2,
        ratios: { Apple: 2, Bread: 8, Wood: 4, Book: 1 },
      },
    ]);
  });
});

describe('world job projection', () => {
  test('replays job application and assignment into projection state', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = [
      createEventEnvelope({
        id: 'event-application',
        simulationId: 'sim-1',
        commandId: 'command-apply',
        type: 'JobApplicationSubmitted',
        payload: {
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          residentialTier: 1,
          educationScore: 0,
        },
        occurredAt: 70,
        sequence: 1,
      }),
      createEventEnvelope({
        id: 'event-assigned',
        simulationId: 'sim-1',
        commandId: 'command-apply',
        type: 'JobAssigned',
        payload: {
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          previousJob: null,
        },
        occurredAt: 70,
        sequence: 2,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.jobApplications).toEqual([
      {
        agentId: 'agent-1',
        occupationName: 'Cleaner',
        submittedAt: 70,
      },
    ]);
    expect(projection.agents['agent-1']?.job).toBe('Cleaner');
  });
});

describe('world social projection', () => {
  test('replays social interactions into directed relation state', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const initial = createWorldProjection({
      agents: [
        {
          agentId: agent1,
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: agent2,
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const nextRelation = {
      sourceAgentId: agent1,
      targetAgentId: agent2,
      relationScore: 0.25,
      attitudeScore: 0.5,
      relationLabel: 'acquaintance' as const,
      interactionCount: 1,
      lastInteractionSummary: 'Shared food after work.',
    };
    const events = [
      createEventEnvelope({
        id: 'event-social',
        simulationId: 'sim-1',
        commandId: 'command-social',
        type: 'SocialInteractionCompleted',
        payload: {
          sourceAgentId: agent1,
          targetAgentId: agent2,
          summary: 'Shared food after work.',
          relationDelta: 0.25,
          attitudeDelta: 0.5,
          nextRelation,
        },
        occurredAt: 80,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.socialRelations['agent-1->agent-2']).toEqual(nextRelation);
  });
});
