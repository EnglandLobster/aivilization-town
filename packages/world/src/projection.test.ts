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
