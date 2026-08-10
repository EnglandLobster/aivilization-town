# Sim Core File Event Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local file-backed `EventStore` adapter so simulation event streams and idempotency records survive process restarts.

**Architecture:** `@aivilization/sim-core` owns the `EventStore` contract, stream versioning, idempotent append semantics, and event sequence invariants. This slice keeps the existing synchronous interface and adds a filesystem adapter behind it; workers, API handlers, and projection hydration code should not care whether the store is in-memory or file-backed.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path` sync APIs, JSONL event logs.

---

## Scope

This slice adds the first durable persistence adapter:

- Store each event stream as an append-only JSONL file under a caller-provided root directory.
- Persist idempotency records to a JSONL metadata file so retries after process restart do not duplicate events.
- Preserve the same optimistic concurrency, contiguous sequence, read window, and idempotency semantics as `InMemoryEventStore`.
- Export the adapter from `@aivilization/sim-core`.

It does not implement SQLite projections, event-log compaction, snapshots, cross-process file locks, fsync tuning, object storage, encryption, or schema migration.

## File Structure

- Add `packages/sim-core/src/fileEventStore.test.ts`: TDD coverage for durability, restart, read windows, stale versions, and persisted idempotency.
- Add `packages/sim-core/src/fileEventStore.ts`: file-backed `EventStore` adapter.
- Modify `packages/sim-core/src/index.ts`: export the adapter.
- Modify this plan file as tasks complete.

## Task 1: File Store Tests

**Files:**

- Add: `packages/sim-core/src/fileEventStore.test.ts`

- [x] **Step 1: Write failing tests for local durable event streams**

Create tests that require:

- Appending events to a file-backed store and reading them from a new store instance.
- Computing stream version from persisted events.
- Returning idempotent replay after restart for the same idempotency key and event batch.
- Rejecting idempotency key reuse after restart when the event batch differs.
- Preserving read windows with `afterSequence` and `limit`.
- Rejecting stale expected versions and event sequence gaps.

Run:

```bash
pnpm --filter @aivilization/sim-core test
```

Expected before implementation: tests fail because `FileEventStore` is not exported.

## Task 2: File Store Adapter

**Files:**

- Add: `packages/sim-core/src/fileEventStore.ts`
- Modify: `packages/sim-core/src/index.ts`

- [x] **Step 2: Implement the file-backed EventStore**

Add `FileEventStore<TEvent extends EventEnvelope>` with constructor:

```ts
new FileEventStore({ rootDir: string })
```

Implementation requirements:

- Create `rootDir`, `rootDir/streams`, and `rootDir/idempotency.jsonl` lazily as needed.
- Map each stream name to a safe filename with `encodeURIComponent(streamName) + '.jsonl'`.
- Store one serialized event per JSONL line.
- Store one serialized idempotency record per JSONL line with key, stream name, expected version, event fingerprint, appended events, and resulting stream version.
- Use the same public error messages as `InMemoryEventStore` for stale versions, sequence gaps, empty stream names, empty batches, idempotency reuse, and invalid read options where practical.
- Return appended events from the persisted idempotency record when replaying a duplicate append.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [x] **Step 3: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/sim-core test
pnpm --filter @aivilization/sim-core typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

## Verification Results

- `pnpm --filter @aivilization/sim-core test` failed before implementation because `FileEventStore` was not exported.
- `pnpm --filter @aivilization/sim-core test` passed after implementation.
- `pnpm --filter @aivilization/sim-core typecheck` passed.
- `pnpm check` passed.
- `pnpm build` passed.
