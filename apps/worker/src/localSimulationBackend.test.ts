import { type ReactiveLocalizedPlanner } from '@aivilization/agent-runtime';
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
    ).rejects.toThrow('request partitionKey world-other must match storage partitionKey world-main');
    expect(storage.commandStore.getStreamVersion(storage.partition.commandStreamName)).toBe(0);
  });
});

function createBackend(
  storage: ReturnType<typeof createLocalWorldRuntimeStorage>,
): LocalSimulationBackend {
  return createLocalSimulationBackend({
    storage,
    loopId: 'loop-main',
    tickBatchSize: 1,
    tickIntervalMs: 100,
    simulationId: 'sim-1',
    initialProjection: createInitialProjection(),
    policies,
    commandConsumerId: 'worker-main',
    localizedPlanners: [reactiveStudyPlanner()],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    agents: [],
  });
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
