import {
  createBranchPlan,
  type AtomicActionProposal,
  type DomainMicroPlanner,
  type ReactiveLocalizedPlanner,
} from '@aivilization/agent-runtime';
import { createAmmPool } from '@aivilization/economy';
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

  test('builds tick agents from a provider after command drain updates projection', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    storage.commandStore.appendToStream({
      streamName: storage.partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-command-provider',
      commands: [
        createCommandEnvelope({
          id: 'cmd-provider-study',
          simulationId: 'sim-1',
          actorId: agentOne,
          source: 'human',
          type: 'IssueReactiveCommand',
          payload: {
            reactiveCommandId: 'reactive-provider-study',
            summary: 'study before provider resolves agents',
            tags: ['study'],
          },
          issuedAt: 100,
        }),
      ],
    });
    const providerObservedEducation: number[] = [];

    const result = await runLocalWorldRuntimeStep({
      storage,
      tickId: 'tick-provider',
      simulationId: 'sim-1',
      issuedAt: 200,
      initialProjection: createInitialProjection(),
      policies,
      commandConsumerId: 'worker-main',
      localizedPlanners: [reactiveStudyPlanner()],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      agentProvider: ({ projection }) => {
        providerObservedEducation.push(projection.agents['agent-1']?.educationScore ?? -1);
        return [
          {
            agentId: agentOne,
            observedStateSummary: 'provider-built study agent',
            plan: createStudyPlan(),
            signals: [],
            microPlanners: [
              studyMicroPlanner({
                id: 'study-from-provider',
                description: 'study from provider',
                commandType: 'AgentStudy',
                payload: { durationSeconds: 30, educationRatePerSecond: 1 },
              }),
            ],
            simulate: ({ action }) => ({ status: 'accepted', action }),
          },
        ];
      },
    });

    expect(providerObservedEducation).toEqual([70]);
    if (result.status !== 'ticked') {
      throw new Error('expected ticked result');
    }
    expect(result.projection.agents['agent-1']?.educationScore).toBe(100);
  });

  test('records market observations through local storage during a runtime step', async () => {
    const rootDir = createRootDir();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });

    const result = await runLocalWorldRuntimeStep({
      storage,
      tickId: 'tick-market-observations',
      simulationId: 'sim-1',
      issuedAt: 200,
      initialProjection: createInitialMarketProjection(),
      policies,
      commandConsumerId: 'worker-main',
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'agent-1 needs food from the Apple market',
          plan: createTradePlan(),
          signals: [],
          microPlanners: [
            tradeMicroPlanner({
              id: 'buy-apple',
              description: 'buy Apple from AMM',
              commandType: 'AgentTrade',
              payload: { side: 'buy', commodityName: 'Apple', quantity: 10 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      marketObservations: { priceBinning: { intervalMs: 1000, originAt: 0 } },
    });

    if (result.status !== 'ticked') {
      throw new Error('expected ticked result');
    }
    expect(result.tick.marketObservationRecording).toEqual({
      tradeObservationCount: 1,
      ohlcBarCount: 1,
    });
    await expect(
      storage.marketObservationRepository.queryTrades({
        simulationId: 'sim-1',
        commodityId: 'Apple',
      }),
    ).resolves.toMatchObject([
      {
        simulationId: 'sim-1',
        commodityId: 'Apple',
        sourceSequence: 2,
        side: 'buy',
      },
    ]);

    const restarted = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    await expect(
      restarted.marketObservationRepository.queryOhlcBars({
        simulationId: 'sim-1',
        commodityId: 'Apple',
      }),
    ).resolves.toMatchObject([
      {
        simulationId: 'sim-1',
        commodityId: 'Apple',
        intervalStartedAt: 0,
        intervalEndedAt: 1000,
        tradeCount: 1,
      },
    ]);
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

function createInitialMarketProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 1000,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
    marketPools: [
      createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
    ],
    moneySupply: 1000,
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

function createTradePlan() {
  return createBranchPlan({
    objective: 'buy food from the market',
    branches: [
      {
        id: 'market',
        objective: 'buy Apple',
        subtasks: [{ id: 'buy-apple', description: 'buy Apple', basePriority: 5 }],
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

function tradeMicroPlanner(action: AtomicActionProposal): DomainMicroPlanner {
  return {
    domain: 'trade',
    supports: ({ subtaskId }) => subtaskId === 'buy-apple',
    propose: () => [action],
  };
}
