import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileEventStore,
  createEventEnvelope,
  createSimulationPartition,
  type EventEnvelope,
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
  const root = mkdtempSync(join(tmpdir(), 'aivilization-file-event-store-'));
  tmpRoots.push(root);
  return root;
}

function timeAdvancedEvent(input: {
  readonly id: string;
  readonly sequence: number;
  readonly now: number;
}): EventEnvelope<'SimulationTimeAdvanced', { readonly now: number }> {
  return createEventEnvelope({
    id: input.id,
    simulationId: 'sim-1',
    partitionKey: partition.partitionKey,
    commandId: `cmd-${input.sequence}`,
    type: 'SimulationTimeAdvanced',
    payload: { now: input.now },
    occurredAt: input.now,
    sequence: input.sequence,
  });
}

describe('FileEventStore', () => {
  test('persists appended events and stream versions across store instances', () => {
    const rootDir = createRootDir();
    const firstStore = new FileEventStore({ rootDir });
    firstStore.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    });

    const secondStore = new FileEventStore({ rootDir });
    const secondAppend = secondStore.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 1,
      idempotencyKey: 'append-2',
      events: [timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 })],
    });

    expect(secondAppend.streamVersion).toBe(2);
    expect(secondStore.getStreamVersion(partition.eventStreamName)).toBe(2);
    expect(secondStore.readStream(partition.eventStreamName).map((event) => event.id)).toEqual([
      'evt-1',
      'evt-2',
    ]);
  });

  test('replays persisted idempotency records after restart without duplicating events', () => {
    const rootDir = createRootDir();
    const request = {
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    } as const;

    new FileEventStore({ rootDir }).appendToStream(request);
    const restartedStore = new FileEventStore({ rootDir });
    const replay = restartedStore.appendToStream(request);

    expect(replay).toEqual({
      appendedEvents: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
      streamVersion: 1,
      idempotentReplay: true,
    });
    expect(restartedStore.readStream(partition.eventStreamName)).toHaveLength(1);
  });

  test('rejects persisted idempotency key reuse for a different event batch', () => {
    const rootDir = createRootDir();
    new FileEventStore({ rootDir }).appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    });

    const restartedStore = new FileEventStore({ rootDir });
    expect(() =>
      restartedStore.appendToStream({
        streamName: partition.eventStreamName,
        expectedVersion: 1,
        idempotencyKey: 'append-1',
        events: [timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 })],
      }),
    ).toThrow('idempotency key append-1 was already used for a different append request');
  });

  test('preserves read windows after restart', () => {
    const rootDir = createRootDir();
    new FileEventStore({ rootDir }).appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [
        timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 }),
        timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 }),
        timeAdvancedEvent({ id: 'evt-3', sequence: 3, now: 3000 }),
      ],
    });

    const restartedStore = new FileEventStore({ rootDir });
    expect(
      restartedStore
        .readStream(partition.eventStreamName, { afterSequence: 1, limit: 1 })
        .map((event) => event.id),
    ).toEqual(['evt-2']);
  });

  test('rejects stale expected versions and event sequence gaps using persisted streams', () => {
    const rootDir = createRootDir();
    new FileEventStore({ rootDir }).appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    });
    const restartedStore = new FileEventStore({ rootDir });

    expect(() =>
      restartedStore.appendToStream({
        streamName: partition.eventStreamName,
        expectedVersion: 0,
        idempotencyKey: 'append-stale',
        events: [timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 })],
      }),
    ).toThrow('expected stream version 0 but current version is 1');
    expect(() =>
      restartedStore.appendToStream({
        streamName: partition.eventStreamName,
        expectedVersion: 1,
        idempotencyKey: 'append-gap',
        events: [timeAdvancedEvent({ id: 'evt-3', sequence: 3, now: 3000 })],
      }),
    ).toThrow('event sequence 3 must equal next stream sequence 2');
  });
});
