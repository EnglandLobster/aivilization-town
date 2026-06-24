import { createAmmPool } from '@aivilization/economy';
import { asAgentId, asLocationId, createEventEnvelope, type AgentId } from '@aivilization/sim-core';
import { type ScenarioPreset } from '@aivilization/content';
import { type WorldCommandPolicies, type WorldEvent } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  bootstrapLocalSimulationRuntimeHostFromManifest,
  createLocalSimulationRuntimeSupervisor,
  type LocalSimulationLifecycleValidationSchedule,
  type LocalSimulationRuntimeManifest,
  type LocalWorldRuntimeStorage,
} from './index';

const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');
const mainSquare = asLocationId('main-square');

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

describe('local simulation runtime supervisor', () => {
  test('reports bootstrapped partition status before lifecycle commands run', async () => {
    const host = await bootstrapTestHost();
    const supervisor = createLocalSimulationRuntimeSupervisor({ host });

    expect(toStatusSummary(supervisor.getStatus())).toEqual({
      manifestId: 'town-runtime',
      partitionCount: 2,
      healthyPartitionCount: 2,
      attentionPartitionCount: 0,
      partitions: [
        {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          scenarioPresetId: 'scenario-main',
          status: 'bootstrapped',
          health: 'healthy',
          initializedCheckpoint: true,
          seededAgentCount: 1,
          skippedAgentCount: 0,
          nextTickIndex: undefined,
          lastAppliedSequence: 0,
        },
        {
          simulationId: 'sim-1',
          partitionKey: 'world-east',
          scenarioPresetId: 'scenario-east',
          status: 'bootstrapped',
          health: 'healthy',
          initializedCheckpoint: true,
          seededAgentCount: 1,
          skippedAgentCount: 0,
          nextTickIndex: undefined,
          lastAppliedSequence: 0,
        },
      ],
    });
  });

  test('starts and pauses every hosted partition through the registry lifecycle API', async () => {
    const host = await bootstrapTestHost();
    const supervisor = createLocalSimulationRuntimeSupervisor({ host });

    const startResult = await supervisor.startAll({
      operationId: 'op-start-all-200',
      requestedAt: 200,
    });

    expect(startResult.traceId).toBe('op-start-all-200');
    expect(startResult.partitions.map((partition) => partition.status)).toEqual([
      'completed',
      'completed',
    ]);
    expect(
      startResult.status.partitions.map((partition) => ({
        partitionKey: partition.partitionKey,
        status: partition.status,
        health: partition.health,
        nextTickIndex: partition.nextTickIndex,
        lastAppliedSequence: partition.lastAppliedSequence,
      })),
    ).toEqual([
      {
        partitionKey: 'world-main',
        status: 'completed',
        health: 'healthy',
        nextTickIndex: 2,
        lastAppliedSequence: 1,
      },
      {
        partitionKey: 'world-east',
        status: 'completed',
        health: 'healthy',
        nextTickIndex: 2,
        lastAppliedSequence: 1,
      },
    ]);
    await expect(supervisor.getOperationTrace('op-start-all-200')).resolves.toMatchObject({
      traceId: 'op-start-all-200',
      manifestId: 'town-runtime',
      command: 'start-all',
      requestedAt: 200,
      outcome: 'succeeded',
      succeededPartitionCount: 2,
      failedPartitionCount: 0,
      partitions: [
        {
          partitionKey: 'world-main',
          outcome: 'succeeded',
          status: 'completed',
        },
        {
          partitionKey: 'world-east',
          outcome: 'succeeded',
          status: 'completed',
        },
      ],
      status: {
        manifestId: 'town-runtime',
        partitionCount: 2,
      },
    });

    const restartedSupervisor = createLocalSimulationRuntimeSupervisor({ host });
    await expect(
      restartedSupervisor.queryOperationTraces({ manifestId: 'town-runtime' }),
    ).resolves.toMatchObject([
      {
        traceId: 'op-start-all-200',
        command: 'start-all',
        outcome: 'succeeded',
      },
    ]);

    const pauseResult = await restartedSupervisor.pauseAll({
      operationId: 'op-pause-all-300',
      requestedAt: 300,
    });

    expect(pauseResult.traceId).toBe('op-pause-all-300');
    expect(pauseResult.partitions.map((partition) => partition.status)).toEqual([
      'paused',
      'paused',
    ]);
    expect(
      pauseResult.status.partitions.map((partition) => ({
        partitionKey: partition.partitionKey,
        status: partition.status,
        health: partition.health,
        nextTickIndex: partition.nextTickIndex,
        lastAppliedSequence: partition.lastAppliedSequence,
      })),
    ).toEqual([
      {
        partitionKey: 'world-main',
        status: 'paused',
        health: 'healthy',
        nextTickIndex: 2,
        lastAppliedSequence: 1,
      },
      {
        partitionKey: 'world-east',
        status: 'paused',
        health: 'healthy',
        nextTickIndex: 2,
        lastAppliedSequence: 1,
      },
    ]);
  });

  test('surfaces partial partition failures without rejecting the whole bulk start command', async () => {
    const host = await bootstrapTestHost();
    const supervisor = createLocalSimulationRuntimeSupervisor({ host });
    await host.registry.api.resetSimulation({
      simulationId: 'sim-1',
      partitionKey: 'world-east',
      requestedAt: 150,
    });

    const startResult = await supervisor.startAll({
      operationId: 'op-start-partial-failure-200',
      requestedAt: 200,
    });

    expect(startResult.traceId).toBe('op-start-partial-failure-200');
    expect(startResult.outcome).toBe('partial-failure');
    expect(startResult.succeededPartitionCount).toBe(1);
    expect(startResult.failedPartitionCount).toBe(1);
    expect(
      startResult.partitions.map((partition) => ({
        partitionKey: partition.partitionKey,
        status: partition.status,
        outcome: partition.outcome,
        error: partition.outcome === 'failed' ? partition.error.message : undefined,
      })),
    ).toEqual([
      {
        partitionKey: 'world-main',
        status: 'completed',
        outcome: 'succeeded',
        error: undefined,
      },
      {
        partitionKey: 'world-east',
        status: 'failed',
        outcome: 'failed',
        error: 'local simulation reset has not been materialized',
      },
    ]);
    expect(
      startResult.status.partitions.map((partition) => ({
        partitionKey: partition.partitionKey,
        status: partition.status,
        health: partition.health,
      })),
    ).toEqual([
      {
        partitionKey: 'world-main',
        status: 'completed',
        health: 'healthy',
      },
      {
        partitionKey: 'world-east',
        status: 'reset-requested',
        health: 'attention',
      },
    ]);
    await expect(
      supervisor.getOperationTrace('op-start-partial-failure-200'),
    ).resolves.toMatchObject({
      traceId: 'op-start-partial-failure-200',
      manifestId: 'town-runtime',
      command: 'start-all',
      outcome: 'partial-failure',
      succeededPartitionCount: 1,
      failedPartitionCount: 1,
      partitions: [
        {
          partitionKey: 'world-main',
          outcome: 'succeeded',
          status: 'completed',
        },
        {
          partitionKey: 'world-east',
          outcome: 'failed',
          status: 'failed',
          error: {
            message: 'local simulation reset has not been materialized',
          },
        },
      ],
      status: {
        attentionPartitionCount: 1,
        partitions: [
          {
            partitionKey: 'world-main',
            health: 'healthy',
          },
          {
            partitionKey: 'world-east',
            health: 'attention',
          },
        ],
      },
    });
  });

  test('records generated validation report links in start-all operation traces', async () => {
    const host = await bootstrapTestHost({ validationSchedule: createValidationSchedule() });
    appendTradeEvents(host.partitions[0]!.bootstrap.storage, agentOne, [100, 110, 99]);
    appendTradeEvents(host.partitions[1]!.bootstrap.storage, agentTwo, [100, 105, 95]);
    const supervisor = createLocalSimulationRuntimeSupervisor({ host });

    const startResult = await supervisor.startAll({
      operationId: 'op-start-validation-400',
      requestedAt: 400,
    });

    expect(
      startResult.partitions.map((partition) => ({
        partitionKey: partition.partitionKey,
        status: partition.status,
        validationRunId:
          partition.outcome === 'succeeded'
            ? partition.result.validationReport?.report.run.runId
            : undefined,
      })),
    ).toEqual([
      {
        partitionKey: 'world-main',
        status: 'completed',
        validationRunId: 'town-runtime:sim-1:world-main:validation:400:4',
      },
      {
        partitionKey: 'world-east',
        status: 'completed',
        validationRunId: 'town-runtime:sim-1:world-east:validation:400:4',
      },
    ]);
    await expect(supervisor.getOperationTrace('op-start-validation-400')).resolves.toMatchObject({
      traceId: 'op-start-validation-400',
      command: 'start-all',
      partitions: [
        {
          partitionKey: 'world-main',
          outcome: 'succeeded',
          status: 'completed',
          validationReport: {
            runId: 'town-runtime:sim-1:world-main:validation:400:4',
            generatedAt: 400,
            source: 'local-lifecycle-validation',
            streamVersion: 4,
            fromSequence: 0,
            toSequence: 3,
            eventCount: 3,
            projectionSequence: 3,
          },
        },
        {
          partitionKey: 'world-east',
          outcome: 'succeeded',
          status: 'completed',
          validationReport: {
            runId: 'town-runtime:sim-1:world-east:validation:400:4',
            generatedAt: 400,
            source: 'local-lifecycle-validation',
            streamVersion: 4,
            fromSequence: 0,
            toSequence: 3,
            eventCount: 3,
            projectionSequence: 3,
          },
        },
      ],
    });
  });

  test('keeps completed start-all partitions successful when validation report generation fails', async () => {
    const host = await bootstrapTestHost({ validationSchedule: createFailingValidationSchedule() });
    const supervisor = createLocalSimulationRuntimeSupervisor({ host });

    const startResult = await supervisor.startAll({
      operationId: 'op-start-validation-failure-500',
      requestedAt: 500,
    });

    expect(startResult.outcome).toBe('succeeded');
    expect(startResult.succeededPartitionCount).toBe(2);
    expect(startResult.failedPartitionCount).toBe(0);
    expect(startResult.status.attentionPartitionCount).toBe(2);
    expect(
      startResult.partitions.map((partition) => ({
        partitionKey: partition.partitionKey,
        outcome: partition.outcome,
        status: partition.status,
        validationFailure:
          partition.outcome === 'succeeded'
            ? partition.result.validationFailure?.message
            : undefined,
      })),
    ).toEqual([
      {
        partitionKey: 'world-main',
        outcome: 'succeeded',
        status: 'completed',
        validationFailure: 'events must include at least one TradeExecuted observation',
      },
      {
        partitionKey: 'world-east',
        outcome: 'succeeded',
        status: 'completed',
        validationFailure: 'events must include at least one TradeExecuted observation',
      },
    ]);
    expect(
      startResult.status.partitions.map((partition) => ({
        partitionKey: partition.partitionKey,
        health: partition.health,
        lastValidationStatus: partition.lastValidationStatus,
        lastValidationFailure: partition.lastValidationFailure?.message,
      })),
    ).toEqual([
      {
        partitionKey: 'world-main',
        health: 'attention',
        lastValidationStatus: 'failed',
        lastValidationFailure: 'events must include at least one TradeExecuted observation',
      },
      {
        partitionKey: 'world-east',
        health: 'attention',
        lastValidationStatus: 'failed',
        lastValidationFailure: 'events must include at least one TradeExecuted observation',
      },
    ]);
    await expect(
      supervisor.getOperationTrace('op-start-validation-failure-500'),
    ).resolves.toMatchObject({
      traceId: 'op-start-validation-failure-500',
      outcome: 'succeeded',
      partitions: [
        {
          partitionKey: 'world-main',
          outcome: 'succeeded',
          status: 'completed',
          validationFailure: {
            name: 'Error',
            message: 'events must include at least one TradeExecuted observation',
          },
        },
        {
          partitionKey: 'world-east',
          outcome: 'succeeded',
          status: 'completed',
          validationFailure: {
            name: 'Error',
            message: 'events must include at least one TradeExecuted observation',
          },
        },
      ],
    });
  });
});

