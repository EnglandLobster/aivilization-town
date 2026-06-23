import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  handleAgentEatCommand,
  handleAgentStudyCommand,
} from './index';

describe('agent action command handlers', () => {
  test('AgentEat consumes inventory, restores satiety, and records STM', () => {
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
      ],
    });

    const events = handleAgentEatCommand({
      command: createCommandEnvelope({
        id: 'command-eat',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentEat',
        payload: { commodityName: 'Bread', quantity: 1 },
        issuedAt: 10,
      }),
      projection,
      satietyRecoveryByCommodity: { Bread: 15 },
      maxSatiety: 100,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'InventoryChanged',
      'PhysiologyChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[1]?.payload).toMatchObject({
      agentId: 'agent-1',
      next: { energy: 100, satiety: 55, health: 100 },
      reason: 'eat',
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({ Bread: 1 });
    expect(updated.memoryRecords[0]?.status).toBe('succeeded');
  });

  test('AgentStudy increases education and records STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentStudyCommand({
      command: createCommandEnvelope({
        id: 'command-study',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentStudy',
        payload: { durationSeconds: 120, educationRatePerSecond: 0.5 },
        issuedAt: 20,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'EducationChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      previousEducationScore: 10,
      nextEducationScore: 70,
    });
  });

  test('invalid AgentEat emits rejection and failed STM without mutating inventory', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentEatCommand({
      command: createCommandEnvelope({
        id: 'command-eat',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentEat',
        payload: { commodityName: 'Bread', quantity: 1 },
        issuedAt: 10,
      }),
      projection,
      satietyRecoveryByCommodity: { Bread: 15 },
      maxSatiety: 100,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      commandType: 'AgentEat',
      reason: 'insufficient Bread: required 1, available 0',
    });
    expect(events[1]).toMatchObject({
      type: 'ShortTermMemoryRecorded',
      payload: { record: { status: 'failed' } },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({});
    expect(updated.rejectedActions).toHaveLength(1);
  });
});
