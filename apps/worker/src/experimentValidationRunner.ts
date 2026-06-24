import { calculateNetWorth } from '@aivilization/economy';
import {
  createExperimentValidationReport,
  type AgentCycleTrace,
  type AgentCycleTraceRepository,
  type AgentTrajectoryObservation,
  type ExperimentValidationReport,
  type ExperimentValidationReportRepository,
  type ExperimentValidationRunMetadata,
  type ExperimentValidationThresholds,
  type PlannerExperimentRun,
  type PriceCloseObservation,
  type WealthSnapshotObservation,
} from '@aivilization/observability';
import type { WorldEvent, WorldProjection } from '@aivilization/world';

export type WorkerExperimentValidationTraceWindow = {
  readonly fromCycleStartedAt?: number;
  readonly toCycleStartedAt?: number;
};

export type WorkerExperimentValidationPriceBinning = {
  readonly intervalMs: number;
  readonly originAt?: number;
};

export type WorkerExperimentValidationReportInput = {
  readonly run: ExperimentValidationRunMetadata;
  readonly projection: WorldProjection;
  readonly events: readonly WorldEvent[];
  readonly priceSeries?: readonly PriceCloseObservation[];
  readonly plannerRuns: readonly PlannerExperimentRun[];
  readonly priceBinning?: WorkerExperimentValidationPriceBinning;
  readonly expectedTrajectoryAgentIds?: readonly string[];
  readonly trajectories?: readonly AgentTrajectoryObservation[];
  readonly agentCycleTraceRepository?: AgentCycleTraceRepository;
  readonly traceWindow?: WorkerExperimentValidationTraceWindow;
  readonly thresholds?: ExperimentValidationThresholds;
};

export type RecordWorkerExperimentValidationReportInput = WorkerExperimentValidationReportInput & {
  readonly repository: ExperimentValidationReportRepository;
};

export type WorkerTradePriceObservation = {
  readonly sourceEventId: string;
  readonly commodityId: string;
  readonly observedAt: number;
  readonly sourceSequence: number;
  readonly side: 'buy' | 'sell';
  readonly price: number;
  readonly commodityQuantity: number;
  readonly currencyQuantity: number;
  readonly effectivePrice?: number;
  readonly spotPriceBefore?: number;
  readonly spotPriceAfter?: number;
  readonly slippageRatio?: number;
  readonly invariantBefore?: number;
  readonly invariantAfter?: number;
};

export type WorkerOhlcPriceBar = {
  readonly commodityId: string;
  readonly intervalStartedAt: number;
  readonly intervalEndedAt: number;
  readonly openPrice: number;
  readonly highPrice: number;
  readonly lowPrice: number;
  readonly closePrice: number;
  readonly tradeCount: number;
  readonly commodityVolume: number;
  readonly currencyVolume: number;
};

export async function createWorkerExperimentValidationReport(
  input: WorkerExperimentValidationReportInput,
): Promise<ExperimentValidationReport> {
  const expectedTrajectoryAgentIds =
    input.expectedTrajectoryAgentIds ?? createExpectedTrajectoryAgentIds(input.projection);
  const trajectories =
    input.trajectories ??
    (await createAgentTrajectoriesFromTraceRepository({
      simulationId: input.run.simulationId,
      expectedAgentIds: expectedTrajectoryAgentIds,
      repository: requireTraceRepository(input.agentCycleTraceRepository),
      ...(input.traceWindow === undefined ? {} : { traceWindow: input.traceWindow }),
    }));

  return createExperimentValidationReport({
    run: input.run,
    priceSeries:
      input.priceSeries ??
      createValidationPriceSeriesFromWorldEvents({
        simulationId: input.run.simulationId,
        events: input.events,
        ...(input.priceBinning === undefined ? {} : { priceBinning: input.priceBinning }),
      }),
    wealthSnapshot: createWealthSnapshotFromWorldProjection(input.projection),
    plannerRuns: input.plannerRuns,
    expectedTrajectoryAgentIds,
    trajectories,
    ...(input.thresholds === undefined ? {} : { thresholds: input.thresholds }),
  });
}

export async function recordWorkerExperimentValidationReport(
  input: RecordWorkerExperimentValidationReportInput,
): Promise<ExperimentValidationReport> {
  const report = await createWorkerExperimentValidationReport(input);
  await input.repository.record(report);
  return report;
}

