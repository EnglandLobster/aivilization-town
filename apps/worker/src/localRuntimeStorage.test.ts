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
import { asAgentId, asSimulationId } from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldCommandPolicies,
  type WorldEvent,
} from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalWorldRuntimeStorage, runWorkerSimulationTick } from './index';

const simulationId = asSimulationId('sim-1');
const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');

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

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-runtime-'));
  tmpRoots.push(root);
  return root;
}

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

describe('local world runtime storage', () => {
  test('restarts file-backed world tick storage and continues from the latest checkpoint', async () => {
    const rootDir = createRootDir();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId,
      partitionKey: 'world-main',
    });
    const repositories = createRepositories();

    const first = await runWorkerSimulationTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore: storage.eventStore,
      streamName: storage.partition.eventStreamName,
      expectedVersion: 0,
      checkpointing: storage.checkpointing,
      agents: createTickAgents(),
      ...repositories,
    });
    const restarted = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId,
      partitionKey: 'world-main',
    });

    expect(first.streamVersion).toBe(5);
    expect(storage.paths.partitionDir).toContain('simulations');
    expect(restarted.eventStore.getStreamVersion(restarted.partition.eventStreamName)).toBe(5);
    expect(
      restarted.checkpointStore.getLatestCheckpoint({
        simulationId,
        partitionKey: restarted.partition.partitionKey,
      })?.lastAppliedSequence,
    ).toBe(5);

    const second = await runWorkerSimulationTick({
      tickId: 'tick-2',
      simulationId,
      issuedAt: 200,
      projectionHydration: {
        initialProjection: createProjection(),
        checkpoint: restarted.checkpointHydration,
      },
      policies,
      eventStore: restarted.eventStore,
      streamName: restarted.partition.eventStreamName,
      checkpointing: restarted.checkpointing,
      agents: createTickAgents(),
      ...repositories,
    });

    expect(second.events.map((event: WorldEvent) => [event.sequence, event.type])).toEqual([
      [6, 'SimulationTimeAdvanced'],
      [7, 'EducationChanged'],
      [8, 'ShortTermMemoryRecorded'],
      [9, 'EducationChanged'],
      [10, 'ShortTermMemoryRecorded'],
    ]);
    expect(second.projection.clock).toEqual({ now: 2000, tickDurationMs: 1000 });
    expect(second.projection.agents['agent-1']?.educationScore).toBe(130);
    expect(second.projection.agents['agent-2']?.educationScore).toBe(80);
    expect(second.streamVersion).toBe(10);
    expect(restarted.eventStore.getStreamVersion(restarted.partition.eventStreamName)).toBe(10);
    expect(
      restarted.checkpointStore.getLatestCheckpoint({
        simulationId,
        partitionKey: restarted.partition.partitionKey,
      }),
    ).toEqual(second.checkpoint);
    if (second.snapshot === undefined) {
      throw new Error('expected second tick to write a snapshot');
    }
    expect(restarted.snapshotStore.loadSnapshot(second.snapshot)).toEqual(second.projection);
  });
});
