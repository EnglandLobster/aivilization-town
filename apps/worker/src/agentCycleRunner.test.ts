import {
  createBranchPlan,
  createBranchPlanProgress,
  InMemoryBranchPlanRepository,
  InMemoryBranchPlanProgressRepository,
  type AtomicActionProposal,
  type DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import {
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  asMemoryRecordId,
  createShortTermMemoryRecord,
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

  test('retrieves short-term memory context before planning and records it in the trace', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.shortTermMemoryRepository.append(
      createShortTermMemoryRecord({
        id: 'recent-energy-failure',
        agentId,
        kind: 'action',
        status: 'failed',
        summary: 'Failed to work because energy was too low.',
        occurredAt: 1000,
        importanceScore: 0.8,
        source: { eventIds: [] },
        tags: ['work', 'energy'],
      }),
    );
    await repositories.longTermProfileRepository.save({
      agentId,
      beliefs: [],
      habits: [
        {
          key: 'rest-recovery',
          statement: 'Rest to recover from energy depletion.',
          confidence: 0.7,
          updatedAt: 900,
          provenanceRecordIds: [asMemoryRecordId('reflection-rest-1')],
        },
      ],
      values: [],
      personality: [],
      socialRecords: [],
    });

    const result = await runWorkerAgentCycle({
      cycleId: 'cycle-memory-context',
      simulationId,
      agentId,
      issuedAt: 1000,
      observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
      plan: createBranchPlan({
        objective: 'avoid repeating recent failures',
        branches: [
          {
            id: 'income',
            objective: 'earn wage',
            subtasks: [{ id: 'work', description: 'work shift', basePriority: 4 }],
          },
          {
            id: 'recovery',
            objective: 'restore energy',
            subtasks: [
              {
                id: 'sleep',
                description: 'rest before working',
                basePriority: 1,
                memoryAffinityTags: ['energy'],
                profileAffinityTags: ['recovery'],
              },
            ],
          },
        ],
      }),
      signals: [],
      memoryRetrievalLimit: 10,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'cycle-memory-context',
      commandIdPrefix: 'cycle-memory-context-command',
      microPlanners: [
        {
          domain: 'sleep',
          supports: ({ subtaskId }) => subtaskId === 'sleep',
          propose: () => [
            {
              id: 'sleep-1',
              description: 'sleep for one minute',
              commandType: 'AgentSleep',
              payload: { durationSeconds: 60 },
            },
          ],
        },
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 60 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
      ...repositories,
    });

    expect(result.cycleResult.selectedSubtask).toMatchObject({
      branchId: 'recovery',
      subtaskId: 'sleep',
    });
    expect(result.trace.memoryContextIds).toEqual(['recent-energy-failure']);
    expect(result.trace.selectionEvidence).toEqual({
      selectedSubtaskId: 'sleep',
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 3.2,
      profileInfluenceScore: 1.4,
      memoryEvidenceRecordIds: ['recent-energy-failure'],
      profileEntryKeys: ['rest-recovery'],
      profileEvidenceRecordIds: ['reflection-rest-1'],
    });
    expect(result.cycleResult.commandDrafts[0]?.type).toBe('AgentSleep');
  });

  test('records a rejected trace and skips event append when simulator requires replanning', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    await repositories.shortTermMemoryRepository.append(
      createShortTermMemoryRecord({
        id: 'study-energy-failure',
        agentId,
        kind: 'action',
        status: 'failed',
        summary: 'Failed to study because energy was too low.',
        occurredAt: 90,
        importanceScore: 0.9,
        source: { eventIds: [] },
        tags: ['study', 'energy'],
      }),
    );

    const result = await runWorkerAgentCycle({
      cycleId: 'cycle-replan',
      simulationId,
      agentId,
      issuedAt: 100,
      observedStateSummary: 'energy=0 satiety=80 health=100 education=10',
      plan: createStudyPlan(),
      signals: [],
      memoryRetrievalLimit: 10,
      replanningPolicy: { consecutiveFailureThreshold: 2 },
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
      replanningDecision: {
        kind: 'memory-guided-correction',
        trigger: 'simulator-rejection',
        reason: 'energy too low',
        failedActionIds: ['study-1'],
        evidenceRecordIds: ['study-energy-failure'],
      },
      emittedCommandIds: [],
      memoryContextIds: ['study-energy-failure'],
      memoryWriteIds: [],
    });
  });

  test('returns progress updates when full replanning blocks the selected subtask', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const progress = createBranchPlanProgress({ planId: 'plan-1', agentId, createdAt: 50 });
    await repositories.shortTermMemoryRepository.append(
      createShortTermMemoryRecord({
        id: 'study-energy-failure',
        agentId,
        kind: 'action',
        status: 'failed',
        summary: 'Failed to study because energy was too low.',
        occurredAt: 90,
        importanceScore: 0.9,
        source: { eventIds: [] },
        tags: ['study', 'energy'],
      }),
    );

    const result = await runWorkerAgentCycle({
      cycleId: 'cycle-full-replan',
      simulationId,
      agentId,
      issuedAt: 100,
      observedStateSummary: 'energy=0 satiety=80 health=100 education=10',
      plan: createStudyPlan(),
      progress,
      signals: [],
      memoryRetrievalLimit: 10,
      replanningPolicy: { consecutiveFailureThreshold: 1 },
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'cycle-full-replan',
      commandIdPrefix: 'cycle-full-replan-command',
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

    expect(result.events).toEqual([]);
    expect(result.progressUpdate).toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [
        {
          subtaskId: 'study',
          reason: 'repeated-failure: energy too low',
          blockedAt: 100,
        },
      ],
      updatedAt: 100,
    });
  });

  test('loads and saves progress updates through a repository', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    await planProgressRepository.getOrCreate({
      planId: 'plan-1',
      agentId,
      createdAt: 50,
    });
    await repositories.shortTermMemoryRepository.append(
      createShortTermMemoryRecord({
        id: 'study-energy-failure',
        agentId,
        kind: 'action',
        status: 'failed',
        summary: 'Failed to study because energy was too low.',
        occurredAt: 90,
        importanceScore: 0.9,
        source: { eventIds: [] },
        tags: ['study', 'energy'],
      }),
    );

    const result = await runWorkerAgentCycle({
      cycleId: 'cycle-repo-progress',
      simulationId,
      agentId,
      issuedAt: 100,
      observedStateSummary: 'energy=0 satiety=80 health=100 education=10',
      plan: createStudyPlan(),
      planProgressRepository,
      planProgressId: 'plan-1',
      signals: [],
      memoryRetrievalLimit: 10,
      replanningPolicy: { consecutiveFailureThreshold: 1 },
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'cycle-repo-progress',
      commandIdPrefix: 'cycle-repo-progress-command',
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

    expect(result.events).toEqual([]);
    expect(result.progressUpdate?.blockedSubtasks).toEqual([
      {
        subtaskId: 'study',
        reason: 'repeated-failure: energy too low',
        blockedAt: 100,
      },
    ]);
    await expect(
      planProgressRepository.getOrCreate({
        planId: 'plan-1',
        agentId,
        createdAt: 999,
      }),
    ).resolves.toEqual(result.progressUpdate);
  });

  test('does not save completed progress when event append fails', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    await planProgressRepository.getOrCreate({
      planId: 'plan-1',
      agentId,
      createdAt: 50,
    });

    await expect(
      runWorkerAgentCycle({
        cycleId: 'cycle-progress-append-failure',
        simulationId,
        agentId,
        issuedAt: 100,
        observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
        plan: createStudyPlan(),
        planProgressRepository,
        planProgressId: 'plan-1',
        signals: [],
        projection: createProjection(),
        policies,
        eventStore,
        streamName: partition.eventStreamName,
        expectedVersion: 1,
        appendIdempotencyKey: 'cycle-progress-append-failure',
        commandIdPrefix: 'cycle-progress-append-failure-command',
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
      }),
    ).rejects.toThrow('expected stream version 1 but current version is 0');

    await expect(
      planProgressRepository.getOrCreate({
        planId: 'plan-1',
        agentId,
        createdAt: 999,
      }),
    ).resolves.toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 50,
    });
  });

  test('loads branch plans through a repository when only plan id is provided', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const planRepository = new InMemoryBranchPlanRepository();
    await planRepository.save({
      planId: 'sleep-plan',
      agentId,
      plan: createBranchPlan({
        objective: 'restore energy',
        branches: [
          {
            id: 'recovery',
            objective: 'recover energy',
            subtasks: [{ id: 'sleep', description: 'sleep to recover', basePriority: 10 }],
          },
        ],
      }),
      createdAt: 50,
      updatedAt: 50,
    });

    const result = await runWorkerAgentCycle({
      cycleId: 'cycle-plan-repository',
      simulationId,
      agentId,
      issuedAt: 100,
      observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
      planRepository,
      planId: 'sleep-plan',
      signals: [],
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'cycle-plan-repository',
      commandIdPrefix: 'cycle-plan-repository-command',
      microPlanners: [
        {
          domain: 'sleep',
          supports: ({ subtaskId }) => subtaskId === 'sleep',
          propose: () => [
            {
              id: 'sleep-1',
              description: 'sleep for one minute',
              commandType: 'AgentSleep',
              payload: { durationSeconds: 60 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
      ...repositories,
    });

    expect(result.cycleResult.selectedSubtask).toMatchObject({
      branchId: 'recovery',
      subtaskId: 'sleep',
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'PhysiologyChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(result.projection.agents['agent-1']?.physiology.energy).toBe(100);
  });
});
