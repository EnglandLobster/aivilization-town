import { asAgentId } from '@aivilization/sim-core';
import { createWorldProjection, type WorldCommandPolicies } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalWorldRuntimeStorage, runLocalWorldRuntimeLoop } from './index';

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
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-runtime-loop-'));
  tmpRoots.push(root);
  return root;
}

describe('local world runtime loop', () => {
  test('pauses before the requested tick and resumes from persisted event/checkpoint state', async () => {
    const rootDir = createRootDir();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });

    const paused = await runLocalWorldRuntimeLoop({
      storage,
      loopId: 'loop-main',
      simulationId: 'sim-1',
      firstTickIndex: 1,
      tickCount: 3,
      issuedAtStart: 1000,
      tickIntervalMs: 100,
      initialProjection: createInitialProjection(),
      policies,
      commandConsumerId: 'worker-main',
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      pauseBeforeTick: ({ tickIndex }) => tickIndex === 2,
    });

    expect(paused.status).toBe('paused');
    expect(paused.completedTickCount).toBe(1);
    expect(paused.nextTickIndex).toBe(2);
    expect(paused.steps.map((step) => [step.tickIndex, requireTickedStep(step).tickId])).toEqual([
      [1, 'loop-main:tick:1'],
    ]);
    expect(
      storage.eventStore
        .readStream(storage.partition.eventStreamName)
        .map((event) => [event.sequence, event.type]),
    ).toEqual([[1, 'SimulationTimeAdvanced']]);

    const restarted = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const resumed = await runLocalWorldRuntimeLoop({
      storage: restarted,
      loopId: 'loop-main',
      simulationId: 'sim-1',
      firstTickIndex: paused.nextTickIndex,
      tickCount: 2,
      issuedAtStart: 1000,
      tickIntervalMs: 100,
      initialProjection: createInitialProjection(),
      policies,
      commandConsumerId: 'worker-main',
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });

    expect(resumed.status).toBe('completed');
    expect(resumed.completedTickCount).toBe(2);
    expect(resumed.nextTickIndex).toBe(4);
    expect(resumed.steps.map((step) => [step.tickIndex, requireTickedStep(step).tickId])).toEqual([
      [2, 'loop-main:tick:2'],
      [3, 'loop-main:tick:3'],
    ]);
    expect(
      restarted.eventStore
        .readStream(restarted.partition.eventStreamName)
        .map((event) => [event.sequence, event.type]),
    ).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'SimulationTimeAdvanced'],
      [3, 'SimulationTimeAdvanced'],
    ]);
    expect(
      restarted.checkpointStore.getLatestCheckpoint({
        simulationId: restarted.partition.simulationId,
        partitionKey: restarted.partition.partitionKey,
      }),
    ).toMatchObject({ lastAppliedSequence: 3 });
  });
});

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

function requireTickedStep(
  step: Awaited<ReturnType<typeof runLocalWorldRuntimeLoop>>['steps'][number],
) {
  if (step.tick === undefined) {
    throw new Error(`expected ticked loop step ${step.tickIndex}`);
  }
  return step.tick;
}
