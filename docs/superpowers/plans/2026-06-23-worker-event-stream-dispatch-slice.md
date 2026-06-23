# Worker Event Stream Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist worker-dispatched world events into the server-authoritative event stream before returning the updated projection.

**Architecture:** `apps/worker` remains the orchestration boundary between `agent-runtime`, `world`, and `sim-core`. The existing pure dispatch helper stays available for tests and dry-run style composition, while the new event-stream helper derives event sequence numbers from the event store, appends emitted world events with optimistic concurrency and idempotency, then applies committed events to the projection.

**Tech Stack:** TypeScript, Vitest, `@aivilization/sim-core` EventStore, `@aivilization/world` command dispatcher.

---

## Scope

This slice connects the worker command-dispatch seam to the append-only event stream:

- Convert command drafts to command envelopes as before.
- Use the target event stream version to derive `nextSequence`.
- Dispatch drafts through `world` command handlers.
- Append emitted events to `EventStore<WorldEvent>` with `expectedVersion` and an append idempotency key.
- Return the append result and a projection rebuilt by applying committed appended events.
- Preserve existing pure dispatch behavior.

It does not implement file-backed event storage, SQLite projection persistence, API endpoints, queue workers, or a durable tick loop.

## File Structure

- Modify `apps/worker/src/commandDispatch.test.ts`: add event-stream dispatch tests.
- Modify `apps/worker/src/commandDispatch.ts`: add `dispatchCommandDraftsToWorldEventStream`.
- Modify this plan file as tasks complete.

## Task 1: Event Stream Dispatch Tests

**Files:**

- Modify: `apps/worker/src/commandDispatch.test.ts`

- [ ] **Step 1: Write failing tests for worker event-stream append behavior**

Add these imports to `apps/worker/src/commandDispatch.test.ts`:

```ts
import {
  InMemoryEventStore,
  createSimulationPartition,
} from '@aivilization/sim-core';
import type { WorldEvent } from '@aivilization/world';
```

Extend the worker import:

```ts
import {
  createCommandEnvelopeFromDraft,
  dispatchCommandDraftsToWorld,
  dispatchCommandDraftsToWorldEventStream,
} from './index';
```

Add this partition constant after `policies`:

```ts
const partition = createSimulationPartition({
  simulationId: 'sim-1',
  partitionKey: 'world-main',
});
```

Add this projection helper after `createStudyDraft()`:

```ts
function createAgentProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: asAgentId('agent-1'),
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
}
```

Add these tests inside `describe('worker command dispatch seam', () => { ... })`:

```ts
  test('appends dispatched world events to the target event stream before applying projection updates', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();

    const result = dispatchCommandDraftsToWorldEventStream({
      commandDrafts: [createStudyDraft()],
      projection: createAgentProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'agent-cycle-1',
      commandIdPrefix: 'draft-command',
    });

    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'EducationChanged'],
      [2, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.appendResult).toMatchObject({
      streamVersion: 2,
      idempotentReplay: false,
    });
    expect(result.appendResult.appendedEvents).toEqual(result.events);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(2);
    expect(eventStore.readStream(partition.eventStreamName).map((event) => event.id)).toEqual([
      'draft-command-1:event:0',
      'draft-command-1:event:1',
    ]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
  });

  test('derives event sequence numbers from the current event stream version when expectedVersion is omitted', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    dispatchCommandDraftsToWorldEventStream({
      commandDrafts: [createStudyDraft()],
      projection: createAgentProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'agent-cycle-1',
      commandIdPrefix: 'draft-command',
    });

    const sleepDraft: CommandDraft = {
      simulationId: asSimulationId('sim-1'),
      actorId: asAgentId('agent-1'),
      source: 'agent-runtime',
      type: 'AgentSleep',
      payload: { durationSeconds: 10 },
      issuedAt: 110,
    };
    const result = dispatchCommandDraftsToWorldEventStream({
      commandDrafts: [sleepDraft],
      projection: createAgentProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      appendIdempotencyKey: 'agent-cycle-2',
      commandIdPrefix: 'sleep-command',
    });

    expect(result.events.map((event) => event.sequence)).toEqual([3, 4]);
    expect(result.appendResult.streamVersion).toBe(4);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(4);
  });

  test('replays duplicate append requests idempotently without duplicating world events', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const input = {
      commandDrafts: [createStudyDraft()],
      projection: createAgentProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'agent-cycle-1',
      commandIdPrefix: 'draft-command',
    } satisfies Parameters<typeof dispatchCommandDraftsToWorldEventStream>[0];

    dispatchCommandDraftsToWorldEventStream(input);
    const replay = dispatchCommandDraftsToWorldEventStream(input);

    expect(replay.appendResult.idempotentReplay).toBe(true);
    expect(replay.appendResult.streamVersion).toBe(2);
    expect(eventStore.readStream(partition.eventStreamName)).toHaveLength(2);
    expect(replay.projection.agents['agent-1']?.educationScore).toBe(70);
  });

  test('does not apply projection updates when event stream append fails optimistic concurrency', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    dispatchCommandDraftsToWorldEventStream({
      commandDrafts: [createStudyDraft()],
      projection: createAgentProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'agent-cycle-1',
      commandIdPrefix: 'draft-command',
    });

    expect(() =>
      dispatchCommandDraftsToWorldEventStream({
        commandDrafts: [createStudyDraft()],
        projection: createAgentProjection(),
        policies,
        eventStore,
        streamName: partition.eventStreamName,
        expectedVersion: 0,
        appendIdempotencyKey: 'agent-cycle-stale',
        commandIdPrefix: 'stale-command',
      }),
    ).toThrow('expected stream version 0 but current version is 2');
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(2);
  });
```

