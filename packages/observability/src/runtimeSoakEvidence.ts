import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertReproducibleSourceRevision,
  assertSourceWorkspaceFingerprint,
  type SourceRevision,
} from '@aivilization/sim-core';

export const RUNTIME_SOAK_EVIDENCE_SCHEMA_VERSION = 'runtime-soak-evidence-v1';
export const RUNTIME_SOAK_CANONICAL_MINIMUM_DURATION_MS = 30 * 60 * 1_000;
export const RUNTIME_SOAK_CANONICAL_MAXIMUM_SAMPLE_GAP_MS = 10_000;
export const RUNTIME_SOAK_RECOMMENDED_SAMPLE_INTERVAL_MS = 5_000;
export const RUNTIME_SOAK_MAXIMUM_FAILED_ATTEMPT_RATIO = 0.01;

const ARTIFACT_ID_PREFIX = 'runtime-soak-evidence:sha256:';
const MANIFEST_FILENAME = 'artifact.json';

export const RUNTIME_SOAK_REQUIRED_PROFILES = [
  { profileId: 'smoke-25', agentCount: 25 },
  { profileId: 'default-100', agentCount: 100 },
  { profileId: 'headless-stress-1000', agentCount: 1_000 },
] as const;

export type RuntimeSoakProfileId = (typeof RUNTIME_SOAK_REQUIRED_PROFILES)[number]['profileId'];
export type RuntimeSoakEvidenceSourceKind =
  | 'canonical-runtime-process-observation'
  | 'synthetic-contract';

export type RuntimeSoakEvidencePolicy = {
  readonly policyVersion: typeof RUNTIME_SOAK_EVIDENCE_SCHEMA_VERSION;
  readonly minimumDurationMs: number;
  readonly maximumSampleGapMs: number;
  readonly maximumReadyQueueDepth: number;
  readonly maximumFailedAttemptRatio: number;
  readonly requiredProfile: {
    readonly profileId: RuntimeSoakProfileId;
    readonly agentCount: number;
  };
  readonly throughputRule: 'completed-queue-jobs-and-requested-world-cycles-per-wall-clock-second';
  readonly latencyRule: 'completed-job-enqueue-start-complete-wall-clock-nearest-rank';
  readonly memoryRule: 'node-process-memory-usage-bytes';
  readonly queueRule: 'durable-run-queue-point-samples-and-cumulative-counter-deltas';
  readonly recoveryRule: 'recovery-host-cumulative-counter-deltas';
  readonly failureRateRule: 'failed-attempt-delta-divided-by-completed-job-plus-failed-attempt-delta';
  readonly dataGrowthRule: 'recursive-regular-file-byte-and-count-delta';
  readonly scope: 'single-process-backend-runtime';
  readonly fullProviderCapacityClaim: false;
  readonly paperScaleClaim: false;
};

export type RuntimeSoakPartitionProgress = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly lastAppliedSequence: number;
  readonly nextTickIndex?: number;
};

export type RuntimeSoakEvidenceSample = {
  readonly observedAt: number;
  readonly health: 'healthy' | 'degraded' | 'attention';
  readonly attentionPartitionCount: number;
  readonly partitionProgress: readonly RuntimeSoakPartitionProgress[];
  readonly queue: {
    readonly totalJobCount: number;
    readonly completedJobCount: number;
    readonly readyQueueDepth: number;
    readonly delayedQueueDepth: number;
    readonly activeLeaseCount: number;
    readonly expiredLeaseCount: number;
    readonly deadLetterCount: number;
    readonly failedAttemptCount: number;
    readonly replayCount: number;
  };
  readonly recovery: {
    readonly attemptedRecoveryCount: number;
    readonly recoveredCount: number;
  };
  readonly processMemory: {
    readonly rssBytes: number;
    readonly heapTotalBytes: number;
    readonly heapUsedBytes: number;
    readonly externalBytes: number;
    readonly arrayBuffersBytes: number;
  };
  readonly storage: {
    readonly regularFileCount: number;
    readonly totalBytes: number;
  };
};

export type RuntimeSoakCompletedJobTiming = {
  readonly jobId: string;
  readonly enqueuedAt: number;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly requestedCycleCount: number;
  readonly attemptCount: number;
  readonly failedAttemptCount: number;
};

