import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createRuntimeSoakEvidenceArtifact,
  type RuntimeSoakEvidenceArtifact,
  type RuntimeSoakProfileId,
} from './runtimeSoakEvidence';
import {
  FileRuntimeResourceEnvelopeAssessmentRepository,
  createRuntimeResourceEnvelopeAssessmentArtifact,
  createRuntimeResourceEnvelopePolicyManifest,
  validateRuntimeResourceEnvelopeAssessmentArtifact,
  type RuntimeResourceEnvelopeAssessmentArtifact,
} from './runtimeResourceEnvelope';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('runtime resource envelope', () => {
  test('publishes a repository-design capacity policy with explicit claim boundaries', () => {
    expect(createRuntimeResourceEnvelopePolicyManifest()).toEqual({
      policyVersion: 'runtime-resource-envelope-v2',
      source: 'repository-design',
      paperDefinesResourceThresholds: false,
      referenceDeploymentClass: 'single-process-4vcpu-4gib-25gib-v1',
      minimumLogicalCpuCount: 4,
      nodeMemoryCapacityBytes: 4_294_967_296,
      runtimeMemoryReserveRatio: 0.25,
      runtimeMemoryBudgetBytes: 3_221_225_472,
      durableStorageCapacityBytes: 26_843_545_600,
      durableStorageReserveRatio: 0.25,
      durableStorageBudgetBytes: 20_132_659_200,
      lateWindowFraction: 1 / 3,
      minimumLateWindowSampleCount: 30,
      memoryProjectionHorizonMs: 3_600_000,
      storageProjectionHorizonMs: 86_400_000,
      projectionRule:
        'final-value-plus-positive-least-squares-late-window-slope-times-forward-horizon',
      memoryRateRule: 'positive-least-squares-final-third-slope-with-observed-peak-hard-cap',
      storageRateRule: 'maximum-of-zero-all-window-average-and-least-squares-late-window-slope',
      claimBoundary: {
        scope: 'single-process-backend-runtime',
        observationOnly: true,
        resourceLimitEnforcementEstablished: false,
        fullProviderCapacityEstablished: false,
        paperDeploymentScaleEstablished: false,
      },
    });
  });

  test('regrades the exact immutable profile matrix and derives late-window projections', () => {
    const sources = createProfileMatrix();
    const assessment = createRuntimeResourceEnvelopeAssessmentArtifact(sources);

    expect(assessment.artifactId).toMatch(
      /^runtime-resource-envelope-assessment:sha256:[a-f0-9]{64}$/u,
    );
    expect(assessment.status).toBe('pass');
    expect(assessment.profiles.map((profile) => profile.profileId)).toEqual([
      'smoke-25',
      'default-100',
      'headless-stress-1000',
    ]);
    expect(assessment.profiles.every((profile) => profile.lateWindow.sampleCount === 61)).toBe(
      true,
    );
    expect(
      assessment.profiles.every((profile) =>
        profile.checks.every((check) => check.status === 'pass'),
      ),
    ).toBe(true);
    expect(assessment.evidenceClassification).toEqual({
      source: 'repository-design-applied-to-immutable-runtime-observations',
      scope: 'single-process-backend-runtime',
      completeRequiredProfileMatrix: true,
      withinReferenceResourceEnvelope: true,
      resourceLimitEnforcementEstablished: false,
      fullProviderCapacityEstablished: false,
      paperDeploymentScaleEstablished: false,
    });
    expect(validateRuntimeResourceEnvelopeAssessmentArtifact(assessment, sources)).toEqual(
      assessment,
    );
  });

  test('fails a positive late-window memory trend that exceeds the forward budget', () => {
    const sources = createProfileMatrix().map((artifact) =>
      artifact.run.profileId === 'headless-stress-1000'
        ? createSourceArtifact('headless-stress-1000', 80 * 1_024 * 1_024)
        : artifact,
    );
    const assessment = createRuntimeResourceEnvelopeAssessmentArtifact(sources);
    const stress = assessment.profiles.find(
      (profile) => profile.profileId === 'headless-stress-1000',
    );

    expect(assessment.status).toBe('fail');
    expect(stress?.checks.find((check) => check.checkId === 'projected-rss-budget')).toMatchObject({
      status: 'fail',
    });
    expect(stress?.lateWindow.rssSlopeBytesPerMinute).toBeGreaterThan(0);
  });

  test('does not extrapolate bounded warm-up RSS expansion after the final third plateaus', () => {
    const twoGibibytes = 2 * 1_024 ** 3;
    const sources = createProfileMatrix().map((artifact) =>
      artifact.run.profileId === 'headless-stress-1000'
        ? createSourceArtifact('headless-stress-1000', (elapsedMinutes) =>
            Math.round(twoGibibytes * Math.min(1, elapsedMinutes / 20)),
          )
        : artifact,
    );
    const assessment = createRuntimeResourceEnvelopeAssessmentArtifact(sources);
    const stress = assessment.profiles.find(
      (profile) => profile.profileId === 'headless-stress-1000',
    );

    expect(assessment.status).toBe('pass');
    expect(stress?.lateWindow.rssSlopeBytesPerMinute).toBeCloseTo(0, 5);
    expect(stress?.checks.find((check) => check.checkId === 'peak-rss-budget')).toMatchObject({
      status: 'pass',
    });
    expect(stress?.checks.find((check) => check.checkId === 'projected-rss-budget')).toMatchObject({
      status: 'pass',
    });
  });

  test('requires one source artifact for every canonical profile', () => {
    expect(() =>
      createRuntimeResourceEnvelopeAssessmentArtifact(createProfileMatrix().slice(0, 2)),
    ).toThrow('exact canonical profile matrix');
    const duplicate = [
      createSourceArtifact('smoke-25'),
      createSourceArtifact('smoke-25'),
      createSourceArtifact('headless-stress-1000'),
    ];
    expect(() => createRuntimeResourceEnvelopeAssessmentArtifact(duplicate)).toThrow(
      'duplicate runtime soak profile',
    );
  });

  test('rejects a profile matrix assembled from different source snapshots', () => {
    const [smoke, normal, stress] = createProfileMatrix();
    const changed = createSourceArtifact('default-100', 0, {
      commit: normal!.run.sourceRevision.commit,
      dirty: true,
      workspaceFingerprint: {
        policyVersion: 'git-workspace-fingerprint-v1',
        sha256: `sha256:${'b'.repeat(64)}`,
        pathCount: 17,
      },
    });
    expect(() =>
      createRuntimeResourceEnvelopeAssessmentArtifact([smoke!, changed, stress!]),
    ).toThrow('one exact source revision and workspace fingerprint');
  });

  test('persists a content-addressed assessment and detects tampering', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'runtime-resource-envelope-'));
    roots.push(rootDir);
    const assessment = createRuntimeResourceEnvelopeAssessmentArtifact(createProfileMatrix());
    const repository = new FileRuntimeResourceEnvelopeAssessmentRepository({ rootDir });

    expect(repository.save(assessment)).toEqual(assessment);
    expect(repository.get(assessment.artifactId)).toEqual(assessment);

    const path = join(
      rootDir,
      'runtime-resource-envelope-assessments',
      encodeURIComponent(assessment.artifactId),
      'artifact.json',
    );
    const parsed = JSON.parse(
      readFileSync(path, 'utf8'),
    ) as RuntimeResourceEnvelopeAssessmentArtifact;
    writeFileSync(path, `${JSON.stringify({ ...parsed, status: 'fail' })}\n`, 'utf8');
    expect(() => repository.get(assessment.artifactId)).toThrow('content mismatch');
  });
});

