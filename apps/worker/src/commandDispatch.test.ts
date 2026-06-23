import type { CommandDraft } from '@aivilization/agent-runtime';
import { createAmmPool } from '@aivilization/economy';
import { asAgentId, asSimulationId } from '@aivilization/sim-core';
import { createWorldProjection, type WorldCommandPolicies } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { createCommandEnvelopeFromDraft, dispatchCommandDraftsToWorld } from './index';

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Bread: 15 },
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
  sleep: { energyRecoveryPerSecond: 1, maxEnergy: 100 },
  jobApplication: {
    populationEducationScores: [0],
    quotaByResidentialTier: [1, 1, 1, 1, 1],
  },
};

function createStudyDraft(): CommandDraft {
  return {
    simulationId: asSimulationId('sim-1'),
    actorId: asAgentId('agent-1'),
    source: 'agent-runtime',
    type: 'AgentStudy',
    payload: { durationSeconds: 120, educationRatePerSecond: 0.5 },
    issuedAt: 100,
  };
}

describe('worker command dispatch seam', () => {
  test('creates deterministic command envelopes from command drafts', () => {
    const envelope = createCommandEnvelopeFromDraft({
      draft: createStudyDraft(),
      commandId: 'draft-command-1',
      idempotencyKey: 'idem-draft-command-1',
      expectedVersion: 7,
    });

    expect(envelope).toEqual({
      id: 'draft-command-1',
      simulationId: 'sim-1',
      idempotencyKey: 'idem-draft-command-1',
      actorId: 'agent-1',
      source: 'agent-runtime',
      type: 'AgentStudy',
      payload: { durationSeconds: 120, educationRatePerSecond: 0.5 },
      issuedAt: 100,
      expectedVersion: 7,
    });
  });

  test('dispatches command drafts through world handlers and applies emitted events', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 50, satiety: 80, health: 100 },
          educationScore: 10,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const result = dispatchCommandDraftsToWorld({
      commandDrafts: [createStudyDraft()],
      projection,
      policies,
      startingSequence: 10,
      commandIdPrefix: 'draft-command',
    });

    expect(result.commands.map((command) => command.id)).toEqual(['draft-command-1']);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [10, 'EducationChanged'],
      [11, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(result.projection.memoryRecords).toHaveLength(1);
  });

  test('advances event sequence across multiple drafts without collisions', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 50, satiety: 80, health: 100 },
          educationScore: 10,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Fish', commodityReserve: 100, currencyReserve: 1000 }),
      ],
    });

    const sleepDraft: CommandDraft = {
      simulationId: asSimulationId('sim-1'),
      actorId: asAgentId('agent-1'),
      source: 'agent-runtime',
      type: 'AgentSleep',
      payload: { durationSeconds: 10 },
      issuedAt: 110,
    };

    const result = dispatchCommandDraftsToWorld({
      commandDrafts: [createStudyDraft(), sleepDraft],
      projection,
      policies,
      startingSequence: 5,
      commandIdPrefix: 'draft-command',
    });

    expect(result.commands.map((command) => command.id)).toEqual([
      'draft-command-1',
      'draft-command-2',
    ]);
    expect(result.events.map((event) => event.sequence)).toEqual([5, 6, 7, 8]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(result.projection.agents['agent-1']?.physiology.energy).toBe(60);
  });
});
