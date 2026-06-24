import {
  createBranchPlan,
  createBranchPlanProgress,
  InMemoryBranchPlanProgressRepository,
  InMemoryBranchPlanRepository,
  markSubtaskCompleted,
} from '@aivilization/agent-runtime';
import { InMemoryAgentIntentionRepository, type LongHorizonObjective } from '@aivilization/memory';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import { createWorldProjection, type WorldAgentState } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { completeFinishedActiveObjectives } from './index';

const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');

describe('worker objective lifecycle', () => {
  test('completes active objectives whose durable plans have no selectable subtasks', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const objectiveA = createObjective(agentA, 'objective-study');
    const objectiveB = createObjective(agentB, 'objective-work');
    await intentionRepository.setObjective(agentA, objectiveA);
    await intentionRepository.setObjective(agentB, objectiveB);
    await planRepository.save(
      createSingleStepPlanRecord({ agentId: agentA, planId: objectiveA.id }),
    );
    await planRepository.save(
      createSingleStepPlanRecord({ agentId: agentB, planId: objectiveB.id }),
    );
    await planProgressRepository.save(
      markSubtaskCompleted(
        createBranchPlanProgress({
          planId: objectiveA.id,
          agentId: agentA,
          createdAt: 100,
        }),
        { subtaskId: 'pursue-objective', completedAt: 200 },
      ),
    );

    await expect(
      completeFinishedActiveObjectives({
        projection: createProjection(),
        intentionRepository,
        planRepository,
        planProgressRepository,
        completedAt: 300,
      }),
    ).resolves.toEqual([{ agentId: agentA, objectiveId: objectiveA.id, planId: objectiveA.id }]);

    const agentAState = await intentionRepository.getOrCreate(agentA);
    expect(agentAState.activeObjective).toBeUndefined();
    expect(agentAState.completedObjectives).toEqual([
      {
        objective: objectiveA,
        completedAt: 300,
        reason: 'plan-completed',
        planId: objectiveA.id,
      },
    ]);
    await expect(intentionRepository.getOrCreate(agentB)).resolves.toMatchObject({
      activeObjective: objectiveB,
      completedObjectives: [],
    });
  });
});

function createProjection() {
  return createWorldProjection({
    agents: [createAgent(agentA), createAgent(agentB)],
  });
}

function createAgent(agentId: AgentId): WorldAgentState {
  return {
    agentId,
    locationId: null,
    physiology: { energy: 50, satiety: 50, health: 100 },
    educationScore: 0,
    balance: 100,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}

function createObjective(agentId: AgentId, id: string): LongHorizonObjective {
  return {
    id,
    agentId,
    statement: `Complete ${id}.`,
    priority: 2,
    source: 'agent',
    affinityTags: ['study'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createSingleStepPlanRecord(input: { readonly agentId: AgentId; readonly planId: string }) {
  return {
    planId: input.planId,
    agentId: input.agentId,
    plan: createBranchPlan({
      objective: input.planId,
      branches: [
        {
          id: 'primary-objective',
          objective: input.planId,
          subtasks: [{ id: 'pursue-objective', description: 'pursue objective', basePriority: 5 }],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}
