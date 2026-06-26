import {
  createBranchPlan,
  type ReactiveLocalizedPlanner,
  type StrategicPlanCompilationTrace,
} from '@aivilization/agent-runtime';
import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { createWorldProjection, type WorldCommandPolicies } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createLocalWorldRuntimeStorage,
  drainLocalRuntimeSteeringCommands,
  drainLocalRuntimeSteeringCommandsToWorld,
  type WorkerSteeringCommand,
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
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-command-drain-'));
  tmpRoots.push(root);
  return root;
}

function objectiveCommand(): WorkerSteeringCommand {
  return createCommandEnvelope({
    id: 'cmd-objective-study',
    simulationId: 'sim-1',
    actorId: agentOne,
    source: 'human',
    type: 'SetLongHorizonObjective',
    payload: {
      objectiveId: 'objective-study',
      statement: 'Study until education score exceeds 100.',
      priority: 2,
      affinityTags: ['study', 'education'],
    },
    issuedAt: 100,
  });
}

function reactiveTradeCommand(input: {
  readonly id: string;
  readonly reactiveCommandId: string;
  readonly summary: string;
  readonly issuedAt: number;
}): WorkerSteeringCommand {
  return createCommandEnvelope({
    id: input.id,
    simulationId: 'sim-1',
    actorId: agentOne,
    source: 'human',
    type: 'IssueReactiveCommand',
    payload: {
      reactiveCommandId: input.reactiveCommandId,
      summary: input.summary,
      tags: ['trade', 'fish'],
    },
    issuedAt: input.issuedAt,
  });
}

