# Sim Core Projection Snapshot Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a projection snapshot store so `SnapshotReference.uri` points to a durable projection blob that can be loaded after a worker restart.

**Architecture:** `@aivilization/sim-core` keeps checkpoint metadata and projection snapshot blobs as separate ports. Checkpoints answer "which replay boundary should I resume from"; snapshot stores answer "where is the projection state at that boundary". This keeps local file storage replaceable by SQLite, object storage, or a remote simulation service later.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path`/`url` sync APIs, JSON projection snapshot files.

---

## Scope

This slice adds durable projection snapshot blob storage:

- Add a generic `ProjectionSnapshotStore<TProjection>` interface.
- Add `FileProjectionSnapshotStore<TProjection>` for local durable JSON snapshots.
- Save snapshots under a partition-scoped path and return a `SnapshotReference`.
- Load snapshots by `SnapshotReference` across store instances.
- Detect corrupt files whose embedded reference does not match the requested reference.

It does not wire snapshots into worker hydration, compact event logs, schedule automatic checkpoint creation, add cross-process locking, add schema migration, or implement remote/object storage adapters.

## File Structure

- Add `packages/sim-core/src/projectionSnapshotStore.test.ts`: TDD coverage for save/load, restart recovery, missing snapshots, corrupt metadata detection, and URI boundary validation.
- Add `packages/sim-core/src/projectionSnapshotStore.ts`: snapshot store interface and file adapter.
- Modify `packages/sim-core/src/index.ts`: export projection snapshot store.
- Modify this plan file as tasks complete.

## Task 1: Projection Snapshot Store Tests

**Files:**

- Add: `packages/sim-core/src/projectionSnapshotStore.test.ts`

- [ ] **Step 1: Write failing tests for projection snapshot blob storage**

Create tests that require:

- `FileProjectionSnapshotStore` saves a projection snapshot and returns a `SnapshotReference`.
- A restarted file store can load the projection by the returned reference.
- Loading a missing file-backed snapshot returns `undefined`.
- Loading a non-file URI is rejected.
- Loading a corrupt snapshot file whose embedded reference differs from the requested reference is rejected.

Run:

```bash
pnpm --filter @aivilization/sim-core test
```

Expected before implementation: tests fail because projection snapshot store exports do not exist.

## Task 2: Projection Snapshot Store Implementation

**Files:**

- Add: `packages/sim-core/src/projectionSnapshotStore.ts`
- Modify: `packages/sim-core/src/index.ts`

- [ ] **Step 2: Implement projection snapshot store port and file adapter**

Add:

- `ProjectionSnapshotSaveInput<TProjection>`
- `ProjectionSnapshotStore<TProjection>`
- `FileProjectionSnapshotStore<TProjection>`

File store requirements:

- Constructor: `new FileProjectionSnapshotStore<TProjection>({ rootDir: string })`.
- Store JSON files under `rootDir/projection-snapshots/<simulationId>/<partitionKey>/<sequence>.json`.
- Return `SnapshotReference` with a `file://` URI created from the saved path.
- Load projection blobs by `SnapshotReference`.
- Return `undefined` for missing snapshot files.
- Reject snapshot references that do not use a `file://` URI.
- Reject snapshot files whose embedded reference does not match the requested reference.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/sim-core test
pnpm --filter @aivilization/sim-core typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

