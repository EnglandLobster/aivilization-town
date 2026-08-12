import {
  createPlannerExperimentRunsFromRuntimeProfileReports,
  evaluateExperimentValidationReportGate,
} from '@aivilization/observability';
import type {
  ExperimentValidationReport,
  ExperimentValidationReportGateCriteria,
  ExperimentValidationReportGateResult,
  ExperimentValidationThresholds,
  PlannerExperimentRun,
  PriceCloseObservation,
  RuntimeProfileRunReportQuery,
  RuntimeProfileRunReportRepository,
  SocialReflectionValidationObservation,
  SteeringValidationTrace,
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

export type LocalExperimentValidationSocialReflectionObservationSource = {
  readonly observationId?: string;
  readonly agentId?: string;
  readonly targetAgentId?: string;
  readonly fromGeneratedAt?: number;
  readonly toGeneratedAt?: number;
  readonly limit?: number;
};

export type LocalExperimentValidationSteeringTraceSource = {
  readonly traceId?: string;
  readonly commandId?: string;
  readonly agentId?: string;
  readonly objectiveId?: string;
  readonly reactiveCommandId?: string;
  readonly resultKind?: 'long-horizon-objective-set' | 'reactive-command-routed';
  readonly fromIssuedAt?: number;
  readonly toIssuedAt?: number;
  readonly limit?: number;
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
  readonly socialReflectionObservationSource?: LocalExperimentValidationSocialReflectionObservationSource;
  readonly steeringTraceSource?: LocalExperimentValidationSteeringTraceSource;
  readonly priceBinning?: WorkerExperimentValidationPriceBinning;
  readonly expectedTrajectoryAgentIds?: readonly string[];
  readonly trajectories?: readonly { readonly agentId: string; readonly stepCount: number }[];
  readonly traceWindow?: WorkerExperimentValidationTraceWindow;
  readonly thresholds?: ExperimentValidationThresholds;
  readonly reportGate?: ExperimentValidationReportGateCriteria;
};

export type LocalExperimentValidationScheduleResult = {
  readonly report: ExperimentValidationReport;
  readonly reportGate?: ExperimentValidationReportGateResult;
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
  const socialReflectionObservations =
    input.socialReflectionObservationSource === undefined
      ? undefined
      : await createValidationSocialReflectionObservationsFromSource(input);
  const steeringTraces =
    input.steeringTraceSource === undefined
      ? undefined
      : await createValidationSteeringTracesFromSource(input);
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
    ...(socialReflectionObservations === undefined ? {} : { socialReflectionObservations }),
    ...(steeringTraces === undefined ? {} : { steeringTraces }),
    agentCycleTraceRepository: input.storage.agentCycleTraceRepository,
    ...(input.priceBinning === undefined ? {} : { priceBinning: input.priceBinning }),
    ...(input.expectedTrajectoryAgentIds === undefined
      ? {}
      : { expectedTrajectoryAgentIds: input.expectedTrajectoryAgentIds }),
    ...(input.trajectories === undefined ? {} : { trajectories: input.trajectories }),
    ...(input.traceWindow === undefined ? {} : { traceWindow: input.traceWindow }),
    ...(input.thresholds === undefined ? {} : { thresholds: input.thresholds }),
  });
  const reportGate =
    input.reportGate === undefined
      ? undefined
      : evaluateExperimentValidationReportGate(report, input.reportGate);

  return {
    report,
    ...(reportGate === undefined ? {} : { reportGate }),
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

async function createValidationSocialReflectionObservationsFromSource(
  input: LocalExperimentValidationScheduleInput,
): Promise<SocialReflectionValidationObservation[]> {
  const source = input.socialReflectionObservationSource;
  if (source === undefined) {
    return [];
  }

  const observations = await input.storage.socialReflectionObservationRepository.query({
    simulationId: input.storage.partition.simulationId,
    partitionKey: input.storage.partition.partitionKey,
    ...(source.observationId === undefined ? {} : { observationId: source.observationId }),
    ...(source.agentId === undefined ? {} : { agentId: source.agentId }),
    ...(source.targetAgentId === undefined ? {} : { targetAgentId: source.targetAgentId }),
    ...(source.fromGeneratedAt === undefined ? {} : { fromGeneratedAt: source.fromGeneratedAt }),
    ...(source.toGeneratedAt === undefined ? {} : { toGeneratedAt: source.toGeneratedAt }),
    ...(source.limit === undefined ? {} : { limit: source.limit }),
  });

  return observations.map((observation) => ({
    observationId: observation.observationId,
    agentId: observation.agentId,
    targetAgentId: observation.targetAgentId,
    confidence: observation.confidence,
    evidenceRecordIds: [...observation.evidenceRecordIds],
    generatedAt: observation.generatedAt,
    tags: [...observation.tags],
  }));
}

async function createValidationSteeringTracesFromSource(
  input: LocalExperimentValidationScheduleInput,
): Promise<SteeringValidationTrace[]> {
  const source = input.steeringTraceSource;
  if (source === undefined) {
    return [];
  }

  const traces = await input.storage.steeringTraceRepository.query({
    simulationId: input.storage.partition.simulationId,
    partitionKey: input.storage.partition.partitionKey,
    ...(source.traceId === undefined ? {} : { traceId: source.traceId }),
    ...(source.commandId === undefined ? {} : { commandId: source.commandId }),
    ...(source.agentId === undefined ? {} : { agentId: source.agentId }),
    ...(source.objectiveId === undefined ? {} : { objectiveId: source.objectiveId }),
    ...(source.reactiveCommandId === undefined
      ? {}
      : { reactiveCommandId: source.reactiveCommandId }),
    ...(source.resultKind === undefined ? {} : { resultKind: source.resultKind }),
    ...(source.fromIssuedAt === undefined ? {} : { fromIssuedAt: source.fromIssuedAt }),
    ...(source.toIssuedAt === undefined ? {} : { toIssuedAt: source.toIssuedAt }),
    ...(source.limit === undefined ? {} : { limit: source.limit }),
  });

  return traces.flatMap((trace) => {
    // Operator town-bulletin traces carry no acting Agent and are not
    // experiment-validation guidance, so they are skipped here.
    if (trace.agentId === undefined || trace.resultKind === 'town-bulletin-issued') {
      return [];
    }
    return [
      {
        traceId: trace.traceId,
        agentId: trace.agentId,
        source: trace.source,
        resultKind: trace.resultKind,
        ...(trace.objectiveId === undefined ? {} : { objectiveId: trace.objectiveId }),
        ...(trace.planId === undefined ? {} : { planId: trace.planId }),
        ...(trace.reactiveCommandId === undefined
          ? {}
          : { reactiveCommandId: trace.reactiveCommandId }),
        commandDraftCount: trace.commandDraftCount,
        shortTermMemoryRecordIds: [...trace.shortTermMemoryRecordIds],
        issuedAt: trace.issuedAt,
      },
    ];
  });
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