describe('local runtime steering command drain', () => {
  test('drains persisted steering commands into runtime repositories and checkpoints progress', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    appendCommands(storage.partition.commandStreamName, storage.commandStore, [
      objectiveCommand(),
      reactiveTradeCommand({
        id: 'cmd-reactive-buy-fish',
        reactiveCommandId: 'reactive-buy-fish',
        summary: 'buy 10 fish now',
        issuedAt: 200,
      }),
    ]);

    const result = await drainLocalRuntimeSteeringCommands({
      storage,
      consumerId: 'worker-main',
      checkpointUpdatedAt: 1000,
      localizedPlanners: [
        {
          domain: 'trade',
          supports: ({ summary }) => summary.includes('fish'),
          propose: () => [
            {
              id: 'buy-fish',
              description: 'buy 10 fish',
              commandType: 'AgentTrade',
              payload: { side: 'buy', commodityName: 'Fish', quantity: 10 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.status).toBe('drained');
    expect(result.handledRecords.map((record) => record.command.id)).toEqual([
      'cmd-objective-study',
      'cmd-reactive-buy-fish',
    ]);
    expect(result.results.map((item) => item.kind)).toEqual([
      'long-horizon-objective-set',
      'reactive-command-routed',
    ]);
    expect(result.checkpoint).toMatchObject({
      consumerId: 'worker-main',
      streamName: storage.partition.commandStreamName,
      lastConsumedSequence: 2,
      updatedAt: 1000,
    });
    await expect(storage.intentionRepository.getOrCreate(agentOne)).resolves.toMatchObject({
      activeObjective: {
        id: 'objective-study',
        statement: 'Study until education score exceeds 100.',
      },
    });
    await expect(
      storage.planRepository.require({ planId: 'objective-study', agentId: agentOne }),
    ).resolves.toMatchObject({
      planId: 'objective-study',
      agentId: 'agent-1',
      plan: { objective: 'Study until education score exceeds 100.' },
    });
    await expect(
      storage.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        kinds: ['human-command'],
        requiredTags: ['strategic', 'long-horizon-objective'],
        limit: 10,
      }),
    ).resolves.toMatchObject([
      {
        id: 'cmd-objective-study:strategic-objective',
        summary:
          'Human steering set long-horizon objective: Study until education score exceeds 100.',
      },
    ]);
    await expect(storage.longTermProfileRepository.getOrCreate(agentOne)).resolves.toMatchObject({
      values: [
        {
          key: 'human-objective:objective-study',
          statement:
            'Human steering set long-horizon objective: Study until education score exceeds 100.',
          provenanceRecordIds: ['cmd-objective-study:strategic-objective'],
        },
      ],
    });
    await expect(
      storage.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        kinds: ['human-command'],
        requiredTags: ['reactive'],
        limit: 10,
      }),
    ).resolves.toHaveLength(2);
  });

  test('resumes from persisted checkpoints after local runtime restart', async () => {
    const rootDir = createRootDir();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    appendCommands(storage.partition.commandStreamName, storage.commandStore, [
      reactiveTradeCommand({
        id: 'cmd-reactive-buy-fish',
        reactiveCommandId: 'reactive-buy-fish',
        summary: 'buy 10 fish now',
        issuedAt: 200,
      }),
    ]);
    await drainLocalRuntimeSteeringCommands({
      storage,
      consumerId: 'worker-main',
      checkpointUpdatedAt: 1000,
      localizedPlanners: [tradePlanner()],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    const restarted = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    restarted.commandStore.appendToStream({
      streamName: restarted.partition.commandStreamName,
      expectedVersion: 1,
      idempotencyKey: 'append-command-2',
      commands: [
        reactiveTradeCommand({
          id: 'cmd-reactive-sell-fish',
          reactiveCommandId: 'reactive-sell-fish',
          summary: 'sell 3 fish now',
          issuedAt: 300,
        }),
      ],
    });

    const result = await drainLocalRuntimeSteeringCommands({
      storage: restarted,
      consumerId: 'worker-main',
      checkpointUpdatedAt: 1100,
      localizedPlanners: [tradePlanner()],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.previousCheckpoint).toMatchObject({ lastConsumedSequence: 1 });
    expect(result.handledRecords.map((record) => record.command.id)).toEqual([
      'cmd-reactive-sell-fish',
    ]);
    expect(result.checkpoint).toMatchObject({
      lastConsumedSequence: 2,
      updatedAt: 1100,
    });
  });

  test('records durable steering traces while draining objective and reactive commands', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    appendCommands(storage.partition.commandStreamName, storage.commandStore, [
      objectiveCommand(),
      reactiveTradeCommand({
        id: 'cmd-reactive-buy-fish',
        reactiveCommandId: 'reactive-buy-fish',
        summary: 'buy 10 fish now',
        issuedAt: 200,
      }),
    ]);

    const result = await drainLocalRuntimeSteeringCommands({
      storage,
      consumerId: 'worker-main',
      checkpointUpdatedAt: 1000,
      localizedPlanners: [tradePlanner()],
      simulate: ({ action }) => ({ status: 'accepted', action }),
      strategicPlanCompiler: ({ objective }) => ({
        plan: createBranchPlan({
          objective: objective.statement,
          branches: [
            {
              id: 'llm-development',
              objective: 'Use an LLM-proposed route.',
              subtasks: [{ id: 'study', description: 'Study via LLM.', basePriority: 12 }],
            },
          ],
        }),
        planningTrace: createPlanningTrace('steering-llm-plan-objective-study'),
      }),
    });

    expect(result.status).toBe('drained');
    const traces = await storage.steeringTraceRepository.query({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(traces).toHaveLength(2);
    expect(traces[0]).toMatchObject({
      traceId: 'sim-1:world-main:2:cmd-reactive-buy-fish',
      commandId: 'cmd-reactive-buy-fish',
      resultKind: 'reactive-command-routed',
      reactiveCommandId: 'reactive-buy-fish',
      selectedPlannerDomain: 'trade',
      candidateActionCount: 1,
      commandDraftCount: 1,
      shortTermMemoryRecordIds: ['reactive-buy-fish:received', 'reactive-buy-fish:outcome'],
    });
    expect(traces[1]).toMatchObject({
      traceId: 'sim-1:world-main:1:cmd-objective-study',
      commandId: 'cmd-objective-study',
      resultKind: 'long-horizon-objective-set',
      objectiveId: 'objective-study',
      planId: 'objective-study',
      shortTermMemoryRecordIds: ['cmd-objective-study:strategic-objective'],
    });
    expect(traces[1]?.strategicPlan).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'steering-llm-plan-objective-study',
      providerId: 'scripted-planner',
    });
  });

  test('dispatches reactive command drafts to the world event stream before checkpointing command consumption', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    appendCommands(storage.partition.commandStreamName, storage.commandStore, [
      reactiveTradeCommand({
        id: 'cmd-reactive-study',
        reactiveCommandId: 'reactive-study',
        summary: 'study for one minute now',
        issuedAt: 200,
      }),
    ]);

    const result = await drainLocalRuntimeSteeringCommandsToWorld({
      storage,
      consumerId: 'worker-main',
      checkpointUpdatedAt: 1000,
      projection: createWorldProjection({
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
      }),
      policies,
      localizedPlanners: [studyPlanner()],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.status).toBe('drained');
    expect(result.results[0]?.steering.kind).toBe('reactive-command-routed');
    expect(result.results[0]?.dispatch?.events.map((event) => event.type)).toEqual([
      'EducationChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(result.worldDispatchResults).toHaveLength(1);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(
      storage.eventStore
        .readStream(storage.partition.eventStreamName)
        .map((event) => [event.sequence, event.type]),
    ).toEqual([
      [1, 'EducationChanged'],
      [2, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.checkpoint).toMatchObject({
      lastConsumedSequence: 1,
      updatedAt: 1000,
    });
  });

  test('links persisted reactive command outcome memory to dispatched world events', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRootDir(),
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    appendCommands(storage.partition.commandStreamName, storage.commandStore, [
      reactiveTradeCommand({
        id: 'cmd-reactive-study',
        reactiveCommandId: 'reactive-study',
        summary: 'study for one minute now',
        issuedAt: 200,
      }),
    ]);

    const result = await drainLocalRuntimeSteeringCommandsToWorld({
      storage,
      consumerId: 'worker-main',
      checkpointUpdatedAt: 1000,
      projection: createWorldProjection({
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
      }),
      policies,
      localizedPlanners: [studyPlanner()],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    const dispatchEventIds = result.worldDispatchResults.flatMap((dispatch) =>
      dispatch.events.map((event) => event.id),
    );
    await expect(
      storage.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        kinds: ['human-command'],
        statuses: ['succeeded'],
        requiredTags: ['reactive', 'AgentStudy'],
        limit: 1,
      }),
    ).resolves.toMatchObject([
      {
        id: 'reactive-study:outcome',
        source: {
          commandId: 'reactive-study',
          eventIds: dispatchEventIds,
        },
      },
    ]);
  });
});

function tradePlanner(): ReactiveLocalizedPlanner {
  return {
    domain: 'trade',
    supports: ({ summary }: { readonly summary: string }) => summary.includes('fish'),
    propose: () => [
      {
        id: 'trade-fish',
        description: 'trade fish',
        commandType: 'AgentTrade',
        payload: { side: 'buy', commodityName: 'Fish', quantity: 1 },
      },
    ],
  };
}

function studyPlanner(): ReactiveLocalizedPlanner {
  return {
    domain: 'study',
    supports: ({ summary }) => summary.includes('study'),
    propose: () => [
      {
        id: 'study-now',
        description: 'study now',
        commandType: 'AgentStudy',
        payload: { durationSeconds: 60, educationRatePerSecond: 1 },
      },
    ],
  };
}

function createPlanningTrace(requestId: string): StrategicPlanCompilationTrace {
  return {
    status: 'accepted',
    source: 'llm',
    requestId,
    providerId: 'scripted-planner',
    model: 'planner-model',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      estimatedCostMicros: 70,
    },
    attempts: [
      {
        attemptIndex: 1,
        status: 'succeeded',
        providerId: 'scripted-planner',
        model: 'planner-model',
        message: 'LLM structured response validated',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          estimatedCostMicros: 70,
        },
      },
    ],
  };
}

function appendCommands(
  streamName: string,
  commandStore: Parameters<typeof drainLocalRuntimeSteeringCommands>[0]['storage']['commandStore'],
  commands: readonly WorkerSteeringCommand[],
): void {
  commandStore.appendToStream({
    streamName,
    expectedVersion: 0,
    idempotencyKey: 'append-command-1',
    commands,
  });
}
