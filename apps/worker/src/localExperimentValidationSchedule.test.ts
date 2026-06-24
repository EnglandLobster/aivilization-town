import { createAmmPool } from '@aivilization/economy';
import {
  createAgentCycleTrace,
  type AgentCycleTrace,
  type ExperimentValidationMetric,
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
