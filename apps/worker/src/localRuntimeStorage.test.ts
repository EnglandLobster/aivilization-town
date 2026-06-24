import {
  createBranchPlan,
  markSubtaskBlocked,
  type AtomicActionProposal,
  type DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import {
  createCommandConsumerCheckpoint,
  createCommandEnvelope,
  asAgentId,
  asSimulationId,
} from '@aivilization/sim-core';
import { createExperimentValidationReport } from '@aivilization/observability';
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
  createLocalWorldRuntimeStorage,
  handleWorkerSteeringCommand,
  runWorkerSimulationTick,
} from './index';

const simulationId = asSimulationId('sim-1');
const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Bread: 15 },
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
  sleep: { energyRecoveryPerSecond: 1, maxEnergy: 100 },
  jobApplication: {
    populationEducationScores: [0],
    quotaByResidentialTier: [1, 1, 1, 1, 1],
  },
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
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-runtime-'));
  tmpRoots.push(root);
  return root;
}

function createProjection() {
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
      {
        agentId: agentTwo,
        physiology: { energy: 60, satiety: 80, health: 100 },
        educationScore: 20,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
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

function createStudyPlanner(action: AtomicActionProposal): DomainMicroPlanner {
  return {
    domain: 'study',
    supports: ({ subtaskId }) => subtaskId === 'study',
    propose: () => [action],
  };
}

function createTickAgents() {
  return [
    {
      agentId: agentOne,
      observedStateSummary: 'agent-1 education=10',
      plan: createStudyPlan(),
      signals: [],
      microPlanners: [
        createStudyPlanner({
          id: 'study-agent-1',
          description: 'agent 1 studies',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 60, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    },
    {
      agentId: agentTwo,
      observedStateSummary: 'agent-2 education=20',
      plan: createStudyPlan(),
      signals: [],
      microPlanners: [
        createStudyPlanner({
          id: 'study-agent-2',
          description: 'agent 2 studies',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 30, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    },
  ] satisfies Parameters<typeof runWorkerSimulationTick>[0]['agents'];
}

describe('local world runtime storage', () => {
  test('restarts file-backed world tick storage and continues from the latest checkpoint', async () => {
    const rootDir = createRootDir();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId,
      partitionKey: 'world-main',
    });

    const first = await runWorkerSimulationTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore: storage.eventStore,
      streamName: storage.partition.eventStreamName,
      expectedVersion: 0,
      checkpointing: storage.checkpointing,
      agents: createTickAgents(),
      ...storage.repositories,
    });
    const progress = await storage.planProgressRepository.getOrCreate({
      planId: 'plan-1',
      agentId: agentOne,
      createdAt: 100,
    });
    await storage.planProgressRepository.save(
      markSubtaskBlocked(progress, {
        subtaskId: 'study',
        reason: 'repeated-failure: energy too low',
        blockedAt: 150,
      }),
    );
    const planRecord = {
      planId: 'plan-1',
      agentId: agentOne,
      plan: createStudyPlan(),
      createdAt: 100,
      updatedAt: 100,
    };
    await storage.planRepository.save(planRecord);
    const validationReport = createValidationReport();
    await storage.experimentValidationReportRepository.record(validationReport);
    await storage.objectiveRenewalTraceRepository.record({
      traceId: 'objective-trace-1',
      simulationId,
      partitionKey: 'world-main',
      agentId: agentOne,
      objectiveId: 'objective-study',
      selectedCandidateId: 'education-development',
      rationale: 'Education score is below the next job threshold.',
      score: 42,
      shortTermMemoryContextIds: ['memory-study-observed'],
      profileEntryKeys: ['values:education'],
      profileEvidenceRecordIds: ['profile-record-1'],
      issuedAt: 176,
    });
    await storage.steeringTraceRepository.record({
      traceId: 'sim-1:world-main:1:cmd-objective-study',
      simulationId,
      partitionKey: 'world-main',
      commandId: 'cmd-objective-study',
      commandType: 'SetLongHorizonObjective',
      source: 'human',
      agentId: agentOne,
      resultKind: 'long-horizon-objective-set',
      objectiveId: 'objective-study',
      planId: 'objective-study',
      candidateActionCount: 0,
      commandDraftCount: 0,
      shortTermMemoryRecordIds: [],
      strategicPlan: {
        status: 'deterministic',
        source: 'deterministic',
      },
      issuedAt: 175,
      recordedAt: 1000,
    });
    await handleWorkerSteeringCommand({
      command: createCommandEnvelope({
        id: 'cmd-objective-study',
        simulationId,
        actorId: agentOne,
        source: 'human',
        type: 'SetLongHorizonObjective',
        payload: {
          objectiveId: 'objective-study',
          statement: 'Do not work yet; study until education score exceeds 100.',
          priority: 2,
          affinityTags: ['study', 'education'],
        },
        issuedAt: 175,
      }),
      localizedPlanners: [],
      simulate: ({ action }) => ({ status: 'accepted', action }),
      ...storage.repositories,
    });

    const restarted = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId,
      partitionKey: 'world-main',
    });

    expect(first.streamVersion).toBe(5);
    expect(storage.paths.partitionDir).toContain('simulations');
    expect(storage.paths.planningDir).toContain('planning');
    await expect(
      restarted.experimentValidationReportRepository.get('validation-run-1'),
    ).resolves.toEqual(validationReport);
    await expect(
      restarted.objectiveRenewalTraceRepository.get('objective-trace-1'),
    ).resolves.toEqual({
      traceId: 'objective-trace-1',
      simulationId,
      partitionKey: 'world-main',
      agentId: agentOne,
      objectiveId: 'objective-study',
      selectedCandidateId: 'education-development',
      rationale: 'Education score is below the next job threshold.',
      score: 42,
      shortTermMemoryContextIds: ['memory-study-observed'],
      profileEntryKeys: ['values:education'],
      profileEvidenceRecordIds: ['profile-record-1'],
      issuedAt: 176,
    });
    await expect(
      restarted.steeringTraceRepository.get('sim-1:world-main:1:cmd-objective-study'),
    ).resolves.toMatchObject({
      traceId: 'sim-1:world-main:1:cmd-objective-study',
      commandId: 'cmd-objective-study',
      resultKind: 'long-horizon-objective-set',
      objectiveId: 'objective-study',
      strategicPlan: {
        source: 'deterministic',
      },
    });
    await expect(
      restarted.planRepository.require({
        planId: 'plan-1',
        agentId: agentOne,
      }),
    ).resolves.toEqual(planRecord);
    await expect(
      restarted.planRepository.require({
        planId: 'objective-study',
        agentId: agentOne,
      }),
    ).resolves.toMatchObject({
      planId: 'objective-study',
      agentId: agentOne,
      createdAt: 175,
      updatedAt: 175,
      plan: {
        objective: 'Do not work yet; study until education score exceeds 100.',
      },
    });
    expect(restarted.eventStore.getStreamVersion(restarted.partition.eventStreamName)).toBe(5);
    await expect(
      restarted.planProgressRepository.getOrCreate({
        planId: 'plan-1',
        agentId: agentOne,
        createdAt: 999,
      }),
    ).resolves.toEqual({
      planId: 'plan-1',
      agentId: agentOne,
      completedSubtaskIds: [],
      blockedSubtasks: [
        {
          subtaskId: 'study',
          reason: 'repeated-failure: energy too low',
          blockedAt: 150,
        },
      ],
      updatedAt: 150,
    });
    expect(
      restarted.checkpointStore.getLatestCheckpoint({
        simulationId,
        partitionKey: restarted.partition.partitionKey,
      })?.lastAppliedSequence,
    ).toBe(5);
    await expect(
      restarted.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        statuses: ['succeeded'],
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toHaveLength(1);

    const second = await runWorkerSimulationTick({
      tickId: 'tick-2',
      simulationId,
      issuedAt: 200,
      projectionHydration: {
        initialProjection: createProjection(),
        checkpoint: restarted.checkpointHydration,
      },
      policies,
      eventStore: restarted.eventStore,
      streamName: restarted.partition.eventStreamName,
      checkpointing: restarted.checkpointing,
      agents: createTickAgents(),
      ...restarted.repositories,
    });

    expect(second.events.map((event: WorldEvent) => [event.sequence, event.type])).toEqual([
      [6, 'SimulationTimeAdvanced'],
      [7, 'EducationChanged'],
      [8, 'ShortTermMemoryRecorded'],
      [9, 'EducationChanged'],
      [10, 'ShortTermMemoryRecorded'],
    ]);
    expect(second.projection.clock).toEqual({ now: 2000, tickDurationMs: 1000 });
    expect(second.projection.agents['agent-1']?.educationScore).toBe(130);
    expect(second.projection.agents['agent-2']?.educationScore).toBe(80);
    expect(second.streamVersion).toBe(10);
    expect(restarted.eventStore.getStreamVersion(restarted.partition.eventStreamName)).toBe(10);
    expect(
      restarted.checkpointStore.getLatestCheckpoint({
        simulationId,
        partitionKey: restarted.partition.partitionKey,
      }),
    ).toEqual(second.checkpoint);
    if (second.snapshot === undefined) {
      throw new Error('expected second tick to write a snapshot');
    }
    expect(restarted.snapshotStore.loadSnapshot(second.snapshot)).toEqual(second.projection);
    await expect(
      restarted.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        statuses: ['succeeded'],
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toHaveLength(2);
  });

  test('persists worker tick traces through local trace repository storage', async () => {
    const rootDir = createRootDir();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId,
      partitionKey: 'world-main',
    });

    await runWorkerSimulationTick({
      tickId: 'tick-trace',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore: storage.eventStore,
      streamName: storage.partition.eventStreamName,
      expectedVersion: 0,
      agents: [createTickAgents()[0]!],
      traceSink: storage.agentCycleTraceRepository,
      ...storage.repositories,
    });

    const restarted = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId,
      partitionKey: 'world-main',
    });

    expect(storage.paths.observabilityDir).toContain('observability');
    await expect(
      restarted.agentCycleTraceRepository.query({ simulationId }),
    ).resolves.toMatchObject([
      {
        traceId: 'tick-trace:cycle:1:agent-1',
        simulationId: 'sim-1',
        agentId: 'agent-1',
        selectedBranch: 'development',
        selectionEvidence: {
          selectedSubtaskId: 'study',
        },
      },
    ]);
  });

  test('restarts file-backed command inbox and command consumer checkpoint storage', () => {
    const rootDir = createRootDir();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId,
      partitionKey: 'world-main',
    });
    const command = createCommandEnvelope({
      id: 'cmd-reactive-buy-fish',
      simulationId,
      actorId: agentOne,
      source: 'human',
      type: 'IssueReactiveCommand',
      payload: {
        reactiveCommandId: 'reactive-buy-fish',
        summary: 'buy 10 fish now',
      },
      issuedAt: 300,
    });

    storage.commandStore.appendToStream({
      streamName: storage.partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-command-1',
      commands: [command],
    });
    storage.commandConsumerCheckpointStore.saveCheckpoint(
      createCommandConsumerCheckpoint({
        consumerId: 'worker-main',
        streamName: storage.partition.commandStreamName,
        lastConsumedSequence: 1,
        updatedAt: 400,
      }),
    );
    const restarted = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId,
      partitionKey: 'world-main',
    });

    expect(restarted.paths.commandStoreDir).toContain('commands');
    expect(restarted.paths.commandConsumerCheckpointStoreDir).toContain(
      'command-consumer-checkpoints',
    );
    expect(
      restarted.commandStore
        .readStream(restarted.partition.commandStreamName)
        .map((record) => ({ sequence: record.sequence, id: record.command.id })),
    ).toEqual([{ sequence: 1, id: 'cmd-reactive-buy-fish' }]);
    expect(
      restarted.commandConsumerCheckpointStore.getLatestCheckpoint({
        consumerId: 'worker-main',
        streamName: restarted.partition.commandStreamName,
      }),
    ).toEqual({
      consumerId: 'worker-main',
      streamName: restarted.partition.commandStreamName,
      lastConsumedSequence: 1,
      updatedAt: 400,
    });
  });
});

function createValidationReport() {
  return createExperimentValidationReport({
    run: {
      runId: 'validation-run-1',
      simulationId,
      generatedAt: 180,
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
