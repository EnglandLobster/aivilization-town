import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { RuntimeSoakEvidenceSample } from '@aivilization/observability';
import {
  createLocalRuntimeTownSoakCliHelp,
  resolveLocalRuntimeTownSoakCliConfig,
  runLocalRuntimeTownSoakCli,
} from './localRuntimeTownSoakCli';

const roots: string[] = [];
const sourceRevision = {
  commit: '0123456789abcdef0123456789abcdef01234567',
  dirty: false,
} as const;

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town soak CLI', () => {
  test('resolves canonical defaults into an isolated deterministic runtime configuration', () => {
    const config = resolveLocalRuntimeTownSoakCliConfig({
      argv: ['--profile', 'headless-stress-1000'],
      cwd: '/workspace',
      now: 1_234,
      env: {},
      sourceRevision,
    });

    expect(config).toMatchObject({
      soakRunId: 'headless-stress-1000-1234',
      durationMs: 1_800_000,
      sampleIntervalMs: 5_000,
      artifactRootDir: '/workspace/.aivilization/soak-artifacts',
      runtime: {
        profileId: 'headless-stress-1000',
        rootDir: '/workspace/.aivilization/soak-runs/headless-stress-1000-1234/runtime',
        port: 0,
        seed: 'runtime-soak-evidence-v1:headless-stress-1000:headless-stress-1000-1234',
        llmMode: 'deterministic',
        sourceRevision,
      },
    });
  });

  test('rejects non-scale profiles and unsafe run identifiers', () => {
    expect(() =>
      resolveLocalRuntimeTownSoakCliConfig({
        argv: ['--profile', 'ablation-80'],
        sourceRevision,
      }),
    ).toThrow('must be one of');
    expect(() =>
      resolveLocalRuntimeTownSoakCliConfig({
        argv: ['--profile', 'smoke-25', '--soak-run-id', '../escape'],
        sourceRevision,
      }),
    ).toThrow('only letters');
  });

  test('runs the sampler through an injected runtime, closes it, and persists noncanonical evidence', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'runtime-soak-cli-'));
    roots.push(rootDir);
    const runtimeRootDir = join(rootDir, 'runtime');
    const artifactRootDir = join(rootDir, 'artifacts');
    mkdirSync(runtimeRootDir);
    let now = 1_000;
    let closed = false;
    const config = resolveLocalRuntimeTownSoakCliConfig({
      argv: [
        '--profile',
        'smoke-25',
        '--soak-run-id',
        'test-soak',
        '--duration-ms',
        '1000',
        '--sample-interval-ms',
        '500',
        '--runtime-root-dir',
        runtimeRootDir,
        '--artifact-root-dir',
        artifactRootDir,
      ],
      env: {},
      sourceRevision,
    });

    const result = await runLocalRuntimeTownSoakCli(config, {
      sourceKind: 'synthetic-contract',
      clock: { now: () => now },
      delay: (delayMs) => {
        now += delayMs;
        return Promise.resolve();
      },
      startRuntime: () =>
        Promise.resolve({
          manifestId: 'aivilization-smoke-25',
          runManifestId: `resolved-run-manifest:sha256:${'a'.repeat(64)}`,
          partitionCount: 1,
          maximumReadyQueueDepth: 1,
          captureSample: (observedAt) => Promise.resolve(createSample(observedAt)),
          queryCompletedJobs: () =>
            Promise.resolve([
              {
                jobId: 'job-1',
                enqueuedAt: 1_100,
                startedAt: 1_200,
                completedAt: 1_400,
                requestedCycleCount: 1,
                attemptCount: 1,
                failedAttemptCount: 0,
              },
            ]),
          close: () => {
            closed = true;
            return Promise.resolve();
          },
        }),
    });

    expect(closed).toBe(true);
    expect(result.artifact).toMatchObject({
      run: {
        soakRunId: 'test-soak',
        profileId: 'smoke-25',
        agentCount: 25,
        startedAt: 1_000,
        endedAt: 2_000,
      },
      summary: {
        sampleCount: 3,
        throughput: { completedQueueJobCount: 1, eventSequenceDelta: 2 },
        qualityGate: { status: 'pass' },
      },
      evidenceClassification: {
        empiricalScaleClaimEligibility: 'not-eligible-synthetic-contract',
      },
    });
    expect(
      existsSync(
        join(
          artifactRootDir,
          'runtime-soak-evidence',
          encodeURIComponent(result.artifact.artifactId),
          'artifact.json',
        ),
      ),
    ).toBe(true);
  });

  test('closes the runtime when sampling fails', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'runtime-soak-cli-failure-'));
    roots.push(rootDir);
    const runtimeRootDir = join(rootDir, 'runtime');
    mkdirSync(runtimeRootDir);
    let now = 1_000;
    let closed = false;
    const config = resolveLocalRuntimeTownSoakCliConfig({
      argv: [
        '--profile',
        'smoke-25',
        '--duration-ms',
        '1',
        '--sample-interval-ms',
        '1',
        '--runtime-root-dir',
        runtimeRootDir,
        '--artifact-root-dir',
        join(rootDir, 'artifacts'),
      ],
      env: {},
      sourceRevision,
    });
    let captureCount = 0;

    await expect(
      runLocalRuntimeTownSoakCli(config, {
        clock: { now: () => now },
        delay: (delayMs) => {
          now += delayMs;
          return Promise.resolve();
        },
        startRuntime: () =>
          Promise.resolve({
            manifestId: 'aivilization-smoke-25',
            runManifestId: `resolved-run-manifest:sha256:${'b'.repeat(64)}`,
            partitionCount: 1,
            maximumReadyQueueDepth: 1,
            captureSample: (observedAt) => {
              captureCount += 1;
              if (captureCount === 2) {
                throw new Error('injected sample failure');
              }
              return Promise.resolve(createSample(observedAt));
            },
            queryCompletedJobs: () => Promise.resolve([]),
            close: () => {
              closed = true;
              return Promise.resolve();
            },
          }),
      }),
    ).rejects.toThrow('injected sample failure');
    expect(closed).toBe(true);
  });

  test('documents metric coverage and evidence boundaries in CLI help', () => {
    expect(createLocalRuntimeTownSoakCliHelp()).toContain(
      'throughput, queue/execution/end-to-end latency, process memory',
    );
    expect(createLocalRuntimeTownSoakCliHelp()).toContain(
      'does not establish full provider or paper scale',
    );
  });
});

function createSample(observedAt: number): RuntimeSoakEvidenceSample {
  const completed = observedAt >= 1_500 ? 1 : 0;
  const sequence = 1 + Math.floor((observedAt - 1_000) / 500);
  return {
    observedAt,
    health: 'healthy',
    attentionPartitionCount: 0,
    partitionProgress: [
      {
        simulationId: 'aivilization-smoke-25',
        partitionKey: 'world-main',
        lastAppliedSequence: sequence,
        nextTickIndex: sequence,
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
      rssBytes: 100 + sequence,
      heapTotalBytes: 100,
      heapUsedBytes: 50 + sequence,
      externalBytes: 10,
      arrayBuffersBytes: 5,
    },
    storage: { regularFileCount: completed, totalBytes: completed * 100 },
  };
}
