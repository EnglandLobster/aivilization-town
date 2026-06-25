import { createAmmPool } from '@aivilization/economy';
import {
  createAgentCycleTrace,
  createRuntimeProfileRunReport,
  type AgentCycleTrace,
  type ExperimentValidationMetric,
  InMemoryRuntimeProfileRunReportRepository,
  type SteeringTrace,
} from '@aivilization/observability';
import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import { createWorldProjection, type WorldEvent } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalWorldRuntimeStorage, runLocalExperimentValidationSchedule } from './index';

const simulationId = 'sim-1';
const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');
const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-validation-schedule-'));
  tmpRoots.push(root);
  return root;
}

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

describe('local experiment validation schedule', () => {
  test('generates and records a validation report from local runtime storage', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId,
      partitionKey: 'world-main',
    });
    appendTradeEvents(storage, [100, 110, 99, 120]);
    await storage.agentCycleTraceRepository.record(
      createTrace({ traceId: 'trace-agent-1-a', agentId: 'agent-1', cycleStartedAt: 100 }),
    );
    await storage.agentCycleTraceRepository.record(
      createTrace({ traceId: 'trace-agent-1-b', agentId: 'agent-1', cycleStartedAt: 200 }),
    );
    await storage.agentCycleTraceRepository.record(
      createTrace({ traceId: 'trace-agent-2-a', agentId: 'agent-2', cycleStartedAt: 150 }),
    );

    const result = await runLocalExperimentValidationSchedule({
      storage,
      initialProjection: createInitialProjection(),
      runId: 'validation-schedule-1',
      generatedAt: 500,
      plannerRuns: createPlannerRuns(),
      expectedTrajectoryAgentIds: ['agent-1', 'agent-2'],
      thresholds: {
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
      },
    });

    expect(result).toMatchObject({
      streamName: storage.partition.eventStreamName,
      streamVersion: 4,
      fromSequence: 0,
      toSequence: 4,
      eventCount: 4,
      projectionSequence: 4,
    });
    expect(result.report.run).toEqual({
      runId: 'validation-schedule-1',
      simulationId,
      generatedAt: 500,
      source: 'local-validation-schedule',
    });
    expect(getMetric(result.report.metrics, 'trajectory-coverage').evidence.maximumStepCount).toBe(
      2,
    );
    expect(
      getMetric(result.report.metrics, 'trajectory-coverage').evidence.commandBackedTrajectoryCount,
    ).toBe(2);
    await expect(
      storage.experimentValidationReportRepository.get('validation-schedule-1'),
    ).resolves.toEqual(result.report);
  });

  test('generates a report from a bounded event window', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId,
      partitionKey: 'world-main',
    });
    appendTradeEvents(storage, [100, 110, 99]);

    const result = await runLocalExperimentValidationSchedule({
      storage,
      initialProjection: createInitialProjection(),
      runId: 'validation-windowed',
      generatedAt: 600,
      eventWindow: { afterSequence: 1, toSequence: 3 },
      plannerRuns: createPlannerRuns(),
      expectedTrajectoryAgentIds: ['agent-1'],
      trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
      thresholds: {
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
      },
    });

    expect(result.fromSequence).toBe(1);
    expect(result.toSequence).toBe(3);
    expect(result.eventCount).toBe(2);
    expect(getMetric(result.report.metrics, 'market-stability').evidence.observationCount).toBe(2);
  });

  test('generates market diagnostics from durable OHLC observations', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId,
      partitionKey: 'world-main',
    });
    await storage.marketObservationRepository.recordOhlcBars([
      createOhlcBar({ intervalStartedAt: 0, closePrice: 100 }),
      createOhlcBar({ intervalStartedAt: 60, closePrice: 110 }),
      createOhlcBar({ intervalStartedAt: 120, closePrice: 99 }),
    ]);

    const result = await runLocalExperimentValidationSchedule({
      storage,
      initialProjection: createInitialProjection(),
      runId: 'validation-market-ohlc',
      generatedAt: 700,
      priceBinning: { intervalMs: 60 },
      marketObservationSource: {
        commodityId: 'Fish',
        fromIntervalStartedAt: 0,
        toIntervalStartedAt: 120,
      },
      plannerRuns: createPlannerRuns(),
      expectedTrajectoryAgentIds: ['agent-1'],
      trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
      thresholds: {
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
      },
    });

    expect(result.eventCount).toBe(0);
    expect(getMetric(result.report.metrics, 'market-stability').evidence.observationCount).toBe(3);
    expect(
      getMetric(result.report.metrics, 'market-stability').evidence.maximumDrawdown,
    ).toBeCloseTo((110 - 99) / 110);
  });

  test('generates market diagnostics from durable trade observations when no OHLC binning is configured', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId,
      partitionKey: 'world-main',
    });
    await storage.marketObservationRepository.recordTrades([
      createMarketTradeObservation({ sourceSequence: 1, observedAt: 0, price: 100 }),
      createMarketTradeObservation({ sourceSequence: 2, observedAt: 1, price: 110 }),
      createMarketTradeObservation({ sourceSequence: 3, observedAt: 2, price: 99 }),
    ]);

    const result = await runLocalExperimentValidationSchedule({
      storage,
      initialProjection: createInitialProjection(),
      runId: 'validation-market-trades',
      generatedAt: 800,
      marketObservationSource: {
        commodityId: 'Fish',
        fromObservedAt: 0,
        toObservedAt: 2,
      },
      plannerRuns: createPlannerRuns(),
      expectedTrajectoryAgentIds: ['agent-1'],
      trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
      thresholds: {
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
      },
    });

    expect(result.eventCount).toBe(0);
    expect(getMetric(result.report.metrics, 'market-stability').evidence.observationCount).toBe(3);
    await expect(
      storage.experimentValidationReportRepository.get('validation-market-trades'),
    ).resolves.toEqual(result.report);
  });

  test('generates planner diagnostics from durable runtime profile run reports', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId,
      partitionKey: 'world-main',
    });
    appendTradeEvents(storage, [100, 110]);
    const profileRunReports = new InMemoryRuntimeProfileRunReportRepository();
    await profileRunReports.record(
      createProfileRunReport({ runId: 'profile-run-default', variant: 'default', value: 110_098 }),
    );
    await profileRunReports.record(
      createProfileRunReport({
        runId: 'profile-run-without-branch',
        variant: 'without-branch',
        value: 75_237,
      }),
    );
    await profileRunReports.record(
      createProfileRunReport({
        runId: 'profile-run-without-objective-decomposition',
        variant: 'without-objective-decomposition',
        value: 95_279,
      }),
    );

    const result = await runLocalExperimentValidationSchedule({
      storage,
      initialProjection: createInitialProjection(),
      runId: 'validation-planner-profile-source',
      generatedAt: 900,
      plannerRunSource: {
        repository: profileRunReports,
        profileId: 'planner-ablation-suite',
      },
      expectedTrajectoryAgentIds: ['agent-1'],
      trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
      thresholds: {
        plannerAblation: { minimumDefaultWinRate: 1 },
      },
    });

    const plannerAblation = getMetric(result.report.metrics, 'planner-ablation');
    expect(plannerAblation.status).toBe('pass');
    expect(plannerAblation.evidence.comparisonCount).toBe(2);
    expect(plannerAblation.evidence.defaultWinRate).toBe(1);
    expect(plannerAblation.evidence.expectedVariantCount).toBe(3);
    expect(plannerAblation.evidence.observedVariantCount).toBe(3);
  });

  test('generates social reflection diagnostics from durable observation rows', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId,
      partitionKey: 'world-main',
    });
    appendTradeEvents(storage, [100, 110]);
    await storage.socialReflectionObservationRepository.record([
      createSocialReflectionObservation({
        observationId: 'reflection-agent-1-agent-2',
        reflectionId: 'reflection-1',
        agentId: 'agent-1',
        targetAgentId: 'agent-2',
        confidence: 0.8,
        generatedAt: 100,
      }),
      createSocialReflectionObservation({
        observationId: 'reflection-agent-2-agent-1',
        reflectionId: 'reflection-2',
        agentId: 'agent-2',
        targetAgentId: 'agent-1',
        confidence: 0.7,
        generatedAt: 110,
      }),
    ]);

    const result = await runLocalExperimentValidationSchedule({
      storage,
      initialProjection: createInitialProjection(),
      runId: 'validation-social-reflection-source',
      generatedAt: 920,
      plannerRuns: createPlannerRuns(),
      socialReflectionObservationSource: {
        fromGeneratedAt: 100,
        toGeneratedAt: 110,
        limit: 5,
      },
      expectedTrajectoryAgentIds: ['agent-1', 'agent-2'],
      trajectories: [
        { agentId: 'agent-1', stepCount: 1 },
        { agentId: 'agent-2', stepCount: 1 },
      ],
      thresholds: {
        socialReflectionCoverage: {
          minimumObservationCount: 2,
          minimumAgentCoverageRatio: 1,
          minimumDirectedPairCount: 2,
          minimumMeanConfidence: 0.7,
        },
      },
    });

    const socialReflection = getMetric(result.report.metrics, 'social-reflection-coverage');
    expect(socialReflection).toMatchObject({
      status: 'pass',
      evidence: {
        observationCount: 2,
        expectedAgentCount: 2,
        coveredAgentCount: 2,
        directedPairCount: 2,
        requiredTagObservationCount: 2,
      },
    });
    expect(socialReflection.evidence.agentCoverageRatio).toBe(1);
    expect(socialReflection.evidence.meanConfidence).toBeCloseTo(0.75);
  });

  test('generates steering propagation diagnostics from durable steering traces', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId,
      partitionKey: 'world-main',
    });
    appendTradeEvents(storage, [100, 110]);
    await storage.steeringTraceRepository.record(
      createSteeringTrace({
        traceId: 'steering-objective-agent-1',
        agentId: 'agent-1',
        resultKind: 'long-horizon-objective-set',
        issuedAt: 120,
      }),
    );
    await storage.steeringTraceRepository.record(
      createSteeringTrace({
        traceId: 'steering-reactive-agent-2',
        agentId: 'agent-2',
        resultKind: 'reactive-command-routed',
        issuedAt: 130,
      }),
    );

    const result = await runLocalExperimentValidationSchedule({
      storage,
      initialProjection: createInitialProjection(),
      runId: 'validation-steering-source',
      generatedAt: 930,
      plannerRuns: createPlannerRuns(),
      steeringTraceSource: {
        fromIssuedAt: 120,
        toIssuedAt: 130,
        limit: 5,
      },
      expectedTrajectoryAgentIds: ['agent-1', 'agent-2'],
      trajectories: [
        { agentId: 'agent-1', stepCount: 1 },
        { agentId: 'agent-2', stepCount: 1 },
      ],
      thresholds: {
        steeringMemoryPropagation: {
          minimumTraceCount: 2,
          minimumAgentCoverageRatio: 1,
          minimumLongHorizonTraceCount: 1,
          minimumReactiveTraceCount: 1,
        },
      },
    });

    const steering = getMetric(result.report.metrics, 'steering-memory-propagation');
    expect(steering).toMatchObject({
      status: 'pass',
      evidence: {
        traceCount: 2,
        humanTraceCount: 2,
        expectedAgentCount: 2,
        coveredAgentCount: 2,
        longHorizonTraceCount: 1,
        reactiveTraceCount: 1,
        planBackedLongHorizonTraceCount: 1,
        memoryBackedReactiveTraceCount: 1,
        commandDraftBackedReactiveTraceCount: 1,
        latestIssuedAt: 130,
      },
    });
    expect(steering.evidence.agentCoverageRatio).toBe(1);
  });

  test('rejects durable planner sources that do not cover the paper ablation variants', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId,
      partitionKey: 'world-main',
    });
    appendTradeEvents(storage, [100, 110]);
    const profileRunReports = new InMemoryRuntimeProfileRunReportRepository();
    await profileRunReports.record(
      createProfileRunReport({ runId: 'profile-run-default', variant: 'default', value: 110_098 }),
    );
    await profileRunReports.record(
      createProfileRunReport({
        runId: 'profile-run-without-branch',
        variant: 'without-branch',
        value: 75_237,
      }),
    );

    await expect(
      runLocalExperimentValidationSchedule({
        storage,
        initialProjection: createInitialProjection(),
        runId: 'validation-planner-profile-source-missing-variant',
        generatedAt: 901,
        plannerRunSource: {
          repository: profileRunReports,
          profileId: 'planner-ablation-suite',
        },
        expectedTrajectoryAgentIds: ['agent-1'],
        trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
      }),
    ).rejects.toThrow(
      'plannerRuns missing expected variants without-objective-decomposition for task high-tech-production metric net-worth',
    );
  });

  test('evaluates a validation report gate when configured', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId,
      partitionKey: 'world-main',
    });
    appendTradeEvents(storage, [100, 110, 99]);

    const result = await runLocalExperimentValidationSchedule({
      storage,
      initialProjection: createInitialProjection(),
      runId: 'validation-schedule-gated',
      generatedAt: 950,
      plannerRuns: createPlannerRuns(),
      expectedTrajectoryAgentIds: ['agent-1'],
      trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
      reportGate: {
        criteriaId: 'validation-schedule-gate',
        defaultAllowedStatuses: ['pass', 'watch'],
      },
      thresholds: {
        marketStability: {
          maximumLogPriceRange: 1,
          maximumDrawdown: 0.05,
          minimumLogReturnStandardDeviation: 0,
        },
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
      },
    });

    expect(result.reportGate).toEqual({
      status: 'fail',
      criteriaId: 'validation-schedule-gate',
      runId: 'validation-schedule-gated',
      simulationId,
      failureCount: 1,
      failures: [
        {
          code: 'metric-status-not-allowed',
          message: 'metric market-stability status fail is not allowed',
          evidence: {
            metricId: 'market-stability',
            actual: 'fail',
            allowed: 'pass,watch',
          },
        },
      ],
    });
  });
});

