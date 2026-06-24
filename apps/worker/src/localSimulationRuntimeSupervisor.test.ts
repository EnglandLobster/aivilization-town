import {
  asAgentId,
  asLocationId,
  type AgentId,
} from '@aivilization/sim-core';
import { type ScenarioPreset } from '@aivilization/content';
import { type WorldCommandPolicies } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  bootstrapLocalSimulationRuntimeHostFromManifest,
  createLocalSimulationRuntimeSupervisor,
  type LocalSimulationRuntimeManifest,
} from './index';

const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');
const mainSquare = asLocationId('main-square');

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

describe('local simulation runtime supervisor', () => {
  test('reports bootstrapped partition status before lifecycle commands run', async () => {
    const host = await bootstrapTestHost();
    const supervisor = createLocalSimulationRuntimeSupervisor({ host });

    expect(toStatusSummary(supervisor.getStatus())).toEqual({
      manifestId: 'town-runtime',
      partitionCount: 2,
      healthyPartitionCount: 2,
      attentionPartitionCount: 0,
      partitions: [
        {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          scenarioPresetId: 'scenario-main',
          status: 'bootstrapped',
          health: 'healthy',
          initializedCheckpoint: true,
          seededAgentCount: 1,
          skippedAgentCount: 0,
          nextTickIndex: undefined,
          lastAppliedSequence: 0,
        },
        {
          simulationId: 'sim-1',
          partitionKey: 'world-east',
          scenarioPresetId: 'scenario-east',
          status: 'bootstrapped',
          health: 'healthy',
          initializedCheckpoint: true,
          seededAgentCount: 1,
          skippedAgentCount: 0,
          nextTickIndex: undefined,
          lastAppliedSequence: 0,
        },
      ],
    });
  });

  test('starts and pauses every hosted partition through the registry lifecycle API', async () => {
    const host = await bootstrapTestHost();
    const supervisor = createLocalSimulationRuntimeSupervisor({ host });

    const startResult = await supervisor.startAll({ requestedAt: 200 });

    expect(startResult.partitions.map((partition) => partition.status)).toEqual([
      'completed',
      'completed',
    ]);
    expect(
      startResult.status.partitions.map((partition) => ({
        partitionKey: partition.partitionKey,
        status: partition.status,
        health: partition.health,
        nextTickIndex: partition.nextTickIndex,
        lastAppliedSequence: partition.lastAppliedSequence,
      })),
    ).toEqual([
      {
        partitionKey: 'world-main',
        status: 'completed',
        health: 'healthy',
        nextTickIndex: 2,
        lastAppliedSequence: 1,
      },
      {
        partitionKey: 'world-east',
        status: 'completed',
        health: 'healthy',
        nextTickIndex: 2,
        lastAppliedSequence: 1,
      },
    ]);

    const pauseResult = await supervisor.pauseAll({ requestedAt: 300 });

    expect(pauseResult.partitions.map((partition) => partition.status)).toEqual([
      'paused',
      'paused',
    ]);
    expect(
      pauseResult.status.partitions.map((partition) => ({
        partitionKey: partition.partitionKey,
        status: partition.status,
        health: partition.health,
        nextTickIndex: partition.nextTickIndex,
        lastAppliedSequence: partition.lastAppliedSequence,
      })),
    ).toEqual([
      {
        partitionKey: 'world-main',
        status: 'paused',
        health: 'healthy',
        nextTickIndex: 2,
        lastAppliedSequence: 1,
      },
      {
        partitionKey: 'world-east',
        status: 'paused',
        health: 'healthy',
        nextTickIndex: 2,
        lastAppliedSequence: 1,
      },
    ]);
  });

  test('surfaces partial partition failures without rejecting the whole bulk start command', async () => {
    const host = await bootstrapTestHost();
    const supervisor = createLocalSimulationRuntimeSupervisor({ host });
    await host.registry.api.resetSimulation({
      simulationId: 'sim-1',
      partitionKey: 'world-east',
      requestedAt: 150,
    });

    const startResult = await supervisor.startAll({ requestedAt: 200 });

    expect(startResult.outcome).toBe('partial-failure');
    expect(startResult.succeededPartitionCount).toBe(1);
    expect(startResult.failedPartitionCount).toBe(1);
    expect(
      startResult.partitions.map((partition) => ({
        partitionKey: partition.partitionKey,
        status: partition.status,
        outcome: partition.outcome,
        error: partition.outcome === 'failed' ? partition.error.message : undefined,
      })),
    ).toEqual([
      {
        partitionKey: 'world-main',
        status: 'completed',
        outcome: 'succeeded',
        error: undefined,
      },
      {
        partitionKey: 'world-east',
        status: 'failed',
        outcome: 'failed',
        error: 'local simulation reset has not been materialized',
      },
    ]);
    expect(
      startResult.status.partitions.map((partition) => ({
        partitionKey: partition.partitionKey,
        status: partition.status,
        health: partition.health,
      })),
    ).toEqual([
      {
        partitionKey: 'world-main',
        status: 'completed',
        health: 'healthy',
      },
      {
        partitionKey: 'world-east',
        status: 'reset-requested',
        health: 'attention',
      },
    ]);
  });
});

