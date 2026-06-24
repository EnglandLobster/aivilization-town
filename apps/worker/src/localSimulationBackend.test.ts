import { type ReactiveLocalizedPlanner } from '@aivilization/agent-runtime';
import { asMemoryRecordId } from '@aivilization/memory';
import { createExperimentValidationReport } from '@aivilization/observability';
import { asAgentId } from '@aivilization/sim-core';
import { createWorldProjection, type WorldCommandPolicies } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createLocalSimulationBackend,
  createLocalWorldRuntimeStorage,
  type LocalSimulationBackend,
  type LocalSimulationBackendLifecycleResult,
  type LocalSimulationLifecycleReplayResult,
  type LocalSimulationLifecycleStartResult,
} from './index';

const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
};

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
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-backend-'));
  tmpRoots.push(root);
  return root;
}

describe('local simulation backend composition', () => {
  test('wires API command submission, lifecycle control, projection query, and replay to local storage', async () => {
    const rootDir = createRootDir();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const backend = createBackend(storage);

    const beforeStart = await backend.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(beforeStart.lastAppliedSequence).toBe(0);
    expect(beforeStart.projection.agents['agent-1']?.educationScore).toBe(10);

    const submission = await backend.api.submitReactiveCommand({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      agentId: 'agent-1',
      reactiveCommandId: 'reactive-study',
      commandId: 'cmd-reactive-study',
      idempotencyKey: 'reactive-study-once',
      summary: 'study for one minute before the next simulation tick',
      tags: ['study'],
      issuedAt: 100,
      expectedVersion: 0,
    });

    expect(submission.result).toEqual({
      accepted: true,
      streamName: storage.partition.commandStreamName,
      sequence: 1,
      streamVersion: 1,
      idempotentReplay: false,
    });

    const started = await backend.api.startSimulation({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      requestedAt: 200,
    });

    expect(started.status).toBe('completed');
    expect(started.state).toMatchObject({
      status: 'completed',
      nextTickIndex: 2,
      lastAppliedSequence: 3,
    });

    const afterStart = await backend.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(afterStart.lastAppliedSequence).toBe(3);
    expect(afterStart.projection.clock).toEqual({ now: 1000, tickDurationMs: 1000 });
    expect(afterStart.projection.agents['agent-1']?.educationScore).toBe(70);

    const eventFeed = await backend.api.getEvents({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      afterSequence: 1,
      limit: 2,
    });
    expect(eventFeed.streamName).toBe(storage.partition.eventStreamName);
    expect(eventFeed.streamVersion).toBe(3);
    expect(eventFeed.nextAfterSequence).toBe(3);
    expect(eventFeed.events.map((event) => [event.sequence, event.type])).toEqual([
      [2, 'ShortTermMemoryRecorded'],
      [3, 'SimulationTimeAdvanced'],
    ]);

    const sync = await backend.api.getSync({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      afterSequence: 1,
      limit: 1,
    });
    expect(sync.streamName).toBe(storage.partition.eventStreamName);
    expect(sync.streamVersion).toBe(3);
    expect(sync.projectionSequence).toBe(3);
    expect(sync.projection.clock).toEqual({ now: 1000, tickDurationMs: 1000 });
    expect(sync.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(sync.events.map((event) => [event.sequence, event.type])).toEqual([
      [2, 'ShortTermMemoryRecorded'],
    ]);
    expect(sync.nextAfterSequence).toBe(2);
    expect(sync.hasMoreEvents).toBe(true);

    const validationReport = createValidationReport({
      runId: 'validation-main-1',
      generatedAt: 600,
    });
    await backend.storage.experimentValidationReportRepository.record(validationReport);
    await expect(
      backend.api.queryExperimentValidationReports({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        fromGeneratedAt: 500,
        limit: 1,
      }),
    ).resolves.toEqual([validationReport]);
    await expect(
      backend.api.getExperimentValidationReport({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        runId: 'validation-main-1',
      }),
    ).resolves.toEqual(validationReport);
    await expect(
      backend.api.getExperimentValidationReport({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        runId: 'missing-validation',
      }),
    ).resolves.toBeUndefined();

    await storage.marketObservationRepository.recordTrades([
      {
        observationId: 'sim-1:trade:2:event-trade-1',
        simulationId: 'sim-1',
        commodityId: 'Apple',
        sourceEventId: 'event-trade-1',
        sourceSequence: 2,
        side: 'buy',
        observedAt: 250,
        price: 11,
        commodityQuantity: 1,
        currencyQuantity: 11,
      },
    ]);
    await storage.marketObservationRepository.recordOhlcBars([
      {
        barId: 'sim-1:ohlc:100:0:Apple:200',
        simulationId: 'sim-1',
        commodityId: 'Apple',
        intervalStartedAt: 200,
        intervalEndedAt: 300,
        openPrice: 10,
        highPrice: 12,
        lowPrice: 9,
        closePrice: 11,
        tradeCount: 3,
        commodityVolume: 4,
        currencyVolume: 44,
      },
    ]);
    await expect(
      backend.api.queryMarketTradeObservations({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        commodityId: 'Apple',
        fromObservedAt: 200,
        limit: 1,
      }),
    ).resolves.toMatchObject([
      {
        observationId: 'sim-1:trade:2:event-trade-1',
        simulationId: 'sim-1',
        commodityId: 'Apple',
        observedAt: 250,
      },
    ]);
    await expect(
      backend.marketObservations.queryMarketOhlcBars({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        commodityId: 'Apple',
        fromIntervalStartedAt: 200,
        limit: 1,
      }),
    ).resolves.toMatchObject([
      {
        barId: 'sim-1:ohlc:100:0:Apple:200',
        simulationId: 'sim-1',
        commodityId: 'Apple',
        intervalStartedAt: 200,
      },
    ]);

    const replayed = requireReplayResult(
      await backend.api.replaySimulation({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        requestedAt: 300,
        toSequence: 2,
      }),
    );
    expect(replayed.status).toBe('replayed');
    expect(replayed.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'EducationChanged'],
      [2, 'ShortTermMemoryRecorded'],
    ]);
    expect(replayed.projection.clock).toEqual({ now: 0, tickDurationMs: 1000 });
    expect(replayed.projection.agents['agent-1']?.educationScore).toBe(70);

    const restarted = createBackend(
      createLocalWorldRuntimeStorage({
        rootDir,
        simulationId: 'sim-1',
        partitionKey: 'world-main',
      }),
    );
    await restarted.api.pauseSimulation({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      requestedAt: 400,
    });
    const resumed = requireCompletedStartResult(
      await restarted.api.startSimulation({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        requestedAt: 500,
      }),
    );

    expect(resumed.status).toBe('completed');
    expect(resumed.loop.steps.map((step) => [step.tickIndex, step.tickId])).toEqual([
      [2, 'loop-main:tick:2'],
    ]);
  });

  test('rejects API commands for a different local partition before writing to the inbox', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const backend = createBackend(storage);

    await expect(
      backend.api.submitReactiveCommand({
        simulationId: 'sim-1',
        partitionKey: 'world-other',
        agentId: 'agent-1',
        reactiveCommandId: 'reactive-study',
        commandId: 'cmd-reactive-study',
        summary: 'study in the wrong partition',
        issuedAt: 100,
        expectedVersion: 0,
      }),
    ).rejects.toThrow(
      'request partitionKey world-other must match storage partitionKey world-main',
    );
    await expect(
      backend.api.getEvents({
        simulationId: 'sim-1',
        partitionKey: 'world-other',
      }),
    ).rejects.toThrow(
      'request partitionKey world-other must match storage partitionKey world-main',
    );
    await expect(
      backend.api.getSync({
        simulationId: 'sim-1',
        partitionKey: 'world-other',
      }),
    ).rejects.toThrow(
      'request partitionKey world-other must match storage partitionKey world-main',
    );
    await expect(
      backend.api.queryExperimentValidationReports({
        simulationId: 'sim-1',
        partitionKey: 'world-other',
      }),
    ).rejects.toThrow(
      'request partitionKey world-other must match storage partitionKey world-main',
    );
    await expect(
      backend.api.queryMarketTradeObservations({
        simulationId: 'sim-1',
        partitionKey: 'world-other',
      }),
    ).rejects.toThrow(
      'request partitionKey world-other must match storage partitionKey world-main',
    );
    expect(storage.commandStore.getStreamVersion(storage.partition.commandStreamName)).toBe(0);
  });

  test('queries long-term agent profiles from projected agent state without creating unknown agents', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const backend = createBackend(
      storage,
      createWorldProjection({
        agents: [
          createAgentState({ agentId: agentOne, educationScore: 10 }),
          createAgentState({ agentId: agentTwo, educationScore: 20 }),
        ],
      }),
    );
    await storage.longTermProfileRepository.applyPatches(agentTwo, [
      {
        id: 'ltm-patch-agent-2-value-community-300',
        agentId: agentTwo,
        section: 'values',
        key: 'community-cooperation',
        statement: 'Agent 2 values cooperative community routines.',
        confidence: 0.8,
        provenanceRecordIds: [asMemoryRecordId('memory-social-2')],
        proposedAt: 300,
      },
    ]);

    await expect(
      backend.agentProfiles.queryProfiles({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
      }),
    ).resolves.toEqual([
      expect.objectContaining({ agentId: agentOne, values: [] }),
      expect.objectContaining({
        agentId: agentTwo,
        values: [
          expect.objectContaining({
            key: 'community-cooperation',
            statement: 'Agent 2 values cooperative community routines.',
          }),
        ],
      }),
    ]);
    await expect(
      backend.agentProfiles.queryProfiles({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        limit: 1,
      }),
    ).resolves.toEqual([expect.objectContaining({ agentId: agentOne })]);
    await expect(
      backend.agentProfiles.getProfile({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-2',
      }),
    ).resolves.toMatchObject({
      agentId: agentTwo,
      values: [
        {
          key: 'community-cooperation',
          statement: 'Agent 2 values cooperative community routines.',
          confidence: 0.8,
          updatedAt: 300,
          provenanceRecordIds: ['memory-social-2'],
        },
      ],
    });
    await expect(
      backend.agentProfiles.getProfile({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-missing',
      }),
    ).resolves.toBeUndefined();
    await expect(
      backend.agentProfiles.queryProfiles({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-missing',
      }),
    ).resolves.toEqual([]);
  });
});

