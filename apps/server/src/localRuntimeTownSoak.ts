import { existsSync, readdirSync, statSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  FileRuntimeSoakEvidenceRepository,
  RUNTIME_SOAK_CANONICAL_MINIMUM_DURATION_MS,
  RUNTIME_SOAK_RECOMMENDED_SAMPLE_INTERVAL_MS,
  createRuntimeSoakEvidenceArtifact,
  type RuntimeSoakCompletedJobTiming,
  type RuntimeSoakEvidenceArtifact,
  type RuntimeSoakEvidenceSample,
  type RuntimeSoakEvidenceSourceKind,
} from '@aivilization/observability';
import type { LocalSimulationRuntimeRunQueueJob } from '@aivilization/worker';
import {
  startLocalRuntimeTownCli,
  type LocalRuntimeTownCliApplication,
  type LocalRuntimeTownCliConfig,
} from './localRuntimeTownCli';
import { createLocalRuntimeTownDaemonScenarioProfile } from './localRuntimeTownScenarioProfile';

export type LocalRuntimeTownSoakConfig = {
  readonly soakRunId: string;
  readonly durationMs: number;
  readonly sampleIntervalMs: number;
  readonly artifactRootDir: string;
  readonly runtime: LocalRuntimeTownCliConfig;
};

export type LocalRuntimeTownSoakResult = {
  readonly artifact: RuntimeSoakEvidenceArtifact;
  readonly artifactRootDir: string;
};

export type LocalRuntimeTownSoakRuntime = {
  readonly manifestId: string;
  readonly runManifestId: string;
  readonly partitionCount: number;
  readonly maximumReadyQueueDepth: number;
  readonly captureSample: (observedAt: number) => Promise<RuntimeSoakEvidenceSample>;
  readonly queryCompletedJobs: (input: {
    readonly startedAt: number;
    readonly endedAt: number;
  }) => Promise<readonly RuntimeSoakCompletedJobTiming[]>;
  readonly close: () => Promise<void>;
};

export type LocalRuntimeTownSoakDependencies = {
  readonly clock?: { readonly now: () => number };
  readonly delay?: (delayMs: number) => Promise<void>;
  readonly startRuntime?: (
    config: LocalRuntimeTownCliConfig,
  ) => Promise<LocalRuntimeTownSoakRuntime>;
  readonly sourceKind?: RuntimeSoakEvidenceSourceKind;
};

export async function runLocalRuntimeTownSoak(
  config: LocalRuntimeTownSoakConfig,
  dependencies: LocalRuntimeTownSoakDependencies = {},
): Promise<LocalRuntimeTownSoakResult> {
  validateConfig(config);
  assertUnusedRuntimeRoot(config.runtime.rootDir);
  const clock = dependencies.clock ?? { now: () => Date.now() };
  const delay = dependencies.delay ?? delayWithTimer;
  const runtime = await (dependencies.startRuntime ?? startCanonicalSoakRuntime)(config.runtime);
  const samples: RuntimeSoakEvidenceSample[] = [];
  try {
    const firstObservedAt = requireNonNegativeTimestamp(clock.now(), 'first observedAt');
    samples.push(await runtime.captureSample(firstObservedAt));
    const targetEndedAt = firstObservedAt + config.durationMs;
    while (samples.at(-1)!.observedAt < targetEndedAt) {
      const remainingMs = Math.max(0, targetEndedAt - clock.now());
      if (remainingMs > 0) {
        await delay(Math.min(config.sampleIntervalMs, remainingMs));
      }
      const observedAt = requireNonNegativeTimestamp(clock.now(), 'sample observedAt');
      if (observedAt <= samples.at(-1)!.observedAt) {
        throw new Error('runtime soak clock must advance between samples');
      }
      samples.push(await runtime.captureSample(observedAt));
    }
    const startedAt = samples[0]!.observedAt;
    const endedAt = samples.at(-1)!.observedAt;
    const completedJobs = await runtime.queryCompletedJobs({ startedAt, endedAt });
    const artifact = createRuntimeSoakEvidenceArtifact({
      run: {
        soakRunId: config.soakRunId,
        runManifestId: runtime.runManifestId,
        manifestId: runtime.manifestId,
        profileId: assertSoakProfileId(config.runtime.profileId),
        agentCount: profileAgentCount(config.runtime.profileId),
        partitionCount: runtime.partitionCount,
        sourceRevision: { ...config.runtime.sourceRevision },
        seed: config.runtime.seed,
        cognitionMode: config.runtime.llmMode,
        sourceKind:
          dependencies.sourceKind ??
          (dependencies.startRuntime === undefined
            ? 'canonical-runtime-process-observation'
            : 'synthetic-contract'),
        runtimeRootDir: config.runtime.rootDir,
        startedAt,
        endedAt,
        environment: {
          platform: platform(),
          architecture: arch(),
          osRelease: release(),
          logicalCpuCount: cpus().length,
          totalMemoryBytes: totalmem(),
          nodeVersion: process.version,
        },
      },
      maximumReadyQueueDepth: runtime.maximumReadyQueueDepth,
      samples,
      completedJobs,
    });
    const repository = new FileRuntimeSoakEvidenceRepository({
      rootDir: config.artifactRootDir,
    });
    return {
      artifact: await repository.save(artifact),
      artifactRootDir: config.artifactRootDir,
    };
  } finally {
    await runtime.close();
  }
}

