import {
  createBranchPlan,
  type AtomicActionProposal,
  type DomainMicroPlanner,
  type ReactiveLocalizedPlanner,
} from '@aivilization/agent-runtime';
import { asAgentId, asLocationId, type AgentId } from '@aivilization/sim-core';
import { type ScenarioPreset } from '@aivilization/content';
import { type WorldCommandPolicies } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createLocalSimulationBackendRegistryFromManifest,
  createLocalSimulationBackendRegistrationsFromManifest,
  type LocalSimulationBackendLifecycleResult,
  type LocalSimulationLifecycleStartResult,
  type LocalSimulationLifecycleMemoryConsolidationSchedule,
  type LocalSimulationLifecycleValidationSchedule,
  type LocalSimulationRuntimeManifest,
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

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-runtime-manifest-'));
  tmpRoots.push(root);
  return root;
}

describe('local simulation runtime manifest', () => {
  test('creates backend registry registrations from scenario preset ids and runtime defaults', async () => {
    const manifest: LocalSimulationRuntimeManifest = {
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
          loopId: 'loop-main',
        },
        {
          simulationId: 'sim-1',
          partitionKey: 'world-east',
          scenarioPresetId: 'scenario-east',
          loopId: 'loop-east',
        },
      ],
    };
    const scenarioPresets = [
      createScenarioPreset({
        id: 'scenario-main',
        agentId: agentOne,
        educationScore: 10,
      }),
      createScenarioPreset({
        id: 'scenario-east',
        agentId: agentTwo,
        educationScore: 20,
      }),
    ];

    const registrations = createLocalSimulationBackendRegistrationsFromManifest({
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [reactiveStudyPlanner()],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });

    expect(
      registrations.map((registration) => ({
        simulationId: registration.simulationId,
        partitionKey: registration.partitionKey,
        loopId: registration.loopId,
        tickBatchSize: registration.tickBatchSize,
        tickIntervalMs: registration.tickIntervalMs,
        commandConsumerId: registration.commandConsumerId,
        agentIds: Object.keys(registration.initialProjection.agents),
      })),
    ).toEqual([
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        loopId: 'loop-main',
        tickBatchSize: 1,
        tickIntervalMs: 100,
        commandConsumerId: 'worker-world-main',
        agentIds: ['agent-1'],
      },
      {
        simulationId: 'sim-1',
        partitionKey: 'world-east',
        loopId: 'loop-east',
        tickBatchSize: 1,
        tickIntervalMs: 100,
        commandConsumerId: 'worker-world-east',
        agentIds: ['agent-2'],
      },
    ]);

    const validationSchedule = createValidationSchedule();
    const validationRegistrations = createLocalSimulationBackendRegistrationsFromManifest({
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [reactiveStudyPlanner()],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      validationSchedule,
    });
    expect(validationRegistrations.map((registration) => registration.validationSchedule)).toEqual([
      validationSchedule,
      validationSchedule,
    ]);
    const memoryConsolidationSchedule = createMemoryConsolidationSchedule();
    const memoryConsolidationRegistrations = createLocalSimulationBackendRegistrationsFromManifest({
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [reactiveStudyPlanner()],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      memoryConsolidationSchedule,
    });
    expect(
      memoryConsolidationRegistrations.map(
        (registration) => registration.memoryConsolidationSchedule,
      ),
    ).toEqual([memoryConsolidationSchedule, memoryConsolidationSchedule]);

    const registry = createLocalSimulationBackendRegistryFromManifest({
      rootDir: createRootDir(),
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [reactiveStudyPlanner()],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });

    await registry.api.submitReactiveCommand({
      simulationId: 'sim-1',
      partitionKey: 'world-east',
      agentId: 'agent-2',
      reactiveCommandId: 'reactive-study-east',
      commandId: 'cmd-study-east',
      summary: 'study in the east runtime',
      issuedAt: 100,
      expectedVersion: 0,
    });
    const started = requireCompletedStartResult(
      await registry.api.startSimulation({
        simulationId: 'sim-1',
        partitionKey: 'world-east',
        requestedAt: 200,
      }),
    );
    expect(started.state.lastAppliedSequence).toBe(3);

    const eastProjection = await registry.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-east',
    });
    expect(eastProjection.projection.agents['agent-2']?.educationScore).toBe(80);

    const mainProjection = await registry.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(mainProjection.projection.agents['agent-1']?.educationScore).toBe(10);
  });

  test('rejects manifest partitions that reference an unknown scenario preset', () => {
    expect(() =>
      createLocalSimulationBackendRegistrationsFromManifest({
        manifest: {
          id: 'broken-runtime',
          defaults: { tickBatchSize: 1, tickIntervalMs: 100 },
          partitions: [
            {
              simulationId: 'sim-1',
              partitionKey: 'world-main',
              scenarioPresetId: 'missing-scenario',
            },
          ],
        },
        scenarioPresets: [],
        policies,
        localizedPlanners: [],
        steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
        agents: [],
      }),
    ).toThrow('scenario preset is not registered: missing-scenario');
  });

  test('propagates a dynamic agent provider into manifest-created backends', async () => {
    const manifest: LocalSimulationRuntimeManifest = {
      id: 'town-runtime-provider',
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
      ],
    };
    const providerObserved: string[] = [];
    const registry = createLocalSimulationBackendRegistryFromManifest({
      rootDir: createRootDir(),
      manifest,
      scenarioPresets: [
        createScenarioPreset({
          id: 'scenario-main',
          agentId: agentOne,
          educationScore: 10,
        }),
      ],
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      agentProvider: ({ projection, storage }) => {
        providerObserved.push(
          `${storage.partition.partitionKey}:${projection.agents['agent-1']?.educationScore ?? -1}`,
        );
        return [
          {
            agentId: agentOne,
            observedStateSummary: 'provider-built manifest agent',
            plan: createStudyPlan(),
            signals: [],
            microPlanners: [
              studyMicroPlanner({
                id: 'study-from-manifest-provider',
                description: 'study from manifest provider',
                commandType: 'AgentStudy',
                payload: { durationSeconds: 30, educationRatePerSecond: 1 },
              }),
            ],
            simulate: ({ action }) => ({ status: 'accepted', action }),
          },
        ];
      },
    });

    const started = requireCompletedStartResult(
      await registry.api.startSimulation({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        requestedAt: 200,
      }),
    );
    expect(started.state.lastAppliedSequence).toBe(3);
    expect(providerObserved).toEqual(['world-main:10']);

    const projection = await registry.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(projection.projection.agents['agent-1']?.educationScore).toBe(40);
  });

  test('rejects duplicate scenario preset ids in the catalog input', () => {
    const duplicate = createScenarioPreset({
      id: 'scenario-main',
      agentId: agentOne,
      educationScore: 10,
    });

    expect(() =>
      createLocalSimulationBackendRegistrationsFromManifest({
        manifest: {
          id: 'broken-runtime',
          defaults: { tickBatchSize: 1, tickIntervalMs: 100 },
          partitions: [
            {
              simulationId: 'sim-1',
              partitionKey: 'world-main',
              scenarioPresetId: 'scenario-main',
            },
          ],
        },
        scenarioPresets: [duplicate, duplicate],
        policies,
        localizedPlanners: [],
        steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
        agents: [],
      }),
    ).toThrow('duplicate scenario preset id: scenario-main');
  });

  test('rejects blank runtime partition identities in the manifest', () => {
    const scenario = createScenarioPreset({
      id: 'scenario-main',
      agentId: agentOne,
      educationScore: 10,
    });

    expect(() =>
      createLocalSimulationBackendRegistrationsFromManifest({
        manifest: {
          id: 'broken-runtime',
          defaults: { tickBatchSize: 1, tickIntervalMs: 100 },
          partitions: [
            {
              simulationId: ' ',
              partitionKey: 'world-main',
              scenarioPresetId: 'scenario-main',
            },
          ],
        },
        scenarioPresets: [scenario],
        policies,
        localizedPlanners: [],
        steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
        agents: [],
      }),
    ).toThrow('simulationId must not be empty');

    expect(() =>
      createLocalSimulationBackendRegistrationsFromManifest({
        manifest: {
          id: 'broken-runtime',
          defaults: { tickBatchSize: 1, tickIntervalMs: 100 },
          partitions: [
            {
              simulationId: 'sim-1',
              partitionKey: ' ',
              scenarioPresetId: 'scenario-main',
            },
          ],
        },
        scenarioPresets: [scenario],
        policies,
        localizedPlanners: [],
        steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
        agents: [],
      }),
    ).toThrow('partitionKey must not be empty');
  });
});

function createScenarioPreset(input: {
  readonly id: string;
  readonly agentId: AgentId;
  readonly educationScore: number;
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
        educationScore: input.educationScore,
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

function createValidationSchedule(): LocalSimulationLifecycleValidationSchedule {
  return {
    runIdPrefix: 'runtime-validation',
    plannerRuns: [
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
    ],
    expectedTrajectoryAgentIds: ['agent-1'],
    trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
  };
}

function createMemoryConsolidationSchedule(): LocalSimulationLifecycleMemoryConsolidationSchedule {
  return {
    retrievalLimit: 10,
    minPatternCount: 3,
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

function createStudyPlan() {
  return createBranchPlan({
    objective: 'develop education',
    branches: [
      {
        id: 'development',
        objective: 'improve education',
        subtasks: [{ id: 'study', description: 'self study', basePriority: 5 }],
      },
    ],
  });
}

function studyMicroPlanner(action: AtomicActionProposal): DomainMicroPlanner {
  return {
    domain: 'study',
    supports: ({ subtaskId }) => subtaskId === 'study',
    propose: () => [action],
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
