import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileRuntimeSoakEvidenceRepository,
  RUNTIME_SOAK_CANONICAL_MINIMUM_DURATION_MS,
  createRuntimeSoakEvidenceArtifact,
  createRuntimeSoakEvidencePolicyManifest,
  type RuntimeSoakEvidenceArtifact,
  type RuntimeSoakEvidenceSample,
} from './runtimeSoakEvidence';
import type { SourceRevision } from '@aivilization/sim-core';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('runtime soak evidence', () => {
  test('derives every SCALE-001 metric from raw samples and completed-job timings', () => {
    const artifact = createArtifact({
      sourceKind: 'synthetic-contract',
      startedAt: 1_000,
      endedAt: 2_000,
      samples: [
        createSample({ observedAt: 1_000, sequence: 10, rssBytes: 100, heapUsedBytes: 40 }),
        createSample({
          observedAt: 2_000,
          sequence: 20,
          completedJobCount: 1,
          attemptedRecoveryCount: 2,
          recoveredCount: 1,
          rssBytes: 160,
          heapUsedBytes: 70,
          fileCount: 5,
          totalBytes: 1_200,
        }),
      ],
      completedJobs: [
        {
          jobId: 'job-1',
          enqueuedAt: 1_100,
          startedAt: 1_200,
          completedAt: 1_800,
          requestedCycleCount: 2,
          attemptCount: 1,
          failedAttemptCount: 0,
        },
      ],
    });

    expect(artifact.artifactId).toMatch(/^runtime-soak-evidence:sha256:[a-f0-9]{64}$/u);
    expect(artifact.summary).toMatchObject({
      durationMs: 1_000,
      sampleCount: 2,
      maximumSampleGapMs: 1_000,
      throughput: {
        completedQueueJobCount: 1,
        completedRequestedWorldCycleCount: 2,
        completedPartitionCycleCount: 2,
        eventSequenceDelta: 10,
        completedQueueJobsPerSecond: 1,
        completedRequestedWorldCyclesPerSecond: 2,
        eventSequencesPerSecond: 10,
      },
      latencyMs: {
        completedJobSampleCount: 1,
        queueWait: { minimum: 100, p50: 100, p95: 100, maximum: 100 },
        execution: { minimum: 600, p50: 600, p95: 600, maximum: 600 },
        endToEnd: { minimum: 700, p50: 700, p95: 700, maximum: 700 },
      },
      memory: {
        baselineRssBytes: 100,
        peakRssBytes: 160,
        finalRssBytes: 160,
        rssGrowthBytes: 60,
        baselineHeapUsedBytes: 40,
        peakHeapUsedBytes: 70,
        finalHeapUsedBytes: 70,
        heapUsedGrowthBytes: 30,
      },
      recovery: { attemptedRecoveryDelta: 2, recoveredDelta: 1 },
      failure: { denominator: 1, failedAttemptRatio: 0 },
      dataGrowth: {
        baselineRegularFileCount: 1,
        finalRegularFileCount: 5,
        regularFileCountDelta: 4,
        baselineBytes: 100,
        finalBytes: 1_200,
        byteDelta: 1_100,
        bytesPerSecond: 1_100,
      },
      qualityGate: { status: 'pass' },
    });
    expect(artifact.evidenceClassification).toEqual({
      mechanism: 'verified-by-artifact-contract',
      observationProtocol: 'noncanonical',
      empiricalScaleClaimEligibility: 'not-eligible-synthetic-contract',
      syntheticInputsMayEstablishScaleCapability: false,
      fullProviderCapacityEstablished: false,
      paperScaleEstablished: false,
    });
  });

  test('only classifies a full-duration healthy runtime observation as eligible backend evidence', () => {
    const startedAt = 5_000;
    const endedAt = startedAt + RUNTIME_SOAK_CANONICAL_MINIMUM_DURATION_MS;
    const samples = Array.from(
      { length: RUNTIME_SOAK_CANONICAL_MINIMUM_DURATION_MS / 10_000 + 1 },
      (_, index) =>
        createSample({
          observedAt: startedAt + index * 10_000,
          sequence: 10 + index,
          completedJobCount: index,
        }),
    );
    const artifact = createArtifact({
      sourceKind: 'canonical-runtime-process-observation',
      startedAt,
      endedAt,
      samples,
      completedJobs: [
        {
          jobId: 'job-canonical',
          enqueuedAt: startedAt + 1,
          startedAt: startedAt + 2,
          completedAt: startedAt + 3,
          requestedCycleCount: 1,
          attemptCount: 1,
          failedAttemptCount: 0,
        },
      ],
    });

    expect(artifact.evidenceClassification).toMatchObject({
      observationProtocol: 'canonical',
      empiricalScaleClaimEligibility: 'eligible-single-process-backend-profile-evidence',
      fullProviderCapacityEstablished: false,
      paperScaleEstablished: false,
    });
  });

  test('fails quality gates for unhealthy backlog, dead letters, and failed attempts', () => {
    const first = createSample({ observedAt: 1_000, sequence: 10 });
    const last = createSample({
      observedAt: 2_000,
      sequence: 11,
      health: 'attention',
      completedJobCount: 1,
      readyQueueDepth: 2,
      deadLetterCount: 1,
      failedAttemptCount: 1,
    });
    const artifact = createArtifact({
      sourceKind: 'canonical-runtime-process-observation',
      startedAt: 1_000,
      endedAt: 2_000,
      samples: [first, last],
      completedJobs: [
        {
          jobId: 'job-failed-once',
          enqueuedAt: 1_100,
          startedAt: 1_200,
          completedAt: 1_800,
          requestedCycleCount: 1,
          attemptCount: 2,
          failedAttemptCount: 1,
        },
      ],
    });

    expect(artifact.summary.qualityGate.status).toBe('fail');
    expect(
      artifact.summary.qualityGate.checks
        .filter((check) => check.status === 'fail')
        .map((check) => check.checkId),
    ).toEqual([
      'healthy-samples',
      'ready-queue-depth',
      'no-dead-letter-growth',
      'failed-attempt-ratio',
    ]);
    expect(artifact.evidenceClassification.empiricalScaleClaimEligibility).toBe(
      'not-eligible-noncanonical-observation-window',
    );
  });

  test('persists content-addressed artifacts and rejects tampering after restart', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'runtime-soak-evidence-'));
    roots.push(rootDir);
    const artifact = createArtifact({
      sourceKind: 'synthetic-contract',
      startedAt: 1_000,
      endedAt: 2_000,
      samples: [
        createSample({ observedAt: 1_000, sequence: 10 }),
        createSample({ observedAt: 2_000, sequence: 11, completedJobCount: 1 }),
      ],
      completedJobs: [
        {
          jobId: 'job-1',
          enqueuedAt: 1_100,
          startedAt: 1_200,
          completedAt: 1_800,
          requestedCycleCount: 1,
          attemptCount: 1,
          failedAttemptCount: 0,
        },
      ],
    });
    const repository = new FileRuntimeSoakEvidenceRepository({ rootDir });
    await repository.save(artifact);
    await expect(
      new FileRuntimeSoakEvidenceRepository({ rootDir }).get(artifact.artifactId),
    ).resolves.toEqual(artifact);

    const path = join(
      rootDir,
      'runtime-soak-evidence',
      encodeURIComponent(artifact.artifactId),
      'artifact.json',
    );
    expect(existsSync(path)).toBe(true);
    const tampered = JSON.parse(readFileSync(path, 'utf8')) as RuntimeSoakEvidenceArtifact;
    writeFileSync(
      path,
      `${JSON.stringify({ ...tampered, summary: { ...tampered.summary, durationMs: 99 } })}\n`,
      'utf8',
    );
    await expect(repository.get(artifact.artifactId)).rejects.toThrow('content mismatch');
  });

  test('publishes the exact canonical profile set and honest evidence boundary', () => {
    expect(createRuntimeSoakEvidencePolicyManifest()).toEqual({
      policyVersion: 'runtime-soak-evidence-v1',
      requiredProfiles: [
        { profileId: 'smoke-25', agentCount: 25 },
        { profileId: 'default-100', agentCount: 100 },
        { profileId: 'headless-stress-1000', agentCount: 1_000 },
      ],
      minimumDurationMs: 1_800_000,
      maximumSampleGapMs: 10_000,
      maximumFailedAttemptRatio: 0.01,
      requiredMetrics: [
        'throughput',
        'cycle-latency',
        'process-memory',
        'queue-depth',
        'recovery-count',
        'failure-rate',
        'data-growth',
      ],
      evidenceBoundary: {
        scope: 'single-process-backend-runtime',
        fullProviderCapacityClaim: false,
        paperScaleClaim: false,
        syntheticContractOutputIsEmpiricalEvidence: false,
      },
    });
  });

  test('refuses to create new empirical evidence from an unidentified dirty worktree', () => {
    expect(() =>
      createArtifact({
        sourceKind: 'synthetic-contract',
        startedAt: 1_000,
        endedAt: 2_000,
        sourceRevision: {
          commit: '0123456789abcdef0123456789abcdef01234567',
          dirty: true,
        },
        samples: [
          createSample({ observedAt: 1_000, sequence: 10 }),
          createSample({ observedAt: 2_000, sequence: 11 }),
        ],
        completedJobs: [],
      }),
    ).toThrow('requires a workspaceFingerprint when dirty');
  });
});

