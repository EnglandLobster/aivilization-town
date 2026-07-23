import { describe, expect, test } from 'vitest';
import {
  createLocalRuntimeTownProductionSloPolicy,
  evaluateLocalRuntimeTownProductionSlo,
  summarizeLocalRuntimeTownLlmProviderTraces,
  type LocalRuntimeTownProductionSloObservation,
} from './localRuntimeTownProductionSlo';

const policy = createLocalRuntimeTownProductionSloPolicy({
  maxPendingJobs: 2,
  workerPollIntervalMs: 1_000,
  schedulerIntervalMs: 1_000,
  recoveryIntervalMs: 1_000,
});

function createObservation(
  overrides: Partial<LocalRuntimeTownProductionSloObservation> = {},
): LocalRuntimeTownProductionSloObservation {
  return {
    observedAt: 20_000,
    manifestId: 'manifest-1',
    baseDaemonHealth: 'healthy',
    schedulerDesiredRunning: true,
    queue: {
      readyDepth: 0,
      deadLetterCount: 0,
      expiredLeaseCount: 0,
    },
    checkpoints: [
      {
        simulationId: 'simulation-1',
        partitionKey: 'world-main',
        eventStreamVersion: 10,
        checkpointSequence: 10,
        checkpointWallClockAgeMs: 1_000,
      },
    ],
    llm: {
      providerConfigured: true,
      pricingConfigured: true,
      observedAgentCycleCount: 4,
      traceCollectionTruncated: false,
      simulatedWindowStartedAt: 0,
      simulatedWindowEndedAt: 3_600_000,
      requestCount: 100,
      failedOrFallbackCount: 2,
      inputTokens: 1_000,
      outputTokens: 500,
      totalTokens: 1_500,
      estimatedCostMicros: 100_000,
      providerIds: ['provider-1'],
      models: ['model-1'],
    },
    market: [
      {
        simulationId: 'simulation-1',
        partitionKey: 'world-main',
        recentTradeCount: 2,
        latestTradeObservedAt: 3_500_000,
        latestCoveringBarEndedAt: 3_600_000,
        observationLagSimulatedMs: 0,
        collectionTruncated: false,
      },
    ],
    recovery: {
      desiredRunning: true,
      running: true,
      attemptedRecoveryCount: 2,
      recoveredCount: 0,
      lastCompletedCheckAgeMs: 1_000,
      hasLastError: false,
    },
    artifacts: {
      registeredCount: 1,
      verifiedCount: 1,
      failedArtifactIds: [],
    },
    ...overrides,
  };
}

