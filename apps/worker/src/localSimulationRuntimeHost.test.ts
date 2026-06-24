import { type ReactiveLocalizedPlanner } from '@aivilization/agent-runtime';
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
  type LocalSimulationBackendLifecycleResult,
  type LocalSimulationLifecycleStartResult,
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

describe('local simulation runtime host', () => {
  test('bootstraps every manifest partition before exposing a routed registry', async () => {
    const rootDir = createRootDir();
    const manifest = createManifest();
    const scenarioPresets = createScenarioPresets();

    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 123,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [reactiveStudyPlanner()],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });

    expect(host.manifestId).toBe('town-runtime');
    expect(
      host.partitions.map((partition) => ({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        scenarioPresetId: partition.scenarioPresetId,
        initializedCheckpoint: partition.bootstrap.initializedCheckpoint,
        seededAgentIds: partition.bootstrap.profileSeeding.seededAgentIds,
        snapshotSequence: partition.bootstrap.snapshot.sequence,
      })),
    ).toEqual([
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        scenarioPresetId: 'scenario-main',
        initializedCheckpoint: true,
        seededAgentIds: ['agent-1'],
        snapshotSequence: 0,
      },
      {
        simulationId: 'sim-1',
        partitionKey: 'world-east',
        scenarioPresetId: 'scenario-east',
        initializedCheckpoint: true,
        seededAgentIds: ['agent-2'],
        snapshotSequence: 0,
      },
    ]);
    expect(host.registry.listPartitions()).toEqual([
      { simulationId: 'sim-1', partitionKey: 'world-main' },
      { simulationId: 'sim-1', partitionKey: 'world-east' },
    ]);
    await expect(
      host.partitions[0]!.bootstrap.storage.longTermProfileRepository.getOrCreate(agentOne),
    ).resolves.toMatchObject({
      personality: [
        {
          key: 'initial-mbti',
          statement: 'MBTI: INTJ.',
          updatedAt: 123,
        },
      ],
    });

    await host.registry.api.submitReactiveCommand({
      simulationId: 'sim-1',
      partitionKey: 'world-east',
      agentId: 'agent-2',
      reactiveCommandId: 'reactive-study-east',
      commandId: 'cmd-study-east',
      summary: 'study in the east runtime',
      issuedAt: 200,
      expectedVersion: 0,
    });
    const started = requireCompletedStartResult(
      await host.registry.api.startSimulation({
        simulationId: 'sim-1',
        partitionKey: 'world-east',
        requestedAt: 300,
      }),
    );
    expect(started.state.lastAppliedSequence).toBe(3);

    const eastProjection = await host.registry.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-east',
    });
    expect(eastProjection.projection.agents['agent-2']?.educationScore).toBe(80);

    const mainProjection = await host.registry.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(mainProjection.projection.agents['agent-1']?.educationScore).toBe(10);
  });

  test('reuses existing partition checkpoints and profile seeds on host restart', async () => {
    const rootDir = createRootDir();
    const manifest = createManifest();
    const scenarioPresets = createScenarioPresets();
    const first = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });

    const restarted = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 999,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });

    expect(
      restarted.partitions.map((partition, index) => ({
        initializedCheckpoint: partition.bootstrap.initializedCheckpoint,
        checkpoint: partition.bootstrap.checkpoint,
        skippedAgentIds: partition.bootstrap.profileSeeding.skippedAgentIds,
        firstCheckpoint: first.partitions[index]!.bootstrap.checkpoint,
      })),
    ).toEqual([
      {
        initializedCheckpoint: false,
        checkpoint: first.partitions[0]!.bootstrap.checkpoint,
        firstCheckpoint: first.partitions[0]!.bootstrap.checkpoint,
        skippedAgentIds: ['agent-1'],
      },
      {
        initializedCheckpoint: false,
        checkpoint: first.partitions[1]!.bootstrap.checkpoint,
        firstCheckpoint: first.partitions[1]!.bootstrap.checkpoint,
        skippedAgentIds: ['agent-2'],
      },
    ]);
    await expect(
      restarted.partitions[0]!.bootstrap.storage.longTermProfileRepository.getOrCreate(agentOne),
    ).resolves.toMatchObject({
      personality: [
        {
          key: 'initial-mbti',
          updatedAt: 100,
        },
      ],
    });
    expect(
      restarted.registry.hasBackend({ simulationId: 'sim-1', partitionKey: 'world-east' }),
    ).toBe(true);
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-runtime-host-'));
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
      educationScore: 10,
    }),
    createScenarioPreset({
      id: 'scenario-east',
      agentId: agentTwo,
      educationScore: 20,
    }),
  ];
}

function createScenarioPreset(input: {
  readonly id: string;
  readonly agentId: AgentId;
  readonly educationScore: number;
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
        educationScore: input.educationScore,
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

function requireCompletedStartResult(
  result: LocalSimulationBackendLifecycleResult,
): LocalSimulationLifecycleStartResult {
  if (result.status !== 'completed') {
    throw new Error(`expected completed start lifecycle result, received ${result.status}`);
  }
  return result;
}
