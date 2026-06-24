import type {
  ExperimentValidationReport,
  ExperimentValidationThresholds,
  PlannerExperimentRun,
} from '@aivilization/observability';
import type { WorldProjection } from '@aivilization/world';
import type { LocalWorldRuntimeStorage } from './localRuntimeStorage';
import { hydrateWorldProjectionFromEventStream } from './projectionHydration';
import {
  recordWorkerExperimentValidationReport,
  type WorkerExperimentValidationPriceBinning,
  type WorkerExperimentValidationTraceWindow,
} from './experimentValidationRunner';

export type LocalExperimentValidationEventWindow = {
  readonly afterSequence?: number;
  readonly toSequence?: number;
};

export type LocalExperimentValidationScheduleInput = {
  readonly storage: LocalWorldRuntimeStorage;
  readonly initialProjection: WorldProjection;
  readonly runId: string;
  readonly generatedAt: number;
  readonly source?: string;
  readonly eventWindow?: LocalExperimentValidationEventWindow;
  readonly plannerRuns: readonly PlannerExperimentRun[];
  readonly priceBinning?: WorkerExperimentValidationPriceBinning;
  readonly expectedTrajectoryAgentIds?: readonly string[];
  readonly trajectories?: readonly { readonly agentId: string; readonly stepCount: number }[];
  readonly traceWindow?: WorkerExperimentValidationTraceWindow;
  readonly thresholds?: ExperimentValidationThresholds;
};

export type LocalExperimentValidationScheduleResult = {
  readonly report: ExperimentValidationReport;
  readonly streamName: string;
  readonly streamVersion: number;
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly eventCount: number;
  readonly projectionSequence: number;
};

export async function runLocalExperimentValidationSchedule(
  input: LocalExperimentValidationScheduleInput,
): Promise<LocalExperimentValidationScheduleResult> {
  assertNonEmpty(input.runId, 'runId');
  assertFinite(input.generatedAt, 'generatedAt');

  const streamName = input.storage.partition.eventStreamName;
  const streamVersion = input.storage.eventStore.getStreamVersion(streamName);
  const window = resolveEventWindow(input.eventWindow, streamVersion);
  const hydrated = hydrateWorldProjectionFromEventStream({
    initialProjection: input.initialProjection,
    eventStore: input.storage.eventStore,
    streamName,
    toSequence: window.toSequence,
    checkpoint: {
      checkpointStore: input.storage.checkpointStore,
      snapshotStore: input.storage.snapshotStore,
      lookup: {
        simulationId: input.storage.partition.simulationId,
        partitionKey: input.storage.partition.partitionKey,
      },
    },
  });
  const events = input.storage.eventStore
    .readStream(streamName, { afterSequence: window.afterSequence })
    .filter((event) => event.sequence <= window.toSequence);
  const report = await recordWorkerExperimentValidationReport({
    repository: input.storage.experimentValidationReportRepository,
    run: {
      runId: input.runId,
      simulationId: input.storage.partition.simulationId,
      generatedAt: input.generatedAt,
      source: input.source ?? 'local-validation-schedule',
    },
    projection: hydrated.projection,
    events,
    plannerRuns: input.plannerRuns,
    agentCycleTraceRepository: input.storage.agentCycleTraceRepository,
    ...(input.priceBinning === undefined ? {} : { priceBinning: input.priceBinning }),
    ...(input.expectedTrajectoryAgentIds === undefined
      ? {}
      : { expectedTrajectoryAgentIds: input.expectedTrajectoryAgentIds }),
    ...(input.trajectories === undefined ? {} : { trajectories: input.trajectories }),
    ...(input.traceWindow === undefined ? {} : { traceWindow: input.traceWindow }),
    ...(input.thresholds === undefined ? {} : { thresholds: input.thresholds }),
  });

  return {
    report,
    streamName,
    streamVersion,
    fromSequence: window.afterSequence,
    toSequence: window.toSequence,
    eventCount: events.length,
    projectionSequence: hydrated.lastAppliedSequence,
  };
}

function resolveEventWindow(
  window: LocalExperimentValidationEventWindow | undefined,
  streamVersion: number,
): { readonly afterSequence: number; readonly toSequence: number } {
  const afterSequence = window?.afterSequence ?? 0;
  const toSequence = window?.toSequence ?? streamVersion;
  assertNonNegativeInteger(afterSequence, 'eventWindow afterSequence');
  assertNonNegativeInteger(toSequence, 'eventWindow toSequence');
  if (toSequence < afterSequence) {
    throw new Error('eventWindow toSequence must be greater than or equal to afterSequence');
  }
  if (toSequence > streamVersion) {
    throw new Error(
      `eventWindow toSequence ${toSequence} must not exceed stream version ${streamVersion}`,
    );
  }
  return { afterSequence, toSequence };
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
