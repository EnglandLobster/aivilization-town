import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileRuntimeProfileRunReportRepository,
  InMemoryRuntimeProfileRunReportRepository,
  createRuntimeProfileRunReport,
  type RuntimeProfileRunReport,
} from './index';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('runtime profile run report repositories', () => {
  test('records and queries in-memory reports idempotently', async () => {
    const repository = new InMemoryRuntimeProfileRunReportRepository();
    const older = createReport({ runId: 'run-100', generatedAt: 100 });
    const newer = createReport({ runId: 'run-200', generatedAt: 200 });
    const otherProfile = createReport({
      runId: 'run-other-profile',
      profileId: 'default-100',
      generatedAt: 300,
    });

    await repository.record(older);
    await repository.record(newer);
    await repository.record(otherProfile);
    await repository.record({
      ...newer,
      totalEventCount: 999,
    });

    await expect(repository.query({ profileId: 'smoke-25' })).resolves.toEqual([newer, older]);
    await expect(repository.query({ profileId: 'smoke-25', limit: 1 })).resolves.toEqual([newer]);
    await expect(
      repository.query({ profileId: 'smoke-25', fromGeneratedAt: 120, toGeneratedAt: 220 }),
    ).resolves.toEqual([newer]);
    await expect(repository.get('missing')).resolves.toBeUndefined();

    const read = await repository.get('run-200');
    if (read === undefined) {
      throw new Error('expected report to be readable');
    }
    Reflect.set(read, 'totalEventCount', 999);
    Reflect.set(read.partitions[0]!, 'eventCount', 999);

    await expect(repository.get('run-200')).resolves.toEqual(newer);
  });

  test('persists file-backed reports across repository instances', async () => {
    const rootDir = createRootDir();
    const first = new FileRuntimeProfileRunReportRepository({ rootDir });
    const report = createReport({ runId: 'run-1', generatedAt: 100 });

    await first.record(report);
    await first.record({ ...report, totalEventCount: 999 });

    const restarted = new FileRuntimeProfileRunReportRepository({ rootDir });

    await expect(restarted.get('run-1')).resolves.toEqual(report);
    await expect(restarted.query({ profileId: 'smoke-25' })).resolves.toEqual([report]);
    await expect(restarted.query({ profileId: 'smoke-25', limit: 0 })).rejects.toThrow(
      'limit must be positive',
    );
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-profile-run-reports-'));
  tmpRoots.push(root);
  return root;
}

function createReport(input: {
  readonly runId: string;
  readonly profileId?: string;
  readonly generatedAt?: number;
}): RuntimeProfileRunReport {
  return createRuntimeProfileRunReport({
    runId: input.runId,
    profileId: input.profileId ?? 'smoke-25',
    manifestId: `aivilization-${input.profileId ?? 'smoke-25'}`,
    rootDir: '/tmp/aivilization-profile-run',
    generatedAt: input.generatedAt ?? 100,
    requestedAt: 50,
    daemonHealth: 'healthy',
    outcome: 'succeeded',
    requestedCycleCount: 2,
    completedCycleCount: 2,
    stopReason: 'cycle-count-completed',
    partitionCount: 1,
    totalProjectionAgentCount: 25,
    totalEventCount: 10,
    totalAgentTraceCount: 5,
    partitions: [
      {
        simulationId: 'aivilization-smoke-25',
        partitionKey: 'world-main',
        scenarioPresetId: 'aivilization-smoke-25-world-main',
        status: 'succeeded',
        health: 'healthy',
        lastAppliedSequence: 10,
        streamVersion: 10,
        eventCount: 10,
        projectionAgentCount: 25,
        agentTraceCount: 5,
      },
    ],
  });
}