export type RuntimeSoakEvidenceArtifact = {
  readonly schemaVersion: typeof RUNTIME_SOAK_EVIDENCE_SCHEMA_VERSION;
  readonly artifactId: string;
  readonly run: {
    readonly soakRunId: string;
    readonly runManifestId: string;
    readonly manifestId: string;
    readonly profileId: RuntimeSoakProfileId;
    readonly agentCount: number;
    readonly partitionCount: number;
    readonly sourceRevision: SourceRevision;
    readonly seed: string;
    readonly cognitionMode: 'deterministic' | 'provider';
    readonly sourceKind: RuntimeSoakEvidenceSourceKind;
    readonly runtimeRootDir: string;
    readonly startedAt: number;
    readonly endedAt: number;
    readonly environment: {
      readonly platform: string;
      readonly architecture: string;
      readonly osRelease: string;
      readonly logicalCpuCount: number;
      readonly totalMemoryBytes: number;
      readonly nodeVersion: string;
    };
  };
  readonly policy: RuntimeSoakEvidencePolicy;
  readonly samples: readonly RuntimeSoakEvidenceSample[];
  readonly completedJobs: readonly RuntimeSoakCompletedJobTiming[];
  readonly summary: RuntimeSoakEvidenceSummary;
  readonly evidenceClassification: {
    readonly mechanism: 'verified-by-artifact-contract';
    readonly observationProtocol: 'canonical' | 'noncanonical';
    readonly empiricalScaleClaimEligibility:
      | 'eligible-single-process-backend-profile-evidence'
      | 'not-eligible-noncanonical-observation-window'
      | 'not-eligible-synthetic-contract'
      | 'not-eligible-quality-gate-failure';
    readonly syntheticInputsMayEstablishScaleCapability: false;
    readonly fullProviderCapacityEstablished: false;
    readonly paperScaleEstablished: false;
  };
};

export type RuntimeSoakEvidenceSummary = {
  readonly durationMs: number;
  readonly sampleCount: number;
  readonly maximumSampleGapMs: number;
  readonly throughput: {
    readonly completedQueueJobCount: number;
    readonly completedRequestedWorldCycleCount: number;
    readonly completedPartitionCycleCount: number;
    readonly eventSequenceDelta: number;
    readonly completedQueueJobsPerSecond: number;
    readonly completedRequestedWorldCyclesPerSecond: number;
    readonly completedPartitionCyclesPerSecond: number;
    readonly eventSequencesPerSecond: number;
  };
  readonly latencyMs: {
    readonly completedJobSampleCount: number;
    readonly queueWait: RuntimeSoakDistributionSummary;
    readonly execution: RuntimeSoakDistributionSummary;
    readonly endToEnd: RuntimeSoakDistributionSummary;
  };
  readonly memory: {
    readonly baselineRssBytes: number;
    readonly peakRssBytes: number;
    readonly finalRssBytes: number;
    readonly rssGrowthBytes: number;
    readonly baselineHeapUsedBytes: number;
    readonly peakHeapUsedBytes: number;
    readonly finalHeapUsedBytes: number;
    readonly heapUsedGrowthBytes: number;
  };
  readonly queue: {
    readonly maximumReadyQueueDepth: number;
    readonly p95ReadyQueueDepth: number;
    readonly finalReadyQueueDepth: number;
    readonly failedAttemptDelta: number;
    readonly deadLetterDelta: number;
    readonly replayDelta: number;
  };
  readonly recovery: {
    readonly attemptedRecoveryDelta: number;
    readonly recoveredDelta: number;
  };
  readonly failure: {
    readonly denominator: number;
    readonly failedAttemptRatio: number;
  };
  readonly dataGrowth: {
    readonly baselineRegularFileCount: number;
    readonly finalRegularFileCount: number;
    readonly regularFileCountDelta: number;
    readonly baselineBytes: number;
    readonly finalBytes: number;
    readonly byteDelta: number;
    readonly bytesPerSecond: number;
  };
  readonly qualityGate: {
    readonly status: 'pass' | 'fail';
    readonly checks: readonly {
      readonly checkId:
        | 'positive-runtime-progress'
        | 'healthy-samples'
        | 'ready-queue-depth'
        | 'no-dead-letter-growth'
        | 'failed-attempt-ratio'
        | 'sample-continuity';
      readonly status: 'pass' | 'fail';
      readonly measurement: Readonly<Record<string, number | string | boolean>>;
    }[];
  };
};

export type RuntimeSoakDistributionSummary = {
  readonly minimum: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly maximum: number | null;
};

export type RuntimeSoakEvidenceArtifactInput = {
  readonly run: RuntimeSoakEvidenceArtifact['run'];
  readonly maximumReadyQueueDepth: number;
  readonly samples: readonly RuntimeSoakEvidenceSample[];
  readonly completedJobs: readonly RuntimeSoakCompletedJobTiming[];
};