function createBackend(
  storage: ReturnType<typeof createLocalWorldRuntimeStorage>,
  initialProjection = createInitialProjection(),
): LocalSimulationBackend {
  return createLocalSimulationBackend({
    storage,
    loopId: 'loop-main',
    tickBatchSize: 1,
    tickIntervalMs: 100,
    simulationId: 'sim-1',
    initialProjection,
    policies,
    commandConsumerId: 'worker-main',
    localizedPlanners: [reactiveStudyPlanner()],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    agents: [],
  });
}

function createInitialProjection() {
  return createWorldProjection({
    agents: [createAgentState({ agentId: agentOne, educationScore: 10 })],
  });
}

function createAgentState(input: {
  readonly agentId: typeof agentOne;
  readonly educationScore: number;
}) {
  return {
    agentId: input.agentId,
    physiology: { energy: 50, satiety: 80, health: 100 },
    educationScore: input.educationScore,
    balance: 100,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}

function reactiveStudyPlanner(): ReactiveLocalizedPlanner {
  return {
    domain: 'study',
    supports: ({ summary }) => summary.includes('study'),
    propose: () => [
      {
        id: 'study-before-tick',
        description: 'study before tick',
        commandType: 'AgentStudy',
        payload: { durationSeconds: 60, educationRatePerSecond: 1 },
      },
    ],
  };
}

function createValidationReport(input: { readonly runId: string; readonly generatedAt: number }) {
  return createExperimentValidationReport({
    run: {
      runId: input.runId,
      simulationId: 'sim-1',
      generatedAt: input.generatedAt,
    },
    priceSeries: [
      { commodityId: 'Fish', observedAt: 0, closePrice: 100 },
      { commodityId: 'Fish', observedAt: 1, closePrice: 101 },
    ],
    wealthSnapshot: [
      { agentId: 'agent-1', educationScore: 10, netWorth: 100 },
      { agentId: 'agent-2', educationScore: 20, netWorth: 120 },
    ],
    plannerRuns: [
      {
        taskId: 'task-1',
        variant: 'default',
        metrics: [{ metricId: 'net-worth', value: 100, higherIsBetter: true }],
      },
      {
        taskId: 'task-1',
        variant: 'without-branch',
        metrics: [{ metricId: 'net-worth', value: 80, higherIsBetter: true }],
      },
    ],
    expectedTrajectoryAgentIds: ['agent-1'],
    trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
    thresholds: {
      heavyTailReturns: { minimumExcessKurtosis: -2 },
    },
  });
}

function requireReplayResult(
  result: LocalSimulationBackendLifecycleResult,
): LocalSimulationLifecycleReplayResult {
  if (result.status !== 'replayed') {
    throw new Error(`expected replayed lifecycle result, received ${result.status}`);
  }
  return result;
}

function requireCompletedStartResult(
  result: LocalSimulationBackendLifecycleResult,
): LocalSimulationLifecycleStartResult {
  if (result.status !== 'completed') {
    throw new Error(`expected completed start lifecycle result, received ${result.status}`);
  }
  return result;
}
