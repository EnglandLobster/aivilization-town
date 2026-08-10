import { commodities, type ScenarioPreset } from '@aivilization/content';
import { describe, expect, test } from 'vitest';
import { createLocalRuntimeTownDaemonScenarioProfile } from './index';

describe('local runtime town daemon scenario profiles', () => {
  test('creates registered smoke, default, stress, recovery, and paper ablation profiles', () => {
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

    const ablation = createLocalRuntimeTownDaemonScenarioProfile('ablation-80');
    expect(ablation).toMatchObject({
      profileId: 'ablation-80',
      agentCount: 80,
      headless: true,
      manifest: {
        id: 'aivilization-ablation-80',
        defaults: {
          tickBatchSize: 1,
          tickIntervalMs: 0,
          commandConsumerIdPrefix: 'ablation-worker',
        },
      },
      runtimeRunQueue: { maxJobsPerPoll: 1 },
      runtimeScheduler: { cycleCount: 1, maxPendingJobs: 1 },
    });
    expect(ablation.scenarioPresets).toHaveLength(1);
    const ablationPreset = ablation.scenarioPresets[0];
    expect(ablationPreset).toMatchObject({
      id: 'aivilization-ablation-80-agent-cohort',
      timeScale: 35,
    });
    expect(ablationPreset?.agentSeeds).toHaveLength(80);
    const mbtiCounts = ablationPreset?.agentSeeds.reduce<Record<string, number>>(
      (counts, agent) => {
        const mbti = agent.profile.personality.mbti;
        counts[mbti] = (counts[mbti] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(Object.values(mbtiCounts ?? {})).toEqual(Array.from({ length: 16 }, () => 5));
    expect(
      ablationPreset?.agentSeeds.every(
        (agent) =>
          agent.physiology.energy === 60 &&
          agent.physiology.satiety === 60 &&
          agent.physiology.health === 60 &&
          agent.balance === 0 &&
          agent.educationScore === 0 &&
          Object.keys(agent.inventory).length === 0,
      ),
    ).toBe(true);
    const ablationPartition = ablation.manifest.partitions[0];
    const ablationMarketPools = ablationPartition?.marketPools ?? [];
    expect(ablationMarketPools).not.toEqual([]);
    expect(ablationPartition?.moneySupply).toBe(
      ablationMarketPools.reduce((total, marketPool) => total + marketPool.currencyReserve, 0),
    );
  });
});

function totalAgents(scenarioPresets: readonly ScenarioPreset[]): number {
  return scenarioPresets.reduce((total, preset) => total + preset.agentSeeds.length, 0);
}
