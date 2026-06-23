import { InMemoryBranchPlanRepository } from '@aivilization/agent-runtime';
import {
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  type LongHorizonObjective,
} from '@aivilization/memory';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import { createWorldProjection, type WorldAgentState } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { createDefaultAutonomousObjective, renewMissingActiveObjectives } from './index';

const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');

describe('worker objective renewal', () => {
  test('proposes a deterministic study objective for low-education agents', () => {
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);

    expect(
      createDefaultAutonomousObjective({
        agentId: agentA,
        agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
        projection,
        intentionState: {
          agentId: agentA,
          completedObjectives: [],
          scheduledIntentions: [],
          updatedAt: 0,
        },
        longTermProfile: {
          agentId: agentA,
          beliefs: [],
          habits: [],
          values: [],
          personality: [],
          socialRecords: [],
        },
        issuedAt: 100,
      }),
    ).toEqual({
      id: 'auto-objective-agent-a-100',
      agentId: agentA,
      statement: 'Improve education to qualify for better town opportunities.',
      priority: 2,
      source: 'agent',
      affinityTags: ['study', 'education'],
      createdAt: 100,
      updatedAt: 100,
    });
  });

  test('renews missing active objectives and saves durable branch plans', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createProjection([
      createAgent({ agentId: agentA, educationScore: 12 }),
      createAgent({ agentId: agentB, educationScore: 50 }),
    ]);
    const existingObjective = createObjective(agentB, 'objective-existing');
    await intentionRepository.setObjective(agentB, existingObjective);

    await expect(
      renewMissingActiveObjectives({
        projection,
        intentionRepository,
        longTermProfileRepository,
        planRepository,
        issuedAt: 100,
      }),
    ).resolves.toEqual([
      {
        agentId: agentA,
        objectiveId: 'auto-objective-agent-a-100',
        planId: 'auto-objective-agent-a-100',
      },
    ]);
    await expect(intentionRepository.getOrCreate(agentA)).resolves.toMatchObject({
      activeObjective: {
        id: 'auto-objective-agent-a-100',
        statement: 'Improve education to qualify for better town opportunities.',
      },
    });
    await expect(
      planRepository.require({
        planId: 'auto-objective-agent-a-100',
        agentId: agentA,
      }),
    ).resolves.toMatchObject({
      planId: 'auto-objective-agent-a-100',
      agentId: agentA,
      plan: {
        objective: 'Improve education to qualify for better town opportunities.',
      },
      createdAt: 100,
      updatedAt: 100,
    });
    await expect(intentionRepository.getOrCreate(agentB)).resolves.toMatchObject({
      activeObjective: existingObjective,
    });
  });
});

function createProjection(agents: readonly WorldAgentState[]) {
  return createWorldProjection({ agents });
}

function createAgent(input: {
  readonly agentId: AgentId;
  readonly energy?: number;
  readonly satiety?: number;
  readonly health?: number;
  readonly educationScore?: number;
  readonly balance?: number;
}): WorldAgentState {
  return {
    agentId: input.agentId,
    physiology: {
      energy: input.energy ?? 50,
      satiety: input.satiety ?? 80,
      health: input.health ?? 100,
    },
    educationScore: input.educationScore ?? 0,
    balance: input.balance ?? 100,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}

function createObjective(agentId: AgentId, id: string): LongHorizonObjective {
  return {
    id,
    agentId,
    statement: `Existing objective ${id}.`,
    priority: 1,
    source: 'human',
    affinityTags: ['study'],
    createdAt: 50,
    updatedAt: 50,
  };
}
