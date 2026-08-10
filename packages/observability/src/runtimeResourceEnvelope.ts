import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceRevisionsEqual } from '@aivilization/sim-core';
import {
  RUNTIME_SOAK_REQUIRED_PROFILES,
  validateRuntimeSoakEvidenceArtifact,
  type RuntimeSoakEvidenceArtifact,
  type RuntimeSoakEvidenceSample,
  type RuntimeSoakProfileId,
} from './runtimeSoakEvidence';

export const RUNTIME_RESOURCE_ENVELOPE_POLICY_VERSION = 'runtime-resource-envelope-v2';
export const RUNTIME_RESOURCE_ENVELOPE_ASSESSMENT_SCHEMA_VERSION =
  'runtime-resource-envelope-assessment-v1';

const GIBIBYTE = 1_024 ** 3;
const MINUTE_MS = 60_000;
const ASSESSMENT_ID_PREFIX = 'runtime-resource-envelope-assessment:sha256:';
const MANIFEST_FILENAME = 'artifact.json';

export type RuntimeResourceEnvelopePolicy = ReturnType<
  typeof createRuntimeResourceEnvelopePolicyManifest
>;

export type RuntimeResourceEnvelopeCheckId =
  | 'eligible-source-artifact'
  | 'observation-host-capacity'
  | 'late-window-sample-count'
  | 'peak-rss-budget'
  | 'projected-rss-budget'
  | 'projected-heap-budget'
  | 'projected-storage-budget';

export type RuntimeResourceEnvelopeProfileAssessment = {
  readonly profileId: RuntimeSoakProfileId;
  readonly sourceArtifactId: string;
  readonly sourceEligibility: RuntimeSoakEvidenceArtifact['evidenceClassification']['empiricalScaleClaimEligibility'];
  readonly observationEnvironment: RuntimeSoakEvidenceArtifact['run']['environment'];
  readonly lateWindow: {
    readonly fraction: number;
    readonly startedAt: number;
    readonly sampleCount: number;
    readonly rssSlopeBytesPerMinute: number;
    readonly heapUsedSlopeBytesPerMinute: number;
    readonly storageSlopeBytesPerMinute: number;
  };
  readonly measurements: {
    readonly peakRssBytes: number;
    readonly finalRssBytes: number;
    readonly projectedRssBytes: number;
    readonly finalHeapUsedBytes: number;
    readonly projectedHeapUsedBytes: number;
    readonly finalStorageBytes: number;
    readonly allWindowStorageGrowthBytesPerMinute: number;
    readonly conservativeStorageGrowthBytesPerMinute: number;
    readonly projectedStorageBytes: number;
  };
  readonly checks: readonly {
    readonly checkId: RuntimeResourceEnvelopeCheckId;
    readonly status: 'pass' | 'fail';
    readonly measurement: Readonly<Record<string, number | string | boolean>>;
  }[];
  readonly status: 'pass' | 'fail';
};

export type RuntimeResourceEnvelopeAssessmentArtifact = {
  readonly schemaVersion: typeof RUNTIME_RESOURCE_ENVELOPE_ASSESSMENT_SCHEMA_VERSION;
  readonly artifactId: string;
  readonly policy: RuntimeResourceEnvelopePolicy;
  readonly sourceArtifactIds: readonly string[];
  readonly profiles: readonly RuntimeResourceEnvelopeProfileAssessment[];
  readonly status: 'pass' | 'fail';
  readonly evidenceClassification: {
    readonly source: 'repository-design-applied-to-immutable-runtime-observations';
    readonly scope: 'single-process-backend-runtime';
    readonly completeRequiredProfileMatrix: true;
    readonly withinReferenceResourceEnvelope: boolean;
    readonly resourceLimitEnforcementEstablished: false;
    readonly fullProviderCapacityEstablished: false;
    readonly paperDeploymentScaleEstablished: false;
  };
};