function createProfileMatrix(): RuntimeSoakEvidenceArtifact[] {
  return [
    createSourceArtifact('smoke-25'),
    createSourceArtifact('default-100'),
    createSourceArtifact('headless-stress-1000'),
  ];
}

function createSourceArtifact(
  profileId: RuntimeSoakProfileId,
  rssGrowthBytesPerMinute: number | ((elapsedMinutes: number) => number) = 0,
  sourceRevision: RuntimeSoakEvidenceArtifact['run']['sourceRevision'] = {
    commit: '0123456789abcdef0123456789abcdef01234567',
    dirty: false,
  },
): RuntimeSoakEvidenceArtifact {
  const profileAgentCounts: Record<RuntimeSoakProfileId, number> = {
    'smoke-25': 25,
    'default-100': 100,
    'headless-stress-1000': 1_000,
  };
  const startedAt = 1_000;
  const endedAt = startedAt + 1_800_000;
  const samples = Array.from({ length: 181 }, (_, index) => {
    const elapsedMinutes = index / 6;
    const completed = index;
    const rssGrowthBytes =
      typeof rssGrowthBytesPerMinute === 'function'
        ? rssGrowthBytesPerMinute(elapsedMinutes)
        : rssGrowthBytesPerMinute * elapsedMinutes;
    return {
      observedAt: startedAt + index * 10_000,
      health: 'healthy' as const,
      attentionPartitionCount: 0,
      partitionProgress: [
        {
          simulationId: `aivilization-${profileId}`,
          partitionKey: 'world-main',
          lastAppliedSequence: 10 + index,
          nextTickIndex: index,
        },
      ],
      queue: {
        totalJobCount: completed,
        completedJobCount: completed,
        readyQueueDepth: 0,
        delayedQueueDepth: 0,
        activeLeaseCount: 0,
        expiredLeaseCount: 0,
        deadLetterCount: 0,
        failedAttemptCount: 0,
        replayCount: 0,
      },
      recovery: { attemptedRecoveryCount: 0, recoveredCount: 0 },
      processMemory: {
        rssBytes: Math.round(128 * 1_024 * 1_024 + rssGrowthBytes),
        heapTotalBytes: 128 * 1_024 * 1_024,
        heapUsedBytes: 64 * 1_024 * 1_024,
        externalBytes: 1_024,
        arrayBuffersBytes: 1_024,
      },
      storage: {
        regularFileCount: 10,
        totalBytes: Math.round(100 * 1_024 * 1_024 + elapsedMinutes * 1_024 * 1_024),
      },
    };
  });
  return createRuntimeSoakEvidenceArtifact({
    run: {
      soakRunId: `resource-envelope-${profileId}`,
      runManifestId: `resolved-run-manifest:sha256:${'a'.repeat(64)}`,
      manifestId: `aivilization-${profileId}`,
      profileId,
      agentCount: profileAgentCounts[profileId],
      partitionCount: 1,
      sourceRevision,
      seed: `resource-envelope-${profileId}`,
      cognitionMode: 'deterministic',
      sourceKind: 'canonical-runtime-process-observation',
      runtimeRootDir: `/tmp/resource-envelope-${profileId}`,
      startedAt,
      endedAt,
      environment: {
        platform: 'test',
        architecture: 'test-arch',
        osRelease: 'test-release',
        logicalCpuCount: 8,
        totalMemoryBytes: 8 * 1_024 ** 3,
        nodeVersion: 'v-test',
      },
    },
    maximumReadyQueueDepth: 1,
    samples,
    completedJobs: [
      {
        jobId: `job-${profileId}`,
        enqueuedAt: startedAt + 1,
        startedAt: startedAt + 2,
        completedAt: endedAt - 1,
        requestedCycleCount: 1,
        attemptCount: 1,
        failedAttemptCount: 0,
      },
    ],
  });
}
