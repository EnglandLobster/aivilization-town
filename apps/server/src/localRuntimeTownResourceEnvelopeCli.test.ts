import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileRuntimeSoakEvidenceRepository,
  createRuntimeSoakEvidenceArtifact,
  type RuntimeSoakProfileId,
} from '@aivilization/observability';
import {
  createLocalRuntimeTownResourceEnvelopeCliHelp,
  resolveLocalRuntimeTownResourceEnvelopeCliConfig,
  runLocalRuntimeTownResourceEnvelopeCli,
} from './localRuntimeTownResourceEnvelopeCli';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town resource envelope CLI', () => {
  test('requires exactly three unique content-addressed source IDs', () => {
    const ids = ['a', 'b', 'c'].map(
      (suffix) => `runtime-soak-evidence:sha256:${suffix.repeat(64)}`,
    );
    const config = resolveLocalRuntimeTownResourceEnvelopeCliConfig({
      cwd: '/workspace',
      argv: ids.flatMap((id) => ['--source-artifact-id', id]),
    });

    expect(config).toEqual({
      artifactRootDir: '/workspace/.aivilization/soak-artifacts',
      sourceArtifactIds: ids,
    });
    expect(() =>
      resolveLocalRuntimeTownResourceEnvelopeCliConfig({
        argv: ['--source-artifact-id', ids[0]!, '--source-artifact-id', ids[1]!],
      }),
    ).toThrow('exactly three times');
    expect(() =>
      resolveLocalRuntimeTownResourceEnvelopeCliConfig({
        argv: ids.flatMap(() => ['--source-artifact-id', ids[0]!]),
      }),
    ).toThrow('must be unique');
  });

  test('loads immutable source artifacts and persists the derived assessment', async () => {
    const artifactRootDir = mkdtempSync(join(tmpdir(), 'resource-envelope-cli-'));
    roots.push(artifactRootDir);
    const repository = new FileRuntimeSoakEvidenceRepository({ rootDir: artifactRootDir });
    const sources = [
      createSourceArtifact('headless-stress-1000'),
      createSourceArtifact('smoke-25'),
      createSourceArtifact('default-100'),
    ];
    for (const source of sources) {
      await repository.save(source);
    }

    const artifact = await runLocalRuntimeTownResourceEnvelopeCli({
      artifactRootDir,
      sourceArtifactIds: sources.map((source) => source.artifactId),
    });

    expect(artifact.status).toBe('pass');
    expect(artifact.profiles.map((profile) => profile.profileId)).toEqual([
      'smoke-25',
      'default-100',
      'headless-stress-1000',
    ]);
    expect(
      existsSync(
        join(
          artifactRootDir,
          'runtime-resource-envelope-assessments',
          encodeURIComponent(artifact.artifactId),
          'artifact.json',
        ),
      ),
    ).toBe(true);
  });

  test('documents the repository-decision and claim boundary', () => {
    const help = createLocalRuntimeTownResourceEnvelopeCliHelp();
    expect(help).toContain('4-vCPU/4-GiB/25-GiB');
    expect(help).toContain('does not establish resource-limit');
    expect(help).toContain('paper deployment');
  });
});

function createSourceArtifact(profileId: RuntimeSoakProfileId) {
  const agentCounts: Record<RuntimeSoakProfileId, number> = {
    'smoke-25': 25,
    'default-100': 100,
    'headless-stress-1000': 1_000,
  };
  const startedAt = 1_000;
  const endedAt = startedAt + 1_800_000;
  const samples = Array.from({ length: 181 }, (_, index) => ({
    observedAt: startedAt + index * 10_000,
    health: 'healthy' as const,
    attentionPartitionCount: 0,
    partitionProgress: [
      {
        simulationId: `aivilization-${profileId}`,
        partitionKey: 'world-main',
        lastAppliedSequence: index,
        nextTickIndex: index,
      },
    ],
    queue: {
      totalJobCount: index,
      completedJobCount: index,
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
      rssBytes: 256 * 1_024 ** 2,
      heapTotalBytes: 128 * 1_024 ** 2,
      heapUsedBytes: 64 * 1_024 ** 2,
      externalBytes: 1_024,
      arrayBuffersBytes: 1_024,
    },
    storage: {
      regularFileCount: 10,
      totalBytes: 100 * 1_024 ** 2 + index * 1_024 ** 2,
    },
  }));
  return createRuntimeSoakEvidenceArtifact({
    run: {
      soakRunId: `resource-envelope-cli-${profileId}`,
      runManifestId: `resolved-run-manifest:sha256:${'a'.repeat(64)}`,
      manifestId: `aivilization-${profileId}`,
      profileId,
      agentCount: agentCounts[profileId],
      partitionCount: 1,
      sourceRevision: { commit: '0123456789abcdef0123456789abcdef01234567', dirty: false },
      seed: `resource-envelope-cli-${profileId}`,
      cognitionMode: 'deterministic',
      sourceKind: 'canonical-runtime-process-observation',
      runtimeRootDir: `/tmp/resource-envelope-cli-${profileId}`,
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