export function createTradePriceObservationsFromWorldEvents(input: {
  readonly simulationId: string;
  readonly events: readonly WorldEvent[];
}): WorkerTradePriceObservation[] {
  const observations: WorkerTradePriceObservation[] = [];

  for (const event of [...input.events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.simulationId !== input.simulationId) {
      throw new Error(
        `event simulationId ${event.simulationId} must match validation run simulationId ${input.simulationId}`,
      );
    }
    if (event.type !== 'TradeExecuted') {
      continue;
    }

    assertPositiveFinite(event.payload.commodityQuantity, 'TradeExecuted commodityQuantity');
    assertPositiveFinite(event.payload.currencyQuantity, 'TradeExecuted currencyQuantity');
    const quantityPrice = event.payload.currencyQuantity / event.payload.commodityQuantity;
    const closePrice = event.payload.effectivePrice ?? quantityPrice;
    assertPositiveFinite(closePrice, 'TradeExecuted closePrice');
    if (
      event.payload.effectivePrice !== undefined &&
      Math.abs(event.payload.effectivePrice - quantityPrice) > 1e-9
    ) {
      throw new Error(
        'TradeExecuted effectivePrice must match currencyQuantity / commodityQuantity',
      );
    }

    observations.push({
      sourceEventId: event.id,
      commodityId: event.payload.commodityName,
      observedAt: event.occurredAt,
      sourceSequence: event.sequence,
      side: event.payload.side,
      price: closePrice,
      commodityQuantity: event.payload.commodityQuantity,
      currencyQuantity: event.payload.currencyQuantity,
      ...(event.payload.effectivePrice === undefined
        ? {}
        : { effectivePrice: event.payload.effectivePrice }),
      ...(event.payload.spotPriceBefore === undefined
        ? {}
        : { spotPriceBefore: event.payload.spotPriceBefore }),
      ...(event.payload.spotPriceAfter === undefined
        ? {}
        : { spotPriceAfter: event.payload.spotPriceAfter }),
      ...(event.payload.slippageRatio === undefined
        ? {}
        : { slippageRatio: event.payload.slippageRatio }),
      ...(event.payload.invariantBefore === undefined
        ? {}
        : { invariantBefore: event.payload.invariantBefore }),
      ...(event.payload.invariantAfter === undefined
        ? {}
        : { invariantAfter: event.payload.invariantAfter }),
    });
  }

  if (observations.length === 0) {
    throw new Error('events must include at least one TradeExecuted observation');
  }
  return sortTradePriceObservations(observations);
}

export function createPriceCloseObservationsFromWorldEvents(input: {
  readonly simulationId: string;
  readonly events: readonly WorldEvent[];
}): PriceCloseObservation[] {
  return createPriceCloseObservationsFromTradePriceObservations(
    createTradePriceObservationsFromWorldEvents(input),
  );
}

export function createOhlcPriceBarsFromTradePriceObservations(input: {
  readonly observations: readonly WorkerTradePriceObservation[];
  readonly intervalMs: number;
  readonly originAt?: number;
}): WorkerOhlcPriceBar[] {
  assertPositiveInteger(input.intervalMs, 'priceBinning intervalMs');
  if (input.originAt !== undefined) {
    assertFinite(input.originAt, 'priceBinning originAt');
  }

  const originAt = input.originAt ?? 0;
  const buckets = new Map<string, WorkerTradePriceObservation[]>();
  for (const observation of sortTradePriceObservations(input.observations)) {
    const intervalStartedAt =
      originAt +
      Math.floor((observation.observedAt - originAt) / input.intervalMs) * input.intervalMs;
    const key = JSON.stringify([observation.commodityId, intervalStartedAt]);
    const existing = buckets.get(key) ?? [];
    existing.push(observation);
    buckets.set(key, existing);
  }

  return [...buckets.entries()]
    .map(([key, observations]) => {
      const { commodityId, intervalStartedAt } = parseOhlcBucketKey(key);
      const sorted = sortTradePriceObservations(observations);
      const prices = sorted.map((observation) => observation.price);

      return {
        commodityId,
        intervalStartedAt,
        intervalEndedAt: intervalStartedAt + input.intervalMs,
        openPrice: sorted[0]!.price,
        highPrice: Math.max(...prices),
        lowPrice: Math.min(...prices),
        closePrice: sorted[sorted.length - 1]!.price,
        tradeCount: sorted.length,
        commodityVolume: sorted.reduce(
          (total, observation) => total + observation.commodityQuantity,
          0,
        ),
        currencyVolume: sorted.reduce(
          (total, observation) => total + observation.currencyQuantity,
          0,
        ),
      };
    })
    .sort(compareOhlcPriceBars);
}

export function createPriceCloseObservationsFromOhlcBars(
  bars: readonly WorkerOhlcPriceBar[],
): PriceCloseObservation[] {
  return [...bars].sort(compareOhlcPriceBars).map((bar) => ({
    commodityId: bar.commodityId,
    observedAt: bar.intervalStartedAt,
    closePrice: bar.closePrice,
  }));
}

export function createWealthSnapshotFromWorldProjection(
  projection: WorldProjection,
): WealthSnapshotObservation[] {
  const pools = Object.values(projection.marketPools);
  return Object.values(projection.agents)
    .sort((left, right) => left.agentId.localeCompare(right.agentId))
    .map((agent) => ({
      agentId: agent.agentId,
      educationScore: agent.educationScore,
      netWorth: calculateNetWorth({
        currencyBalance: agent.balance,
        inventory: agent.inventory,
        pools,
      }),
      ...(agent.job === null ? {} : { occupationId: agent.job }),
    }));
}