function toStatusSummary(status: ReturnType<ReturnType<typeof createLocalSimulationRuntimeSupervisor>['getStatus']>) {
  return {
    manifestId: status.manifestId,
    partitionCount: status.partitionCount,
    healthyPartitionCount: status.healthyPartitionCount,
    attentionPartitionCount: status.attentionPartitionCount,
    partitions: status.partitions.map((partition) => ({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      scenarioPresetId: partition.scenarioPresetId,
      status: partition.status,
      health: partition.health,
      initializedCheckpoint: partition.initializedCheckpoint,
      seededAgentCount: partition.seededAgentCount,
      skippedAgentCount: partition.skippedAgentCount,
      nextTickIndex: partition.nextTickIndex,
      lastAppliedSequence: partition.lastAppliedSequence,
    })),
  };
}

async function bootstrapTestHost() {
  return bootstrapLocalSimulationRuntimeHostFromManifest({
    rootDir: createRootDir(),
    bootstrappedAt: 100,
    manifest: createManifest(),
    scenarioPresets: createScenarioPresets(),
    policies,
    localizedPlanners: [],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    agents: [],
  });
}

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-runtime-supervisor-'));
  tmpRoots.push(root);
  return root;
}

function createManifest(): LocalSimulationRuntimeManifest {
  return {
    id: 'town-runtime',
    defaults: {
      tickBatchSize: 1,
      tickIntervalMs: 100,
      commandConsumerIdPrefix: 'worker',
    },
    partitions: [
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        scenarioPresetId: 'scenario-main',
      },
      {
        simulationId: 'sim-1',
        partitionKey: 'world-east',
        scenarioPresetId: 'scenario-east',
      },
    ],
  };
}

function createScenarioPresets(): readonly ScenarioPreset[] {
  return [
    createScenarioPreset({
      id: 'scenario-main',
      agentId: agentOne,
    }),
    createScenarioPreset({
      id: 'scenario-east',
      agentId: agentTwo,
    }),
  ];
}

function createScenarioPreset(input: {
  readonly id: string;
  readonly agentId: AgentId;
}): ScenarioPreset {
  return {
    id: input.id,
    name: input.id,
    description: `${input.id} test scenario`,
    clock: { now: 0, tickDurationMs: 1000 },
    timeScale: 35,
    locations: [
      {
        locationId: mainSquare,
        name: 'Main Square',
        kind: 'social',
        activityAffinities: ['study'],
        capacity: null,
        source: 'test',
      },
    ],
    agentSeeds: [
      {
        agentId: input.agentId,
        displayName: input.agentId,
        profile: { personality: { mbti: 'INTJ' }, source: 'test' },
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
        locationId: mainSquare,
        source: 'test',
        tags: ['test'],
      },
    ],
    source: 'test',
  };
}
