import { describe, expect, test } from 'vitest';
import {
  createEventEnvelope,
  createSimulationPartition,
  InMemoryEventStore,
  type EventEnvelope,
} from './index';

const partition = createSimulationPartition({
  simulationId: 'sim-1',
  partitionKey: 'world-main',
});

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

describe('InMemoryEventStore', () => {
  test('appends contiguous events when the expected version matches', () => {
    const store = new InMemoryEventStore();

    const firstAppend = store.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    });
    const secondAppend = store.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 1,
      idempotencyKey: 'append-2',
      events: [timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 })],
    });

    expect(firstAppend).toEqual({
      appendedEvents: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
      streamVersion: 1,
      idempotentReplay: false,
    });
    expect(secondAppend.streamVersion).toBe(2);
    expect(store.getStreamVersion(partition.eventStreamName)).toBe(2);
    expect(store.readStream(partition.eventStreamName).map((event) => event.id)).toEqual([
      'evt-1',
      'evt-2',
    ]);
  });

  test('rejects stale expected stream versions', () => {
    const store = new InMemoryEventStore();
    store.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    });

    expect(() =>
      store.appendToStream({
        streamName: partition.eventStreamName,
        expectedVersion: 0,
        idempotencyKey: 'append-2',
        events: [timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 })],
      }),
    ).toThrow('expected stream version 0 but current version is 1');
  });

  test('rejects event sequence gaps before append', () => {
    const store = new InMemoryEventStore();

    expect(() =>
      store.appendToStream({
        streamName: partition.eventStreamName,
        expectedVersion: 0,
        idempotencyKey: 'append-gap',
        events: [timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 })],
      }),
    ).toThrow('event sequence 2 must equal next stream sequence 1');
  });

  test('replays duplicate idempotent appends without duplicating events', () => {
    const store = new InMemoryEventStore();
    const request = {
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    } as const;

    store.appendToStream(request);
    const replay = store.appendToStream(request);

    expect(replay).toEqual({
      appendedEvents: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
      streamVersion: 1,
      idempotentReplay: true,
    });
    expect(store.readStream(partition.eventStreamName)).toHaveLength(1);
  });

  test('rejects idempotency key reuse for a different event batch', () => {
    const store = new InMemoryEventStore();
    store.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    });

    expect(() =>
      store.appendToStream({
        streamName: partition.eventStreamName,
        expectedVersion: 1,
        idempotencyKey: 'append-1',
        events: [timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 })],
      }),
    ).toThrow('idempotency key append-1 was already used for a different append request');
  });

  test('reads event windows after a sequence with a limit', () => {
    const store = new InMemoryEventStore();
    store.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [
        timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 }),
        timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 }),
        timeAdvancedEvent({ id: 'evt-3', sequence: 3, now: 3000 }),
      ],
    });

    expect(
      store
        .readStream(partition.eventStreamName, { afterSequence: 1, limit: 1 })
        .map((event) => event.id),
    ).toEqual(['evt-2']);
  });
});
