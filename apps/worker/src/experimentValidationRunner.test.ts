import { createAmmPool } from '@aivilization/economy';
import {
  InMemoryAgentCycleTraceRepository,
  createAgentCycleTrace,
  type AgentCycleTrace,
  type ExperimentValidationMetric,
} from '@aivilization/observability';
import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import { createWorldProjection, type WorldEvent, type WorldProjection } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { createWorkerExperimentValidationReport } from './index';

const simulationId = 'sim-worker-validation';

function getMetric(
  metrics: readonly ExperimentValidationMetric[],
  id: ExperimentValidationMetric['id'],
): ExperimentValidationMetric {
  const metric = metrics.find((candidate) => candidate.id === id);
  if (metric === undefined) {
    throw new Error(`missing metric ${id}`);
  }
  return metric;
}

function createProjection(): WorldProjection {
  return createWorldProjection({
    agents: [
      {
        agentId: asAgentId('agent-a'),
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 1_400,
        balance: 90,
        residentialTier: 3,
        job: 'CEO',
        inventory: { Fish: 1 },
      },
      {
        agentId: asAgentId('agent-b'),
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 900,
        balance: 50,
        residentialTier: 2,
        job: 'Teacher',
        inventory: {},
      },
      {
        agentId: asAgentId('agent-c'),
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 100,
        balance: 25,
        residentialTier: 1,
        job: 'Worker',
        inventory: {},
      },
      {
        agentId: asAgentId('agent-d'),
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 0,
        balance: 25,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
    marketPools: [createAmmPool({ commodity: 'Fish', commodityReserve: 10, currencyReserve: 100 })],
  });
}

function createTradeEvents(closePrices: readonly number[]): WorldEvent[] {
  return closePrices.map((closePrice, index) =>
    createEventEnvelope({
      id: `trade-${index + 1}`,
      simulationId,
      type: 'TradeExecuted',
      payload: {
        agentId: asAgentId('agent-a'),
        side: 'buy' as const,
        commodityName: 'Fish',
        commodityQuantity: 1,
        currencyQuantity: closePrice,
        poolAfter: createAmmPool({
          commodity: 'Fish',
          commodityReserve: 10,
          currencyReserve: closePrice * 10,
        }),
        moneySupplyDelta: 0,
      },
      occurredAt: index,
      sequence: index + 1,
    }),
  );
}

function createInvalidTradeEvent(): WorldEvent {
  return createEventEnvelope({
    id: 'invalid-trade',
    simulationId,
    type: 'TradeExecuted',
    payload: {
      agentId: asAgentId('agent-a'),
      side: 'buy' as const,
      commodityName: 'Fish',
      commodityQuantity: 0,
      currencyQuantity: 10,
      poolAfter: createAmmPool({ commodity: 'Fish', commodityReserve: 10, currencyReserve: 100 }),
      moneySupplyDelta: 0,
    },
    occurredAt: 0,
    sequence: 1,
  });
}

function createTrace(input: {
  readonly traceId: string;
  readonly agentId: string;
  readonly cycleStartedAt: number;
}): AgentCycleTrace {
  return createAgentCycleTrace({
    traceId: input.traceId,
    simulationId,
    agentId: input.agentId,
    cycleStartedAt: input.cycleStartedAt,
    observedStateSummary: 'energy=100 satiety=100 health=100',
    selectedBranch: 'development',
    subtaskCandidates: [
      {
        branchId: 'development',
        subtaskId: 'study',
        description: 'study',
        score: 1,
        scoreBreakdown: {
          basePriorityScore: 1,
          signalInfluenceScore: 0,
          intentionInfluenceScore: 0,
          memoryInfluenceScore: 0,
          profileInfluenceScore: 0,
        },
      },
    ],
    actionSynthesis: {
      acceptedActions: [
        {
          id: `${input.traceId}:action`,
          description: 'study for one minute',
          commandType: 'AgentStudy',
        },
      ],
      rejectedActions: [],
    },
    candidateActions: ['study for one minute'],
    simulatorResult: { status: 'accepted' },
    selectionEvidence: {
      selectedSubtaskId: 'study',
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 0,
      profileInfluenceScore: 0,
      memoryEvidenceRecordIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    },
    replanningDecision: { kind: 'none' },
    emittedCommandIds: [`${input.traceId}:command`],
    memoryContextIds: [],
    memoryWriteIds: [],
  });
}

function createPlannerRuns() {
  return [
    {
      taskId: 'high-tech-production',
      variant: 'default',
      metrics: [{ metricId: 'net-worth', value: 110_098, higherIsBetter: true }],
    },
    {
      taskId: 'high-tech-production',
      variant: 'without-branch',
      metrics: [{ metricId: 'net-worth', value: 75_237, higherIsBetter: true }],
    },
    {
      taskId: 'high-tech-production',
      variant: 'without-objective-decomposition',
      metrics: [{ metricId: 'net-worth', value: 95_279, higherIsBetter: true }],
    },
  ];
}

describe('worker experiment validation runner', () => {
  test('creates a validation report from projection, transaction events, planner rows, and cycle traces', async () => {
    const traceRepository = new InMemoryAgentCycleTraceRepository();
    await traceRepository.record(
      createTrace({ traceId: 'trace-a-1', agentId: 'agent-a', cycleStartedAt: 100 }),
    );
    await traceRepository.record(
      createTrace({ traceId: 'trace-a-2', agentId: 'agent-a', cycleStartedAt: 200 }),
    );
    await traceRepository.record(
      createTrace({ traceId: 'trace-b-1', agentId: 'agent-b', cycleStartedAt: 150 }),
    );

    const report = await createWorkerExperimentValidationReport({
      run: {
        runId: 'worker-validation-1',
        simulationId,
        generatedAt: 1_700_000_000,
      },
      projection: createProjection(),
      events: createTradeEvents([100, 110, 99, 120, 105, 126]),
      plannerRuns: createPlannerRuns(),
      expectedTrajectoryAgentIds: ['agent-a', 'agent-b', 'agent-c'],
      agentCycleTraceRepository: traceRepository,
      thresholds: {
        marketStability: {
          maximumLogPriceRange: 1,
          maximumDrawdown: 0.2,
          minimumLogReturnStandardDeviation: 0,
        },
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
        wealthStratification: { minimumGiniCoefficient: 0.2, minimumEducationWealthRatio: 2 },
        plannerAblation: { minimumDefaultWinRate: 1 },
        trajectoryCoverage: { minimumCoverageRatio: 0.6, minimumMinimumStepCount: 1 },
      },
    });

    expect(report.metrics.map((metric) => metric.id)).toEqual([
      'market-stability',
      'heavy-tail-returns',
      'volatility-clustering',
      'wealth-stratification',
      'planner-ablation',
      'trajectory-coverage',
    ]);

    expect(getMetric(report.metrics, 'market-stability').status).toBe('pass');
    expect(getMetric(report.metrics, 'wealth-stratification').value).toBeCloseTo(0.3125);
    expect(getMetric(report.metrics, 'trajectory-coverage').value).toBeCloseTo(2 / 3);
    expect(getMetric(report.metrics, 'trajectory-coverage').evidence.maximumStepCount).toBe(2);
  });

  test('rejects invalid trade quantities before creating a report', async () => {
    await expect(
      createWorkerExperimentValidationReport({
        run: {
          runId: 'worker-validation-invalid',
          simulationId,
          generatedAt: 1_700_000_001,
        },
        projection: createProjection(),
        events: [createInvalidTradeEvent()],
        plannerRuns: createPlannerRuns(),
        expectedTrajectoryAgentIds: ['agent-a'],
        trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
      }),
    ).rejects.toThrow('TradeExecuted commodityQuantity must be positive and finite');
  });
});
