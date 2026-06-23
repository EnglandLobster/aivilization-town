# Sim Core Event Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-authoritative event stream contract with optimistic concurrency, sequence validation, and idempotent append replay.

**Architecture:** `sim-core` owns the persistence-facing event stream contract because command ordering, replay, partition streams, expected versions, and immutable events are simulation invariants. This slice adds an in-memory adapter for tests and worker composition while keeping durable file, SQLite, Postgres, and queue-backed adapters outside domain packages.

**Tech Stack:** TypeScript, Vitest, `EventEnvelope`, `SimulationPartition`, append-only event streams.

---

## Scope

This slice builds the generic event-store seam needed before worker tick loops and API command submission can become recoverable:

- Define event stream append/read contracts.
- Enforce expected stream versions where empty streams start at version `0`.
- Enforce that appended event sequences are exactly contiguous with the stream version.
- Support idempotent append replay keyed by command/request id without duplicating facts.
- Reject idempotency-key reuse for a different stream or different event batch.
- Provide an in-memory implementation for focused tests and early worker integration.

It does not implement file IO, SQLite projection persistence, API endpoints, or a worker tick loop. Those should depend on this seam later.

## File Structure

- Create `packages/sim-core/src/eventStore.test.ts`: TDD coverage for expected versions, sequence validation, idempotency replay, and stream reads.
- Create `packages/sim-core/src/eventStore.ts`: event-store contracts plus `InMemoryEventStore`.
- Modify `packages/sim-core/src/index.ts`: export the event-store contracts.
- Modify this plan file as tasks complete.

## Task 1: Event Store Tests

**Files:**

- Create: `packages/sim-core/src/eventStore.test.ts`

- [ ] **Step 1: Write failing tests for stream append semantics**

Create `packages/sim-core/src/eventStore.test.ts`:

```ts
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
```

- [ ] **Step 2: Run sim-core tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/sim-core test
```

Expected: FAIL because `InMemoryEventStore` does not exist.

## Task 2: Event Store Implementation

**Files:**

- Create: `packages/sim-core/src/eventStore.ts`
- Modify: `packages/sim-core/src/index.ts`

- [ ] **Step 1: Implement event-store contracts and in-memory adapter**

Create `packages/sim-core/src/eventStore.ts` with:

```ts
import type { EventEnvelope } from './event';

export type EventStreamName = string;

export type EventStreamReadOptions = {
  readonly afterSequence?: number;
  readonly limit?: number;
};

export type AppendToEventStreamRequest<TEvent extends EventEnvelope = EventEnvelope> = {
  readonly streamName: EventStreamName;
  readonly expectedVersion?: number;
  readonly idempotencyKey?: string;
  readonly events: readonly TEvent[];
};

export type AppendToEventStreamResult<TEvent extends EventEnvelope = EventEnvelope> = {
  readonly appendedEvents: readonly TEvent[];
  readonly streamVersion: number;
  readonly idempotentReplay: boolean;
};

export interface EventStore<TEvent extends EventEnvelope = EventEnvelope> {
  appendToStream(request: AppendToEventStreamRequest<TEvent>): AppendToEventStreamResult<TEvent>;
  readStream(streamName: EventStreamName, options?: EventStreamReadOptions): readonly TEvent[];
  getStreamVersion(streamName: EventStreamName): number;
}
```

Then implement `InMemoryEventStore` that:

- keeps `Map<EventStreamName, TEvent[]>` for streams;
- keeps `Map<string, StoredIdempotencyRecord<TEvent>>` for idempotency records;
- rejects empty event batches;
- checks `expectedVersion` against `stream.length`;
- checks each event sequence equals `stream.length + index + 1`;
- returns an idempotent replay if the same key, stream name, expected version, and serialized event batch are repeated;
- rejects same idempotency key with a different stream, expected version, or event batch.

- [ ] **Step 2: Export event-store contracts**

Modify `packages/sim-core/src/index.ts`:

```ts
export * from './eventStore';
```

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/sim-core test
pnpm --filter @aivilization/sim-core typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/sim-core/src/eventStore.ts packages/sim-core/src/eventStore.test.ts packages/sim-core/src/index.ts
git commit -m "feat: add sim-core event store"
```

## Task 3: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-sim-core-event-store-slice.md`

- [ ] Run `pnpm check`.
- [ ] Run `pnpm build`.
- [ ] Update this plan's completed checkboxes.
- [ ] Commit the final plan update.

## Acceptance Criteria

- Event stream appends are optimistic-concurrency checked through `expectedVersion`.
- Event sequences are contiguous with the current stream version before events become committed facts.
- Duplicate append requests with the same idempotency key replay prior results without duplicating events.
- Idempotency-key reuse for a different request is rejected.
- Event streams can be read as full streams or bounded windows.
- `pnpm check` and `pnpm build` pass.