export function createRuntimeResourceEnvelopePolicyManifest() {
  const nodeMemoryCapacityBytes = 4 * GIBIBYTE;
  const durableStorageCapacityBytes = 25 * GIBIBYTE;
  return {
    policyVersion: RUNTIME_RESOURCE_ENVELOPE_POLICY_VERSION,
    source: 'repository-design' as const,
    paperDefinesResourceThresholds: false as const,
    referenceDeploymentClass: 'single-process-4vcpu-4gib-25gib-v1' as const,
    minimumLogicalCpuCount: 4,
    nodeMemoryCapacityBytes,
    runtimeMemoryReserveRatio: 0.25,
    runtimeMemoryBudgetBytes: nodeMemoryCapacityBytes * 0.75,
    durableStorageCapacityBytes,
    durableStorageReserveRatio: 0.25,
    durableStorageBudgetBytes: durableStorageCapacityBytes * 0.75,
    lateWindowFraction: 1 / 3,
    minimumLateWindowSampleCount: 30,
    memoryProjectionHorizonMs: 60 * MINUTE_MS,
    storageProjectionHorizonMs: 24 * 60 * MINUTE_MS,
    projectionRule:
      'final-value-plus-positive-least-squares-late-window-slope-times-forward-horizon' as const,
    memoryRateRule: 'positive-least-squares-final-third-slope-with-observed-peak-hard-cap' as const,
    storageRateRule:
      'maximum-of-zero-all-window-average-and-least-squares-late-window-slope' as const,
    claimBoundary: {
      scope: 'single-process-backend-runtime' as const,
      observationOnly: true as const,
      resourceLimitEnforcementEstablished: false as const,
      fullProviderCapacityEstablished: false as const,
      paperDeploymentScaleEstablished: false as const,
    },
  };
}

export function createRuntimeResourceEnvelopeAssessmentArtifact(
  sourceArtifacts: readonly RuntimeSoakEvidenceArtifact[],
): RuntimeResourceEnvelopeAssessmentArtifact {
  const validated = normalizeSourceArtifacts(sourceArtifacts);
  const policy = createRuntimeResourceEnvelopePolicyManifest();
  const profiles = validated.map((artifact) => assessProfile(artifact, policy));
  const withoutId: Omit<RuntimeResourceEnvelopeAssessmentArtifact, 'artifactId'> = {
    schemaVersion: RUNTIME_RESOURCE_ENVELOPE_ASSESSMENT_SCHEMA_VERSION,
    policy,
    sourceArtifactIds: profiles.map((profile) => profile.sourceArtifactId),
    profiles,
    status: profiles.every((profile) => profile.status === 'pass') ? 'pass' : 'fail',
    evidenceClassification: {
      source: 'repository-design-applied-to-immutable-runtime-observations',
      scope: 'single-process-backend-runtime',
      completeRequiredProfileMatrix: true,
      withinReferenceResourceEnvelope: profiles.every((profile) => profile.status === 'pass'),
      resourceLimitEnforcementEstablished: false,
      fullProviderCapacityEstablished: false,
      paperDeploymentScaleEstablished: false,
    },
  };
  return cloneAssessment({
    ...withoutId,
    artifactId: createAssessmentId(withoutId),
  });
}

export function validateRuntimeResourceEnvelopeAssessmentArtifact(
  artifact: RuntimeResourceEnvelopeAssessmentArtifact,
  sourceArtifacts: readonly RuntimeSoakEvidenceArtifact[],
): RuntimeResourceEnvelopeAssessmentArtifact {
  if (artifact.schemaVersion !== RUNTIME_RESOURCE_ENVELOPE_ASSESSMENT_SCHEMA_VERSION) {
    throw new Error('unsupported runtime resource envelope assessment schema');
  }
  if (!/^runtime-resource-envelope-assessment:sha256:[a-f0-9]{64}$/u.test(artifact.artifactId)) {
    throw new Error('runtime resource envelope assessment artifactId must be content-addressed');
  }
  const { artifactId, ...withoutId } = artifact;
  if (createAssessmentId(withoutId) !== artifactId) {
    throw new Error(`runtime resource envelope assessment content mismatch for ${artifactId}`);
  }
  const rebuilt = createRuntimeResourceEnvelopeAssessmentArtifact(sourceArtifacts);
  if (stableStringify(rebuilt) !== stableStringify(artifact)) {
    throw new Error(
      `runtime resource envelope assessment content mismatch for ${artifact.artifactId}`,
    );
  }
  return cloneAssessment(artifact);
}

