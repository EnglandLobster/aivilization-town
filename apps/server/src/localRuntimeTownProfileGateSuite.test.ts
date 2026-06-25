import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalRuntimeTownProfileGateCriteria } from './localRuntimeTownProfileGate';
import {
  localRuntimeTownProfileGateSuiteDefaultProfileIds,
  runLocalRuntimeTownProfileGateSuite,
} from './localRuntimeTownProfileGateSuite';
import type {
  LocalRuntimeTownProfileRunnerInput,
  LocalRuntimeTownProfileRunnerSummary,
} from './localRuntimeTownProfileRunner';
import { createLocalRuntimeTownDaemonScenarioProfile } from './localRuntimeTownScenarioProfile';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town profile gate suite', () => {
  test('runs profile gates sequentially with deterministic profile roots and report wiring', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];
    const reportRootDir = createRootDir();

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir: '/tmp/aivilization-suite',
      reportRootDir,
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 2,
      cycleIntervalMs: 25,
      profileIds: ['smoke-25', 'default-100'],
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(createPassingSummary(input));
      },
    });

    expect(result).toMatchObject({
      status: 'pass',
      requestedAt: 100,
      profileCount: 2,
      passedProfileCount: 2,
      failedProfileCount: 0,
    });
    expect(result.profiles.map((profile) => profile.profileId)).toEqual([
      'smoke-25',
      'default-100',
    ]);
    expect(result.profiles.map((profile) => profile.gate.status)).toEqual(['pass', 'pass']);
    expect(result.profiles[0]?.report).toMatchObject({
      profileId: 'smoke-25',
      generatedAt: 200,
      completedCycleCount: 2,
    });
    expect(inputs.map((input) => input.profileId)).toEqual(['smoke-25', 'default-100']);
    expect(inputs.map((input) => input.rootDir)).toEqual([
      '/tmp/aivilization-suite/smoke-25',
      '/tmp/aivilization-suite/default-100',
    ]);
    expect(inputs.map((input) => input.cycleCount)).toEqual([2, 2]);
    expect(inputs.map((input) => input.cycleIntervalMs)).toEqual([25, 25]);
    expect(inputs.map((input) => input.reportGeneratedAt)).toEqual([200, 200]);
    expect(inputs.every((input) => input.profileRunReportRepository !== undefined)).toBe(true);
  });

  test('returns a failing suite when an injected profile summary violates its gate', async () => {
    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir: '/tmp/aivilization-suite',
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 2,
      profileIds: ['smoke-25'],
      runProfile: (input) => {
        const summary = createPassingSummary(input);
        return Promise.resolve({
          ...summary,
          daemonHealth: 'attention',
          totalAgentTraceCount: 0,
          agentCycleDiagnostics: createAgentCycleDiagnostics(0),
          run: {
            ...summary.run,
            completedCycleCount: 0,
          },
          partitions: summary.partitions.map((partition) => ({
            ...partition,
            agentTraceCount: 0,
          })),
        });
      },
    });

    expect(result).toMatchObject({
      status: 'fail',
      profileCount: 1,
      passedProfileCount: 0,
      failedProfileCount: 1,
    });
    expect(result.profiles[0]?.gate.status).toBe('fail');
    expect(result.profiles[0]?.gate.failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining([
        'daemon-health-mismatch',
        'completed-cycle-count-too-low',
        'total-agent-trace-count-too-low',
      ]),
    );
  });

  test('forwards full replan materialization requirements into each profile gate', async () => {
    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir: '/tmp/aivilization-suite',
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 2,
      minimumFullReplanMaterializationCount: 1,
      profileIds: ['smoke-25'],
      runProfile: (input) => Promise.resolve(createPassingSummary(input)),
    });

    expect(result.status).toBe('fail');
    expect(result.profiles[0]?.gate.failures.map((failure) => failure.code)).toContain(
      'full-replan-materialization-count-too-low',
    );
  });

  test('defaults to the canonical profile gate order', () => {
    expect(localRuntimeTownProfileGateSuiteDefaultProfileIds).toEqual([
      'smoke-25',
      'default-100',
      'headless-stress-1000',
    ]);
  });
});

function createPassingSummary(
  input: LocalRuntimeTownProfileRunnerInput,
): LocalRuntimeTownProfileRunnerSummary {
  const profile = createLocalRuntimeTownDaemonScenarioProfile(input.profileId);
  const criteria = createLocalRuntimeTownProfileGateCriteria(input.profileId, {
    minimumCompletedCycleCount: input.cycleCount,
  });
  const partitions = profile.manifest.partitions.map((partition) => {
    const projectionAgentCount =
      criteria.expectedProjectionAgentCountByPartition[partition.partitionKey];
    if (projectionAgentCount === undefined) {
      throw new Error(`missing expected agent count for ${partition.partitionKey}`);
    }

    return {
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      scenarioPresetId: partition.scenarioPresetId,
      status: 'completed',
      health: 'healthy',
      lastAppliedSequence: 3,
      streamVersion: 3,
      eventCount: 3,
      projectionAgentCount,
      agentTraceCount: 1,
    };
  });

  const totalAgentTraceCount = partitions.reduce(
    (total, partition) => total + partition.agentTraceCount,
    0,
  );

  return {
    profileId: input.profileId,
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
    replanningDecisionCount: 0,
    simulatorEventTraceCount: traceCount,
    simulatorEventCount: traceCount,
    commandEmittingCycleCount: traceCount,
    fullReplanMaterializationCount: 0,
    commandEmittingCycleRatio: traceCount === 0 ? 0 : 1,
    fullReplanMaterializationRatio: 0,
    repairedSimulatorRatio: 0,
    rejectedSimulatorRatio: 0,
    replanningDecisionRatio: 0,
  };
}

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-profile-gate-suite-'));
  tmpRoots.push(root);
  return root;
}
