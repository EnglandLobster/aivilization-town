import { commodities, type ScenarioPreset } from '@aivilization/content';
import { describe, expect, test } from 'vitest';
import { createLocalRuntimeTownDaemonScenarioProfile } from './index';

describe('local runtime town daemon scenario profiles', () => {
  test('creates registered smoke, default, and headless stress backend profiles', () => {
    const smoke = createLocalRuntimeTownDaemonScenarioProfile('smoke-25');
    expect(smoke).toMatchObject({
      profileId: 'smoke-25',
      agentCount: 25,
      headless: false,
      manifest: {
        id: 'aivilization-smoke-25',
        defaults: {
          tickBatchSize: 1,
          tickIntervalMs: 100,
          commandConsumerIdPrefix: 'smoke-worker',
        },
      },
      runtimeScheduler: {
        cycleCount: 1,
        maxPendingJobs: 1,
        allowWhenDeadLettered: false,
      },
      runtimeRecovery: {
        maxDrainJobsPerRun: 1,
        maxDeadLetterReplaysPerRun: 1,
      },
    });
    expect(smoke.manifest.partitions).toHaveLength(1);
    expect(totalAgents(smoke.scenarioPresets)).toBe(25);
    expect(new Set(smoke.scenarioPresets.map((preset) => preset.id))).toEqual(
      new Set(smoke.manifest.partitions.map((partition) => partition.scenarioPresetId)),
    );
    expect(smoke.manifest.partitions[0]?.marketPools).toHaveLength(commodities.length - 1);
    expect(smoke.manifest.partitions[0]?.moneySupply).toBeGreaterThan(0);

    const standard = createLocalRuntimeTownDaemonScenarioProfile('default-100');
    expect(standard).toMatchObject({
      profileId: 'default-100',
      agentCount: 100,
      headless: false,
      manifest: {
        id: 'aivilization-default-100',
        defaults: {
          tickBatchSize: 2,
          tickIntervalMs: 100,
          commandConsumerIdPrefix: 'default-worker',
        },
      },
      runtimeRunQueue: {
        maxJobsPerPoll: 2,
      },
      runtimeScheduler: {
        cycleCount: 1,
        maxPendingJobs: 2,
      },
    });
    expect(standard.manifest.partitions.map((partition) => partition.partitionKey)).toEqual([
      'world-main',
      'world-east',
    ]);
    expect(totalAgents(standard.scenarioPresets)).toBe(100);

    const stress = createLocalRuntimeTownDaemonScenarioProfile('headless-stress-1000');
    expect(stress).toMatchObject({
      profileId: 'headless-stress-1000',
      agentCount: 1000,
      headless: true,
      manifest: {
        id: 'aivilization-headless-stress-1000',
        defaults: {
          tickBatchSize: 10,
          tickIntervalMs: 0,
          commandConsumerIdPrefix: 'stress-worker',
        },
      },
      runtimeRunQueue: {
        maxJobsPerPoll: 10,
      },
      runtimeScheduler: {
        cycleCount: 1,
        maxPendingJobs: 10,
      },
      runtimeRecovery: {
        maxDrainJobsPerRun: 10,
      },
    });
    expect(stress.manifest.partitions).toHaveLength(10);
    expect(totalAgents(stress.scenarioPresets)).toBe(1000);
    expect(stress.runtimeRunQueue.pollIntervalMs).toBeGreaterThan(0);
    expect(stress.runtimeScheduler.scheduleIntervalMs).toBeGreaterThan(0);
    expect(stress.manifest.partitions.map((partition) => partition.partitionKey)).toEqual([
      'world-main',
      'world-east',
      'world-west',
      'world-north',
      'world-south',
      'world-market',
      'world-residential',
      'world-industrial',
      'world-campus',
      'world-rural',
    ]);

    const recovery = createLocalRuntimeTownDaemonScenarioProfile('recovery-drill-25');
    expect(recovery).toMatchObject({
      profileId: 'recovery-drill-25',
      agentCount: 25,
      headless: true,
      manifest: {
        id: 'aivilization-recovery-drill-25',
        defaults: {
          tickBatchSize: 1,
          tickIntervalMs: 0,
          commandConsumerIdPrefix: 'recovery-drill-worker',
        },
      },
      runtimeRunQueue: {
        maxJobsPerPoll: 1,
      },
      runtimeScheduler: {
        cycleCount: 1,
        maxPendingJobs: 1,
      },
      runtimeRecovery: {
        maxDrainJobsPerRun: 1,
      },
    });
    expect(recovery.manifest.partitions.map((partition) => partition.partitionKey)).toEqual([
      'world-main',
    ]);
    expect(totalAgents(recovery.scenarioPresets)).toBe(25);
  });
});

function totalAgents(scenarioPresets: readonly ScenarioPreset[]): number {
  return scenarioPresets.reduce((total, preset) => total + preset.agentSeeds.length, 0);
}