export function createLocalRuntimeTownSoakDefaults() {
  return {
    durationMs: RUNTIME_SOAK_CANONICAL_MINIMUM_DURATION_MS,
    sampleIntervalMs: RUNTIME_SOAK_RECOMMENDED_SAMPLE_INTERVAL_MS,
  } as const;
}

async function startCanonicalSoakRuntime(
  config: LocalRuntimeTownCliConfig,
): Promise<LocalRuntimeTownSoakRuntime> {
  const application = await startLocalRuntimeTownCli(config);
  const orchestration = application.runtime.runtimeOrchestration;
  const scheduler = orchestration.profile.runtimeScheduler;
  return {
    manifestId: orchestration.manifestId,
    runManifestId: application.runManifestId,
    partitionCount: orchestration.host.partitions.length,
    maximumReadyQueueDepth:
      scheduler?.maxPendingJobs ?? orchestration.profile.runtimeRunQueue?.maxJobsPerPoll ?? 1,
    captureSample: (observedAt) => captureCanonicalRuntimeSample(application, observedAt),
    queryCompletedJobs: (window) => queryCompletedJobTimings(application, window),
    close: async () => {
      orchestration.runQueueSchedulerHost?.stop();
      orchestration.runQueueRecoveryHost?.stop();
      orchestration.runQueueWorkerHost.stop();
      await waitForRuntimeHostsToBecomeIdle(orchestration);
      await application.close();
    },
  };
}

async function waitForRuntimeHostsToBecomeIdle(
  orchestration: LocalRuntimeTownCliApplication['runtime']['runtimeOrchestration'],
): Promise<void> {
  while (
    orchestration.runQueueWorkerHost.getStatus().inFlight ||
    orchestration.runQueueSchedulerHost?.getStatus().inFlight === true ||
    orchestration.runQueueRecoveryHost?.getStatus().inFlight === true
  ) {
    await new Promise<void>((resolveIdleCheck) => setImmediate(resolveIdleCheck));
  }
}

async function captureCanonicalRuntimeSample(
  application: LocalRuntimeTownCliApplication,
  observedAt: number,
): Promise<RuntimeSoakEvidenceSample> {
  const orchestration = application.runtime.runtimeOrchestration;
  const supervisor = orchestration.supervisor.getStatus();
  const queue = await orchestration.runQueueRepository.getStats({
    observedAt,
    manifestId: orchestration.manifestId,
  });
  const worker = orchestration.runQueueWorkerHost.getStatus();
  const scheduler = orchestration.runQueueSchedulerHost?.getStatus();
  const recovery = orchestration.runQueueRecoveryHost?.getStatus();
  const processMemory = process.memoryUsage();
  const storage = measureRegularFileStorage(application.config.rootDir);
  const hasHostError =
    worker.lastError !== undefined ||
    scheduler?.lastError !== undefined ||
    recovery?.lastError !== undefined;
  const missingDesiredHost =
    !worker.running ||
    (orchestration.profile.runtimeScheduler?.autoStart === true && scheduler?.running !== true) ||
    (orchestration.profile.runtimeRecovery?.autoStart === true && recovery?.running !== true);
  const health =
    supervisor.attentionPartitionCount > 0 ||
    queue.statusCounts['dead-lettered'] > 0 ||
    hasHostError
      ? 'attention'
      : queue.expiredLeaseCount > 0 || queue.failedAttemptCount > 0 || missingDesiredHost
        ? 'degraded'
        : 'healthy';
  return {
    observedAt,
    health,
    attentionPartitionCount: supervisor.attentionPartitionCount,
    partitionProgress: supervisor.partitions.map((partition) => ({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      lastAppliedSequence: partition.lastAppliedSequence,
      ...(partition.nextTickIndex === undefined ? {} : { nextTickIndex: partition.nextTickIndex }),
    })),
    queue: {
      totalJobCount: queue.totalJobCount,
      completedJobCount: queue.statusCounts.completed,
      readyQueueDepth: queue.readyQueueCount,
      delayedQueueDepth: queue.delayedQueueCount,
      activeLeaseCount: queue.activeLeaseCount,
      expiredLeaseCount: queue.expiredLeaseCount,
      deadLetterCount: queue.statusCounts['dead-lettered'],
      failedAttemptCount: queue.failedAttemptCount,
      replayCount: queue.replayCount,
    },
    recovery: {
      attemptedRecoveryCount: recovery?.attemptedRecoveryCount ?? 0,
      recoveredCount: recovery?.recoveredCount ?? 0,
    },
    processMemory: {
      rssBytes: processMemory.rss,
      heapTotalBytes: processMemory.heapTotal,
      heapUsedBytes: processMemory.heapUsed,
      externalBytes: processMemory.external,
      arrayBuffersBytes: processMemory.arrayBuffers,
    },
    storage,
  };
}