export function createRuntimeSoakEvidencePolicy(input: {
  readonly profileId: RuntimeSoakProfileId;
  readonly maximumReadyQueueDepth: number;
}): RuntimeSoakEvidencePolicy {
  assertNonNegativeInteger(input.maximumReadyQueueDepth, 'maximumReadyQueueDepth');
  const requiredProfile = requireProfile(input.profileId);
  return {
    policyVersion: RUNTIME_SOAK_EVIDENCE_SCHEMA_VERSION,
    minimumDurationMs: RUNTIME_SOAK_CANONICAL_MINIMUM_DURATION_MS,
    maximumSampleGapMs: RUNTIME_SOAK_CANONICAL_MAXIMUM_SAMPLE_GAP_MS,
    maximumReadyQueueDepth: input.maximumReadyQueueDepth,
    maximumFailedAttemptRatio: RUNTIME_SOAK_MAXIMUM_FAILED_ATTEMPT_RATIO,
    requiredProfile: { ...requiredProfile },
    throughputRule: 'completed-queue-jobs-and-requested-world-cycles-per-wall-clock-second',
    latencyRule: 'completed-job-enqueue-start-complete-wall-clock-nearest-rank',
    memoryRule: 'node-process-memory-usage-bytes',
    queueRule: 'durable-run-queue-point-samples-and-cumulative-counter-deltas',
    recoveryRule: 'recovery-host-cumulative-counter-deltas',
    failureRateRule: 'failed-attempt-delta-divided-by-completed-job-plus-failed-attempt-delta',
    dataGrowthRule: 'recursive-regular-file-byte-and-count-delta',
    scope: 'single-process-backend-runtime',
    fullProviderCapacityClaim: false,
    paperScaleClaim: false,
  };
}

export function createRuntimeSoakEvidencePolicyManifest() {
  return {
    policyVersion: RUNTIME_SOAK_EVIDENCE_SCHEMA_VERSION,
    requiredProfiles: RUNTIME_SOAK_REQUIRED_PROFILES.map((profile) => ({ ...profile })),
    minimumDurationMs: RUNTIME_SOAK_CANONICAL_MINIMUM_DURATION_MS,
    maximumSampleGapMs: RUNTIME_SOAK_CANONICAL_MAXIMUM_SAMPLE_GAP_MS,
    maximumFailedAttemptRatio: RUNTIME_SOAK_MAXIMUM_FAILED_ATTEMPT_RATIO,
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
  } as const;
}

export function createRuntimeSoakEvidenceArtifact(
  input: RuntimeSoakEvidenceArtifactInput,
): RuntimeSoakEvidenceArtifact {
  assertReproducibleSourceRevision(input.run.sourceRevision, 'run.sourceRevision');
  validateRun(input.run);
  const policy = createRuntimeSoakEvidencePolicy({
    profileId: input.run.profileId,
    maximumReadyQueueDepth: input.maximumReadyQueueDepth,
  });
  if (input.run.agentCount !== policy.requiredProfile.agentCount) {
    throw new Error(
      `${input.run.profileId} requires ${policy.requiredProfile.agentCount} agents; received ${input.run.agentCount}`,
    );
  }
  const samples = normalizeSamples(input.samples, input.run);
  const completedJobs = normalizeCompletedJobs(input.completedJobs, input.run);
  const summary = createSummary(samples, completedJobs, input.run, policy);
  const observationProtocol =
    summary.durationMs >= policy.minimumDurationMs &&
    summary.maximumSampleGapMs <= policy.maximumSampleGapMs
      ? 'canonical'
      : 'noncanonical';
  const empiricalScaleClaimEligibility = classifyEvidence({
    sourceKind: input.run.sourceKind,
    observationProtocol,
    qualityGateStatus: summary.qualityGate.status,
  });
  const artifactWithoutId: Omit<RuntimeSoakEvidenceArtifact, 'artifactId'> = {
    schemaVersion: RUNTIME_SOAK_EVIDENCE_SCHEMA_VERSION,
    run: cloneRun(input.run),
    policy,
    samples,
    completedJobs,
    summary,
    evidenceClassification: {
      mechanism: 'verified-by-artifact-contract',
      observationProtocol,
      empiricalScaleClaimEligibility,
      syntheticInputsMayEstablishScaleCapability: false,
      fullProviderCapacityEstablished: false,
      paperScaleEstablished: false,
    },
  };
  const artifact: RuntimeSoakEvidenceArtifact = {
    ...artifactWithoutId,
    artifactId: createArtifactId(artifactWithoutId),
  };
  validateRuntimeSoakEvidenceArtifact(artifact);
  return cloneArtifact(artifact);
}