function appendTradeEvents(
  storage: ReturnType<typeof createLocalWorldRuntimeStorage>,
  closePrices: readonly number[],
): void {
  const events = closePrices.map((closePrice, index) =>
    createTradeEvent({
      id: `trade-${index + 1}`,
      price: closePrice,
      occurredAt: index,
      sequence: index + 1,
    }),
  );
  storage.eventStore.appendToStream({
    streamName: storage.partition.eventStreamName,
    expectedVersion: 0,
    events,
  });
}

function createTradeEvent(input: {
  readonly id: string;
  readonly price: number;
  readonly occurredAt: number;
  readonly sequence: number;
}): WorldEvent {
  return createEventEnvelope({
    id: input.id,
    simulationId,
    type: 'TradeExecuted',
    payload: {
      agentId: agentOne,
      side: 'buy' as const,
      commodityName: 'Fish',
      commodityQuantity: 1,
      currencyQuantity: input.price,
      poolAfter: createAmmPool({
        commodity: 'Fish',
        commodityReserve: 10,
        currencyReserve: input.price * 10,
      }),
      moneySupplyDelta: 0,
    },
    occurredAt: input.occurredAt,
    sequence: input.sequence,
  });
}

function createMarketTradeObservation(input: {
  readonly sourceSequence: number;
  readonly observedAt: number;
  readonly price: number;
}) {
  return {
    observationId: `${simulationId}:trade:${input.sourceSequence}:trade-${input.sourceSequence}`,
    simulationId,
    commodityId: 'Fish',
    sourceEventId: `trade-${input.sourceSequence}`,
    sourceSequence: input.sourceSequence,
    side: 'buy' as const,
    observedAt: input.observedAt,
    price: input.price,
    commodityQuantity: 1,
    currencyQuantity: input.price,
  };
}

