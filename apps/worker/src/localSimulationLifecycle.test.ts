import { asAgentId, type SimulationTimestamp } from '@aivilization/sim-core';
import { createWorldProjection, type WorldCommandPolicies } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createLocalSimulationLifecycleController,
  createLocalWorldRuntimeStorage,
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
});

function createController(input: {
  readonly storage: ReturnType<typeof createLocalWorldRuntimeStorage>;
  readonly initialProjection: ReturnType<typeof createInitialProjection>;
}) {
  return createLocalSimulationLifecycleController({
    storage: input.storage,
    lifecycleStateStore: input.storage.lifecycleStateStore,
    loopId: 'loop-main',
    tickBatchSize: 2,
    tickIntervalMs: 100,
    simulationId: 'sim-1',
    initialProjection: input.initialProjection,
    policies,
    commandConsumerId: 'worker-main',
    localizedPlanners: [],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    agents: [],
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
  });
}
