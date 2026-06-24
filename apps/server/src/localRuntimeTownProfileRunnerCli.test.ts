import { describe, expect, test } from 'vitest';
import {
  parseLocalRuntimeTownProfileRunnerCliArgs,
  runLocalRuntimeTownProfileRunnerCli,
} from './localRuntimeTownProfileRunnerCli';

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
      ]),
    ).toEqual({
      profileId: 'smoke-25',
      rootDir: '/tmp/town',
      cycleCount: 2,
      requestedAt: 100,
      cycleIntervalMs: 50,
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
});