export class FileRuntimeResourceEnvelopeAssessmentRepository {
  private readonly artifactsDir: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.artifactsDir = join(input.rootDir, 'runtime-resource-envelope-assessments');
    mkdirSync(this.artifactsDir, { recursive: true });
  }

  save(
    artifact: RuntimeResourceEnvelopeAssessmentArtifact,
  ): RuntimeResourceEnvelopeAssessmentArtifact {
    assertAssessmentSelfIntegrity(artifact);
    const path = this.resolveArtifactPath(artifact.artifactId);
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
    if (existsSync(path)) {
      const existing = readAssessment(path);
      if (stableStringify(existing) !== stableStringify(artifact)) {
        throw new Error(
          `runtime resource envelope assessment collision for ${artifact.artifactId}`,
        );
      }
      return existing;
    }
    mkdirSync(join(this.artifactsDir, encodeURIComponent(artifact.artifactId)), {
      recursive: true,
    });
    atomicWrite(path, serialized);
    return cloneAssessment(artifact);
  }

  get(artifactId: string): RuntimeResourceEnvelopeAssessmentArtifact | undefined {
    const path = this.resolveArtifactPath(artifactId);
    return existsSync(path) ? readAssessment(path) : undefined;
  }

  private resolveArtifactPath(artifactId: string): string {
    if (!/^runtime-resource-envelope-assessment:sha256:[a-f0-9]{64}$/u.test(artifactId)) {
      throw new Error('runtime resource envelope assessment artifactId must be content-addressed');
    }
    return join(this.artifactsDir, encodeURIComponent(artifactId), MANIFEST_FILENAME);
  }
}

