import {
  createBranchPlan,
  type AtomicActionProposal,
  type DomainMicroPlanner,
  type ReactiveLocalizedPlanner,
} from '@aivilization/agent-runtime';
import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { createWorldProjection, type WorldCommandPolicies } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalWorldRuntimeStorage, runLocalWorldRuntimeStep } from './index';

const agentOne = asAgentId('agent-1');

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
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
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-runtime-step-'));
  tmpRoots.push(root);
  return root;
}

describe('local world runtime step', () => {
  test('drains command inbox into world events before running the next simulation tick', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    storage.commandStore.appendToStream({
      streamName: storage.partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-command-1',
      commands: [
        createCommandEnvelope({
          id: 'cmd-reactive-study',
          simulationId: 'sim-1',
          actorId: agentOne,
          source: 'human',
          type: 'IssueReactiveCommand',
          payload: {
            reactiveCommandId: 'reactive-study',
            summary: 'study for one minute before the tick',
            tags: ['study'],
          },
          issuedAt: 100,
        }),
      ],
    });

    const result = await runLocalWorldRuntimeStep({
      storage,
      tickId: 'tick-1',
      simulationId: 'sim-1',
      issuedAt: 200,
      initialProjection: createInitialProjection(),
      policies,
      commandConsumerId: 'worker-main',
      commandCheckpointUpdatedAt: 200,
      localizedPlanners: [reactiveStudyPlanner()],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 education=70 after command drain',
          plan: createStudyPlan(),
          signals: [],
          microPlanners: [
            studyMicroPlanner({
              id: 'study-during-tick',
              description: 'study during tick',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 30, educationRatePerSecond: 1 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
    });

    if (result.status !== 'ticked') {
      throw new Error('expected local runtime step to tick after draining commands');
    }
    expect(result.commandDrain.status).toBe('drained');
    expect(result.commandDrain.checkpoint).toMatchObject({
      consumerId: 'worker-main',
      streamName: storage.partition.commandStreamName,
      lastConsumedSequence: 1,
      updatedAt: 200,
    });
    expect(result.tick.events.map((event) => [event.sequence, event.type])).toEqual([
      [3, 'SimulationTimeAdvanced'],
      [4, 'EducationChanged'],
      [5, 'ShortTermMemoryRecorded'],
    ]);
    expect(
      storage.eventStore
        .readStream(storage.partition.eventStreamName)
        .map((event) => [event.sequence, event.type]),
    ).toEqual([
      [1, 'EducationChanged'],
      [2, 'ShortTermMemoryRecorded'],
      [3, 'SimulationTimeAdvanced'],
      [4, 'EducationChanged'],
      [5, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(100);
    expect(result.tick.checkpoint).toMatchObject({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      lastAppliedSequence: 5,
    });
    expect(
      storage.checkpointStore.getLatestCheckpoint({
        simulationId: storage.partition.simulationId,
        partitionKey: storage.partition.partitionKey,
      }),
    ).toEqual(result.tick.checkpoint);
  });
});

function createInitialProjection() {
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

function reactiveStudyPlanner(): ReactiveLocalizedPlanner {
  return {
    domain: 'study',
    supports: ({ summary }) => summary.includes('study'),
    propose: () => [
      {
        id: 'study-before-tick',
        description: 'study before tick',
        commandType: 'AgentStudy',
        payload: { durationSeconds: 60, educationRatePerSecond: 1 },
      },
    ],
  };
}

function studyMicroPlanner(action: AtomicActionProposal): DomainMicroPlanner {
  return {
    domain: 'study',
    supports: ({ subtaskId }) => subtaskId === 'study',
    propose: () => [action],
  };
}
