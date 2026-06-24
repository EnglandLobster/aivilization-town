import { createAmmPool } from '@aivilization/economy';
import {
  InMemoryAgentCycleTraceRepository,
  InMemoryExperimentValidationReportRepository,
  createAgentCycleTrace,
  type AgentCycleTrace,
  type ExperimentValidationMetric,
} from '@aivilization/observability';
import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import { createWorldProjection, type WorldEvent, type WorldProjection } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createOhlcPriceBarsFromTradePriceObservations,
  createTradePriceObservationsFromWorldEvents,
  createWorkerExperimentValidationReport,
  recordWorkerExperimentValidationReport,
} from './index';

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

function createTradeEvent(input: {
  readonly id: string;
  readonly price: number;
  readonly occurredAt: number;
  readonly sequence: number;
  readonly commodityQuantity?: number;
  readonly effectivePrice?: number;
}): WorldEvent {
  const commodityQuantity = input.commodityQuantity ?? 1;
  return createEventEnvelope({
    id: input.id,
    simulationId,
    type: 'TradeExecuted',
    payload: {
      agentId: asAgentId('agent-a'),
      side: 'buy' as const,
      commodityName: 'Fish',
      commodityQuantity,
      currencyQuantity: input.price * commodityQuantity,
      poolAfter: createAmmPool({
        commodity: 'Fish',
        commodityReserve: 10,
        currencyReserve: input.price * 10,
      }),
      ...(input.effectivePrice === undefined ? {} : { effectivePrice: input.effectivePrice }),
      moneySupplyDelta: 0,
    },
    occurredAt: input.occurredAt,
    sequence: input.sequence,
  });
}

function createTradeEvents(closePrices: readonly number[]): WorldEvent[] {
  return closePrices.map((closePrice, index) =>
    createTradeEvent({
      id: `trade-${index + 1}`,
      price: closePrice,
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
  test('bins transaction prices into paper-style OHLC bars by interval', () => {
    const events = [
      createTradeEvent({ id: 'trade-3', price: 90, occurredAt: 40, sequence: 3 }),
      createTradeEvent({ id: 'trade-1', price: 100, occurredAt: 0, sequence: 1 }),
      createTradeEvent({ id: 'trade-2', price: 110, occurredAt: 10, sequence: 2 }),
      createTradeEvent({ id: 'trade-5', price: 105, occurredAt: 90, sequence: 5 }),
      createTradeEvent({ id: 'trade-4', price: 120, occurredAt: 60, sequence: 4 }),
    ];

    const bars = createOhlcPriceBarsFromTradePriceObservations({
      observations: createTradePriceObservationsFromWorldEvents({ simulationId, events }),
      intervalMs: 60,
    });

    expect(bars).toEqual([
      {
        commodityId: 'Fish',
        intervalStartedAt: 0,
        intervalEndedAt: 60,
        openPrice: 100,
        highPrice: 110,
        lowPrice: 90,
        closePrice: 90,
        tradeCount: 3,
        commodityVolume: 3,
        currencyVolume: 300,
      },
      {
        commodityId: 'Fish',
        intervalStartedAt: 60,
        intervalEndedAt: 120,
        openPrice: 120,
        highPrice: 120,
        lowPrice: 105,
        closePrice: 105,
        tradeCount: 2,
        commodityVolume: 2,
        currencyVolume: 225,
      },
    ]);
  });

  test('accepts TradeExecuted effective price metadata as the transaction close price', () => {
    const observations = createTradePriceObservationsFromWorldEvents({
      simulationId,
      events: [
        createTradeEvent({
          id: 'trade-effective-price',
          price: 100,
          effectivePrice: 100,
          commodityQuantity: 2,
          occurredAt: 0,
          sequence: 1,
        }),
      ],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]?.price).toBe(100);
    expect(observations[0]?.commodityQuantity).toBe(2);
    expect(observations[0]?.currencyQuantity).toBe(200);
  });

  test('rejects inconsistent TradeExecuted effective price metadata', () => {
    expect(() =>
      createTradePriceObservationsFromWorldEvents({
        simulationId,
        events: [
          createTradeEvent({
            id: 'trade-inconsistent-effective-price',
            price: 100,
            effectivePrice: 99,
            occurredAt: 0,
            sequence: 1,
          }),
        ],
      }),
    ).toThrow('TradeExecuted effectivePrice must match currencyQuantity / commodityQuantity');
  });

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

  test('can create the validation price series from OHLC close prices', async () => {
    const report = await createWorkerExperimentValidationReport({
      run: {
        runId: 'worker-validation-ohlc',
        simulationId,
        generatedAt: 1_700_000_002,
      },
      projection: createProjection(),
      events: [
        createTradeEvent({ id: 'trade-1', price: 100, occurredAt: 0, sequence: 1 }),
        createTradeEvent({ id: 'trade-2', price: 110, occurredAt: 10, sequence: 2 }),
        createTradeEvent({ id: 'trade-3', price: 90, occurredAt: 40, sequence: 3 }),
        createTradeEvent({ id: 'trade-4', price: 120, occurredAt: 60, sequence: 4 }),
        createTradeEvent({ id: 'trade-5', price: 105, occurredAt: 90, sequence: 5 }),
        createTradeEvent({ id: 'trade-6', price: 126, occurredAt: 120, sequence: 6 }),
      ],
      priceBinning: { intervalMs: 60 },
      plannerRuns: createPlannerRuns(),
      expectedTrajectoryAgentIds: ['agent-a'],
      trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
      thresholds: {
        marketStability: {
          maximumLogPriceRange: 1,
          maximumDrawdown: 0.2,
          minimumLogReturnStandardDeviation: 0,
        },
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
      },
    });

    const marketStability = getMetric(report.metrics, 'market-stability');

    expect(marketStability.evidence.observationCount).toBe(3);
    expect(marketStability.evidence.maximumDrawdown).toBe(0);
    expect(marketStability.evidence.maximumLogPriceRange).toBeCloseTo(Math.log(126) - Math.log(90));
  });

  test('records a generated validation report through the injected repository', async () => {
    const repository = new InMemoryExperimentValidationReportRepository();

    const report = await recordWorkerExperimentValidationReport({
      repository,
      run: {
        runId: 'worker-validation-recorded',
        simulationId,
        generatedAt: 1_700_000_004,
      },
      projection: createProjection(),
      events: createTradeEvents([100, 110, 99, 120, 105, 126]),
      plannerRuns: createPlannerRuns(),
      expectedTrajectoryAgentIds: ['agent-a'],
      trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
      thresholds: {
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
      },
    });

    await expect(repository.get('worker-validation-recorded')).resolves.toEqual(report);
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

  test('rejects invalid OHLC interval configuration before creating a report', async () => {
    await expect(
      createWorkerExperimentValidationReport({
        run: {
          runId: 'worker-validation-invalid-bin',
          simulationId,
          generatedAt: 1_700_000_003,
        },
        projection: createProjection(),
        events: createTradeEvents([100, 101]),
        priceBinning: { intervalMs: 0 },
        plannerRuns: createPlannerRuns(),
        expectedTrajectoryAgentIds: ['agent-a'],
        trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
      }),
    ).rejects.toThrow('priceBinning intervalMs must be a positive integer');
  });
});