function assessProfile(
  artifact: RuntimeSoakEvidenceArtifact,
  policy: RuntimeResourceEnvelopePolicy,
): RuntimeResourceEnvelopeProfileAssessment {
  const lateWindowStartedAt =
    artifact.run.endedAt -
    (artifact.run.endedAt - artifact.run.startedAt) * policy.lateWindowFraction;
  const lateSamples = artifact.samples.filter((sample) => sample.observedAt >= lateWindowStartedAt);
  const rssSlopeBytesPerMinute = leastSquaresSlopeBytesPerMinute(
    lateSamples,
    (sample) => sample.processMemory.rssBytes,
  );
  const heapUsedSlopeBytesPerMinute = leastSquaresSlopeBytesPerMinute(
    lateSamples,
    (sample) => sample.processMemory.heapUsedBytes,
  );
  const storageSlopeBytesPerMinute = leastSquaresSlopeBytesPerMinute(
    lateSamples,
    (sample) => sample.storage.totalBytes,
  );
  const allWindowStorageGrowthBytesPerMinute = artifact.summary.dataGrowth.bytesPerSecond * 60;
  const conservativeStorageGrowthBytesPerMinute = Math.max(
    0,
    allWindowStorageGrowthBytesPerMinute,
    storageSlopeBytesPerMinute,
  );
  const finalRssBytes = artifact.summary.memory.finalRssBytes;
  const finalHeapUsedBytes = artifact.summary.memory.finalHeapUsedBytes;
  const finalStorageBytes = artifact.summary.dataGrowth.finalBytes;
  const projectedRssBytes = projectForward(
    finalRssBytes,
    rssSlopeBytesPerMinute,
    policy.memoryProjectionHorizonMs,
  );
  const projectedHeapUsedBytes = projectForward(
    finalHeapUsedBytes,
    heapUsedSlopeBytesPerMinute,
    policy.memoryProjectionHorizonMs,
  );
  const projectedStorageBytes = projectForward(
    finalStorageBytes,
    conservativeStorageGrowthBytesPerMinute,
    policy.storageProjectionHorizonMs,
  );
  const checks: RuntimeResourceEnvelopeProfileAssessment['checks'] = [
    createCheck(
      'eligible-source-artifact',
      artifact.evidenceClassification.empiricalScaleClaimEligibility ===
        'eligible-single-process-backend-profile-evidence',
      { sourceEligibility: artifact.evidenceClassification.empiricalScaleClaimEligibility },
    ),
    createCheck(
      'observation-host-capacity',
      artifact.run.environment.logicalCpuCount >= policy.minimumLogicalCpuCount &&
        artifact.run.environment.totalMemoryBytes >= policy.nodeMemoryCapacityBytes,
      {
        observedLogicalCpuCount: artifact.run.environment.logicalCpuCount,
        requiredLogicalCpuCount: policy.minimumLogicalCpuCount,
        observedTotalMemoryBytes: artifact.run.environment.totalMemoryBytes,
        requiredTotalMemoryBytes: policy.nodeMemoryCapacityBytes,
      },
    ),
    createCheck(
      'late-window-sample-count',
      lateSamples.length >= policy.minimumLateWindowSampleCount,
      {
        lateWindowSampleCount: lateSamples.length,
        requiredMinimumLateWindowSampleCount: policy.minimumLateWindowSampleCount,
      },
    ),
    createCheck(
      'peak-rss-budget',
      artifact.summary.memory.peakRssBytes <= policy.runtimeMemoryBudgetBytes,
      {
        peakRssBytes: artifact.summary.memory.peakRssBytes,
        runtimeMemoryBudgetBytes: policy.runtimeMemoryBudgetBytes,
      },
    ),
    createCheck('projected-rss-budget', projectedRssBytes <= policy.runtimeMemoryBudgetBytes, {
      projectedRssBytes,
      runtimeMemoryBudgetBytes: policy.runtimeMemoryBudgetBytes,
    }),
    createCheck(
      'projected-heap-budget',
      projectedHeapUsedBytes <= policy.runtimeMemoryBudgetBytes,
      { projectedHeapUsedBytes, runtimeMemoryBudgetBytes: policy.runtimeMemoryBudgetBytes },
    ),
    createCheck(
      'projected-storage-budget',
      projectedStorageBytes <= policy.durableStorageBudgetBytes,
      { projectedStorageBytes, durableStorageBudgetBytes: policy.durableStorageBudgetBytes },
    ),
  ];
  return {
    profileId: artifact.run.profileId,
    sourceArtifactId: artifact.artifactId,
    sourceEligibility: artifact.evidenceClassification.empiricalScaleClaimEligibility,
    observationEnvironment: cloneEnvironment(artifact.run.environment),
    lateWindow: {
      fraction: policy.lateWindowFraction,
      startedAt: lateWindowStartedAt,
      sampleCount: lateSamples.length,
      rssSlopeBytesPerMinute,
      heapUsedSlopeBytesPerMinute,
      storageSlopeBytesPerMinute,
    },
    measurements: {
      peakRssBytes: artifact.summary.memory.peakRssBytes,
      finalRssBytes,
      projectedRssBytes,
      finalHeapUsedBytes,
      projectedHeapUsedBytes,
      finalStorageBytes,
      allWindowStorageGrowthBytesPerMinute,
      conservativeStorageGrowthBytesPerMinute,
      projectedStorageBytes,
    },
    checks,
    status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
  };
}

