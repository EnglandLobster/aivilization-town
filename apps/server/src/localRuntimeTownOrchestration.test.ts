import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ScenarioPreset } from '@aivilization/content';
import { asAgentId, asLocationId, type AgentId } from '@aivilization/sim-core';
import { type WorldCommandPolicies } from '@aivilization/world';
import {
  bootstrapLocalSimulationRuntimeHostFromManifest,
  createLocalSimulationRuntimeSupervisor,
  type LocalSimulationRuntimeManifest,
} from '@aivilization/worker';
import {
  createLocalRuntimeTownOrchestration,
  startLocalRuntimeTownOrchestration,
  stopLocalRuntimeTownOrchestration,
} from './index';

const agentOne = asAgentId('agent-1');
const mainSquare = asLocationId('main-square');
const tmpRoots: string[] = [];

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
};

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town orchestration', () => {
  test('shares queue-backed scheduler, worker, recovery, and API controls', async () => {
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });
    const supervisor = createLocalSimulationRuntimeSupervisor({ host });
    const orchestration = createLocalRuntimeTownOrchestration({
      host,
      supervisor,
      runtimeScheduler: {
        schedulerId: 'main-loop',
        cycleCount: 1,
        cycleIntervalMs: 25,
        scheduleIntervalMs: 1_000,
      },
      runtimeRecovery: {
        recoveryIntervalMs: 1_000,
        maxDrainJobsPerRun: 1,
      },
    });

    await expect(
      orchestration.runtimeSchedulerApi?.runRuntimeSchedulerOnce(),
    ).resolves.toMatchObject({
      status: 'enqueued',
      job: {
        manifestId: 'town-runtime',
        status: 'queued',
        runRequest: {
          cycleCount: 1,
          cycleIntervalMs: 25,
        },
      },
    });
    await expect(orchestration.runtimeRecoveryApi?.runRuntimeRecoveryOnce()).resolves.toMatchObject(
      {
        status: 'recovered',
        drainResult: {
          processedJobCount: 1,
          completedJobCount: 1,
          failedJobCount: 0,
        },
      },
    );
    await expect(
      orchestration.runtimeRunQueueApi.queryRuntimeRunJobs({
        status: 'completed',
        manifestId: 'town-runtime',
        limit: 1,
      }),
    ).resolves.toMatchObject([
      {
        manifestId: 'town-runtime',
        status: 'completed',
      },
    ]);
  });

  test('starts and stops configured daemon hosts from one profile boundary', async () => {
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });
    const supervisor = createLocalSimulationRuntimeSupervisor({ host });
    const profile = {
      runtimeRunQueue: { autoStart: true, pollIntervalMs: 1_000 },
      runtimeScheduler: { autoStart: true, cycleCount: 1, scheduleIntervalMs: 1_000 },
      runtimeRecovery: { autoStart: true, recoveryIntervalMs: 1_000 },
    };
    const orchestration = createLocalRuntimeTownOrchestration({
      host,
      supervisor,
      ...profile,
    });

    startLocalRuntimeTownOrchestration(profile, orchestration);
    expect(orchestration.runQueueWorkerHost.getStatus()).toMatchObject({ running: true });
    expect(orchestration.runQueueSchedulerHost?.getStatus()).toMatchObject({ running: true });
    expect(orchestration.runQueueRecoveryHost?.getStatus()).toMatchObject({ running: true });

    stopLocalRuntimeTownOrchestration(orchestration);
    expect(orchestration.runQueueWorkerHost.getStatus()).toMatchObject({ running: false });
    expect(orchestration.runQueueSchedulerHost?.getStatus()).toMatchObject({ running: false });
    expect(orchestration.runQueueRecoveryHost?.getStatus()).toMatchObject({ running: false });
  });

  test('aggregates daemon health from supervisor, queue stats, and host status', async () => {
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });
    const supervisor = createLocalSimulationRuntimeSupervisor({ host });
    const orchestration = createLocalRuntimeTownOrchestration({
      host,
      supervisor,
      clock: { now: () => 500 },
    });
    await orchestration.runQueueRepository.enqueue({
      jobId: 'job-dead-health-1',
      manifestId: 'town-runtime',
      enqueuedAt: 120,
      runRequest: {
        operationId: 'op-dead-health-1',
        requestedAt: 130,
        cycleCount: 1,
      },
    });
    await orchestration.runQueueRepository.claimNext({
      workerId: 'worker-health',
      claimedAt: 140,
      leaseDurationMs: 10,
    });
    await orchestration.runQueueRepository.fail({
      jobId: 'job-dead-health-1',
      workerId: 'worker-health',
      attemptNumber: 1,
      failedAt: 150,
      maxAttempts: 1,
      error: { name: 'Error', message: 'health failure' },
    });

    await expect(orchestration.runtimeDaemonApi.getRuntimeDaemonStatus()).resolves.toMatchObject({
      manifestId: 'town-runtime',
      observedAt: 500,
      health: 'attention',
      components: {
        supervisor: {
          health: 'healthy',
          partitionCount: 1,
          healthyPartitionCount: 1,
          attentionPartitionCount: 0,
        },
        runQueue: {
          health: 'attention',
          stats: {
            observedAt: 500,
            manifestId: 'town-runtime',
            statusCounts: {
              'dead-lettered': 1,
            },
          },
        },
        worker: {
          configured: true,
          desiredRunning: false,
          health: 'healthy',
          status: {
            running: false,
            processedJobCount: 0,
          },
        },
        authority: { enabled: false },
      },
    });
  });

  test('reports the simulation-wide authority ledger position in daemon status', async () => {
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    const supervisor = createLocalSimulationRuntimeSupervisor({ host });
    const orchestration = createLocalRuntimeTownOrchestration({
      host,
      supervisor,
      clock: { now: () => 600 },
    });

    await expect(orchestration.runtimeDaemonApi.getRuntimeDaemonStatus()).resolves.toMatchObject({
      health: 'healthy',
      components: {
        authority: {
          enabled: true,
          health: 'healthy',
          revision: 0,
          latestFencingToken: 0,
          pendingTransferCount: 0,
          pendingMoveCount: 0,
          partitionKeys: ['world-main'],
        },
      },
    });
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-orchestration-'));
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