function createOhlcBar(input: { readonly intervalStartedAt: number; readonly closePrice: number }) {
  return {
    barId: `${simulationId}:ohlc:60:0:Fish:${input.intervalStartedAt}`,
    simulationId,
    commodityId: 'Fish',
    intervalStartedAt: input.intervalStartedAt,
    intervalEndedAt: input.intervalStartedAt + 60,
    openPrice: input.closePrice,
    highPrice: input.closePrice,
    lowPrice: input.closePrice,
    closePrice: input.closePrice,
    tradeCount: 1,
    commodityVolume: 1,
    currencyVolume: input.closePrice,
  };
}

function createSocialReflectionObservation(input: {
  readonly observationId: string;
  readonly reflectionId: string;
  readonly agentId: string;
  readonly targetAgentId: string;
  readonly confidence: number;
  readonly generatedAt: number;
}) {
  return {
    observationId: input.observationId,
    simulationId,
    partitionKey: 'world-main',
    reflectionId: input.reflectionId,
    agentId: input.agentId,
    targetAgentId: input.targetAgentId,
    statement: `${input.agentId} reflected on an interaction with ${input.targetAgentId}`,
    relationDelta: 0.1,
    attitudeDelta: 0.1,
    confidence: input.confidence,
    evidenceRecordIds: [`memory-${input.reflectionId}`],
    generatedAt: input.generatedAt,
    tags: ['social', 'post-interaction-reflection'],
    source: 'memory-consolidation' as const,
  };
}