- [ ] **Step 2: Run worker tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected: FAIL because `dispatchCommandDraftsToWorldEventStream` is not exported.

## Task 2: Event Stream Dispatch Implementation

**Files:**

- Modify: `apps/worker/src/commandDispatch.ts`

- [ ] **Step 1: Add event-store dispatch result type and function**

Modify the `@aivilization/sim-core` import in `apps/worker/src/commandDispatch.ts`:

```ts
import {
  createCommandEnvelope,
  type AppendToEventStreamResult,
  type CommandEnvelope,
  type CoreCommandType,
  type EventStore,
  type EventStreamName,
} from '@aivilization/sim-core';
```

Add this result type after `DispatchCommandDraftsResult`:

```ts
export type DispatchCommandDraftsToEventStreamResult = DispatchCommandDraftsResult & {
  readonly appendResult: AppendToEventStreamResult<WorldEvent>;
};
```

Add this function after `dispatchCommandDraftsToWorld`:

```ts
export function dispatchCommandDraftsToWorldEventStream(input: {
  readonly commandDrafts: readonly CommandDraft[];
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicies;
  readonly eventStore: EventStore<WorldEvent>;
  readonly streamName: EventStreamName;
  readonly appendIdempotencyKey: string;
  readonly commandIdPrefix: string;
  readonly expectedVersion?: number;
}): DispatchCommandDraftsToEventStreamResult {
  assertNonEmpty(input.appendIdempotencyKey, 'appendIdempotencyKey');

  const expectedVersion =
    input.expectedVersion ?? input.eventStore.getStreamVersion(input.streamName);
  const dispatched = dispatchCommandDraftsToWorld({
    commandDrafts: input.commandDrafts,
    projection: input.projection,
    policies: input.policies,
    startingSequence: expectedVersion + 1,
    commandIdPrefix: input.commandIdPrefix,
    expectedVersion,
  });
  const appendResult = input.eventStore.appendToStream({
    streamName: input.streamName,
    expectedVersion,
    idempotencyKey: input.appendIdempotencyKey,
    events: dispatched.events,
  });
  const projection = appendResult.appendedEvents.reduce(applyWorldEvent, input.projection);

  return {
    commands: dispatched.commands,
    events: appendResult.appendedEvents,
    projection,
    appendResult,
  };
}
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

Run:

```bash
git add apps/worker/src/commandDispatch.ts apps/worker/src/commandDispatch.test.ts
git commit -m "feat: append worker dispatch events"
```

## Task 3: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-worker-event-stream-dispatch-slice.md`

- [ ] Run `pnpm check`.
- [ ] Run `pnpm build`.
- [ ] Update this plan's completed checkboxes.
- [ ] Commit the final plan update.

## Acceptance Criteria

- Worker can dispatch command drafts and append emitted world events to a sim-core event stream.
- Event sequence numbers start from `eventStore.getStreamVersion(streamName) + 1` when no explicit `expectedVersion` is provided.
- Explicit `expectedVersion` is enforced by the event store and stale writes fail before returning an updated projection.
- Duplicate append retries with the same idempotency key replay without duplicating committed events.
- Existing pure dispatch helper remains available and tested.
- `pnpm check` and `pnpm build` pass.