function createArtifact(input: {
  readonly sourceKind: RuntimeSoakEvidenceArtifact['run']['sourceKind'];
  readonly startedAt: number;
  readonly endedAt: number;
  readonly sourceRevision?: SourceRevision;
  readonly samples: readonly RuntimeSoakEvidenceSample[];
  readonly completedJobs: RuntimeSoakEvidenceArtifact['completedJobs'];
}): RuntimeSoakEvidenceArtifact {
  return createRuntimeSoakEvidenceArtifact({
    run: {
      soakRunId: 'soak-test',
      runManifestId: `resolved-run-manifest:sha256:${'a'.repeat(64)}`,
      manifestId: 'aivilization-smoke-25',
      profileId: 'smoke-25',
      agentCount: 25,
      partitionCount: 1,
      sourceRevision: input.sourceRevision ?? {
        commit: '0123456789abcdef0123456789abcdef01234567',
        dirty: false,
      },
      seed: 'soak-test-seed',
      cognitionMode: 'deterministic',
      sourceKind: input.sourceKind,
      runtimeRootDir: '/tmp/runtime-soak-test',
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      environment: {
        platform: 'test',
        architecture: 'test-arch',
        osRelease: 'test-release',
        logicalCpuCount: 8,
        totalMemoryBytes: 16_000,
        nodeVersion: 'v-test',
      },
    },
    maximumReadyQueueDepth: 1,
    samples: input.samples,
    completedJobs: input.completedJobs,
  });
}