async function queryCompletedJobTimings(
  application: LocalRuntimeTownCliApplication,
  window: { readonly startedAt: number; readonly endedAt: number },
): Promise<readonly RuntimeSoakCompletedJobTiming[]> {
  const orchestration = application.runtime.runtimeOrchestration;
  const jobs = await orchestration.runQueueRepository.query({
    manifestId: orchestration.manifestId,
    status: 'completed',
  });
  return jobs
    .filter(
      (job) =>
        job.completedAt !== undefined &&
        job.completedAt >= window.startedAt &&
        job.completedAt <= window.endedAt,
    )
    .map(toCompletedJobTiming)
    .sort(
      (left, right) =>
        left.completedAt - right.completedAt || left.jobId.localeCompare(right.jobId),
    );
}

function toCompletedJobTiming(
  job: LocalSimulationRuntimeRunQueueJob,
): RuntimeSoakCompletedJobTiming {
  if (job.startedAt === undefined || job.completedAt === undefined) {
    throw new Error(`completed queue job ${job.jobId} is missing start or completion timestamps`);
  }
  return {
    jobId: job.jobId,
    enqueuedAt: job.enqueuedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    requestedCycleCount: job.runRequest.cycleCount,
    attemptCount: job.attemptCount ?? job.attempts?.length ?? 1,
    failedAttemptCount: job.failedAttemptCount ?? 0,
  };
}

function measureRegularFileStorage(rootDir: string): RuntimeSoakEvidenceSample['storage'] {
  let regularFileCount = 0;
  let totalBytes = 0;
  const pending = [rootDir];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) {
      continue;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        const stats = statSync(path);
        regularFileCount += 1;
        totalBytes += stats.size;
      }
    }
  }
  return { regularFileCount, totalBytes };
}

function profileAgentCount(profileId: LocalRuntimeTownCliConfig['profileId']): number {
  switch (profileId) {
    case 'smoke-25':
    case 'default-100':
    case 'headless-stress-1000':
      return createLocalRuntimeTownDaemonScenarioProfile(profileId).agentCount;
    default:
      throw new Error(`profile ${profileId} is not a SCALE-001 soak profile`);
  }
}

function assertSoakProfileId(
  profileId: LocalRuntimeTownCliConfig['profileId'],
): RuntimeSoakEvidenceArtifact['run']['profileId'] {
  profileAgentCount(profileId);
  return profileId as RuntimeSoakEvidenceArtifact['run']['profileId'];
}

function validateConfig(config: LocalRuntimeTownSoakConfig): void {
  if (config.soakRunId.trim().length === 0) {
    throw new Error('soakRunId must not be empty');
  }
  assertPositiveInteger(config.durationMs, 'durationMs');
  assertPositiveInteger(config.sampleIntervalMs, 'sampleIntervalMs');
  if (config.artifactRootDir.trim().length === 0) {
    throw new Error('artifactRootDir must not be empty');
  }
  if (pathsOverlap(config.runtime.rootDir, config.artifactRootDir)) {
    throw new Error('runtimeRootDir and artifactRootDir must be separate non-overlapping roots');
  }
  profileAgentCount(config.runtime.profileId);
}

function pathsOverlap(left: string, right: string): boolean {
  const resolvedLeft = resolve(left);
  const resolvedRight = resolve(right);
  return (
    resolvedLeft === resolvedRight ||
    isInside(resolvedLeft, resolvedRight) ||
    isInside(resolvedRight, resolvedLeft)
  );
}

function isInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return (
    path !== '' &&
    path !== '..' &&
    !path.startsWith('../') &&
    !path.startsWith('..\\') &&
    !isAbsolute(path)
  );
}

function assertUnusedRuntimeRoot(rootDir: string): void {
  if (existsSync(rootDir) && readdirSync(rootDir).length > 0) {
    throw new Error(
      `runtime soak requires an empty dedicated runtime root; found existing data at ${rootDir}`,
    );
  }
}

function delayWithTimer(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function requireNonNegativeTimestamp(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite timestamp`);
  }
  return value;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}