function normalizeSourceArtifacts(
  sourceArtifacts: readonly RuntimeSoakEvidenceArtifact[],
): RuntimeSoakEvidenceArtifact[] {
  if (sourceArtifacts.length !== RUNTIME_SOAK_REQUIRED_PROFILES.length) {
    throw new Error(
      'runtime resource envelope assessment requires the exact canonical profile matrix',
    );
  }
  const byProfile = new Map<RuntimeSoakProfileId, RuntimeSoakEvidenceArtifact>();
  for (const sourceArtifact of sourceArtifacts) {
    const artifact = validateRuntimeSoakEvidenceArtifact(sourceArtifact);
    if (byProfile.has(artifact.run.profileId)) {
      throw new Error(`duplicate runtime soak profile ${artifact.run.profileId}`);
    }
    byProfile.set(artifact.run.profileId, artifact);
  }
  const ordered = RUNTIME_SOAK_REQUIRED_PROFILES.map((required) => {
    const artifact = byProfile.get(required.profileId);
    if (artifact === undefined) {
      throw new Error(`missing runtime soak profile ${required.profileId}`);
    }
    return artifact;
  });
  const referenceRevision = ordered[0]!.run.sourceRevision;
  if (
    ordered.some(
      (artifact) => !sourceRevisionsEqual(artifact.run.sourceRevision, referenceRevision),
    )
  ) {
    throw new Error(
      'runtime resource envelope profile matrix must use one exact source revision and workspace fingerprint',
    );
  }
  return ordered;
}

function leastSquaresSlopeBytesPerMinute(
  samples: readonly RuntimeSoakEvidenceSample[],
  select: (sample: RuntimeSoakEvidenceSample) => number,
): number {
  if (samples.length < 2) {
    return 0;
  }
  const origin = samples[0]!.observedAt;
  const points = samples.map((sample) => ({
    x: (sample.observedAt - origin) / MINUTE_MS,
    y: select(sample),
  }));
  const meanX = points.reduce((total, point) => total + point.x, 0) / points.length;
  const meanY = points.reduce((total, point) => total + point.y, 0) / points.length;
  const numerator = points.reduce(
    (total, point) => total + (point.x - meanX) * (point.y - meanY),
    0,
  );
  const denominator = points.reduce((total, point) => total + (point.x - meanX) ** 2, 0);
  return denominator === 0 ? 0 : numerator / denominator;
}

function projectForward(value: number, slopeBytesPerMinute: number, horizonMs: number): number {
  return Math.ceil(value + Math.max(0, slopeBytesPerMinute) * (horizonMs / MINUTE_MS));
}

function createCheck(
  checkId: RuntimeResourceEnvelopeCheckId,
  passed: boolean,
  measurement: Readonly<Record<string, number | string | boolean>>,
): RuntimeResourceEnvelopeProfileAssessment['checks'][number] {
  return { checkId, status: passed ? 'pass' : 'fail', measurement: { ...measurement } };
}

function createAssessmentId(
  artifact: Omit<RuntimeResourceEnvelopeAssessmentArtifact, 'artifactId'>,
): string {
  return `${ASSESSMENT_ID_PREFIX}${sha256(stableStringify(artifact))}`;
}

