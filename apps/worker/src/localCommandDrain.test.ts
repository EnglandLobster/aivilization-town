import type { ReactiveLocalizedPlanner } from '@aivilization/agent-runtime';
import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createLocalWorldRuntimeStorage,
  drainLocalRuntimeSteeringCommands,
  type WorkerSteeringCommand,
} from './index';

const agentOne = asAgentId('agent-1');
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