export function validateRuntimeSoakEvidenceArtifact(
  artifact: RuntimeSoakEvidenceArtifact,
): RuntimeSoakEvidenceArtifact {
  if (artifact.schemaVersion !== RUNTIME_SOAK_EVIDENCE_SCHEMA_VERSION) {
    throw new Error('unsupported runtime soak evidence schema');
  }
  if (!/^runtime-soak-evidence:sha256:[a-f0-9]{64}$/u.test(artifact.artifactId)) {
    throw new Error('runtime soak evidence artifactId must be content-addressed');
  }
  const rebuilt = createRuntimeSoakEvidenceArtifactUnchecked({
    run: artifact.run,
    maximumReadyQueueDepth: artifact.policy.maximumReadyQueueDepth,
    samples: artifact.samples,
    completedJobs: artifact.completedJobs,
  });
  if (stableStringify(rebuilt) !== stableStringify(artifact)) {
    throw new Error(`runtime soak evidence artifact content mismatch for ${artifact.artifactId}`);
  }
  return cloneArtifact(artifact);
}

export class FileRuntimeSoakEvidenceRepository {
  private readonly artifactsDir: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.artifactsDir = join(input.rootDir, 'runtime-soak-evidence');
    mkdirSync(this.artifactsDir, { recursive: true });
  }

  save(artifact: RuntimeSoakEvidenceArtifact): Promise<RuntimeSoakEvidenceArtifact> {
    return Promise.resolve().then(() => {
      const validated = validateRuntimeSoakEvidenceArtifact(artifact);
      const directory = this.resolveArtifactDirectory(validated.artifactId);
      const path = join(directory, MANIFEST_FILENAME);
      const serialized = `${JSON.stringify(validated, null, 2)}\n`;
      if (existsSync(path)) {
        const existing = readArtifact(path);
        if (stableStringify(existing) !== stableStringify(validated)) {
          throw new Error(`runtime soak evidence collision for ${validated.artifactId}`);
        }
        return existing;
      }
      mkdirSync(directory, { recursive: true });
      atomicWrite(path, serialized);
      return cloneArtifact(validated);
    });
  }

  get(artifactId: string): Promise<RuntimeSoakEvidenceArtifact | undefined> {
    return Promise.resolve().then(() => {
      const path = join(this.resolveArtifactDirectory(artifactId), MANIFEST_FILENAME);
      return existsSync(path) ? readArtifact(path) : undefined;
    });
  }

  private resolveArtifactDirectory(artifactId: string): string {
    if (!/^runtime-soak-evidence:sha256:[a-f0-9]{64}$/u.test(artifactId)) {
      throw new Error('runtime soak evidence artifactId must be content-addressed');
    }
    return join(this.artifactsDir, encodeURIComponent(artifactId));
  }
}

function createRuntimeSoakEvidenceArtifactUnchecked(
  input: RuntimeSoakEvidenceArtifactInput,
): RuntimeSoakEvidenceArtifact {
  validateRun(input.run);
  const policy = createRuntimeSoakEvidencePolicy({
    profileId: input.run.profileId,
    maximumReadyQueueDepth: input.maximumReadyQueueDepth,
  });
  if (input.run.agentCount !== policy.requiredProfile.agentCount) {
    throw new Error(
      `${input.run.profileId} requires ${policy.requiredProfile.agentCount} agents; received ${input.run.agentCount}`,
    );
  }
  const samples = normalizeSamples(input.samples, input.run);
  const completedJobs = normalizeCompletedJobs(input.completedJobs, input.run);
  const summary = createSummary(samples, completedJobs, input.run, policy);
  const observationProtocol =
    summary.durationMs >= policy.minimumDurationMs &&
    summary.maximumSampleGapMs <= policy.maximumSampleGapMs
      ? 'canonical'
      : 'noncanonical';
  const withoutId: Omit<RuntimeSoakEvidenceArtifact, 'artifactId'> = {
    schemaVersion: RUNTIME_SOAK_EVIDENCE_SCHEMA_VERSION,
    run: cloneRun(input.run),
    policy,
    samples,
    completedJobs,
    summary,
    evidenceClassification: {
      mechanism: 'verified-by-artifact-contract',
      observationProtocol,
      empiricalScaleClaimEligibility: classifyEvidence({
        sourceKind: input.run.sourceKind,
        observationProtocol,
        qualityGateStatus: summary.qualityGate.status,
      }),
      syntheticInputsMayEstablishScaleCapability: false,
      fullProviderCapacityEstablished: false,
      paperScaleEstablished: false,
    },
  };
  return { ...withoutId, artifactId: createArtifactId(withoutId) };
}

