import { describe, expect, test } from 'vitest';
import {
  createCommandEnvelope,
  createSimulationPartition,
  InMemoryCommandStore,
  type CommandEnvelope,
} from './index';

const partition = createSimulationPartition({
  simulationId: 'sim-1',
  partitionKey: 'world-main',
});

function reactiveCommand(input: {
  readonly id: string;
  readonly issuedAt: number;
  readonly summary?: string;
}): CommandEnvelope<'IssueReactiveCommand', { readonly reactiveCommandId: string; readonly summary: string }> {
  return createCommandEnvelope({
    id: input.id,
    simulationId: 'sim-1',
    actorId: 'agent-1',
    source: 'human',
    type: 'IssueReactiveCommand',
    payload: {
      reactiveCommandId: input.id,
      summary: input.summary ?? `summary for ${input.id}`,
    },
    issuedAt: input.issuedAt,
  });
}

describe('InMemoryCommandStore', () => {
  test('appends commands with contiguous stream positions when the expected version matches', () => {
    const store = new InMemoryCommandStore();

    const firstAppend = store.appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [reactiveCommand({ id: 'cmd-1', issuedAt: 100 })],
    });
    const secondAppend = store.appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 1,
      idempotencyKey: 'append-2',
      commands: [reactiveCommand({ id: 'cmd-2', issuedAt: 200 })],
    });

    expect(firstAppend).toEqual({
      appendedCommands: [
        {
          sequence: 1,
          command: reactiveCommand({ id: 'cmd-1', issuedAt: 100 }),
        },
      ],
      streamVersion: 1,
      idempotentReplay: false,
    });
    expect(secondAppend.streamVersion).toBe(2);
    expect(store.getStreamVersion(partition.commandStreamName)).toBe(2);
    expect(
      store.readStream(partition.commandStreamName).map((record) => ({
        sequence: record.sequence,
        id: record.command.id,
      })),
    ).toEqual([
      { sequence: 1, id: 'cmd-1' },
      { sequence: 2, id: 'cmd-2' },
    ]);
  });

  test('rejects stale expected stream versions', () => {
    const store = new InMemoryCommandStore();
    store.appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [reactiveCommand({ id: 'cmd-1', issuedAt: 100 })],
    });

    expect(() =>
      store.appendToStream({
        streamName: partition.commandStreamName,
        expectedVersion: 0,
        idempotencyKey: 'append-2',
        commands: [reactiveCommand({ id: 'cmd-2', issuedAt: 200 })],
      }),
    ).toThrow('expected command stream version 0 but current version is 1');
  });

  test('replays duplicate idempotent appends without duplicating commands', () => {
    const store = new InMemoryCommandStore();
    const request = {
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [reactiveCommand({ id: 'cmd-1', issuedAt: 100 })],
    } as const;

    store.appendToStream(request);
    const replay = store.appendToStream(request);

    expect(replay).toEqual({
      appendedCommands: [
        {
          sequence: 1,
          command: reactiveCommand({ id: 'cmd-1', issuedAt: 100 }),
        },
      ],
      streamVersion: 1,
      idempotentReplay: true,
    });
    expect(store.readStream(partition.commandStreamName)).toHaveLength(1);
  });

  test('rejects idempotency key reuse for a different command batch', () => {
    const store = new InMemoryCommandStore();
    store.appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [reactiveCommand({ id: 'cmd-1', issuedAt: 100 })],
    });

    expect(() =>
      store.appendToStream({
        streamName: partition.commandStreamName,
        expectedVersion: 1,
        idempotencyKey: 'append-1',
        commands: [reactiveCommand({ id: 'cmd-2', issuedAt: 200 })],
      }),
    ).toThrow('idempotency key append-1 was already used for a different command append request');
  });

  test('reads command windows after a sequence with a limit', () => {
    const store = new InMemoryCommandStore();
    store.appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [
        reactiveCommand({ id: 'cmd-1', issuedAt: 100 }),
        reactiveCommand({ id: 'cmd-2', issuedAt: 200 }),
        reactiveCommand({ id: 'cmd-3', issuedAt: 300 }),
      ],
    });

    expect(
      store
        .readStream(partition.commandStreamName, { afterSequence: 1, limit: 1 })
        .map((record) => record.command.id),
    ).toEqual(['cmd-2']);
  });
});