function toStatusSummary(
  status: ReturnType<ReturnType<typeof createLocalSimulationRuntimeSupervisor>['getStatus']>,
) {
  return {
    manifestId: status.manifestId,
    partitionCount: status.partitionCount,
    healthyPartitionCount: status.healthyPartitionCount,
    attentionPartitionCount: status.attentionPartitionCount,
    partitions: status.partitions.map((partition) => ({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      scenarioPresetId: partition.scenarioPresetId,
      status: partition.status,
      health: partition.health,
      initializedCheckpoint: partition.initializedCheckpoint,
      seededAgentCount: partition.seededAgentCount,
      skippedAgentCount: partition.skippedAgentCount,
      nextTickIndex: partition.nextTickIndex,
      lastAppliedSequence: partition.lastAppliedSequence,
    })),
  };
}

async function bootstrapTestHost(
  input: {
    readonly validationSchedule?: LocalSimulationLifecycleValidationSchedule;
  } = {},
) {
  return bootstrapLocalSimulationRuntimeHostFromManifest({
    rootDir: createRootDir(),
    bootstrappedAt: 100,
    manifest: createManifest(),
    scenarioPresets: createScenarioPresets(),
    policies,
    localizedPlanners: [],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    agents: [],
    ...(input.validationSchedule === undefined
      ? {}
      : { validationSchedule: input.validationSchedule }),
  });
}

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-runtime-supervisor-'));
  tmpRoots.push(root);
  return root;
}

