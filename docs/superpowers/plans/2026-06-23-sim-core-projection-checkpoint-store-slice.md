# Sim Core Projection Checkpoint Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add projection checkpoint creation and repository adapters so replay can resume from the latest per-partition checkpoint metadata instead of always starting from genesis.

**Architecture:** `@aivilization/sim-core` owns snapshot references, checkpoint metadata, and partition-scoped replay boundaries. This slice adds a small repository interface plus in-memory and file-backed adapters; actual projection snapshot blob serialization remains a later adapter concern behind the `SnapshotReference.uri`.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path` sync APIs, JSONL checkpoint metadata.

---

## Scope

This slice adds first-class checkpoint metadata storage:

- Add `createProjectionCheckpoint` validation for `ProjectionCheckpoint`.
- Add a `ProjectionCheckpointStore` interface for saving and reading the latest checkpoint for a simulation partition.
- Add `InMemoryProjectionCheckpointStore` for tests and non-durable runs.
- Add `FileProjectionCheckpointStore` for durable local checkpoint metadata.
- Enforce monotonic `lastAppliedSequence` per simulation partition.

It does not serialize projection blobs, compact event logs, hydrate projections from snapshots, wire checkpointing into workers, add SQLite projections, or implement cross-process locks.

## File Structure

- Add `packages/sim-core/src/checkpointStore.test.ts`: TDD coverage for checkpoint validation, in-memory latest checkpoint behavior, stale checkpoint rejection, and file-backed restart recovery.
- Add `packages/sim-core/src/checkpointStore.ts`: checkpoint store interface and adapters.
- Modify `packages/sim-core/src/snapshot.ts`: add `createProjectionCheckpoint`.
- Modify `packages/sim-core/src/index.ts`: export checkpoint store.
- Modify this plan file as tasks complete.

## Task 1: Checkpoint Store Tests

**Files:**

- Add: `packages/sim-core/src/checkpointStore.test.ts`

- [x] **Step 1: Write failing tests for projection checkpoint storage**

Create tests that require:

- `createProjectionCheckpoint` validates non-negative `lastAppliedSequence`.
- A snapshot reference must belong to the same simulation id and partition key as its checkpoint.
- `InMemoryProjectionCheckpointStore` returns the latest checkpoint per simulation partition.
- Saving an older checkpoint for the same simulation partition is rejected.
- `FileProjectionCheckpointStore` persists checkpoint metadata across store instances.

Run:

```bash
pnpm --filter @aivilization/sim-core test
```

Expected before implementation: tests fail because checkpoint store exports and `createProjectionCheckpoint` do not exist.

## Task 2: Checkpoint Store Implementation

**Files:**

- Add: `packages/sim-core/src/checkpointStore.ts`
- Modify: `packages/sim-core/src/snapshot.ts`
- Modify: `packages/sim-core/src/index.ts`

- [x] **Step 2: Implement checkpoint creation and adapters**

Add:

- `createProjectionCheckpoint(input)`
- `ProjectionCheckpointStore`
- `InMemoryProjectionCheckpointStore`
- `FileProjectionCheckpointStore`

File store requirements:

- Constructor: `new FileProjectionCheckpointStore({ rootDir: string })`.
- Store JSONL records in `rootDir/projection-checkpoints.jsonl`.
- Rebuild latest checkpoint by scanning the metadata log.
- Reject stale checkpoint saves with an error that names current and attempted sequence.
- Keep records partition-scoped by `simulationId` and `partitionKey`.

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

- `pnpm --filter @aivilization/sim-core test` failed before implementation because checkpoint store exports and `createProjectionCheckpoint` were missing.
- Added an extra failing invariant test proving snapshot sequence cannot exceed checkpoint `lastAppliedSequence`, then implemented the guard.
- `pnpm --filter @aivilization/sim-core test` passed after implementation.
- `pnpm --filter @aivilization/sim-core typecheck` passed.
- `pnpm check` passed.
- `pnpm build` passed.
