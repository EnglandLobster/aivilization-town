import { calculateNetWorth } from '@aivilization/economy';
import {
  createExperimentValidationReport,
  type AgentCycleTraceRepository,
  type AgentTrajectoryObservation,
  type ExperimentValidationReport,
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

export type WorkerExperimentValidationReportInput = {
  readonly run: ExperimentValidationRunMetadata;
  readonly projection: WorldProjection;
  readonly events: readonly WorldEvent[];
  readonly plannerRuns: readonly PlannerExperimentRun[];
  readonly expectedTrajectoryAgentIds?: readonly string[];
  readonly trajectories?: readonly AgentTrajectoryObservation[];
  readonly agentCycleTraceRepository?: AgentCycleTraceRepository;
  readonly traceWindow?: WorkerExperimentValidationTraceWindow;
  readonly thresholds?: ExperimentValidationThresholds;
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
    priceSeries: createPriceCloseObservationsFromWorldEvents({
      simulationId: input.run.simulationId,
      events: input.events,
    }),
    wealthSnapshot: createWealthSnapshotFromWorldProjection(input.projection),
    plannerRuns: input.plannerRuns,
    expectedTrajectoryAgentIds,
    trajectories,
    ...(input.thresholds === undefined ? {} : { thresholds: input.thresholds }),
  });
}

export function createPriceCloseObservationsFromWorldEvents(input: {
  readonly simulationId: string;
  readonly events: readonly WorldEvent[];
}): PriceCloseObservation[] {
  const observations: PriceCloseObservation[] = [];

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
    const closePrice = event.payload.currencyQuantity / event.payload.commodityQuantity;
    assertPositiveFinite(closePrice, 'TradeExecuted closePrice');

    observations.push({
      commodityId: event.payload.commodityName,
      observedAt: event.occurredAt,
      closePrice,
    });
  }

  if (observations.length === 0) {
    throw new Error('events must include at least one TradeExecuted observation');
  }
  return observations;
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

  for (const trace of traces) {
    if (!expectedAgentIds.has(trace.agentId)) {
      continue;
    }
    stepCountsByAgentId.set(trace.agentId, (stepCountsByAgentId.get(trace.agentId) ?? 0) + 1);
  }

  return [...stepCountsByAgentId.entries()]
    .sort(([leftAgentId], [rightAgentId]) => leftAgentId.localeCompare(rightAgentId))
    .map(([agentId, stepCount]) => ({
      agentId,
      stepCount,
    }));
}

function createExpectedTrajectoryAgentIds(projection: WorldProjection): string[] {
  return Object.keys(projection.agents).sort((left, right) => left.localeCompare(right));
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