function createManifest(): LocalSimulationRuntimeManifest {
  return {
    id: 'town-runtime',
    defaults: {
      tickBatchSize: 1,
      tickIntervalMs: 100,
      commandConsumerIdPrefix: 'worker',
    },
    partitions: [
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        scenarioPresetId: 'scenario-main',
      },
      {
        simulationId: 'sim-1',
        partitionKey: 'world-east',
        scenarioPresetId: 'scenario-east',
      },
    ],
  };
}

function createScenarioPresets(): readonly ScenarioPreset[] {
  return [
    createScenarioPreset({
      id: 'scenario-main',
      agentId: agentOne,
    }),
    createScenarioPreset({
      id: 'scenario-east',
      agentId: agentTwo,
    }),
  ];
}

function createScenarioPreset(input: {
  readonly id: string;
  readonly agentId: AgentId;
}): ScenarioPreset {
  return {
    id: input.id,
    name: input.id,
    description: `${input.id} test scenario`,
    clock: { now: 0, tickDurationMs: 1000 },
    timeScale: 35,
    locations: [
      {
        locationId: mainSquare,
        name: 'Main Square',
        kind: 'social',
        activityAffinities: ['study'],
        capacity: null,
        source: 'test',
      },
    ],
    agentSeeds: [
      {
        agentId: input.agentId,
        displayName: input.agentId,
        profile: { personality: { mbti: 'INTJ' }, source: 'test' },
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
        locationId: mainSquare,
        source: 'test',
        tags: ['test'],
      },
    ],
    source: 'test',
  };
}

