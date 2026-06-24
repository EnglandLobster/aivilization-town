import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRuntimeProfileRunReportRepository } from '@aivilization/observability';
import { afterEach, describe, expect, test } from 'vitest';
import {
  parseLocalRuntimeTownProfileRunnerCliArgs,
  runLocalRuntimeTownProfileRunnerCli,
} from './localRuntimeTownProfileRunnerCli';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town profile runner CLI', () => {
  test('parses profile runner arguments', () => {
    expect(
      parseLocalRuntimeTownProfileRunnerCliArgs([
        '--profile',
        'smoke-25',
        '--root-dir',
        '/tmp/town',
        '--cycles',
        '2',
        '--requested-at',
        '100',
        '--cycle-interval-ms',
        '50',
        '--report-root-dir',
        '/tmp/reports',
        '--require-gate',
      ]),
    ).toEqual({
      profileId: 'smoke-25',
      rootDir: '/tmp/town',
      cycleCount: 2,
      requestedAt: 100,
      cycleIntervalMs: 50,
      reportRootDir: '/tmp/reports',
      requireGate: true,
    });
  });

  test('runs the injected profile runner and writes JSON to stdout', async () => {
    let output = '';
    const exitCode = await runLocalRuntimeTownProfileRunnerCli({
      argv: [
        '--profile',
        'smoke-25',
        '--root-dir',
        '/tmp/town',
        '--cycles',
        '1',
        '--requested-at',
        '100',
      ],
      stdout: {
        write: (chunk) => {
          output += chunk;
        },
      },
      runProfile: (input) =>
        Promise.resolve({
          profileId: input.profileId,
          manifestId: 'aivilization-smoke-25',
          rootDir: input.rootDir,
          requestedAt: input.requestedAt,
          daemonHealth: 'healthy',
          partitionCount: 1,
          totalProjectionAgentCount: 25,
          totalEventCount: 3,
          totalAgentTraceCount: 1,
          run: {
            traceId: 'trace-1',
            outcome: 'succeeded',
            requestedCycleCount: input.cycleCount,
            completedCycleCount: input.cycleCount,
            stopReason: 'cycle-count-completed',
          },
          partitions: [],
        }),
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toMatchObject({
      profileId: 'smoke-25',
      manifestId: 'aivilization-smoke-25',
      totalProjectionAgentCount: 25,
      run: {
        traceId: 'trace-1',
        outcome: 'succeeded',
      },
    });
    expect(output.endsWith('\n')).toBe(true);
  });

  test('records profile run reports when report root is supplied', async () => {
    let output = '';
    const rootDir = createRootDir();
    const reportRootDir = createRootDir();

    const exitCode = await runLocalRuntimeTownProfileRunnerCli({
      argv: [
        '--profile',
        'smoke-25',
        '--root-dir',
        rootDir,
        '--cycles',
        '1',
        '--requested-at',
        '100',
        '--report-root-dir',
        reportRootDir,
        '--require-gate',
      ],
      stdout: {
        write: (chunk) => {
          output += chunk;
        },
      },
    });

    const reportRepository = new FileRuntimeProfileRunReportRepository({ rootDir: reportRootDir });

    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toMatchObject({
      profileId: 'smoke-25',
      run: {
        traceId: 'aivilization-smoke-25:profile-run:100',
      },
    });
    await expect(reportRepository.query({ profileId: 'smoke-25' })).resolves.toEqual([
      expect.objectContaining({
        runId: 'aivilization-smoke-25:profile-run:100',
        profileId: 'smoke-25',
        totalProjectionAgentCount: 25,
      }),
    ]);
  });

  test('returns a profile gate failure exit code when require gate is supplied', async () => {
    let output = '';
    let stderr = '';
    const exitCode = await runLocalRuntimeTownProfileRunnerCli({
      argv: [
        '--profile',
        'smoke-25',
        '--root-dir',
        '/tmp/town',
        '--cycles',
        '1',
        '--requested-at',
        '100',
        '--require-gate',
      ],
      stderr: {
        write: (chunk) => {
          stderr += chunk;
        },
      },
      stdout: {
        write: (chunk) => {
          output += chunk;
        },
      },
      runProfile: (input) =>
        Promise.resolve({
          profileId: input.profileId,
          manifestId: 'aivilization-smoke-25',
          rootDir: input.rootDir,
          requestedAt: input.requestedAt,
          daemonHealth: 'attention',
          partitionCount: 1,
          totalProjectionAgentCount: 25,
          totalEventCount: 1,
          totalAgentTraceCount: 0,
          run: {
            traceId: 'aivilization-smoke-25:profile-run:100',
            outcome: 'succeeded',
            requestedCycleCount: input.cycleCount,
            completedCycleCount: 0,
            stopReason: 'cycle-count-completed',
          },
          partitions: [
            {
              simulationId: 'aivilization-smoke-25',
              partitionKey: 'world-main',
              scenarioPresetId: 'aivilization-smoke-25-world-main',
              status: 'completed',
              health: 'healthy',
              lastAppliedSequence: 1,
              streamVersion: 1,
              eventCount: 1,
              projectionAgentCount: 25,
              agentTraceCount: 0,
            },
          ],
        }),
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(output)).toMatchObject({
      profileId: 'smoke-25',
      daemonHealth: 'attention',
    });
    expect(stderr).toContain('runtime profile run gate failed');
    expect(stderr).toContain('daemon-health-mismatch');
    expect(stderr).toContain('completed-cycle-count-too-low');
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-profile-runner-cli-'));
  tmpRoots.push(root);
  return root;
}