describe('local runtime town production SLO', () => {
  test('passes a healthy complete observation with versioned concrete targets', () => {
    const report = evaluateLocalRuntimeTownProductionSlo({
      policy,
      observation: createObservation(),
    });

    expect(report.status).toBe('pass');
    expect(report.failedCheckIds).toEqual([]);
    expect(report.policy).toMatchObject({
      policyVersion: 'production-runtime-slo-v2',
      queue: { maxReadyDepth: 2, maxOldestReadyAgeMs: 10_000 },
      checkpoint: { maxSequenceLag: 0, maxWallClockAgeMs: 10_000 },
      llm: {
        maxFallbackOrFailureRatio: 0.05,
        maxEstimatedCostMicrosPerWindow: 5_000_000,
      },
      market: { maxObservationLagSimulatedMs: 600_000 },
      artifactIntegrity: { requiredVerifiedRatio: 1 },
    });
    expect(report.checks).toHaveLength(7);
  });

  test('fails every breached operational boundary with actionable evidence', () => {
    const report = evaluateLocalRuntimeTownProductionSlo({
      policy,
      observation: createObservation({
        baseDaemonHealth: 'degraded',
        queue: {
          readyDepth: 3,
          oldestReadyAgeMs: 20_000,
          deadLetterCount: 1,
          expiredLeaseCount: 1,
        },
        checkpoints: [
          {
            simulationId: 'simulation-1',
            partitionKey: 'world-main',
            eventStreamVersion: 12,
            checkpointSequence: 10,
            checkpointWallClockAgeMs: 20_000,
          },
        ],
        llm: {
          ...createObservation().llm,
          pricingConfigured: false,
          failedOrFallbackCount: 10,
          estimatedCostMicros: 6_000_000,
          traceCollectionTruncated: true,
        },
        market: [
          {
            simulationId: 'simulation-1',
            partitionKey: 'world-main',
            recentTradeCount: 1,
            collectionTruncated: true,
          },
        ],
        recovery: {
          desiredRunning: true,
          running: false,
          attemptedRecoveryCount: 1,
          recoveredCount: 0,
          lastCompletedCheckAgeMs: 20_000,
          hasLastError: true,
        },
        artifacts: {
          registeredCount: 2,
          verifiedCount: 1,
          failedArtifactIds: ['artifact-2'],
        },
      }),
    });

    expect(report.status).toBe('fail');
    expect(report.failedCheckIds).toEqual([
      'daemon-health',
      'run-queue-lag',
      'projection-checkpoint-lag',
      'llm-reliability-and-cost',
      'market-observation-lag',
      'recovery-readiness',
      'experiment-artifact-integrity',
    ]);
    expect(report.checks.every((check) => check.violations.length > 0)).toBe(true);
  });

  test('labels deterministic/provider-startup, inactive-market, and disabled recovery checks honestly', () => {
    const report = evaluateLocalRuntimeTownProductionSlo({
      policy,
      observation: createObservation({
        schedulerDesiredRunning: false,
        llm: {
          ...createObservation().llm,
          providerConfigured: false,
          pricingConfigured: false,
          observedAgentCycleCount: 0,
          requestCount: 0,
          failedOrFallbackCount: 0,
          traceCollectionTruncated: false,
        },
        market: [
          {
            simulationId: 'simulation-1',
            partitionKey: 'world-main',
            recentTradeCount: 0,
            collectionTruncated: false,
          },
        ],
        recovery: undefined,
        artifacts: { registeredCount: 0, verifiedCount: 0, failedArtifactIds: [] },
      }),
    });

    expect(report.status).toBe('pass');
    expect(
      report.checks
        .filter((check) => check.status === 'not-applicable')
        .map((check) => check.checkId),
    ).toEqual([
      'projection-checkpoint-lag',
      'llm-reliability-and-cost',
      'market-observation-lag',
      'recovery-readiness',
      'experiment-artifact-integrity',
    ]);
  });

  test('aggregates top-level provider usage once without double-counting attempts', () => {
    const summary = summarizeLocalRuntimeTownLlmProviderTraces([
      {
        traceId: 'cycle-1',
        contextualPrioritization: {
          source: 'llm',
          status: 'accepted',
          providerId: 'provider-b',
          model: 'model-b',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            estimatedCostMicros: 20,
          },
          attempts: [
            {
              providerId: 'provider-b',
              usage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
                estimatedCostMicros: 20,
              },
            },
          ],
        },
        replanning: {
          source: 'deterministic-fallback',
          status: 'fallback',
          providerId: 'provider-a',
          model: 'model-a',
          failureReason: 'timeout',
          usage: {
            inputTokens: 7,
            outputTokens: 0,
            totalTokens: 7,
            estimatedCostMicros: 4,
          },
        },
        deterministic: { source: 'deterministic', status: 'deterministic' },
      },
    ]);

    expect(summary).toEqual({
      requestCount: 2,
      failedOrFallbackCount: 1,
      inputTokens: 17,
      outputTokens: 5,
      totalTokens: 22,
      estimatedCostMicros: 24,
      providerIds: ['provider-a', 'provider-b'],
      models: ['model-a', 'model-b'],
    });
  });
});
