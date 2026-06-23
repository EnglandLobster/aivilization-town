import { createAmmPool } from '@aivilization/economy';
import { asAgentId, createEventEnvelope, replayEvents } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { applyWorldEvent, createWorldProjection } from './index';

describe('world projection', () => {
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