function createSteeringTrace(input: {
  readonly traceId: string;
  readonly agentId: string;
  readonly resultKind: 'long-horizon-objective-set' | 'reactive-command-routed';
  readonly issuedAt: number;
}): SteeringTrace {
  const isLongHorizon = input.resultKind === 'long-horizon-objective-set';
  const objectiveId = `objective-${input.agentId}`;
  const reactiveCommandId = `reactive-${input.agentId}`;
  return {
    traceId: input.traceId,
    simulationId,
    partitionKey: 'world-main',
    commandId: `cmd-${input.traceId}`,
    commandType: isLongHorizon ? 'SetLongHorizonObjective' : 'IssueReactiveCommand',
    source: 'human',
    agentId: input.agentId,
    resultKind: input.resultKind,
    ...(isLongHorizon
      ? {
          objectiveId,
          planId: objectiveId,
        }
      : {
          reactiveCommandId,
          selectedPlannerDomain: 'market',
        }),
    candidateActionCount: isLongHorizon ? 0 : 1,
    commandDraftCount: isLongHorizon ? 0 : 1,
    shortTermMemoryRecordIds: isLongHorizon ? [] : [`stm-${reactiveCommandId}`],
    issuedAt: input.issuedAt,
    recordedAt: input.issuedAt + 10,
  };
}