function assertAssessmentSelfIntegrity(artifact: RuntimeResourceEnvelopeAssessmentArtifact): void {
  if (artifact.schemaVersion !== RUNTIME_RESOURCE_ENVELOPE_ASSESSMENT_SCHEMA_VERSION) {
    throw new Error('unsupported runtime resource envelope assessment schema');
  }
  if (!/^runtime-resource-envelope-assessment:sha256:[a-f0-9]{64}$/u.test(artifact.artifactId)) {
    throw new Error('runtime resource envelope assessment artifactId must be content-addressed');
  }
  const { artifactId, ...withoutId } = artifact;
  if (createAssessmentId(withoutId) !== artifactId) {
    throw new Error(`runtime resource envelope assessment content mismatch for ${artifactId}`);
  }
  if (
    stableStringify(artifact.policy) !==
    stableStringify(createRuntimeResourceEnvelopePolicyManifest())
  ) {
    throw new Error('runtime resource envelope assessment policy mismatch');
  }
  const expectedProfiles = RUNTIME_SOAK_REQUIRED_PROFILES.map((profile) => profile.profileId);
  if (
    artifact.profiles.length !== expectedProfiles.length ||
    artifact.profiles.some((profile, index) => profile.profileId !== expectedProfiles[index])
  ) {
    throw new Error('runtime resource envelope assessment profile matrix mismatch');
  }
  const expectedCheckIds: readonly RuntimeResourceEnvelopeCheckId[] = [
    'eligible-source-artifact',
    'observation-host-capacity',
    'late-window-sample-count',
    'peak-rss-budget',
    'projected-rss-budget',
    'projected-heap-budget',
    'projected-storage-budget',
  ];
  for (const profile of artifact.profiles) {
    if (!/^runtime-soak-evidence:sha256:[a-f0-9]{64}$/u.test(profile.sourceArtifactId)) {
      throw new Error('runtime resource envelope assessment sourceArtifactId is invalid');
    }
    if (
      profile.checks.length !== expectedCheckIds.length ||
      profile.checks.some((check, index) => check.checkId !== expectedCheckIds[index])
    ) {
      throw new Error(
        `runtime resource envelope assessment checks mismatch for ${profile.profileId}`,
      );
    }
    const expectedStatus = profile.checks.every((check) => check.status === 'pass')
      ? 'pass'
      : 'fail';
    if (profile.status !== expectedStatus) {
      throw new Error(
        `runtime resource envelope assessment status mismatch for ${profile.profileId}`,
      );
    }
  }
  if (
    artifact.sourceArtifactIds.length !== artifact.profiles.length ||
    artifact.sourceArtifactIds.some(
      (sourceArtifactId, index) => sourceArtifactId !== artifact.profiles[index]?.sourceArtifactId,
    )
  ) {
    throw new Error('runtime resource envelope assessment source matrix mismatch');
  }
  const expectedStatus = artifact.profiles.every((profile) => profile.status === 'pass')
    ? 'pass'
    : 'fail';
  if (
    artifact.status !== expectedStatus ||
    artifact.evidenceClassification.source !==
      'repository-design-applied-to-immutable-runtime-observations' ||
    artifact.evidenceClassification.scope !== 'single-process-backend-runtime' ||
    artifact.evidenceClassification.completeRequiredProfileMatrix !== true ||
    artifact.evidenceClassification.withinReferenceResourceEnvelope !==
      (expectedStatus === 'pass') ||
    artifact.evidenceClassification.resourceLimitEnforcementEstablished !== false ||
    artifact.evidenceClassification.fullProviderCapacityEstablished !== false ||
    artifact.evidenceClassification.paperDeploymentScaleEstablished !== false
  ) {
    throw new Error('runtime resource envelope assessment classification mismatch');
  }
}

function readAssessment(path: string): RuntimeResourceEnvelopeAssessmentArtifact {
  const artifact = JSON.parse(
    readFileSync(path, 'utf8'),
  ) as RuntimeResourceEnvelopeAssessmentArtifact;
  assertAssessmentSelfIntegrity(artifact);
  return cloneAssessment(artifact);
}

function atomicWrite(path: string, content: string): void {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporaryPath, path);
}

function cloneAssessment(
  artifact: RuntimeResourceEnvelopeAssessmentArtifact,
): RuntimeResourceEnvelopeAssessmentArtifact {
  return JSON.parse(JSON.stringify(artifact)) as RuntimeResourceEnvelopeAssessmentArtifact;
}

function cloneEnvironment(
  environment: RuntimeSoakEvidenceArtifact['run']['environment'],
): RuntimeSoakEvidenceArtifact['run']['environment'] {
  return { ...environment };
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

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
