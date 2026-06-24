import { createAmmPool } from '@aivilization/economy';
import { asAgentId, createEventEnvelope, type SimulationTimestamp } from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldCommandPolicies,
  type WorldEvent,
} from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createLocalSimulationLifecycleController,
  createLocalWorldRuntimeStorage,
  type LocalSimulationLifecycleValidationSchedule,
} from './index';

const agentOne = asAgentId('agent-1');

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
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-lifecycle-'));
  tmpRoots.push(root);
  return root;
}

describe('local simulation lifecycle controller', () => {
  test('starts, pauses, resumes from lifecycle state, and replays world projection from events', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const firstController = createController({ storage, initialProjection });

    const first = await firstController.start(createRequest(1000));

    expect(first.status).toBe('completed');
    expect(first.state).toMatchObject({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      status: 'completed',
      nextTickIndex: 3,
      lastAppliedSequence: 2,
    });
    expect(first.loop.steps.map((step) => [step.tickIndex, step.tickId])).toEqual([
      [1, 'loop-main:tick:1'],
      [2, 'loop-main:tick:2'],
    ]);

    const paused = await firstController.pause(createRequest(1200));

    expect(paused.status).toBe('paused');
    expect(paused.state).toMatchObject({
      status: 'paused',
      nextTickIndex: 3,
      lastAppliedSequence: 2,
    });

    const restartedStorage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(restartedStorage.lifecycleStateStore.getState(createRequest(1300))).toMatchObject({
      status: 'paused',
      nextTickIndex: 3,
      lastAppliedSequence: 2,
    });
    const resumedController = createController({
      storage: restartedStorage,
      initialProjection,
    });
    const resumed = await resumedController.start(createRequest(1300));

    expect(resumed.status).toBe('completed');
    expect(resumed.state).toMatchObject({
      status: 'completed',
      nextTickIndex: 5,
      lastAppliedSequence: 4,
    });
    expect(resumed.loop.steps.map((step) => [step.tickIndex, step.tickId])).toEqual([
      [3, 'loop-main:tick:3'],
      [4, 'loop-main:tick:4'],
    ]);

    const replayed = await resumedController.replay({ ...createRequest(1400), toSequence: 2 });

    expect(replayed.status).toBe('replayed');
    expect(replayed.requestedFromSequence).toBe(0);
    expect(replayed.requestedToSequence).toBe(2);
    expect(replayed.lastAppliedSequence).toBe(2);
    expect(replayed.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'SimulationTimeAdvanced'],
    ]);
    expect(replayed.projection.clock).toEqual({ now: 2000, tickDurationMs: 1000 });
  });

  test('runs configured validation schedule after a completed lifecycle start', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    appendTradeEvents(storage, [100, 110, 99]);
    const controller = createController({
      storage,
      initialProjection,
      tickBatchSize: 1,
      validationSchedule: {
        runIdPrefix: 'lifecycle-validation',
        plannerRuns: createPlannerRuns(),
        eventWindow: { afterSequence: 0, toSequence: 3 },
        expectedTrajectoryAgentIds: ['agent-1'],
        trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
        thresholds: {
          heavyTailReturns: { minimumExcessKurtosis: -2 },
          volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
        },
      },
    });

    const result = await controller.start(createRequest(500));

    expect(result.status).toBe('completed');
    expect(result.state.lastAppliedSequence).toBe(4);
    expect(result.validationReport).toMatchObject({
      streamName: storage.partition.eventStreamName,
      streamVersion: 4,
      fromSequence: 0,
      toSequence: 3,
      eventCount: 3,
      projectionSequence: 3,
      report: {
        run: {
          runId: 'lifecycle-validation:500:4',
          simulationId: 'sim-1',
          generatedAt: 500,
          source: 'local-lifecycle-validation',
        },
      },
    });
    await expect(
      storage.experimentValidationReportRepository.get('lifecycle-validation:500:4'),
    ).resolves.toEqual(result.validationReport?.report);
  });

  test('skips configured validation schedule when lifecycle start pauses before ticking', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const controller = createController({
      storage,
      initialProjection,
      pauseBeforeTick: () => true,
      validationSchedule: {
        runIdPrefix: 'paused-validation',
        plannerRuns: createPlannerRuns(),
        expectedTrajectoryAgentIds: ['agent-1'],
        trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
      },
    });

    const result = await controller.start(createRequest(700));

    expect(result.status).toBe('paused');
    expect(result.validationReport).toBeUndefined();
    await expect(
      storage.experimentValidationReportRepository.query({ simulationId: 'sim-1' }),
    ).resolves.toEqual([]);
  });

  test('returns validation failure metadata without failing a completed lifecycle start', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const controller = createController({
      storage,
      initialProjection,
      tickBatchSize: 1,
      validationSchedule: {
        plannerRuns: createPlannerRuns(),
        expectedTrajectoryAgentIds: ['agent-1'],
        trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
      },
    });

    const result = await controller.start(createRequest(900));

    expect(result.status).toBe('completed');
    expect(result.state.lastAppliedSequence).toBe(1);
    expect(result.validationReport).toBeUndefined();
    expect(result.validationFailure).toMatchObject({
      name: 'Error',
      message: 'events must include at least one TradeExecuted observation',
    });
    await expect(
      storage.experimentValidationReportRepository.query({ simulationId: 'sim-1' }),
    ).resolves.toEqual([]);
  });
});

function createController(input: {
  readonly storage: ReturnType<typeof createLocalWorldRuntimeStorage>;
  readonly initialProjection: ReturnType<typeof createInitialProjection>;
  readonly tickBatchSize?: number;
  readonly pauseBeforeTick?: () => boolean;
  readonly validationSchedule?: LocalSimulationLifecycleValidationSchedule;
}) {
  return createLocalSimulationLifecycleController({
    storage: input.storage,
    lifecycleStateStore: input.storage.lifecycleStateStore,
    loopId: 'loop-main',
    tickBatchSize: input.tickBatchSize ?? 2,
    tickIntervalMs: 100,
    simulationId: 'sim-1',
    initialProjection: input.initialProjection,
    policies,
    commandConsumerId: 'worker-main',
    localizedPlanners: [],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    agents: [],
    ...(input.pauseBeforeTick === undefined ? {} : { pauseBeforeTick: input.pauseBeforeTick }),
    ...(input.validationSchedule === undefined
      ? {}
      : { validationSchedule: input.validationSchedule }),
  });
}

function createRequest(requestedAt: SimulationTimestamp) {
  return {
    simulationId: 'sim-1',
    partitionKey: 'world-main',
    requestedAt,
  };
}

function createInitialProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
    marketPools: [createAmmPool({ commodity: 'Fish', commodityReserve: 10, currencyReserve: 100 })],
  });
}

function appendTradeEvents(
  storage: ReturnType<typeof createLocalWorldRuntimeStorage>,
  closePrices: readonly number[],
): void {
  storage.eventStore.appendToStream({
    streamName: storage.partition.eventStreamName,
    expectedVersion: 0,
    events: closePrices.map((closePrice, index) =>
      createTradeEvent({
        id: `trade-${index + 1}`,
        price: closePrice,
        occurredAt: index,
        sequence: index + 1,
      }),
    ),
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
    simulationId: 'sim-1',
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
