import { type ReactiveLocalizedPlanner } from '@aivilization/agent-runtime';
import { asAgentId } from '@aivilization/sim-core';
import { createWorldProjection, type WorldCommandPolicies } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createLocalSimulationBackendRegistry,
  type LocalSimulationBackendLifecycleResult,
  type LocalSimulationBackendRegistration,
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
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-backend-registry-'));
  tmpRoots.push(root);
  return root;
}

describe('local simulation backend registry', () => {
  test('routes one API service across registered partitions while isolating local storage', async () => {
    const registry = createLocalSimulationBackendRegistry({
      rootDir: createRootDir(),
      registrations: [
        createRegistration({
          partitionKey: 'world-main',
          agentId: agentOne,
          educationScore: 10,
        }),
        createRegistration({
          partitionKey: 'world-east',
          agentId: agentTwo,
          educationScore: 20,
        }),
      ],
    });

    expect(registry.listPartitions()).toEqual([
      { simulationId: 'sim-1', partitionKey: 'world-main' },
      { simulationId: 'sim-1', partitionKey: 'world-east' },
    ]);
    const mainBackend = registry.getBackend({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const eastBackend = registry.getBackend({
      simulationId: 'sim-1',
      partitionKey: 'world-east',
    });
    expect(
      registry.getBackend({ simulationId: 'sim-1', partitionKey: 'world-east' }),
    ).toBe(eastBackend);
    expect(mainBackend.storage.paths.partitionDir).not.toBe(eastBackend.storage.paths.partitionDir);

    const submission = await registry.api.submitReactiveCommand({
      simulationId: 'sim-1',
      partitionKey: 'world-east',
      agentId: 'agent-2',
      reactiveCommandId: 'reactive-study-east',
      commandId: 'cmd-reactive-study-east',
      summary: 'study in the east partition',
      issuedAt: 100,
      expectedVersion: 0,
    });

    expect(submission.result.streamName).toBe(eastBackend.storage.partition.commandStreamName);
    expect(eastBackend.storage.commandStore.getStreamVersion(eastBackend.storage.partition.commandStreamName)).toBe(
      1,
    );
    expect(mainBackend.storage.commandStore.getStreamVersion(mainBackend.storage.partition.commandStreamName)).toBe(
      0,
    );

    const started = requireCompletedStartResult(
      await registry.api.startSimulation({
        simulationId: 'sim-1',
        partitionKey: 'world-east',
        requestedAt: 200,
      }),
    );
    expect(started.state).toMatchObject({
      status: 'completed',
      nextTickIndex: 2,
      lastAppliedSequence: 3,
    });

    const eastProjection = await registry.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-east',
    });
    expect(eastProjection.lastAppliedSequence).toBe(3);
    expect(eastProjection.projection.agents['agent-2']?.educationScore).toBe(80);

    const mainProjection = await registry.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(mainProjection.lastAppliedSequence).toBe(0);
    expect(mainProjection.projection.agents['agent-1']?.educationScore).toBe(10);
  });

  test('rejects unknown partitions before command submission can create storage state', async () => {
    const registry = createLocalSimulationBackendRegistry({
      rootDir: createRootDir(),
      registrations: [
        createRegistration({
          partitionKey: 'world-main',
          agentId: agentOne,
          educationScore: 10,
        }),
      ],
    });
    const mainBackend = registry.getBackend({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });

    await expect(
      registry.api.submitReactiveCommand({
        simulationId: 'sim-1',
        partitionKey: 'world-missing',
        agentId: 'agent-1',
        reactiveCommandId: 'reactive-study-missing',
        commandId: 'cmd-reactive-study-missing',
        summary: 'this should not create an inbox',
        issuedAt: 100,
        expectedVersion: 0,
      }),
    ).rejects.toThrow('local simulation backend is not registered: sim-1/world-missing');
    expect(registry.hasBackend({ simulationId: 'sim-1', partitionKey: 'world-missing' })).toBe(
      false,
    );
    expect(mainBackend.storage.commandStore.getStreamVersion(mainBackend.storage.partition.commandStreamName)).toBe(
      0,
    );
  });

  test('rejects duplicate partition registrations at startup', () => {
    expect(() =>
      createLocalSimulationBackendRegistry({
        rootDir: createRootDir(),
        registrations: [
          createRegistration({
            partitionKey: 'world-main',
            agentId: agentOne,
            educationScore: 10,
          }),
          createRegistration({
            partitionKey: 'world-main',
            agentId: agentTwo,
            educationScore: 20,
          }),
        ],
      }),
    ).toThrow('duplicate local simulation backend registration: sim-1/world-main');
  });
});

function createRegistration(input: {
  readonly partitionKey: string;
  readonly agentId: typeof agentOne;
  readonly educationScore: number;
}): LocalSimulationBackendRegistration {
  return {
    simulationId: 'sim-1',
    partitionKey: input.partitionKey,
    loopId: `loop-${input.partitionKey}`,
    tickBatchSize: 1,
    tickIntervalMs: 100,
    initialProjection: createInitialProjection(input),
    policies,
    commandConsumerId: `worker-${input.partitionKey}`,
    localizedPlanners: [reactiveStudyPlanner()],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    agents: [],
  };
}

function createInitialProjection(input: {
  readonly agentId: typeof agentOne;
  readonly educationScore: number;
}) {
  return createWorldProjection({
    agents: [
      {
        agentId: input.agentId,
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: input.educationScore,
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

function requireCompletedStartResult(
  result: LocalSimulationBackendLifecycleResult,
): LocalSimulationLifecycleStartResult {
  if (result.status !== 'completed') {
    throw new Error(`expected completed start lifecycle result, received ${result.status}`);
  }
  return result;
}