function createSummary(
  samples: readonly RuntimeSoakEvidenceSample[],
  completedJobs: readonly RuntimeSoakCompletedJobTiming[],
  run: RuntimeSoakEvidenceArtifact['run'],
  policy: RuntimeSoakEvidencePolicy,
): RuntimeSoakEvidenceSummary {
  const first = requireFirst(samples, 'samples');
  const last = requireLast(samples, 'samples');
  const durationMs = run.endedAt - run.startedAt;
  const durationSeconds = durationMs / 1_000;
  const gaps = samples
    .slice(1)
    .map((sample, index) => sample.observedAt - samples[index]!.observedAt);
  const maximumSampleGapMs = Math.max(0, ...gaps);
  const completedRequestedWorldCycleCount = completedJobs.reduce(
    (total, job) => total + job.requestedCycleCount,
    0,
  );
  const completedPartitionCycleCount = completedRequestedWorldCycleCount * run.partitionCount;
  const eventSequenceDelta =
    sumBy(last.partitionProgress, (partition) => partition.lastAppliedSequence) -
    sumBy(first.partitionProgress, (partition) => partition.lastAppliedSequence);
  const failedAttemptDelta = last.queue.failedAttemptCount - first.queue.failedAttemptCount;
  const deadLetterDelta = last.queue.deadLetterCount - first.queue.deadLetterCount;
  const replayDelta = last.queue.replayCount - first.queue.replayCount;
  const failureDenominator = completedJobs.length + failedAttemptDelta;
  const failedAttemptRatio = ratio(failedAttemptDelta, failureDenominator);
  const maximumReadyQueueDepth = Math.max(...samples.map((sample) => sample.queue.readyQueueDepth));
  const healthySamples = samples.filter((sample) => sample.health === 'healthy').length;
  const checks: RuntimeSoakEvidenceSummary['qualityGate']['checks'] = [
    createCheck('positive-runtime-progress', completedJobs.length > 0 && eventSequenceDelta > 0, {
      completedQueueJobCount: completedJobs.length,
      eventSequenceDelta,
    }),
    createCheck('healthy-samples', healthySamples === samples.length, {
      healthySampleCount: healthySamples,
      sampleCount: samples.length,
    }),
    createCheck('ready-queue-depth', maximumReadyQueueDepth <= policy.maximumReadyQueueDepth, {
      maximumReadyQueueDepth,
      permittedMaximumReadyQueueDepth: policy.maximumReadyQueueDepth,
    }),
    createCheck('no-dead-letter-growth', deadLetterDelta === 0, { deadLetterDelta }),
    createCheck('failed-attempt-ratio', failedAttemptRatio <= policy.maximumFailedAttemptRatio, {
      failedAttemptRatio,
      permittedMaximumFailedAttemptRatio: policy.maximumFailedAttemptRatio,
    }),
    createCheck('sample-continuity', maximumSampleGapMs <= policy.maximumSampleGapMs, {
      maximumSampleGapMs,
      permittedMaximumSampleGapMs: policy.maximumSampleGapMs,
    }),
  ];
  return {
    durationMs,
    sampleCount: samples.length,
    maximumSampleGapMs,
    throughput: {
      completedQueueJobCount: completedJobs.length,
      completedRequestedWorldCycleCount,
      completedPartitionCycleCount,
      eventSequenceDelta,
      completedQueueJobsPerSecond: perSecond(completedJobs.length, durationSeconds),
      completedRequestedWorldCyclesPerSecond: perSecond(
        completedRequestedWorldCycleCount,
        durationSeconds,
      ),
      completedPartitionCyclesPerSecond: perSecond(completedPartitionCycleCount, durationSeconds),
      eventSequencesPerSecond: perSecond(eventSequenceDelta, durationSeconds),
    },
    latencyMs: {
      completedJobSampleCount: completedJobs.length,
      queueWait: summarizeDistribution(completedJobs.map((job) => job.startedAt - job.enqueuedAt)),
      execution: summarizeDistribution(completedJobs.map((job) => job.completedAt - job.startedAt)),
      endToEnd: summarizeDistribution(completedJobs.map((job) => job.completedAt - job.enqueuedAt)),
    },
    memory: {
      baselineRssBytes: first.processMemory.rssBytes,
      peakRssBytes: Math.max(...samples.map((sample) => sample.processMemory.rssBytes)),
      finalRssBytes: last.processMemory.rssBytes,
      rssGrowthBytes: last.processMemory.rssBytes - first.processMemory.rssBytes,
      baselineHeapUsedBytes: first.processMemory.heapUsedBytes,
      peakHeapUsedBytes: Math.max(...samples.map((sample) => sample.processMemory.heapUsedBytes)),
      finalHeapUsedBytes: last.processMemory.heapUsedBytes,
      heapUsedGrowthBytes: last.processMemory.heapUsedBytes - first.processMemory.heapUsedBytes,
    },
    queue: {
      maximumReadyQueueDepth,
      p95ReadyQueueDepth: percentile(
        samples.map((sample) => sample.queue.readyQueueDepth),
        0.95,
      )!,
      finalReadyQueueDepth: last.queue.readyQueueDepth,
      failedAttemptDelta,
      deadLetterDelta,
      replayDelta,
    },
    recovery: {
      attemptedRecoveryDelta:
        last.recovery.attemptedRecoveryCount - first.recovery.attemptedRecoveryCount,
      recoveredDelta: last.recovery.recoveredCount - first.recovery.recoveredCount,
    },
    failure: { denominator: failureDenominator, failedAttemptRatio },
    dataGrowth: {
      baselineRegularFileCount: first.storage.regularFileCount,
      finalRegularFileCount: last.storage.regularFileCount,
      regularFileCountDelta: last.storage.regularFileCount - first.storage.regularFileCount,
      baselineBytes: first.storage.totalBytes,
      finalBytes: last.storage.totalBytes,
      byteDelta: last.storage.totalBytes - first.storage.totalBytes,
      bytesPerSecond: perSecond(
        last.storage.totalBytes - first.storage.totalBytes,
        durationSeconds,
      ),
    },
    qualityGate: {
      status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
      checks,
    },
  };
}