function createSample(input: {
  readonly observedAt: number;
  readonly sequence: number;
  readonly health?: RuntimeSoakEvidenceSample['health'];
  readonly completedJobCount?: number;
  readonly readyQueueDepth?: number;
  readonly failedAttemptCount?: number;
  readonly deadLetterCount?: number;
  readonly attemptedRecoveryCount?: number;
  readonly recoveredCount?: number;
  readonly rssBytes?: number;
  readonly heapUsedBytes?: number;
  readonly fileCount?: number;
  readonly totalBytes?: number;
}): RuntimeSoakEvidenceSample {
  const completedJobCount = input.completedJobCount ?? 0;
  return {
    observedAt: input.observedAt,
    health: input.health ?? 'healthy',
    attentionPartitionCount: input.health === 'attention' ? 1 : 0,
    partitionProgress: [
      {
        simulationId: 'aivilization-smoke-25',
        partitionKey: 'world-main',
        lastAppliedSequence: input.sequence,
        nextTickIndex: input.sequence,
      },
    ],
    queue: {
      totalJobCount: completedJobCount + (input.readyQueueDepth ?? 0),
      completedJobCount,
      readyQueueDepth: input.readyQueueDepth ?? 0,
      delayedQueueDepth: 0,
      activeLeaseCount: 0,
      expiredLeaseCount: 0,
      deadLetterCount: input.deadLetterCount ?? 0,
      failedAttemptCount: input.failedAttemptCount ?? 0,
      replayCount: 0,
    },
    recovery: {
      attemptedRecoveryCount: input.attemptedRecoveryCount ?? 0,
      recoveredCount: input.recoveredCount ?? 0,
    },
    processMemory: {
      rssBytes: input.rssBytes ?? 100,
      heapTotalBytes: 100,
      heapUsedBytes: input.heapUsedBytes ?? 40,
      externalBytes: 10,
      arrayBuffersBytes: 5,
    },
    storage: {
      regularFileCount: input.fileCount ?? 1,
      totalBytes: input.totalBytes ?? 100,
    },
  };
}
