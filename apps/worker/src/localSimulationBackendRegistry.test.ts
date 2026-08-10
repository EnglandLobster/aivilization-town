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
    expect(registry.getBackend({ simulationId: 'sim-1', partitionKey: 'world-east' })).toBe(
      eastBackend,
    );
    expect(mainBackend.storage.paths.partitionDir).not.toBe(eastBackend.storage.paths.partitionDir);
    const eastReport = createValidationReport({
      runId: 'validation-east-1',
      generatedAt: 600,
    });
    await eastBackend.storage.experimentValidationReportRepository.record(eastReport);
    await expect(
      registry.api.queryExperimentValidationReports({
        simulationId: 'sim-1',
        partitionKey: 'world-east',
      }),
    ).resolves.toEqual([eastReport]);
    await expect(
      registry.api.queryExperimentValidationReports({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
      }),
    ).resolves.toEqual([]);

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
    expect(
      eastBackend.storage.commandStore.getStreamVersion(
        eastBackend.storage.partition.commandStreamName,
      ),
    ).toBe(1);
    expect(
      mainBackend.storage.commandStore.getStreamVersion(
        mainBackend.storage.partition.commandStreamName,
      ),
    ).toBe(0);

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
      lastAppliedSequence: 4,
    });

    const eastProjection = await registry.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-east',
    });
    expect(eastProjection.lastAppliedSequence).toBe(4);
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
    await expect(
      registry.api.queryExperimentValidationReports({
        simulationId: 'sim-1',
        partitionKey: 'world-missing',
      }),
    ).rejects.toThrow('local simulation backend is not registered: sim-1/world-missing');
    expect(registry.hasBackend({ simulationId: 'sim-1', partitionKey: 'world-missing' })).toBe(
      false,
    );
    expect(
      mainBackend.storage.commandStore.getStreamVersion(
        mainBackend.storage.partition.commandStreamName,
      ),
    ).toBe(0);
  });

  test('routes agent profile queries to the requested partition backend', async () => {
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
    const eastBackend = registry.getBackend({
      simulationId: 'sim-1',
      partitionKey: 'world-east',
    });
    await eastBackend.storage.longTermProfileRepository.applyPatches(agentTwo, [
      {
        id: 'ltm-patch-agent-2-personality-sociable-300',
        agentId: agentTwo,
        section: 'personality',
        key: 'sociable',
        statement: 'Agent 2 is sociable with east-side neighbors.',
        confidence: 0.75,
        provenanceRecordIds: [asMemoryRecordId('memory-east-social')],
        proposedAt: 300,
      },
    ]);

    await expect(
      registry.agentProfiles.queryProfiles({
        simulationId: 'sim-1',
        partitionKey: 'world-east',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        agentId: agentTwo,
        personality: [
          expect.objectContaining({
            key: 'sociable',
            statement: 'Agent 2 is sociable with east-side neighbors.',
          }),
        ],
      }),
    ]);
    await expect(
      registry.agentProfiles.getProfile({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-2',
      }),
    ).resolves.toBeUndefined();
    await expect(
      registry.agentProfiles.queryProfiles({
        simulationId: 'sim-1',
        partitionKey: 'world-missing',
      }),
    ).rejects.toThrow('local simulation backend is not registered: sim-1/world-missing');
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
      {
        taskId: 'task-1',
        variant: 'without-objective-decomposition',
        metrics: [{ metricId: 'net-worth', value: 90, higherIsBetter: true }],
      },
    ],
    expectedTrajectoryAgentIds: ['agent-1'],
    trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
    thresholds: {
      heavyTailReturns: { minimumExcessKurtosis: -2 },
    },
  });
}

function requireCompletedStartResult(
  result: LocalSimulationBackendLifecycleResult,
): LocalSimulationLifecycleStartResult {
  if (result.status !== 'completed') {
    throw new Error(`expected completed start lifecycle result, received ${result.status}`);
  }
  return result;
}
