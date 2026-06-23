import {
  createBranchPlan,
  createBranchPlanProgress,
  InMemoryBranchPlanProgressRepository,
  InMemoryBranchPlanRepository,
  markSubtaskCompleted,
} from '@aivilization/agent-runtime';
import {
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  type LongHorizonObjective,
} from '@aivilization/memory';
import {
  InMemoryEventStore,
  asAgentId,
  asSimulationId,
  createSimulationPartition,
  type AgentId,
} from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldAgentState,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { runCanonicalWorkerActivePlanTick } from './index';

const simulationId = asSimulationId('sim-canonical-active-plan');
const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');
const partition = createSimulationPartition({ simulationId, partitionKey: 'world-main' });

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Apple: 10 },
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

describe('canonical active-plan worker tick', () => {
  test('runs a direct-projection tick from active durable study plans', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(agentA, createObjective(agentA));
    await repositories.planRepository.save(createStudyPlanRecord(agentA));

    const result = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      ...repositories,
    });

    expect(result.agentResults).toHaveLength(1);
    expect(result.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
      type: 'AgentStudy',
      payload: { durationSeconds: 1800, educationRatePerSecond: 1 },
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EducationChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(result.projection.clock.now).toBe(1000);
    expect(result.projection.agents[agentA]?.educationScore).toBe(1800);
  });

  test('saves progress for active durable plans', async () => {
    const repositories = createRepositories();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(agentA, createObjective(agentA));
    await repositories.planRepository.save(createStudyPlanRecord(agentA));

    await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-progress',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      ...repositories,
    });

    await expect(
      planProgressRepository.getOrCreate({
        planId: 'objective-study',
        agentId: agentA,
        createdAt: 999,
      }),
    ).resolves.toEqual({
      planId: 'objective-study',
      agentId: agentA,
      completedSubtaskIds: ['study-step'],
      blockedSubtasks: [],
      updatedAt: 100,
    });
    const intentionState = await repositories.intentionRepository.getOrCreate(agentA);
    expect(intentionState.activeObjective).toBeUndefined();
    expect(intentionState.completedObjectives).toEqual([
      {
        objective: createObjective(agentA),
        completedAt: 100,
        reason: 'plan-completed',
        planId: 'objective-study',
      },
    ]);
  });

  test('skips completed active durable plans and advances time only', async () => {
    const repositories = createRepositories();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(agentA, createObjective(agentA));
    await repositories.planRepository.save(createStudyPlanRecord(agentA));
    await planProgressRepository.save(
      markSubtaskCompleted(
        createBranchPlanProgress({
          planId: 'objective-study',
          agentId: agentA,
          createdAt: 100,
        }),
        { subtaskId: 'study-step', completedAt: 200 },
      ),
    );

    const result = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-completed-plan',
      simulationId,
      issuedAt: 300,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      planProgressRepository,
      ...repositories,
    });

    expect(result.agentResults).toEqual([]);
    expect(result.events.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
    expect(result.projection.clock.now).toBe(1000);
    expect(result.projection.agents[agentA]?.educationScore).toBe(0);
    expect(result.streamVersion).toBe(1);
    const intentionState = await repositories.intentionRepository.getOrCreate(agentA);
    expect(intentionState.activeObjective).toBeUndefined();
    expect(intentionState.completedObjectives).toEqual([
      {
        objective: createObjective(agentA),
        completedAt: 300,
        reason: 'plan-completed',
        planId: 'objective-study',
      },
    ]);
  });

  test('hydrates projection before scheduling the next active-plan tick', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const initialProjection = createProjection();
    await repositories.intentionRepository.setObjective(agentA, createObjective(agentA));
    await repositories.planRepository.save(createStudyPlanRecord(agentA));

    const first = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: initialProjection,
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      ...repositories,
    });
    const second = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-2',
      simulationId,
      issuedAt: 200,
      projectionHydration: { initialProjection },
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      ...repositories,
    });

    expect(second.events[0]?.sequence).toBe(first.streamVersion + 1);
    expect(second.projection.clock.now).toBe(2000);
    expect(second.projection.agents[agentA]?.educationScore).toBe(3600);
    expect(second.streamVersion).toBe(first.streamVersion + 3);
  });

  test('advances time when no active plans can be scheduled', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.intentionRepository.setObjective(agentA, createObjective(agentA));

    const result = await runCanonicalWorkerActivePlanTick({
      tickId: 'tick-empty',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      ...repositories,
    });

    expect(result.agentResults).toEqual([]);
    expect(result.events.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
    expect(result.projection.clock.now).toBe(1000);
    expect(result.streamVersion).toBe(1);
  });
});

function createRepositories() {
  return {
    intentionRepository: new InMemoryAgentIntentionRepository(),
    longTermProfileRepository: new InMemoryLongTermProfileRepository(),
    shortTermMemoryRepository: new InMemoryShortTermMemoryRepository(),
    planRepository: new InMemoryBranchPlanRepository(),
  };
}

function createProjection(): WorldProjection {
  return createWorldProjection({
    agents: [createAgent(agentA), createAgent(agentB)],
    marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
  });
}

function createAgent(agentId: AgentId): WorldAgentState {
  return {
    agentId,
    physiology: { energy: 50, satiety: 50, health: 100 },
    educationScore: 0,
    balance: 1000,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}

function createObjective(agentId: AgentId): LongHorizonObjective {
  return {
    id: 'objective-study',
    agentId,
    statement: 'Study for the town routine.',
    priority: 3,
    source: 'human',
    affinityTags: ['study'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createStudyPlanRecord(agentId: AgentId) {
  return {
    planId: 'objective-study',
    agentId,
    plan: createBranchPlan({
      objective: 'Study for the town routine.',
      branches: [
        {
          id: 'study-lane',
          objective: 'Build knowledge.',
          subtasks: [
            {
              id: 'study-step',
              description: 'Attend planned activity.',
              basePriority: 5,
              intentionAffinityTags: ['study'],
            },
          ],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}
