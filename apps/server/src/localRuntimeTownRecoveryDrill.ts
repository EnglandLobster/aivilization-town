import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectionCheckpoint } from '@aivilization/sim-core';
import type { LocalSimulationRuntimeRunQueueJob } from '@aivilization/worker';
import {
  createCanonicalLocalRuntimeTownServerInput,
  resolveLocalRuntimeTownCliConfig,
  type LocalRuntimeTownSourceRevision,
} from './localRuntimeTownCli';
import {
  createLocalRuntimeTownApi,
  type LocalRuntimeTownApi,
  type LocalRuntimeTownServerInput,
} from './localRuntimeTownServer';
import { stopLocalRuntimeTownOrchestration } from './localRuntimeTownOrchestration';
import {
  createLocalRuntimeTownDataCompatibilityPolicy,
  inspectLocalRuntimeTownDataCompatibility,
  registerLocalRuntimeTownDataCompatibility,
  type LocalRuntimeTownDataCompatibilityMarker,
  type LocalRuntimeTownDataCompatibilityPolicy,
} from './localRuntimeTownDataCompatibility';

export const LOCAL_RUNTIME_TOWN_RECOVERY_DRILL_SCHEMA_VERSION = 'local-runtime-recovery-drill-v1';

type RecoveryDrillCheckpointEvidence = {
  readonly lastAppliedSequence: number;
  readonly snapshotSequence: number;
  readonly snapshotUri: string;
  readonly projectionSha256: string;
  readonly simulationClockNow: number;
};

export type LocalRuntimeTownRecoveryDrillArtifactPayload = {
  readonly schemaVersion: typeof LOCAL_RUNTIME_TOWN_RECOVERY_DRILL_SCHEMA_VERSION;
  readonly status: 'pass';
  readonly startedAt: number;
  readonly completedAt: number;
  readonly sourceRevision: LocalRuntimeTownSourceRevision;
  readonly profileId: 'recovery-drill-25';
  readonly manifestId: string;
  readonly runManifestId: string;
  readonly dataCompatibility: {
    readonly policy: LocalRuntimeTownDataCompatibilityPolicy;
    readonly marker: LocalRuntimeTownDataCompatibilityMarker;
  };
  readonly checkpointRestore: {
    readonly beforeRestart: RecoveryDrillCheckpointEvidence;
    readonly restoredBeforeContinuation: RecoveryDrillCheckpointEvidence;
    readonly afterContinuation: RecoveryDrillCheckpointEvidence;
    readonly sameCheckpointReference: true;
    readonly sameProjectionHash: true;
    readonly advancedAfterRestart: true;
  };
  readonly deadLetterRecovery: {
    readonly jobId: string;
    readonly injectedStatus: 'dead-lettered';
    readonly recoveryStatus: 'recovered';
    readonly replayedJobCount: 1;
    readonly finalStatus: 'completed';
    readonly replayCount: 1;
    readonly attemptCount: 2;
  };
};

export type LocalRuntimeTownRecoveryDrillArtifact = LocalRuntimeTownRecoveryDrillArtifactPayload & {
  readonly artifactId: string;
  readonly artifactPath: string;
};

