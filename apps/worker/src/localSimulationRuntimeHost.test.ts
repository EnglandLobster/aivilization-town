import { type ReactiveLocalizedPlanner } from '@aivilization/agent-runtime';
import { asAgentId, asLocationId, type AgentId } from '@aivilization/sim-core';
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
    const providerDirectoryAgentCounts: number[] = [];

    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 123,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [reactiveStudyPlanner()],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      agentProvider: ({ societyDirectory }) => {
        providerDirectoryAgentCounts.push(societyDirectory?.agents.length ?? 0);
        return [];
      },
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
    expect(host.societyDirectory.getDirectory({ simulationId: 'sim-1' })).toMatchObject({
      schemaVersion: 'local-simulation-society-directory-v1',
      manifestId: 'town-runtime',
      simulationId: 'sim-1',
      partitionBoundaries: [
        { partitionKey: 'world-east', lastAppliedSequence: 0, simulationTime: 0 },
        { partitionKey: 'world-main', lastAppliedSequence: 0, simulationTime: 0 },
      ],
      agents: [
        {
          agentId: 'agent-1',
          ownerPartitionKey: 'world-main',
          ownerLastAppliedSequence: 0,
          publicState: { locationId: 'main-square', educationScore: 10 },
        },
        {
          agentId: 'agent-2',
          ownerPartitionKey: 'world-east',
          ownerLastAppliedSequence: 0,
          publicState: { locationId: 'main-square', educationScore: 20 },
        },
      ],
    });
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
    expect(started.state.lastAppliedSequence).toBe(4);
    expect(providerDirectoryAgentCounts).toContain(2);

    const eastProjection = await host.registry.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-east',
    });
    expect(eastProjection.projection.agents['agent-2']?.educationScore).toBe(80);
    expect(
      host.societyDirectory.getAgent({ simulationId: 'sim-1', agentId: 'agent-2' }),
    ).toMatchObject({
      ownerPartitionKey: 'world-east',
      ownerLastAppliedSequence: 4,
      publicState: { educationScore: 80 },
    });

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
    expect(restarted.societyDirectory.getDirectory({ simulationId: 'sim-1' })).toEqual(
      first.societyDirectory.getDirectory({ simulationId: 'sim-1' }),
    );
  });

  test('commits one cross-partition conversation to both owner projections idempotently', async () => {
    const rootDir = createRootDir();
    const manifest = createManifest();
    const scenarioPresets = createScenarioPresets();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });
    const request = {
      operationId: 'agent-1-meets-agent-2-at-100',
      simulationId: 'sim-1',
      initiatorAgentId: agentOne,
      targetAgentId: agentTwo,
      topic: 'town cooperation',
      turns: [
        {
          speakerAgentId: agentOne,
          utterance: 'Could we coordinate our work at the square?',
          intent: 'request-cooperation',
        },
        {
          speakerAgentId: agentTwo,
          utterance: 'Yes, I will share what the east side needs.',
          intent: 'commit-cooperation',
        },
      ],
      issuedAt: 100,
    } as const;

    await expect(host.socialInteractions.executeConversation(request)).resolves.toMatchObject({
      schemaVersion: 'local-simulation-social-interaction-v1',
      operationId: request.operationId,
      sourcePartitionKey: 'world-main',
      targetPartitionKey: 'world-east',
      partitionStreamVersions: { 'world-main': 4, 'world-east': 4 },
      idempotentReplay: false,
    });
    await expect(host.socialInteractions.executeConversation(request)).resolves.toMatchObject({
      partitionStreamVersions: { 'world-main': 4, 'world-east': 4 },
      idempotentReplay: true,
    });

    for (const partitionKey of ['world-main', 'world-east'] as const) {
      const hydrated = await host.registry.api.getProjection({
        simulationId: 'sim-1',
        partitionKey,
      });
      expect(hydrated.streamVersion).toBe(4);
      expect(hydrated.projection.conversationRecords).toHaveLength(1);
      expect(Object.keys(hydrated.projection.socialRelations)).toHaveLength(2);
      expect(hydrated.projection.memoryRecords).toHaveLength(1);
      expect(hydrated.projection.memoryRecords[0]?.agentId).toBe(
        partitionKey === 'world-main' ? agentOne : agentTwo,
      );
    }

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
    await expect(restarted.socialInteractions.recoverPending()).resolves.toEqual([]);
    await expect(
      restarted.partitions[0]!.bootstrap.storage.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        limit: 64,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      restarted.partitions[1]!.bootstrap.storage.shortTermMemoryRepository.retrieve({
        agentId: agentTwo,
        limit: 64,
      }),
    ).resolves.toHaveLength(1);
  });

  test('rolls forward a cross-partition conversation interrupted after the first owner append', async () => {
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
    const sourceMemoryRepository = first.partitions[0]!.bootstrap.storage.shortTermMemoryRepository;
    const originalAppend = sourceMemoryRepository.append.bind(sourceMemoryRepository);
    sourceMemoryRepository.append = () => Promise.reject(new Error('simulated process failure'));

    await expect(
      first.socialInteractions.executeConversation({
        operationId: 'interrupted-agent-1-meets-agent-2',
        simulationId: 'sim-1',
        initiatorAgentId: agentOne,
        targetAgentId: agentTwo,
        topic: 'recovery cooperation',
        turns: [
          { speakerAgentId: agentOne, utterance: 'Can we recover this plan together?' },
          { speakerAgentId: agentTwo, utterance: 'Yes, I will help.' },
        ],
        issuedAt: 100,
      }),
    ).rejects.toThrow('simulated process failure');
    sourceMemoryRepository.append = originalAppend;
    expect(
      first.partitions[0]!.bootstrap.storage.eventStore.getStreamVersion(
        first.partitions[0]!.bootstrap.storage.partition.eventStreamName,
      ),
    ).toBe(4);
    expect(
      first.partitions[1]!.bootstrap.storage.eventStore.getStreamVersion(
        first.partitions[1]!.bootstrap.storage.partition.eventStreamName,
      ),
    ).toBe(0);

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
    for (const partition of restarted.partitions) {
      expect(
        partition.bootstrap.storage.eventStore.getStreamVersion(
          partition.bootstrap.storage.partition.eventStreamName,
        ),
      ).toBe(4);
      expect(
        partition.bootstrap.storage.checkpointStore.getLatestCheckpoint({
          simulationId: partition.bootstrap.storage.partition.simulationId,
          partitionKey: partition.partitionKey,
        })?.lastAppliedSequence,
      ).toBe(4);
    }
    await expect(
      restarted.partitions[0]!.bootstrap.storage.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        limit: 64,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      restarted.partitions[1]!.bootstrap.storage.shortTermMemoryRepository.retrieve({
        agentId: agentTwo,
        limit: 64,
      }),
    ).resolves.toHaveLength(1);
  });

  test('fails closed when two partitions claim the same society agent identity', async () => {
    await expect(
      bootstrapLocalSimulationRuntimeHostFromManifest({
        rootDir: createRootDir(),
        bootstrappedAt: 100,
        manifest: createManifest(),
        scenarioPresets: [
          createScenarioPreset({ id: 'scenario-main', agentId: agentOne, educationScore: 10 }),
          createScenarioPreset({ id: 'scenario-east', agentId: agentOne, educationScore: 20 }),
        ],
        policies,
        localizedPlanners: [],
        steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
        agents: [],
      }),
    ).rejects.toThrow('duplicate society agent agent-1 owned by world-east and world-main');
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
