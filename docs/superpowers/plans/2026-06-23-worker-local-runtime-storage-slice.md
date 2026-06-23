# Worker Local Runtime Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a local file-backed world runtime storage composition that wires event logs, checkpoints, snapshots, and partition metadata for restartable worker ticks.

**Architecture:** `@aivilization/sim-core` owns the storage ports and local file adapters; `apps/worker` owns runtime composition for world ticks. This slice adds a small factory that creates a simulation partition plus file-backed event/checkpoint/snapshot stores under a stable directory layout, then exposes tick-ready checkpointing and hydration inputs.

**Tech Stack:** TypeScript, Vitest, Node `path`, `@aivilization/sim-core`, `@aivilization/world`, `apps/worker`.

---

## Scope

This slice adds a local runtime storage composition:

- Create a world partition from `simulationId` and `partitionKey`.
- Create file-backed `EventStore<WorldEvent>`, `ProjectionCheckpointStore`, and `ProjectionSnapshotStore<WorldProjection>`.
- Expose `checkpointing` and `checkpointHydration` objects that can be passed directly to `runWorkerSimulationTick`.
- Use a stable per-simulation/per-partition directory layout.
- Verify restart recovery by recreating the local runtime storage from the same root directory.

It does not build an HTTP API, add process supervision, manage long-running worker leases, persist memory repositories, decide sharding strategy beyond one partition directory, or add remote/object storage adapters.

## File Structure

- Add `apps/worker/src/localRuntimeStorage.test.ts`: TDD coverage for storage composition and restart recovery through worker ticks.
- Add `apps/worker/src/localRuntimeStorage.ts`: local file-backed runtime storage factory.
- Modify `apps/worker/src/index.ts`: export the local runtime storage factory.
- Modify this plan file as tasks complete.

## Task 1: Local Runtime Storage Tests

**Files:**

- Add: `apps/worker/src/localRuntimeStorage.test.ts`

- [x] **Step 1: Write failing tests for restartable local runtime storage**

Create tests that require:

- `createLocalWorldRuntimeStorage` returns a partition, event store, checkpoint store, snapshot store, and tick-ready checkpoint inputs.
- A first tick with explicit projection and `storage.checkpointing` persists events, snapshot, and checkpoint.
- A restarted storage instance from the same root can hydrate a second tick using `storage.checkpointHydration`.
- The second tick appends after the persisted stream version and writes a newer checkpoint.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because the local runtime storage factory is missing.

## Task 2: Local Runtime Storage Factory

**Files:**

- Add: `apps/worker/src/localRuntimeStorage.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 2: Implement the file-backed runtime composition**

Add:

- `LocalWorldRuntimeStoragePaths`
- `LocalWorldRuntimeStorage`
- `createLocalWorldRuntimeStorage(input)`

Behavior:

- Constructor input: `{ rootDir: string; simulationId: string; partitionKey: PartitionKey }`.
- Validate `rootDir` is non-empty through underlying file stores and validate `partitionKey` by calling `createSimulationPartition`.
- Directory layout:
  - `rootDir/simulations/<simulationId>/partitions/<partitionKey>/events`
  - `rootDir/simulations/<simulationId>/partitions/<partitionKey>/checkpoints`
  - `rootDir/simulations/<simulationId>/partitions/<partitionKey>/snapshots`
- Return:
  - `partition`
  - `eventStore`
  - `checkpointStore`
  - `snapshotStore`
  - `checkpointing`
  - `checkpointHydration`
  - `paths`

## Task 3: Verification

**Files:**

- Modify: this plan file

- [x] **Step 3: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

## Verification Results

- `pnpm --filter @aivilization/worker test` failed before implementation because `createLocalWorldRuntimeStorage` was not exported.
- `pnpm --filter @aivilization/worker test` passed after implementation.
- `pnpm --filter @aivilization/worker typecheck` passed after implementation.
- `pnpm --filter @aivilization/worker test` passed after targeted formatting.
- `pnpm --filter @aivilization/worker typecheck` passed after targeted formatting.
- `pnpm check` passed.
- `pnpm build` passed.
