import { createPlannerExperimentRunsFromRuntimeProfileReports } from '@aivilization/observability';
import type {
  ExperimentValidationReport,
  ExperimentValidationThresholds,
  PlannerExperimentRun,
  PriceCloseObservation,
  RuntimeProfileRunReportQuery,
  RuntimeProfileRunReportRepository,
} from '@aivilization/observability';
import type { WorldProjection } from '@aivilization/world';
import type { LocalWorldRuntimeStorage } from './localRuntimeStorage';
import { hydrateWorldProjectionFromEventStream } from './projectionHydration';
import {
  recordWorkerExperimentValidationReport,
  createPriceCloseObservationsFromOhlcBars,
  createPriceCloseObservationsFromTradePriceObservations,
  type WorkerExperimentValidationPriceBinning,
  type WorkerExperimentValidationTraceWindow,
} from './experimentValidationRunner';

export type LocalExperimentValidationEventWindow = {
  readonly afterSequence?: number;
  readonly toSequence?: number;
};

export type LocalExperimentValidationMarketObservationSource = {
  readonly commodityId?: string;
  readonly fromObservedAt?: number;
  readonly toObservedAt?: number;
  readonly fromIntervalStartedAt?: number;
  readonly toIntervalStartedAt?: number;
  readonly limit?: number;
};

export type LocalExperimentValidationPlannerRunSource = RuntimeProfileRunReportQuery & {
  readonly repository: RuntimeProfileRunReportRepository;
};

export type LocalExperimentValidationScheduleInput = {
  readonly storage: LocalWorldRuntimeStorage;
  readonly initialProjection: WorldProjection;
  readonly runId: string;
  readonly generatedAt: number;
  readonly source?: string;
  readonly eventWindow?: LocalExperimentValidationEventWindow;
  readonly marketObservationSource?: LocalExperimentValidationMarketObservationSource;
  readonly plannerRuns?: readonly PlannerExperimentRun[];
  readonly plannerRunSource?: LocalExperimentValidationPlannerRunSource;
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
  const priceSeries =
    input.marketObservationSource === undefined
      ? undefined
      : await createValidationPriceSeriesFromMarketObservationSource(input);
  const plannerRuns = await resolveValidationPlannerRuns(input);
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
    ...(priceSeries === undefined ? {} : { priceSeries }),
    plannerRuns,
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

async function resolveValidationPlannerRuns(
  input: LocalExperimentValidationScheduleInput,
): Promise<readonly PlannerExperimentRun[]> {
  if (input.plannerRuns !== undefined) {
    return input.plannerRuns;
  }
  if (input.plannerRunSource === undefined) {
    throw new Error('local validation schedule requires plannerRuns or plannerRunSource');
  }

  const plannerRuns = createPlannerExperimentRunsFromRuntimeProfileReports(
    await input.plannerRunSource.repository.query(
      createPlannerRunSourceQuery(input.plannerRunSource),
    ),
  );
  if (plannerRuns.length === 0) {
    throw new Error('plannerRunSource must resolve at least one planner experiment run');
  }
  return plannerRuns;
}

function createPlannerRunSourceQuery(
  source: LocalExperimentValidationPlannerRunSource,
): RuntimeProfileRunReportQuery {
  return {
    ...(source.runId === undefined ? {} : { runId: source.runId }),
    ...(source.profileId === undefined ? {} : { profileId: source.profileId }),
    ...(source.fromGeneratedAt === undefined ? {} : { fromGeneratedAt: source.fromGeneratedAt }),
    ...(source.toGeneratedAt === undefined ? {} : { toGeneratedAt: source.toGeneratedAt }),
    ...(source.limit === undefined ? {} : { limit: source.limit }),
  };
}

async function createValidationPriceSeriesFromMarketObservationSource(
  input: LocalExperimentValidationScheduleInput,
): Promise<PriceCloseObservation[]> {
  const source = input.marketObservationSource;
  if (source === undefined) {
    return [];
  }

  if (input.priceBinning !== undefined) {
    const bars = await input.storage.marketObservationRepository.queryOhlcBars({
      simulationId: input.storage.partition.simulationId,
      ...(source.commodityId === undefined ? {} : { commodityId: source.commodityId }),
      ...(source.fromIntervalStartedAt === undefined
        ? {}
        : { fromIntervalStartedAt: source.fromIntervalStartedAt }),
      ...(source.toIntervalStartedAt === undefined
        ? {}
        : { toIntervalStartedAt: source.toIntervalStartedAt }),
      ...(source.limit === undefined ? {} : { limit: source.limit }),
    });
    return createPriceCloseObservationsFromOhlcBars(bars);
  }

  const observations = await input.storage.marketObservationRepository.queryTrades({
    simulationId: input.storage.partition.simulationId,
    ...(source.commodityId === undefined ? {} : { commodityId: source.commodityId }),
    ...(source.fromObservedAt === undefined ? {} : { fromObservedAt: source.fromObservedAt }),
    ...(source.toObservedAt === undefined ? {} : { toObservedAt: source.toObservedAt }),
    ...(source.limit === undefined ? {} : { limit: source.limit }),
  });
  return createPriceCloseObservationsFromTradePriceObservations(observations);
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