function normalizeSamples(
  input: readonly RuntimeSoakEvidenceSample[],
  run: RuntimeSoakEvidenceArtifact['run'],
): RuntimeSoakEvidenceSample[] {
  if (input.length < 2) {
    throw new Error('runtime soak evidence requires at least two samples');
  }
  const samples = input.map((sample, index) => cloneAndValidateSample(sample, index));
  if (samples.some((sample) => sample.partitionProgress.length !== run.partitionCount)) {
    throw new Error('runtime soak sample partition count does not match run.partitionCount');
  }
  if (samples[0]?.observedAt !== run.startedAt) {
    throw new Error('first soak sample must match run.startedAt');
  }
  if (samples.at(-1)?.observedAt !== run.endedAt) {
    throw new Error('last soak sample must match run.endedAt');
  }
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    if (current.observedAt <= previous.observedAt) {
      throw new Error('runtime soak samples must be strictly ordered by observedAt');
    }
    assertCumulativeCounters(previous, current);
    assertPartitionProgress(previous.partitionProgress, current.partitionProgress);
  }
  return samples;
}

function normalizeCompletedJobs(
  input: readonly RuntimeSoakCompletedJobTiming[],
  run: RuntimeSoakEvidenceArtifact['run'],
): RuntimeSoakCompletedJobTiming[] {
  const seen = new Set<string>();
  return input
    .map((job) => {
      assertNonEmpty(job.jobId, 'completedJobs.jobId');
      for (const [field, value] of Object.entries({
        enqueuedAt: job.enqueuedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      })) {
        assertFiniteTimestamp(value, `completedJobs.${field}`);
      }
      assertPositiveInteger(job.requestedCycleCount, 'completedJobs.requestedCycleCount');
      assertPositiveInteger(job.attemptCount, 'completedJobs.attemptCount');
      assertNonNegativeInteger(job.failedAttemptCount, 'completedJobs.failedAttemptCount');
      if (job.enqueuedAt > job.startedAt || job.startedAt > job.completedAt) {
        throw new Error(`completed job timestamps are inconsistent for ${job.jobId}`);
      }
      if (job.completedAt < run.startedAt || job.completedAt > run.endedAt) {
        throw new Error(`completed job ${job.jobId} falls outside the soak observation window`);
      }
      if (seen.has(job.jobId)) {
        throw new Error(`duplicate completed job ${job.jobId}`);
      }
      seen.add(job.jobId);
      return { ...job };
    })
    .sort(
      (left, right) =>
        left.completedAt - right.completedAt || left.jobId.localeCompare(right.jobId),
    );
}

function cloneAndValidateSample(
  sample: RuntimeSoakEvidenceSample,
  index: number,
): RuntimeSoakEvidenceSample {
  assertFiniteTimestamp(sample.observedAt, `samples[${index}].observedAt`);
  if (!['healthy', 'degraded', 'attention'].includes(sample.health)) {
    throw new Error(`samples[${index}].health is invalid`);
  }
  assertNonNegativeInteger(
    sample.attentionPartitionCount,
    `samples[${index}].attentionPartitionCount`,
  );
  const partitionProgress = sample.partitionProgress
    .map((partition) => {
      assertNonEmpty(partition.simulationId, 'partitionProgress.simulationId');
      assertNonEmpty(partition.partitionKey, 'partitionProgress.partitionKey');
      assertNonNegativeInteger(partition.lastAppliedSequence, 'lastAppliedSequence');
      if (partition.nextTickIndex !== undefined) {
        assertNonNegativeInteger(partition.nextTickIndex, 'nextTickIndex');
      }
      return { ...partition };
    })
    .sort(comparePartitionProgress);
  assertUniquePartitionProgress(partitionProgress);
  for (const [field, value] of Object.entries(sample.queue)) {
    assertNonNegativeInteger(value, `samples[${index}].queue.${field}`);
  }
  for (const [field, value] of Object.entries(sample.recovery)) {
    assertNonNegativeInteger(value, `samples[${index}].recovery.${field}`);
  }
  for (const [field, value] of Object.entries(sample.processMemory)) {
    assertNonNegativeInteger(value, `samples[${index}].processMemory.${field}`);
  }
  for (const [field, value] of Object.entries(sample.storage)) {
    assertNonNegativeInteger(value, `samples[${index}].storage.${field}`);
  }
  return {
    observedAt: sample.observedAt,
    health: sample.health,
    attentionPartitionCount: sample.attentionPartitionCount,
    partitionProgress,
    queue: { ...sample.queue },
    recovery: { ...sample.recovery },
    processMemory: { ...sample.processMemory },
    storage: { ...sample.storage },
  };
}