function createProfileRunReport(input: {
  readonly runId: string;
  readonly variant: string;
  readonly value: number;
}) {
  return createRuntimeProfileRunReport({
    runId: input.runId,
    profileId: 'planner-ablation-suite',
    manifestId: 'aivilization-planner-ablation-suite',
    rootDir: '/tmp/aivilization-profile-run',
    generatedAt: input.variant === 'default' ? 200 : 100,
    requestedAt: 50,
    daemonHealth: 'healthy',
    outcome: 'succeeded',
    requestedCycleCount: 2,
    completedCycleCount: 2,
    stopReason: 'cycle-count-completed',
    partitionCount: 1,
    totalProjectionAgentCount: 25,
    totalEventCount: 10,
    totalAgentTraceCount: 5,
    agentCycleDiagnostics: createAgentCycleDiagnostics(5),
    plannerExperiment: {
      taskId: 'high-tech-production',
      variant: input.variant,
      metrics: [{ metricId: 'net-worth', value: input.value, higherIsBetter: true }],
    },
    partitions: [
      {
        simulationId: 'aivilization-planner-ablation-suite',
        partitionKey: 'world-main',
        scenarioPresetId: 'aivilization-planner-ablation-suite-world-main',
        status: 'succeeded',
        health: 'healthy',
        lastAppliedSequence: 10,
        streamVersion: 10,
        eventCount: 10,
        projectionAgentCount: 25,
        agentTraceCount: 5,
      },
    ],
  });
}

function createAgentCycleDiagnostics(traceCount: number) {
  return {
    traceCount,
    acceptedSimulatorCount: traceCount,
    repairedSimulatorCount: 0,
    rejectedSimulatorCount: 0,
    replanningDecisionCount: 0,
    simulatorEventTraceCount: traceCount,
    simulatorEventCount: traceCount,
    commandEmittingCycleCount: traceCount,
    fullReplanMaterializationCount: 0,
    commandEmittingCycleRatio: traceCount === 0 ? 0 : 1,
    fullReplanMaterializationRatio: 0,
    repairedSimulatorRatio: 0,
    rejectedSimulatorRatio: 0,
    replanningDecisionRatio: 0,
  };
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
    simulatorEvents: [],
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
    subtaskReplanningDecisions: [
      {
        branchId: 'development',
        subtaskId: 'study',
        decision: { kind: 'none' },
      },
    ],
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

function createInitialProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 1_400,
        balance: 1_000,
        residentialTier: 3,
        job: 'CEO',
        inventory: {},
      },
      {
        agentId: agentTwo,
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 100,
        balance: 50,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
    marketPools: [createAmmPool({ commodity: 'Fish', commodityReserve: 10, currencyReserve: 100 })],
  });
}
