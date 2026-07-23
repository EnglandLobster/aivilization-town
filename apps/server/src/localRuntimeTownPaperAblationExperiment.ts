import { join } from 'node:path';
import {
  FilePaperPlannerAblationArtifactRepository,
  type PaperPlannerAblationRunArtifact,
} from '@aivilization/observability';
import {
  createWorkerPaperPlannerAblationRunArtifact,
  type LocalSimulationRuntimeSupervisorRunCyclesResult,
} from '@aivilization/worker';
import { createCanonicalLocalRuntimeTownServerInput } from './localRuntimeTownCli';
import type { LocalRuntimeTownCliConfig } from './localRuntimeTownCli';
import { createLocalRuntimeTownApi } from './localRuntimeTownServer';
import { stopLocalRuntimeTownOrchestration } from './localRuntimeTownOrchestration';

export type LocalRuntimeTownPaperAblationExperimentResult = {
  readonly run: LocalSimulationRuntimeSupervisorRunCyclesResult;
  readonly artifact: PaperPlannerAblationRunArtifact;
  readonly artifactRootDir: string;
};

export async function runLocalRuntimeTownPaperAblationExperiment(input: {
  readonly config: LocalRuntimeTownCliConfig;
  readonly cycleCount: number;
  readonly operationId?: string;
  readonly requestedAt?: number;
  readonly generatedAt?: number;
}): Promise<LocalRuntimeTownPaperAblationExperimentResult> {
  const taskId = input.config.paperAblationTaskId;
  if (taskId === undefined) {
    throw new Error('paper ablation experiment requires --paper-ablation-task');
  }
  if (input.config.profileId !== 'ablation-80') {
    throw new Error('paper ablation experiment requires profile ablation-80');
  }
  assertPositiveInteger(input.cycleCount, 'cycleCount');
  const requestedAt = input.requestedAt ?? 0;
  const generatedAt = input.generatedAt ?? Date.now();
  assertNonNegativeFinite(requestedAt, 'requestedAt');
  assertNonNegativeFinite(generatedAt, 'generatedAt');
  const operationId =
    input.operationId ??
    `paper-ablation:${taskId}:${input.config.plannerVariant}:${input.config.seed}`;
  assertNonEmpty(operationId, 'operationId');

  const canonicalInput = createCanonicalLocalRuntimeTownServerInput(input.config, requestedAt);
  const runManifest = canonicalInput.resolvedRunManifest;
  if (runManifest === undefined) {
    throw new Error('paper ablation experiment requires a resolved run manifest');
  }
  const runtime = await createLocalRuntimeTownApi({
    ...canonicalInput,
    ...(canonicalInput.runtimeRunQueue === undefined
      ? {}
      : { runtimeRunQueue: { ...canonicalInput.runtimeRunQueue, autoStart: false } }),
    ...(canonicalInput.runtimeScheduler === undefined
      ? {}
      : { runtimeScheduler: { ...canonicalInput.runtimeScheduler, autoStart: false } }),
    ...(canonicalInput.runtimeRecovery === undefined
      ? {}
      : { runtimeRecovery: { ...canonicalInput.runtimeRecovery, autoStart: false } }),
  });
  try {
    const backend = runtime.host.registry.getBackend({
      simulationId: 'aivilization-ablation-80',
      partitionKey: 'world-main',
    });
    const streamName = backend.storage.partition.eventStreamName;
    if (backend.storage.eventStore.getStreamVersion(streamName) !== 0) {
      throw new Error('paper ablation experiment requires a fresh durable root');
    }
    const run = await runtime.supervisor.runCycles({
      operationId,
      requestedAt,
      cycleCount: input.cycleCount,
      cycleIntervalMs: 1,
      stopOnAttention: false,
    });
    if (
      run.outcome !== 'succeeded' ||
      run.stopReason !== 'cycle-count-completed' ||
      run.completedCycleCount !== input.cycleCount
    ) {
      throw new Error(
        `paper ablation experiment did not complete: ${run.outcome}/${run.stopReason}/${run.completedCycleCount}`,
      );
    }
    const projection = await backend.projectionQueries.getProjection({
      simulationId: 'aivilization-ablation-80',
      partitionKey: 'world-main',
    });
    const events = backend.storage.eventStore.readStream(streamName);
    const traces = await backend.storage.agentCycleTraceRepository.query({
      simulationId: 'aivilization-ablation-80',
    });
    const artifact = createWorkerPaperPlannerAblationRunArtifact({
      run: {
        runId: operationId,
        simulationId: 'aivilization-ablation-80',
        runManifestId: runManifest.runManifestId,
        sourceRevision: { ...input.config.sourceRevision },
        seed: input.config.seed,
        taskId,
        variant: input.config.plannerVariant,
        experimentStartedAt: canonicalInput.scenarioPresets[0]?.clock.now ?? 0,
        experimentEndedAt: projection.projection.clock.now,
        completedCycleCount: run.completedCycleCount,
        generatedAt,
      },
      finalProjection: projection.projection,
      events,
      agentCycleTraces: traces,
    });
    const artifactRootDir = join(input.config.rootDir, 'artifacts');
    const repository = new FilePaperPlannerAblationArtifactRepository({
      rootDir: artifactRootDir,
    });
    await repository.saveRun(artifact);
    return { run, artifact, artifactRootDir };
  } finally {
    stopLocalRuntimeTownOrchestration(runtime.runtimeOrchestration);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
