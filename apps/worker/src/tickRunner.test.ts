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
  FileProjectionSnapshotStore,
  InMemoryEventStore,
  InMemoryProjectionCheckpointStore,
  asAgentId,
  asSimulationId,
  createProjectionCheckpoint,
  createSimulationPartition,
} from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { runWorkerSimulationTick } from './index';

const simulationId = asSimulationId('sim-1');
const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');
const partition = createSimulationPartition({ simulationId, partitionKey: 'world-main' });
const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

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
        agentId: agentOne,
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      {
        agentId: agentTwo,
        physiology: { energy: 60, satiety: 80, health: 100 },
        educationScore: 20,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
}

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-worker-tick-'));
  tmpRoots.push(root);
  return root;
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

function createTickAgents() {
  return [
    {
      agentId: agentOne,
      observedStateSummary: 'agent-1 education=10',
      plan: createStudyPlan(),
      signals: [],
      microPlanners: [
        createStudyPlanner({
          id: 'study-agent-1',
          description: 'agent 1 studies',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 60, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    },
    {
      agentId: agentTwo,
      observedStateSummary: 'agent-2 education=20',
      plan: createStudyPlan(),
      signals: [],
      microPlanners: [
        createStudyPlanner({
          id: 'study-agent-2',
          description: 'agent 2 studies',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 30, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    },
  ] satisfies Parameters<typeof runWorkerSimulationTick>[0]['agents'];
}

describe('worker tick runner', () => {
  test('runs agent cycles in order while carrying projection and stream version forward', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const result = await runWorkerSimulationTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: createTickAgents(),
      ...repositories,
    });

    expect(result.agentResults).toHaveLength(2);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'EducationChanged'],
      [3, 'ShortTermMemoryRecorded'],
      [4, 'EducationChanged'],
      [5, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.events[0]).toMatchObject({
      id: 'tick-1-advance-time:event:0',
      commandId: 'tick-1-advance-time',
      payload: {
        previous: { now: 0, tickDurationMs: 1000 },
        next: { now: 1000, tickDurationMs: 1000 },
        deltaMs: 1000,
      },
    });
    expect(result.projection.clock).toEqual({ now: 1000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(50);
    expect(result.streamVersion).toBe(5);
    expect(result.traces.map((trace) => trace.traceId)).toEqual([
      'tick-1:cycle:1:agent-1',
      'tick-1:cycle:2:agent-2',
    ]);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(5);
  });

  test('replays a whole tick idempotently from the same starting expected version', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const input = {
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: createTickAgents(),
      ...repositories,
    } satisfies Parameters<typeof runWorkerSimulationTick>[0];

    await runWorkerSimulationTick(input);
    const replay = await runWorkerSimulationTick(input);

    expect(
      replay.agentResults.map((result) => result.dispatchResult?.appendResult.idempotentReplay),
    ).toEqual([true, true]);
    expect(eventStore.readStream(partition.eventStreamName).map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EducationChanged',
      'ShortTermMemoryRecorded',
      'EducationChanged',
      'ShortTermMemoryRecorded',
    ]);
    await expect(
      repositories.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        statuses: ['succeeded'],
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      repositories.shortTermMemoryRepository.retrieve({
        agentId: agentTwo,
        statuses: ['succeeded'],
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toHaveLength(1);
  });

  test('hydrates the starting projection from the event stream when no explicit projection is provided', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    await runWorkerSimulationTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: createTickAgents(),
      ...repositories,
    });

    const result = await runWorkerSimulationTick({
      tickId: 'tick-2',
      simulationId,
      issuedAt: 200,
      projectionHydration: { initialProjection: createProjection() },
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      agents: createTickAgents(),
      ...repositories,
    });

    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [6, 'SimulationTimeAdvanced'],
      [7, 'EducationChanged'],
      [8, 'ShortTermMemoryRecorded'],
      [9, 'EducationChanged'],
      [10, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.events[0]).toMatchObject({
      payload: {
        previous: { now: 1000, tickDurationMs: 1000 },
        next: { now: 2000, tickDurationMs: 1000 },
        deltaMs: 1000,
      },
    });
    expect(result.projection.clock).toEqual({ now: 2000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(130);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(80);
    expect(result.streamVersion).toBe(10);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(10);
  });

  test('hydrates the starting projection from a checkpoint snapshot when available', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const firstResult = await runWorkerSimulationTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: createTickAgents(),
      ...repositories,
    });
    const checkpointStore = new InMemoryProjectionCheckpointStore();
    const snapshotStore = new FileProjectionSnapshotStore<WorldProjection>({
      rootDir: createRootDir(),
    });
    const snapshot = snapshotStore.saveSnapshot({
      simulationId,
      partitionKey: partition.partitionKey,
      sequence: firstResult.streamVersion,
      createdAt: 150,
      projection: firstResult.projection,
    });
    checkpointStore.saveCheckpoint(
      createProjectionCheckpoint({
        simulationId,
        partitionKey: partition.partitionKey,
        lastAppliedSequence: firstResult.streamVersion,
        snapshot,
      }),
    );

    const result = await runWorkerSimulationTick({
      tickId: 'tick-2',
      simulationId,
      issuedAt: 200,
      projectionHydration: {
        initialProjection: createProjection(),
        checkpoint: {
          partitionKey: partition.partitionKey,
          checkpointStore,
          snapshotStore,
        },
      },
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      agents: createTickAgents(),
      ...repositories,
    });

    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [6, 'SimulationTimeAdvanced'],
      [7, 'EducationChanged'],
      [8, 'ShortTermMemoryRecorded'],
      [9, 'EducationChanged'],
      [10, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.events[0]).toMatchObject({
      payload: {
        previous: { now: 1000, tickDurationMs: 1000 },
        next: { now: 2000, tickDurationMs: 1000 },
        deltaMs: 1000,
      },
    });
    expect(result.projection.clock).toEqual({ now: 2000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(130);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(80);
    expect(result.streamVersion).toBe(10);
  });

  test('continues later agents when an earlier agent requires replanning', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const agents = createTickAgents();
    const firstAgent = agents[0];
    const secondAgent = agents[1];
    if (firstAgent === undefined || secondAgent === undefined) {
      throw new Error('expected two tick agents');
    }
    const result = await runWorkerSimulationTick({
      tickId: 'tick-replan',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [
        {
          ...firstAgent,
          simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
        },
        secondAgent,
      ],
      ...repositories,
    });

    expect(result.agentResults[0]?.dispatchResult).toBeUndefined();
    expect(result.agentResults[0]?.cycleResult.needsReplan).toBe(true);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'EducationChanged'],
      [3, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.projection.clock).toEqual({ now: 1000, tickDurationMs: 1000 });
    expect(result.projection.agents['agent-1']?.educationScore).toBe(10);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(50);
    expect(result.streamVersion).toBe(3);
    expect(result.traces.map((trace) => trace.simulatorResult.status)).toEqual([
      'rejected',
      'accepted',
    ]);
  });
});
