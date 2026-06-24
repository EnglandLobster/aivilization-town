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
      ]),
    ).toEqual({
      profileId: 'smoke-25',
      rootDir: '/tmp/town',
      cycleCount: 2,
      requestedAt: 100,
      cycleIntervalMs: 50,
      reportRootDir: '/tmp/reports',
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
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-profile-runner-cli-'));
  tmpRoots.push(root);
  return root;
}
