import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createCommandEnvelope,
  createSimulationPartition,
  FileCommandStore,
  type CommandEnvelope,
} from './index';

const partition = createSimulationPartition({
  simulationId: 'sim-1',
  partitionKey: 'world-main',
});

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
  const root = mkdtempSync(join(tmpdir(), 'aivilization-file-command-store-'));
  tmpRoots.push(root);
  return root;
}

function reactiveCommand(input: {
  readonly id: string;
  readonly issuedAt: number;
}): CommandEnvelope<'IssueReactiveCommand', { readonly reactiveCommandId: string; readonly summary: string }> {
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

describe('FileCommandStore', () => {
  test('persists appended command records and stream versions across store instances', () => {
    const rootDir = createRootDir();
    const firstStore = new FileCommandStore({ rootDir });
    firstStore.appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [reactiveCommand({ id: 'cmd-1', issuedAt: 100 })],
    });

    const secondStore = new FileCommandStore({ rootDir });
    const secondAppend = secondStore.appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 1,
      idempotencyKey: 'append-2',
      commands: [reactiveCommand({ id: 'cmd-2', issuedAt: 200 })],
    });

    expect(secondAppend.streamVersion).toBe(2);
    expect(secondStore.getStreamVersion(partition.commandStreamName)).toBe(2);
    expect(
      secondStore.readStream(partition.commandStreamName).map((record) => ({
        sequence: record.sequence,
        id: record.command.id,
      })),
    ).toEqual([
      { sequence: 1, id: 'cmd-1' },
      { sequence: 2, id: 'cmd-2' },
    ]);
  });

  test('replays persisted idempotency records after restart without duplicating commands', () => {
    const rootDir = createRootDir();
    const request = {
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [reactiveCommand({ id: 'cmd-1', issuedAt: 100 })],
    } as const;

    new FileCommandStore({ rootDir }).appendToStream(request);
    const restartedStore = new FileCommandStore({ rootDir });
    const replay = restartedStore.appendToStream(request);

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
    expect(restartedStore.readStream(partition.commandStreamName)).toHaveLength(1);
  });

  test('rejects persisted idempotency key reuse for a different command batch', () => {
    const rootDir = createRootDir();
    new FileCommandStore({ rootDir }).appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [reactiveCommand({ id: 'cmd-1', issuedAt: 100 })],
    });

    const restartedStore = new FileCommandStore({ rootDir });
    expect(() =>
      restartedStore.appendToStream({
        streamName: partition.commandStreamName,
        expectedVersion: 1,
        idempotencyKey: 'append-1',
        commands: [reactiveCommand({ id: 'cmd-2', issuedAt: 200 })],
      }),
    ).toThrow('idempotency key append-1 was already used for a different command append request');
  });

  test('preserves read windows after restart', () => {
    const rootDir = createRootDir();
    new FileCommandStore({ rootDir }).appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [
        reactiveCommand({ id: 'cmd-1', issuedAt: 100 }),
        reactiveCommand({ id: 'cmd-2', issuedAt: 200 }),
        reactiveCommand({ id: 'cmd-3', issuedAt: 300 }),
      ],
    });

    const restartedStore = new FileCommandStore({ rootDir });
    expect(
      restartedStore
        .readStream(partition.commandStreamName, { afterSequence: 1, limit: 1 })
        .map((record) => record.command.id),
    ).toEqual(['cmd-2']);
  });

  test('rejects stale expected versions using persisted streams', () => {
    const rootDir = createRootDir();
    new FileCommandStore({ rootDir }).appendToStream({
      streamName: partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      commands: [reactiveCommand({ id: 'cmd-1', issuedAt: 100 })],
    });
    const restartedStore = new FileCommandStore({ rootDir });

    expect(() =>
      restartedStore.appendToStream({
        streamName: partition.commandStreamName,
        expectedVersion: 0,
        idempotencyKey: 'append-stale',
        commands: [reactiveCommand({ id: 'cmd-2', issuedAt: 200 })],
      }),
    ).toThrow('expected command stream version 0 but current version is 1');
  });
});