export async function runLocalRuntimeTownRecoveryDrill(input: {
  readonly rootDir: string;
  readonly sourceRevision: LocalRuntimeTownSourceRevision;
  readonly clock?: { readonly now: () => number };
}): Promise<LocalRuntimeTownRecoveryDrillArtifact> {
  const clock = input.clock ?? { now: () => Date.now() };
  const startedAt = clock.now();
  assertTimestamp(startedAt, 'startedAt');
  const drillInstanceId = `recovery-drill-${Math.trunc(startedAt)}`;
  const compatibilityInspection = inspectLocalRuntimeTownDataCompatibility({
    rootDir: input.rootDir,
  });
  const config = resolveLocalRuntimeTownCliConfig({
    argv: [
      '--llm-mode',
      'deterministic',
      '--profile',
      'recovery-drill-25',
      '--root-dir',
      input.rootDir,
      '--port',
      '0',
    ],
    env: {},
    cwd: process.cwd(),
    sourceRevision: input.sourceRevision,
  });
  const firstRuntime = await createDrillRuntime(config);
  let beforeRestart: RecoveryDrillCheckpointEvidence;
  try {
    registerLocalRuntimeTownDataCompatibility({
      rootDir: input.rootDir,
      sourceRevision: input.sourceRevision,
      registeredAt: startedAt,
      hadUnversionedData: compatibilityInspection.hadUnversionedData,
    });
    const firstRun = await firstRuntime.supervisor.runCycles({
      operationId: `${drillInstanceId}:before-restart`,
      requestedAt: startedAt,
      cycleCount: 1,
    });
    requireSuccessfulRun(firstRun.outcome, 'pre-restart cycle');
    beforeRestart = await captureCheckpointEvidence(firstRuntime);
  } finally {
    stopLocalRuntimeTownOrchestration(firstRuntime.runtimeOrchestration);
  }

  const reopenedCompatibility = inspectLocalRuntimeTownDataCompatibility({
    rootDir: input.rootDir,
  });
  if (reopenedCompatibility.marker === undefined) {
    throw new Error('data compatibility marker disappeared before restart');
  }
  const secondRuntime = await createDrillRuntime(config);
  try {
    const restoredBeforeContinuation = await captureCheckpointEvidence(secondRuntime);
    const sameCheckpointReference = checkpointsMatch(beforeRestart, restoredBeforeContinuation);
    const sameProjectionHash =
      beforeRestart.projectionSha256 === restoredBeforeContinuation.projectionSha256;
    if (!sameCheckpointReference || !sameProjectionHash) {
      throw new Error('checkpoint restore did not reproduce the pre-restart projection');
    }

    const continuationRequestedAt = Math.max(startedAt + 1, clock.now());
    const continuation = await secondRuntime.supervisor.runCycles({
      operationId: `${drillInstanceId}:after-restart`,
      requestedAt: continuationRequestedAt,
      cycleCount: 1,
    });
    requireSuccessfulRun(continuation.outcome, 'post-restart continuation cycle');
    const afterContinuation = await captureCheckpointEvidence(secondRuntime);
    const advancedAfterRestart =
      afterContinuation.lastAppliedSequence > restoredBeforeContinuation.lastAppliedSequence &&
      afterContinuation.simulationClockNow > restoredBeforeContinuation.simulationClockNow;
    if (!advancedAfterRestart) {
      throw new Error('checkpoint did not advance after restart continuation');
    }

    const deadLetterEvidence = await injectAndRecoverDeadLetter({
      runtime: secondRuntime,
      injectedAt: Math.max(continuationRequestedAt + 1, clock.now()),
      drillInstanceId,
    });
    const completedAt = Math.max(startedAt, clock.now());
    const payload: LocalRuntimeTownRecoveryDrillArtifactPayload = {
      schemaVersion: LOCAL_RUNTIME_TOWN_RECOVERY_DRILL_SCHEMA_VERSION,
      status: 'pass',
      startedAt,
      completedAt,
      sourceRevision: { ...input.sourceRevision },
      profileId: 'recovery-drill-25',
      manifestId: secondRuntime.host.manifestId,
      runManifestId: configToRunManifestId(secondRuntime),
      dataCompatibility: {
        policy: createLocalRuntimeTownDataCompatibilityPolicy(),
        marker: reopenedCompatibility.marker,
      },
      checkpointRestore: {
        beforeRestart,
        restoredBeforeContinuation,
        afterContinuation,
        sameCheckpointReference: true,
        sameProjectionHash: true,
        advancedAfterRestart: true,
      },
      deadLetterRecovery: deadLetterEvidence,
    };
    return persistArtifact(input.rootDir, payload);
  } finally {
    stopLocalRuntimeTownOrchestration(secondRuntime.runtimeOrchestration);
  }
}