export async function createAgentTrajectoriesFromTraceRepository(input: {
  readonly simulationId: string;
  readonly expectedAgentIds: readonly string[];
  readonly repository: AgentCycleTraceRepository;
  readonly traceWindow?: WorkerExperimentValidationTraceWindow;
}): Promise<AgentTrajectoryObservation[]> {
  const expectedAgentIds = new Set(input.expectedAgentIds);
  const traces = await input.repository.query({
    simulationId: input.simulationId,
    ...(input.traceWindow?.fromCycleStartedAt === undefined
      ? {}
      : { fromCycleStartedAt: input.traceWindow.fromCycleStartedAt }),
    ...(input.traceWindow?.toCycleStartedAt === undefined
      ? {}
      : { toCycleStartedAt: input.traceWindow.toCycleStartedAt }),
  });
  const stepCountsByAgentId = new Map<string, number>();
  const tracesByAgentId = new Map<string, AgentCycleTrace[]>();

  for (const trace of traces) {
    if (!expectedAgentIds.has(trace.agentId)) {
      continue;
    }
    stepCountsByAgentId.set(trace.agentId, (stepCountsByAgentId.get(trace.agentId) ?? 0) + 1);
    const existing = tracesByAgentId.get(trace.agentId) ?? [];
    existing.push(trace);
    tracesByAgentId.set(trace.agentId, existing);
  }

  return [...stepCountsByAgentId.entries()]
    .sort(([leftAgentId], [rightAgentId]) => leftAgentId.localeCompare(rightAgentId))
    .map(([agentId, stepCount]) =>
      createTrajectoryObservationFromTraces({
        agentId,
        stepCount,
        traces: tracesByAgentId.get(agentId) ?? [],
      }),
    );
}

function createTrajectoryObservationFromTraces(input: {
  readonly agentId: string;
  readonly stepCount: number;
  readonly traces: readonly AgentCycleTrace[];
}): AgentTrajectoryObservation {
  const commandIds = sortCycleTracesChronologically(input.traces).flatMap(
    (trace) => trace.emittedCommandIds,
  );
  return {
    agentId: input.agentId,
    stepCount: input.stepCount,
    ...(commandIds.length === 0
      ? {}
      : {
          firstCommandId: commandIds[0],
          lastCommandId: commandIds[commandIds.length - 1],
        }),
  };
}

function sortCycleTracesChronologically(traces: readonly AgentCycleTrace[]): AgentCycleTrace[] {
  return [...traces].sort((left, right) => {
    if (left.cycleStartedAt !== right.cycleStartedAt) {
      return left.cycleStartedAt - right.cycleStartedAt;
    }
    return left.traceId.localeCompare(right.traceId);
  });
}

function createExpectedTrajectoryAgentIds(projection: WorldProjection): string[] {
  return Object.keys(projection.agents).sort((left, right) => left.localeCompare(right));
}

function createValidationPriceSeriesFromWorldEvents(input: {
  readonly simulationId: string;
  readonly events: readonly WorldEvent[];
  readonly priceBinning?: WorkerExperimentValidationPriceBinning;
}): PriceCloseObservation[] {
  const tradeObservations = createTradePriceObservationsFromWorldEvents(input);
  if (input.priceBinning === undefined) {
    return createPriceCloseObservationsFromTradePriceObservations(tradeObservations);
  }

  return createPriceCloseObservationsFromOhlcBars(
    createOhlcPriceBarsFromTradePriceObservations({
      observations: tradeObservations,
      intervalMs: input.priceBinning.intervalMs,
      ...(input.priceBinning.originAt === undefined
        ? {}
        : { originAt: input.priceBinning.originAt }),
    }),
  );
}

export function createPriceCloseObservationsFromTradePriceObservations(
  observations: readonly WorkerTradePriceObservation[],
): PriceCloseObservation[] {
  return sortTradePriceObservations(observations).map((observation) => ({
    commodityId: observation.commodityId,
    observedAt: observation.observedAt,
    closePrice: observation.price,
  }));
}

function sortTradePriceObservations(
  observations: readonly WorkerTradePriceObservation[],
): WorkerTradePriceObservation[] {
  return [...observations].sort((left, right) => {
    if (left.commodityId !== right.commodityId) {
      return left.commodityId.localeCompare(right.commodityId);
    }
    if (left.observedAt !== right.observedAt) {
      return left.observedAt - right.observedAt;
    }
    return left.sourceSequence - right.sourceSequence;
  });
}

function compareOhlcPriceBars(left: WorkerOhlcPriceBar, right: WorkerOhlcPriceBar): number {
  if (left.commodityId !== right.commodityId) {
    return left.commodityId.localeCompare(right.commodityId);
  }
  return left.intervalStartedAt - right.intervalStartedAt;
}

function parseOhlcBucketKey(key: string): {
  readonly commodityId: string;
  readonly intervalStartedAt: number;
} {
  const parsed = JSON.parse(key) as [string, number];
  return {
    commodityId: parsed[0],
    intervalStartedAt: parsed[1],
  };
}

function requireTraceRepository(
  repository: AgentCycleTraceRepository | undefined,
): AgentCycleTraceRepository {
  if (repository === undefined) {
    throw new Error(
      'worker experiment validation requires trajectories or agentCycleTraceRepository',
    );
  }
  return repository;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