function validateRun(run: RuntimeSoakEvidenceArtifact['run']): void {
  assertNonEmpty(run.soakRunId, 'run.soakRunId');
  if (!/^resolved-run-manifest:sha256:[a-f0-9]{64}$/u.test(run.runManifestId)) {
    throw new Error('run.runManifestId must be a content-addressed resolved run manifest ID');
  }
  assertNonEmpty(run.manifestId, 'run.manifestId');
  requireProfile(run.profileId);
  assertPositiveInteger(run.agentCount, 'run.agentCount');
  assertPositiveInteger(run.partitionCount, 'run.partitionCount');
  assertNonEmpty(run.sourceRevision.commit, 'run.sourceRevision.commit');
  if (typeof run.sourceRevision.dirty !== 'boolean') {
    throw new Error('run.sourceRevision.dirty must be a boolean');
  }
  if (run.sourceRevision.workspaceFingerprint !== undefined) {
    assertSourceWorkspaceFingerprint(
      run.sourceRevision.workspaceFingerprint,
      'run.sourceRevision.workspaceFingerprint',
    );
  }
  assertNonEmpty(run.seed, 'run.seed');
  if (run.cognitionMode !== 'deterministic' && run.cognitionMode !== 'provider') {
    throw new Error('run.cognitionMode must be deterministic or provider');
  }
  if (
    run.sourceKind !== 'canonical-runtime-process-observation' &&
    run.sourceKind !== 'synthetic-contract'
  ) {
    throw new Error('run.sourceKind is invalid');
  }
  assertNonEmpty(run.runtimeRootDir, 'run.runtimeRootDir');
  assertFiniteTimestamp(run.startedAt, 'run.startedAt');
  assertFiniteTimestamp(run.endedAt, 'run.endedAt');
  if (run.endedAt <= run.startedAt) {
    throw new Error('run.endedAt must be greater than run.startedAt');
  }
  assertNonEmpty(run.environment.platform, 'run.environment.platform');
  assertNonEmpty(run.environment.architecture, 'run.environment.architecture');
  assertNonEmpty(run.environment.osRelease, 'run.environment.osRelease');
  assertPositiveInteger(run.environment.logicalCpuCount, 'run.environment.logicalCpuCount');
  assertPositiveInteger(run.environment.totalMemoryBytes, 'run.environment.totalMemoryBytes');
  assertNonEmpty(run.environment.nodeVersion, 'run.environment.nodeVersion');
}

function assertCumulativeCounters(
  previous: RuntimeSoakEvidenceSample,
  current: RuntimeSoakEvidenceSample,
): void {
  const counters = [
    ['totalJobCount', previous.queue.totalJobCount, current.queue.totalJobCount],
    ['completedJobCount', previous.queue.completedJobCount, current.queue.completedJobCount],
    ['failedAttemptCount', previous.queue.failedAttemptCount, current.queue.failedAttemptCount],
    ['deadLetterCount', previous.queue.deadLetterCount, current.queue.deadLetterCount],
    ['replayCount', previous.queue.replayCount, current.queue.replayCount],
    [
      'attemptedRecoveryCount',
      previous.recovery.attemptedRecoveryCount,
      current.recovery.attemptedRecoveryCount,
    ],
    ['recoveredCount', previous.recovery.recoveredCount, current.recovery.recoveredCount],
  ] as const;
  for (const [field, before, after] of counters) {
    if (after < before) {
      throw new Error(`runtime soak cumulative counter ${field} regressed`);
    }
  }
}