async function createDrillRuntime(
  config: Parameters<typeof createCanonicalLocalRuntimeTownServerInput>[0],
): Promise<LocalRuntimeTownApi> {
  const input = createCanonicalLocalRuntimeTownServerInput(config);
  return createLocalRuntimeTownApi(disableAutomaticHosts(input));
}

function disableAutomaticHosts(input: LocalRuntimeTownServerInput): LocalRuntimeTownServerInput {
  if (
    input.runtimeRunQueue === undefined ||
    input.runtimeScheduler === undefined ||
    input.runtimeRecovery === undefined
  ) {
    throw new Error('recovery drill requires queue, scheduler, and recovery configuration');
  }
  return {
    ...input,
    runtimeRunQueue: { ...input.runtimeRunQueue, autoStart: false },
    runtimeScheduler: { ...input.runtimeScheduler, autoStart: false },
    runtimeRecovery: { ...input.runtimeRecovery, autoStart: false },
  };
}

async function captureCheckpointEvidence(
  runtime: LocalRuntimeTownApi,
): Promise<RecoveryDrillCheckpointEvidence> {
  const partitions = runtime.host.registry.listPartitions();
  if (partitions.length !== 1) {
    throw new Error(`recovery drill requires exactly one partition, received ${partitions.length}`);
  }
  const partition = partitions[0];
  if (partition === undefined) {
    throw new Error('recovery drill partition is missing');
  }
  const backend = runtime.host.registry.getBackend(partition);
  const checkpoint = backend.storage.checkpointStore.getLatestCheckpoint(backend.storage.partition);
  if (checkpoint?.snapshot === undefined) {
    throw new Error('recovery drill requires a checkpoint-backed projection snapshot');
  }
  const projection = await backend.projectionQueries.getProjection(partition);
  return createCheckpointEvidence(checkpoint, projection.projection);
}

function createCheckpointEvidence(
  checkpoint: ProjectionCheckpoint,
  projection: unknown,
): RecoveryDrillCheckpointEvidence {
  if (checkpoint.snapshot === undefined) {
    throw new Error('checkpoint snapshot reference is missing');
  }
  const projectionRecord = projection as { readonly clock?: { readonly now?: unknown } };
  if (typeof projectionRecord.clock?.now !== 'number') {
    throw new Error('projection clock is missing from checkpoint evidence');
  }
  return {
    lastAppliedSequence: checkpoint.lastAppliedSequence,
    snapshotSequence: checkpoint.snapshot.sequence,
    snapshotUri: checkpoint.snapshot.uri,
    projectionSha256: createHash('sha256').update(stableStringify(projection)).digest('hex'),
    simulationClockNow: projectionRecord.clock.now,
  };
}

function checkpointsMatch(
  left: RecoveryDrillCheckpointEvidence,
  right: RecoveryDrillCheckpointEvidence,
): boolean {
  return (
    left.lastAppliedSequence === right.lastAppliedSequence &&
    left.snapshotSequence === right.snapshotSequence &&
    left.snapshotUri === right.snapshotUri &&
    left.simulationClockNow === right.simulationClockNow
  );
}