function appendTradeEvents(
  storage: LocalWorldRuntimeStorage,
  agentId: AgentId,
  closePrices: readonly number[],
): void {
  storage.eventStore.appendToStream({
    streamName: storage.partition.eventStreamName,
    expectedVersion: 0,
    events: closePrices.map((closePrice, index) =>
      createTradeEvent({
        id: `${storage.partition.partitionKey}:trade-${index + 1}`,
        agentId,
        price: closePrice,
        occurredAt: index,
        sequence: index + 1,
      }),
    ),
  });
}

function createTradeEvent(input: {
  readonly id: string;
  readonly agentId: AgentId;
  readonly price: number;
  readonly occurredAt: number;
  readonly sequence: number;
}): WorldEvent {
  return createEventEnvelope({
    id: input.id,
    simulationId: 'sim-1',
    type: 'TradeExecuted',
    payload: {
      agentId: input.agentId,
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

function createValidationSchedule(): LocalSimulationLifecycleValidationSchedule {
  return {
    plannerRuns: createPlannerRuns(),
    eventWindow: { afterSequence: 0, toSequence: 3 },
    expectedTrajectoryAgentIds: ['agent-1', 'agent-2'],
    trajectories: [
      { agentId: 'agent-1', stepCount: 1 },
      { agentId: 'agent-2', stepCount: 1 },
    ],
    thresholds: {
      heavyTailReturns: { minimumExcessKurtosis: -2 },
      volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
    },
  };
}

function createFailingValidationSchedule(): LocalSimulationLifecycleValidationSchedule {
  return {
    plannerRuns: createPlannerRuns(),
    expectedTrajectoryAgentIds: ['agent-1', 'agent-2'],
    trajectories: [
      { agentId: 'agent-1', stepCount: 1 },
      { agentId: 'agent-2', stepCount: 1 },
    ],
  };
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