function assertPartitionProgress(
  previous: readonly RuntimeSoakPartitionProgress[],
  current: readonly RuntimeSoakPartitionProgress[],
): void {
  if (previous.length !== current.length) {
    throw new Error('runtime soak partition set changed during the observation window');
  }
  for (let index = 0; index < previous.length; index += 1) {
    const before = previous[index]!;
    const after = current[index]!;
    if (before.simulationId !== after.simulationId || before.partitionKey !== after.partitionKey) {
      throw new Error('runtime soak partition identity changed during the observation window');
    }
    if (after.lastAppliedSequence < before.lastAppliedSequence) {
      throw new Error(`partition ${after.partitionKey} lastAppliedSequence regressed`);
    }
    if (
      before.nextTickIndex !== undefined &&
      after.nextTickIndex !== undefined &&
      after.nextTickIndex < before.nextTickIndex
    ) {
      throw new Error(`partition ${after.partitionKey} nextTickIndex regressed`);
    }
  }
}

function classifyEvidence(input: {
  readonly sourceKind: RuntimeSoakEvidenceSourceKind;
  readonly observationProtocol: 'canonical' | 'noncanonical';
  readonly qualityGateStatus: 'pass' | 'fail';
}): RuntimeSoakEvidenceArtifact['evidenceClassification']['empiricalScaleClaimEligibility'] {
  if (input.sourceKind === 'synthetic-contract') {
    return 'not-eligible-synthetic-contract';
  }
  if (input.observationProtocol !== 'canonical') {
    return 'not-eligible-noncanonical-observation-window';
  }
  return input.qualityGateStatus === 'pass'
    ? 'eligible-single-process-backend-profile-evidence'
    : 'not-eligible-quality-gate-failure';
}

function createCheck(
  checkId: RuntimeSoakEvidenceSummary['qualityGate']['checks'][number]['checkId'],
  passed: boolean,
  measurement: Readonly<Record<string, number | string | boolean>>,
): RuntimeSoakEvidenceSummary['qualityGate']['checks'][number] {
  return { checkId, status: passed ? 'pass' : 'fail', measurement: { ...measurement } };
}

function summarizeDistribution(values: readonly number[]): RuntimeSoakDistributionSummary {
  if (values.length === 0) {
    return { minimum: null, p50: null, p95: null, maximum: null };
  }
  return {
    minimum: Math.min(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    maximum: Math.max(...values),
  };
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? null;
}

function perSecond(value: number, durationSeconds: number): number {
  return durationSeconds === 0 ? 0 : value / durationSeconds;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function sumBy<T>(values: readonly T[], select: (value: T) => number): number {
  return values.reduce((total, value) => total + select(value), 0);
}

function requireProfile(profileId: RuntimeSoakProfileId) {
  const profile = RUNTIME_SOAK_REQUIRED_PROFILES.find(
    (candidate) => candidate.profileId === profileId,
  );
  if (profile === undefined) {
    throw new Error(`unsupported runtime soak profile ${String(profileId)}`);
  }
  return profile;
}

function comparePartitionProgress(
  left: RuntimeSoakPartitionProgress,
  right: RuntimeSoakPartitionProgress,
): number {
  return (
    left.simulationId.localeCompare(right.simulationId) ||
    left.partitionKey.localeCompare(right.partitionKey)
  );
}

function assertUniquePartitionProgress(progress: readonly RuntimeSoakPartitionProgress[]): void {
  const keys = progress.map(
    (partition) => `${partition.simulationId}\u0000${partition.partitionKey}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error('runtime soak sample contains duplicate partition progress');
  }
}

function createArtifactId(artifact: Omit<RuntimeSoakEvidenceArtifact, 'artifactId'>): string {
  return `${ARTIFACT_ID_PREFIX}${sha256(stableStringify(artifact))}`;
}

function readArtifact(path: string): RuntimeSoakEvidenceArtifact {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as RuntimeSoakEvidenceArtifact;
  return validateRuntimeSoakEvidenceArtifact(parsed);
}

function cloneRun(run: RuntimeSoakEvidenceArtifact['run']): RuntimeSoakEvidenceArtifact['run'] {
  return JSON.parse(JSON.stringify(run)) as RuntimeSoakEvidenceArtifact['run'];
}

function cloneArtifact(artifact: RuntimeSoakEvidenceArtifact): RuntimeSoakEvidenceArtifact {
  return JSON.parse(JSON.stringify(artifact)) as RuntimeSoakEvidenceArtifact;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function atomicWrite(path: string, content: string): void {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporaryPath, path);
}

function requireFirst<T>(values: readonly T[], name: string): T {
  const value = values[0];
  if (value === undefined) {
    throw new Error(`${name} must not be empty`);
  }
  return value;
}

function requireLast<T>(values: readonly T[], name: string): T {
  const value = values.at(-1);
  if (value === undefined) {
    throw new Error(`${name} must not be empty`);
  }
  return value;
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertFiniteTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite timestamp`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}
