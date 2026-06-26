import { describe, expect, test } from 'vitest';
import { createLocalRuntimeTownProfileGateCriteria } from './localRuntimeTownProfileGate';
import {
  createLocalRuntimeTownProfileRunReportFromSummary,
  type LocalRuntimeTownProfileGateSuiteInput,
  type LocalRuntimeTownProfileGateSuiteSummary,
} from './localRuntimeTownProfileGateSuite';
import {
  parseLocalRuntimeTownProfileGateSuiteCliArgs,
  runLocalRuntimeTownProfileGateSuiteCli,
} from './localRuntimeTownProfileGateSuiteCli';
import type { LocalRuntimeTownProfileRunnerSummary } from './localRuntimeTownProfileRunner';
import {
  createLocalRuntimeTownDaemonScenarioProfile,
  type LocalRuntimeTownDaemonScenarioProfileId,
} from './localRuntimeTownScenarioProfile';
import { createLocalRuntimeTownPaperAlignmentProfileCoverage } from './localRuntimeTownPaperAlignmentCoverage';

describe('local runtime town profile gate suite CLI', () => {
  test('parses suite arguments', () => {
    expect(
      parseLocalRuntimeTownProfileGateSuiteCliArgs([
        '--root-dir',
        '/tmp/suite',
        '--requested-at',
        '100',
        '--cycles',
        '2',
        '--cycle-interval-ms',
        '25',
        '--profiles',
        'smoke-25,default-100',
        '--report-root-dir',
        '/tmp/reports',
        '--experiment-validation',
        '--runtime-config',
        '/runtime/profile-config.json',
        '--minimum-full-replan-materializations',
        '1',
        '--minimum-simulator-rollout-coverage-ratio',
        '0.75',
        '--minimum-local-repair-accepted-count',
        '1',
      ]),
    ).toEqual({
      rootDir: '/tmp/suite',
      requestedAt: 100,
      cycleCount: 2,
      cycleIntervalMs: 25,
      profileIds: ['smoke-25', 'default-100'],
      reportRootDir: '/tmp/reports',
      experimentValidation: true,
      runtimeConfigPath: '/runtime/profile-config.json',
      minimumFullReplanMaterializationCount: 1,
      minimumSimulatorRolloutCoverageRatio: 0.75,
      minimumLocalRepairAcceptedCount: 1,
    });
  });

  test('parses recovery drill suite profile arguments', () => {
    expect(
      parseLocalRuntimeTownProfileGateSuiteCliArgs([
        '--root-dir',
        '/tmp/suite',
        '--requested-at',
        '100',
        '--profiles',
        'recovery-drill-25',
      ]),
    ).toMatchObject({
      rootDir: '/tmp/suite',
      requestedAt: 100,
      profileIds: ['recovery-drill-25'],
    });
  });

  test('runs the injected suite and writes JSON to stdout', async () => {
    let output = '';
    let capturedInput: LocalRuntimeTownProfileGateSuiteInput | undefined;

    const exitCode = await runLocalRuntimeTownProfileGateSuiteCli({
      argv: [
        '--root-dir',
        '/tmp/suite',
        '--requested-at',
        '100',
        '--cycles',
        '2',
        '--profiles',
        'smoke-25',
        '--report-root-dir',
        '/tmp/reports',
        '--experiment-validation',
        '--runtime-config',
        '/runtime/profile-config.json',
        '--minimum-full-replan-materializations',
        '1',
        '--minimum-simulator-rollout-coverage-ratio',
        '0.75',
        '--minimum-local-repair-accepted-count',
        '1',
      ],
      stdout: {
        write: (chunk) => {
          output += chunk;
        },
      },
      runSuite: (input) => {
        capturedInput = input;
        return Promise.resolve(createSuiteSummary(input, 'pass'));
      },
    });

    expect(exitCode).toBe(0);
    expect(capturedInput).toMatchObject({
      rootDir: '/tmp/suite',
      requestedAt: 100,
      cycleCount: 2,
      profileIds: ['smoke-25'],
      reportRootDir: '/tmp/reports',
      experimentValidation: true,
      runtimeConfigPath: '/runtime/profile-config.json',
      minimumFullReplanMaterializationCount: 1,
      minimumSimulatorRolloutCoverageRatio: 0.75,
      minimumLocalRepairAcceptedCount: 1,
    });
    expect(JSON.parse(output)).toMatchObject({
      status: 'pass',
      profileCount: 1,
      passedProfileCount: 1,
      failedProfileCount: 0,
    });
    expect(output.endsWith('\n')).toBe(true);
  });

  test('returns an input error when experiment validation lacks report root', async () => {
    let stderr = '';

    const exitCode = await runLocalRuntimeTownProfileGateSuiteCli({
      argv: [
        '--root-dir',
        '/tmp/suite',
        '--requested-at',
        '100',
        '--profiles',
        'smoke-25',
        '--experiment-validation',
      ],
      stderr: {
        write: (chunk) => {
          stderr += chunk;
        },
      },
      runSuite: () => {
        throw new Error('suite should not be called');
      },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--experiment-validation requires --report-root-dir');
  });

  test('returns a suite gate failure exit code when any profile gate fails', async () => {
    let output = '';
    let stderr = '';

    const exitCode = await runLocalRuntimeTownProfileGateSuiteCli({
      argv: ['--root-dir', '/tmp/suite', '--requested-at', '100', '--profiles', 'smoke-25'],
      stdout: {
        write: (chunk) => {
          output += chunk;
        },
      },
      stderr: {
        write: (chunk) => {
          stderr += chunk;
        },
      },
      runSuite: (input) => Promise.resolve(createSuiteSummary(input, 'fail')),
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(output)).toMatchObject({
      status: 'fail',
      failedProfileCount: 1,
    });
    expect(stderr).toContain('runtime profile gate suite failed');
    expect(stderr).toContain('smoke-25');
    expect(stderr).toContain('daemon-health-mismatch');
  });
});

function createSuiteSummary(
  input: LocalRuntimeTownProfileGateSuiteInput,
  status: 'pass' | 'fail',
): LocalRuntimeTownProfileGateSuiteSummary {
  const profileId = input.profileIds?.[0] ?? 'smoke-25';
  const summary = createProfileSummary(profileId, {
    rootDir: `${input.rootDir}/${profileId}`,
    requestedAt: input.requestedAt,
    cycleCount: input.cycleCount ?? 1,
  });
  const report = createLocalRuntimeTownProfileRunReportFromSummary({
    summary,
    generatedAt: input.reportGeneratedAt ?? 200,
  });
  const criteria = createLocalRuntimeTownProfileGateCriteria(profileId, {
    minimumCompletedCycleCount: input.cycleCount ?? 1,
  });
  const gate =
    status === 'pass'
      ? {
          status: 'pass' as const,
          criteriaId: `${summary.manifestId}:profile-run-gate`,
          runId: summary.run.traceId,
          profileId,
          failureCount: 0,
          failures: [],
        }
      : {
          status: 'fail' as const,
          criteriaId: `${summary.manifestId}:profile-run-gate`,
          runId: summary.run.traceId,
          profileId,
          failureCount: 1,
          failures: [
            {
              code: 'daemon-health-mismatch',
              message: 'daemonHealth must be healthy',
              evidence: {
                actual: 'attention',
                expected: 'healthy',
              },
            },
          ],
        };

  return {
    status,
    requestedAt: input.requestedAt,
    profileCount: 1,
    passedProfileCount: status === 'pass' ? 1 : 0,
    failedProfileCount: status === 'fail' ? 1 : 0,
    profiles: [
      {
        profileId,
        rootDir: summary.rootDir,
        summary,
        report,
        gate,
        paperAlignment: createLocalRuntimeTownPaperAlignmentProfileCoverage({
          criteria,
          gate,
        }),
      },
    ],
  };
}

function createProfileSummary(
  profileId: LocalRuntimeTownDaemonScenarioProfileId,
  input: {
    readonly rootDir: string;
    readonly requestedAt: number;
    readonly cycleCount: number;
  },
): LocalRuntimeTownProfileRunnerSummary {
  const profile = createLocalRuntimeTownDaemonScenarioProfile(profileId);
  const partitions = profile.manifest.partitions.map((partition) => ({
    simulationId: partition.simulationId,
    partitionKey: partition.partitionKey,
    scenarioPresetId: partition.scenarioPresetId,
    status: 'completed',
    health: 'healthy',
    lastAppliedSequence: 3,
    streamVersion: 3,
    eventCount: 3,
    projectionAgentCount: profile.agentCount / profile.manifest.partitions.length,
    agentTraceCount: 1,
  }));
  const totalAgentTraceCount = partitions.reduce(
    (total, partition) => total + partition.agentTraceCount,
    0,
  );

  return {
    profileId,
    manifestId: profile.manifest.id,
    rootDir: input.rootDir,
    requestedAt: input.requestedAt,
    daemonHealth: 'healthy',
    partitionCount: partitions.length,
    totalProjectionAgentCount: partitions.reduce(
      (total, partition) => total + partition.projectionAgentCount,
      0,
    ),
    totalEventCount: partitions.reduce((total, partition) => total + partition.eventCount, 0),
    totalAgentTraceCount,
    agentCycleDiagnostics: createAgentCycleDiagnostics(totalAgentTraceCount),
    run: {
      traceId: `${profile.manifest.id}:profile-run:${input.requestedAt}`,
      outcome: 'succeeded',
      requestedCycleCount: input.cycleCount,
      completedCycleCount: input.cycleCount,
      stopReason: 'cycle-count-completed',
    },
    partitions,
  };
}

function createAgentCycleDiagnostics(traceCount: number) {
  return {
    traceCount,
    acceptedSimulatorCount: traceCount,
    repairedSimulatorCount: 0,
    rejectedSimulatorCount: 0,
    localRepairAttemptCount: 0,
    localRepairAcceptedCount: 0,
    localRepairRejectedCount: 0,
    localRepairSkippedCount: 0,
    replanningDecisionCount: 0,
    simulatorEventTraceCount: traceCount,
    simulatorEventCount: traceCount,
    simulatorRolloutEventCount: traceCount,
    commandEmittingCycleCount: traceCount,
    fullReplanMaterializationCount: 0,
    commandEmittingCycleRatio: traceCount === 0 ? 0 : 1,
    fullReplanMaterializationRatio: 0,
    repairedSimulatorRatio: 0,
    localRepairAcceptedRatio: 0,
    rejectedSimulatorRatio: 0,
    replanningDecisionRatio: 0,
    simulatorRolloutCoverageRatio: traceCount === 0 ? 0 : 1,
  };
}
