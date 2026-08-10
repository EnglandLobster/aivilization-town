import {
  InMemoryCommandConsumerCheckpointStore,
  InMemoryCommandStore,
  createCommandEnvelope,
  createSimulationPartition,
} from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  consumeWorkerCommandStream,
  consumeWorkerCommandStreamWithCheckpoint,
  type WorkerSteeringCommand,
} from './index';

const partition = createSimulationPartition({
  simulationId: 'sim-1',
  partitionKey: 'world-main',
});

function steeringCommand(input: {
  readonly id: string;
  readonly issuedAt: number;
}): WorkerSteeringCommand {
  return createCommandEnvelope({
    id: input.id,
    simulationId: 'sim-1',
    actorId: 'agent-1',
    source: 'human',
    type: 'IssueReactiveCommand',
    payload: {
      reactiveCommandId: input.id,
      summary: `summary for ${input.id}`,
    },
    issuedAt: input.issuedAt,
  });
}

describe('worker command stream consumer', () => {
  test('reads commands after the last consumed sequence and advances to the last handled record', async () => {
    const commandStore = new InMemoryCommandStore<WorkerSteeringCommand>();
    commandStore.appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [
        steeringCommand({ id: 'cmd-1', issuedAt: 100 }),
        steeringCommand({ id: 'cmd-2', issuedAt: 200 }),
      ],
    });
    const handled: string[] = [];

    const result = await consumeWorkerCommandStream({
      commandStore,
      streamName: partition.commandStreamName,
      afterSequence: 0,
      handle: ({ command }) => {
        handled.push(command.id);
        return { handledCommandId: command.id };
      },
    });
    const emptyResult = await consumeWorkerCommandStream({
      commandStore,
      streamName: partition.commandStreamName,
      afterSequence: result.lastConsumedSequence,
      handle: ({ command }) => {
        handled.push(command.id);
        return { handledCommandId: command.id };
      },
    });

    expect(result.status).toBe('drained');
    expect(result.lastConsumedSequence).toBe(2);
    expect(result.streamVersion).toBe(2);
    expect(result.handledRecords.map((record) => record.sequence)).toEqual([1, 2]);
    expect(result.results).toEqual([
      { handledCommandId: 'cmd-1' },
      { handledCommandId: 'cmd-2' },
    ]);
    expect(emptyResult).toMatchObject({
      status: 'drained',
      lastConsumedSequence: 2,
      streamVersion: 2,
      handledRecords: [],
      results: [],
    });
    expect(handled).toEqual(['cmd-1', 'cmd-2']);
  });

  test('stops at the failed command and reports the last successfully consumed sequence', async () => {
    const commandStore = new InMemoryCommandStore<WorkerSteeringCommand>();
    commandStore.appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [
        steeringCommand({ id: 'cmd-1', issuedAt: 100 }),
        steeringCommand({ id: 'cmd-2', issuedAt: 200 }),
        steeringCommand({ id: 'cmd-3', issuedAt: 300 }),
      ],
    });
    const handled: string[] = [];
    const failure = new Error('planner unavailable');

    const result = await consumeWorkerCommandStream({
      commandStore,
      streamName: partition.commandStreamName,
      afterSequence: 0,
      handle: ({ command }) => {
        handled.push(command.id);
        if (command.id === 'cmd-2') {
          throw failure;
        }
        return { handledCommandId: command.id };
      },
    });

    expect(result.status).toBe('failed');
    expect(result.lastConsumedSequence).toBe(1);
    expect(result.handledRecords.map((record) => record.sequence)).toEqual([1]);
    expect(result.results).toEqual([{ handledCommandId: 'cmd-1' }]);
    if (result.status !== 'failed') {
      throw new Error('expected failed result');
    }
    expect(result.failedRecord.sequence).toBe(2);
    expect(result.failedRecord.command.id).toBe('cmd-2');
    expect(result.error).toBe(failure);
    expect(handled).toEqual(['cmd-1', 'cmd-2']);
  });

  test('uses persisted consumer checkpoints to resume from the last consumed command', async () => {
    const commandStore = new InMemoryCommandStore<WorkerSteeringCommand>();
    const checkpointStore = new InMemoryCommandConsumerCheckpointStore();
    commandStore.appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [
        steeringCommand({ id: 'cmd-1', issuedAt: 100 }),
        steeringCommand({ id: 'cmd-2', issuedAt: 200 }),
      ],
    });
    const handled: string[] = [];

    const firstResult = await consumeWorkerCommandStreamWithCheckpoint({
      commandStore,
      checkpointStore,
      consumerId: 'worker-main',
      streamName: partition.commandStreamName,
      checkpointUpdatedAt: 1000,
      handle: ({ command }) => {
        handled.push(command.id);
        return { handledCommandId: command.id };
      },
    });
    commandStore.appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 2,
      idempotencyKey: 'append-2',
      commands: [steeringCommand({ id: 'cmd-3', issuedAt: 300 })],
    });
    const secondResult = await consumeWorkerCommandStreamWithCheckpoint({
      commandStore,
      checkpointStore,
      consumerId: 'worker-main',
      streamName: partition.commandStreamName,
      checkpointUpdatedAt: 1100,
      handle: ({ command }) => {
        handled.push(command.id);
        return { handledCommandId: command.id };
      },
    });

    expect(firstResult.status).toBe('drained');
    expect(firstResult.checkpoint).toMatchObject({
      consumerId: 'worker-main',
      streamName: partition.commandStreamName,
      lastConsumedSequence: 2,
      updatedAt: 1000,
    });
    expect(secondResult.status).toBe('drained');
    expect(secondResult.handledRecords.map((record) => record.command.id)).toEqual(['cmd-3']);
    expect(secondResult.checkpoint).toMatchObject({
      consumerId: 'worker-main',
      streamName: partition.commandStreamName,
      lastConsumedSequence: 3,
      updatedAt: 1100,
    });
    expect(handled).toEqual(['cmd-1', 'cmd-2', 'cmd-3']);
  });

  test('checkpoints each successful command before returning a failed consumption result', async () => {
    const commandStore = new InMemoryCommandStore<WorkerSteeringCommand>();
    const checkpointStore = new InMemoryCommandConsumerCheckpointStore();
    commandStore.appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [
        steeringCommand({ id: 'cmd-1', issuedAt: 100 }),
        steeringCommand({ id: 'cmd-2', issuedAt: 200 }),
        steeringCommand({ id: 'cmd-3', issuedAt: 300 }),
      ],
    });
    const failure = new Error('planner unavailable');

    const failedResult = await consumeWorkerCommandStreamWithCheckpoint({
      commandStore,
      checkpointStore,
      consumerId: 'worker-main',
      streamName: partition.commandStreamName,
      checkpointUpdatedAt: 1000,
      handle: ({ command }) => {
        if (command.id === 'cmd-2') {
          throw failure;
        }
        return { handledCommandId: command.id };
      },
    });
    const retryResult = await consumeWorkerCommandStreamWithCheckpoint({
      commandStore,
      checkpointStore,
      consumerId: 'worker-main',
      streamName: partition.commandStreamName,
      checkpointUpdatedAt: 1100,
      handle: ({ command }) => ({ handledCommandId: command.id }),
    });

    expect(failedResult.status).toBe('failed');
    expect(failedResult.checkpoint).toMatchObject({
      lastConsumedSequence: 1,
      updatedAt: 1000,
    });
    expect(
      checkpointStore.getLatestCheckpoint({
        consumerId: 'worker-main',
        streamName: partition.commandStreamName,
      }),
    ).toMatchObject({ lastConsumedSequence: 3, updatedAt: 1100 });
    expect(retryResult.status).toBe('drained');
    expect(retryResult.handledRecords.map((record) => record.command.id)).toEqual([
      'cmd-2',
      'cmd-3',
    ]);
  });
});
