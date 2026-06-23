import {
  createBranchPlan,
  type AtomicActionProposal,
  type DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import {
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
} from '@aivilization/memory';
import {
  InMemoryEventStore,
  asAgentId,
  asSimulationId,
  createSimulationPartition,
} from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldCommandPolicies,
  type WorldEvent,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { runWorkerAgentCycle, type WorkerAgentCycleTraceSink } from './index';

const simulationId = asSimulationId('sim-1');
const agentId = asAgentId('agent-1');
const partition = createSimulationPartition({ simulationId, partitionKey: 'world-main' });

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

function createProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId,
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
}

function createStudyPlan() {
  return createBranchPlan({
    objective: 'develop education',
    branches: [
      {
        id: 'development',
        objective: 'improve education',
        subtasks: [{ id: 'study', description: 'self study', basePriority: 5 }],
      },
    ],
  });
}

function createStudyPlanner(action: AtomicActionProposal): DomainMicroPlanner {
  return {
    domain: 'study',
    supports: ({ subtaskId }) => subtaskId === 'study',
    propose: () => [action],
  };
}

function createRepositories() {
  return {
    intentionRepository: new InMemoryAgentIntentionRepository(),
    longTermProfileRepository: new InMemoryLongTermProfileRepository(),
    shortTermMemoryRepository: new InMemoryShortTermMemoryRepository(),
  };
}

describe('worker agent cycle runner', () => {
  test('runs a planning cycle, appends world events, stores STM records, and emits a trace', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const traces: unknown[] = [];
    const traceSink: WorkerAgentCycleTraceSink = {
      record: (trace) => {
        traces.push(trace);
      },
    };

    const result = await runWorkerAgentCycle({
      cycleId: 'cycle-1',
      simulationId,
      agentId,
      issuedAt: 100,
      observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
      plan: createStudyPlan(),
      signals: [],
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'cycle-1',
      commandIdPrefix: 'cycle-1-command',
      microPlanners: [
        createStudyPlanner({
          id: 'study-1',
          description: 'study for one minute',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 60, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
      traceSink,
      ...repositories,
    });

    expect(result.cycleResult.selectedSubtask).toMatchObject({
      branchId: 'development',
      subtaskId: 'study',
    });
    expect(result.dispatchResult?.appendResult).toMatchObject({
      streamVersion: 2,
      idempotentReplay: false,
    });
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'EducationChanged'],
      [2, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    await expect(
      repositories.shortTermMemoryRepository.retrieve({
        agentId,
        statuses: ['succeeded'],
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toHaveLength(1);
    expect(result.trace).toMatchObject({
      traceId: 'cycle-1',
      selectedBranch: 'development',
      candidateActions: ['study for one minute'],
      simulatorResult: { status: 'accepted' },
      emittedCommandIds: ['cycle-1-command-1'],
      memoryWriteIds: ['cycle-1-command-1:memory:1'],
    });
    expect(traces).toEqual([result.trace]);
  });

  test('replays idempotent event appends without duplicating STM repository writes', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const input = {
      cycleId: 'cycle-1',
      simulationId,
      agentId,
      issuedAt: 100,
      observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
      plan: createStudyPlan(),
      signals: [],
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'cycle-1',
      commandIdPrefix: 'cycle-1-command',
      microPlanners: [
        createStudyPlanner({
          id: 'study-1',
          description: 'study for one minute',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 60, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
      ...repositories,
    } satisfies Parameters<typeof runWorkerAgentCycle>[0];

    await runWorkerAgentCycle(input);
    const replay = await runWorkerAgentCycle(input);

    expect(replay.dispatchResult?.appendResult.idempotentReplay).toBe(true);
    expect(eventStore.readStream(partition.eventStreamName)).toHaveLength(2);
    await expect(
      repositories.shortTermMemoryRepository.retrieve({
        agentId,
        statuses: ['succeeded'],
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toHaveLength(1);
  });

  test('records a rejected trace and skips event append when simulator requires replanning', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();

    const result = await runWorkerAgentCycle({
      cycleId: 'cycle-replan',
      simulationId,
      agentId,
      issuedAt: 100,
      observedStateSummary: 'energy=0 satiety=80 health=100 education=10',
      plan: createStudyPlan(),
      signals: [],
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'cycle-replan',
      commandIdPrefix: 'cycle-replan-command',
      microPlanners: [
        createStudyPlanner({
          id: 'study-1',
          description: 'study for one minute',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 60, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
      ...repositories,
    });

    expect(result.cycleResult.needsReplan).toBe(true);
    expect(result.dispatchResult).toBeUndefined();
    expect(result.events).toEqual([]);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(0);
    expect(result.trace).toMatchObject({
      traceId: 'cycle-replan',
      simulatorResult: { status: 'rejected', reason: 'energy too low' },
      emittedCommandIds: [],
      memoryWriteIds: [],
    });
  });
});
