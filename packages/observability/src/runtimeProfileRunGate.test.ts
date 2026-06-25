import { describe, expect, test } from 'vitest';
import {
  createRuntimeProfileRunReport,
  evaluateRuntimeProfileRunReport,
  type RuntimeProfileRunGateCriteria,
  type RuntimeProfileRunReport,
} from './index';

describe('runtime profile run gate', () => {
  test('passes a healthy agent-driven profile run report', () => {
    const result = evaluateRuntimeProfileRunReport(createReport(), createCriteria());

    expect(result).toEqual({
      status: 'pass',
      criteriaId: 'smoke-25-gate',
      runId: 'run-1',
      profileId: 'smoke-25',
      failureCount: 0,
      failures: [],
    });
  });

  test('collects profile run gate failures with evidence', () => {
    const report = createRuntimeProfileRunReport({
      ...createReport(),
      daemonHealth: 'attention',
      completedCycleCount: 0,
      totalAgentTraceCount: 0,
      agentCycleDiagnostics: createAgentCycleDiagnostics(0),
      partitions: [
        {
          ...createReport().partitions[0]!,
          streamVersion: 9,
          agentTraceCount: 0,
        },
      ],
    });

    const result = evaluateRuntimeProfileRunReport(report, createCriteria());

    expect(result.status).toBe('fail');
    expect(result.failureCount).toBe(4);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      'daemon-health-mismatch',
      'completed-cycle-count-too-low',
      'total-agent-trace-count-too-low',
      'partition-stream-version-event-count-mismatch',
    ]);
    expect(result.failures[0]).toMatchObject({
      code: 'daemon-health-mismatch',
      evidence: {
        actual: 'attention',
        expected: 'healthy',
      },
    });
  });

  test('requires full replan materialization when criteria asks for recovery evidence', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
          fullReplanMaterializationCount: 0,
          fullReplanMaterializationRatio: 0,
        },
      }),
      {
        ...createCriteria(),
        minimumFullReplanMaterializationCount: 1,
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'full-replan-materialization-count-too-low',
      message: 'fullReplanMaterializationCount must be at least 1',
      evidence: {
        actual: 0,
        minimum: 1,
      },
    });
  });
});

function createCriteria(): RuntimeProfileRunGateCriteria {
  return {
    criteriaId: 'smoke-25-gate',
    profileId: 'smoke-25',
    manifestId: 'aivilization-smoke-25',
    partitionCount: 1,
    totalProjectionAgentCount: 25,
    minimumCompletedCycleCount: 1,
    minimumTotalEventCount: 2,
    minimumTotalAgentTraceCount: 1,
    minimumFullReplanMaterializationCount: 0,
    requiredDaemonHealth: 'healthy',
    requiredOutcome: 'succeeded',
    requiredStopReason: 'cycle-count-completed',
    allowedPartitionStatuses: ['completed', 'succeeded'],
    requiredPartitionHealth: 'healthy',
    requireStreamVersionMatchesEventCount: true,
    expectedProjectionAgentCountByPartition: { 'world-main': 25 },
  };
}

function createReport(): RuntimeProfileRunReport {
  return createRuntimeProfileRunReport({
    runId: 'run-1',
    profileId: 'smoke-25',
    manifestId: 'aivilization-smoke-25',
    rootDir: '/tmp/aivilization-profile-run',
    generatedAt: 100,
    requestedAt: 50,
    daemonHealth: 'healthy',
    outcome: 'succeeded',
    requestedCycleCount: 1,
    completedCycleCount: 1,
    stopReason: 'cycle-count-completed',
    partitionCount: 1,
    totalProjectionAgentCount: 25,
    totalEventCount: 10,
    totalAgentTraceCount: 5,
    agentCycleDiagnostics: createAgentCycleDiagnostics(5),
    partitions: [
      {
        simulationId: 'aivilization-smoke-25',
        partitionKey: 'world-main',
        scenarioPresetId: 'aivilization-smoke-25-world-main',
        status: 'completed',
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