async function injectAndRecoverDeadLetter(input: {
  readonly runtime: LocalRuntimeTownApi;
  readonly injectedAt: number;
  readonly drillInstanceId: string;
}): Promise<LocalRuntimeTownRecoveryDrillArtifactPayload['deadLetterRecovery']> {
  const repository = input.runtime.runtimeOrchestration.runQueueRepository;
  const jobId = `${input.drillInstanceId}:injected-dead-letter`;
  await repository.enqueue({
    jobId,
    manifestId: input.runtime.host.manifestId,
    enqueuedAt: input.injectedAt,
    runRequest: {
      operationId: `${input.drillInstanceId}:dead-letter-replay`,
      requestedAt: input.injectedAt,
      cycleCount: 1,
    },
  });
  const claimed = await repository.claimNext({
    workerId: 'recovery-drill-fault-injector',
    claimedAt: input.injectedAt,
    leaseDurationMs: 60_000,
    manifestId: input.runtime.host.manifestId,
  });
  if (claimed?.jobId !== jobId) {
    throw new Error('recovery drill could not claim the injected queue job');
  }
  const deadLettered = await repository.fail({
    jobId,
    workerId: 'recovery-drill-fault-injector',
    attemptNumber: 1,
    failedAt: input.injectedAt + 1,
    maxAttempts: 1,
    error: { name: 'InjectedRecoveryDrillFailure', message: 'intentional dead-letter drill' },
  });
  requireJobStatus(deadLettered, 'dead-lettered', 'fault injection');
  const recoveryHost = input.runtime.runQueueRecoveryHost;
  if (recoveryHost === undefined) {
    throw new Error('recovery drill requires a recovery host');
  }
  const recovery = await recoveryHost.runOnce();
  if (recovery.status !== 'recovered' || recovery.replayedDeadLetterJobs.length !== 1) {
    throw new Error('recovery host did not replay exactly one injected dead letter');
  }
  const completed = await repository.get(jobId);
  requireJobStatus(completed, 'completed', 'dead-letter replay');
  if ((completed.replayCount ?? 0) !== 1 || (completed.attemptCount ?? 0) !== 2) {
    throw new Error('dead-letter replay did not preserve one replay and two-attempt provenance');
  }
  return {
    jobId,
    injectedStatus: 'dead-lettered',
    recoveryStatus: 'recovered',
    replayedJobCount: 1,
    finalStatus: 'completed',
    replayCount: 1,
    attemptCount: 2,
  };
}

function requireJobStatus<TStatus extends LocalSimulationRuntimeRunQueueJob['status']>(
  job: LocalSimulationRuntimeRunQueueJob | undefined,
  status: TStatus,
  stage: string,
): asserts job is LocalSimulationRuntimeRunQueueJob & { readonly status: TStatus } {
  if (job?.status !== status) {
    throw new Error(
      `${stage} expected queue status ${status}, received ${job?.status ?? 'missing'}`,
    );
  }
}

function requireSuccessfulRun(outcome: string, stage: string): void {
  if (outcome !== 'succeeded') {
    throw new Error(`${stage} failed with outcome ${outcome}`);
  }
}

function configToRunManifestId(runtime: LocalRuntimeTownApi): string {
  const runManifestId = runtime.runtimeOrchestration.runManifestId;
  if (runManifestId === undefined) {
    throw new Error('recovery drill requires a resolved run manifest');
  }
  return runManifestId;
}

function persistArtifact(
  rootDir: string,
  payload: LocalRuntimeTownRecoveryDrillArtifactPayload,
): LocalRuntimeTownRecoveryDrillArtifact {
  const serializedPayload = stableStringify(payload);
  const artifactId = `recovery-drill:sha256:${createHash('sha256')
    .update(serializedPayload)
    .digest('hex')}`;
  const artifactDir = join(rootDir, 'operations', 'recovery-drills');
  const artifactPath = join(artifactDir, `${artifactId.replaceAll(':', '-')}.json`);
  mkdirSync(artifactDir, { recursive: true });
  const artifact = { ...payload, artifactId, artifactPath };
  const serializedArtifact = `${JSON.stringify(artifact, null, 2)}\n`;
  if (existsSync(artifactPath)) {
    if (readFileSync(artifactPath, 'utf8') !== serializedArtifact) {
      throw new Error(`recovery drill artifact collision: ${artifactPath}`);
    }
    return artifact;
  }
  writeFileSync(artifactPath, serializedArtifact, { encoding: 'utf8', flag: 'wx' });
  return artifact;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}
