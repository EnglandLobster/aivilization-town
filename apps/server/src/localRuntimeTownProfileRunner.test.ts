import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryRuntimeProfileRunReportRepository } from '@aivilization/observability';
import { afterEach, describe, expect, test } from 'vitest';
import { runLocalRuntimeTownDaemonScenarioProfile } from './index';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town profile runner', () => {
  test('runs the smoke profile headlessly with default canonical agents', async () => {
    const rootDir = createRootDir();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 100,
    });

    expect(summary).toMatchObject({
      profileId: 'smoke-25',
      manifestId: 'aivilization-smoke-25',
      rootDir,
      run: {
        traceId: 'aivilization-smoke-25:profile-run:100',
        outcome: 'succeeded',
        requestedCycleCount: 1,
        completedCycleCount: 1,
        stopReason: 'cycle-count-completed',
      },
      daemonHealth: 'healthy',
      partitionCount: 1,
      totalProjectionAgentCount: 25,
    });
    expect(summary.totalEventCount).toBeGreaterThan(summary.partitionCount);
    expect(summary.totalAgentTraceCount).toBeGreaterThan(0);
    expect(summary.partitions).toEqual([
      expect.objectContaining({
        simulationId: 'aivilization-smoke-25',
        partitionKey: 'world-main',
        scenarioPresetId: 'aivilization-smoke-25-world-main',
        health: 'healthy',
        projectionAgentCount: 25,
      }),
    ]);
  });

  test('summarizes multi-partition default profile runs', async () => {
    const rootDir = createRootDir();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'default-100',
      rootDir,
      cycleCount: 2,
      requestedAt: 250,
      cycleIntervalMs: 100,
    });

    expect(summary).toMatchObject({
      profileId: 'default-100',
      manifestId: 'aivilization-default-100',
      rootDir,
      daemonHealth: 'healthy',
      partitionCount: 2,
      totalProjectionAgentCount: 100,
      run: {
        traceId: 'aivilization-default-100:profile-run:250',
        outcome: 'succeeded',
        requestedCycleCount: 2,
        completedCycleCount: 2,
        stopReason: 'cycle-count-completed',
      },
    });
    expect(summary.partitions.map((partition) => partition.partitionKey)).toEqual([
      'world-main',
      'world-east',
    ]);
    expect(summary.partitions).toEqual([
      expect.objectContaining({
        simulationId: 'aivilization-default-100',
        partitionKey: 'world-main',
        projectionAgentCount: 50,
      }),
      expect.objectContaining({
        simulationId: 'aivilization-default-100',
        partitionKey: 'world-east',
        projectionAgentCount: 50,
      }),
    ]);
    for (const partition of summary.partitions) {
      expect(partition.streamVersion).toBe(partition.eventCount);
      expect(partition.eventCount).toBeGreaterThan(2);
      expect(partition.agentTraceCount).toBeGreaterThan(0);
    }
  });

  test('records a runtime profile run report when a repository is supplied', async () => {
    const rootDir = createRootDir();
    const repository = new InMemoryRuntimeProfileRunReportRepository();

    const summary = await runLocalRuntimeTownDaemonScenarioProfile({
      profileId: 'smoke-25',
      rootDir,
      cycleCount: 1,
      requestedAt: 100,
      reportGeneratedAt: 150,
      profileRunReportRepository: repository,
    });

    await expect(repository.get(summary.run.traceId)).resolves.toMatchObject({
      runId: 'aivilization-smoke-25:profile-run:100',
      profileId: 'smoke-25',
      manifestId: 'aivilization-smoke-25',
      rootDir,
      generatedAt: 150,
      requestedAt: 100,
      daemonHealth: 'healthy',
      outcome: 'succeeded',
      requestedCycleCount: 1,
      completedCycleCount: 1,
      stopReason: 'cycle-count-completed',
      partitionCount: 1,
      totalProjectionAgentCount: 25,
      totalEventCount: summary.totalEventCount,
      totalAgentTraceCount: summary.totalAgentTraceCount,
      partitions: summary.partitions,
    });
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-profile-runner-'));
  tmpRoots.push(root);
  return root;
}
