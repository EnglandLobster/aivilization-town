# Worker Snapshot Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let worker projection hydration resume from a durable projection snapshot when a checkpoint is available, then replay only newer world events.

**Architecture:** `apps/worker` composes the durable ports owned by `@aivilization/sim-core`: event store, checkpoint store, and projection snapshot store. The worker keeps the existing from-genesis replay path as a fallback, while the checkpoint path becomes an optional recovery contract for production-scale runs.

**Tech Stack:** TypeScript, Vitest, `@aivilization/sim-core`, `@aivilization/world`, `apps/worker`.

---

## Scope

This slice adds checkpoint-backed projection hydration:

- Extend `hydrateWorldProjectionFromEventStream` with an optional checkpoint recovery input.
- Load a checkpoint's `SnapshotReference` through a `ProjectionSnapshotStore<WorldProjection>`.
- Replay only events after the loaded snapshot sequence.
- Keep from-genesis replay working when no checkpoint or no snapshot is available.
- Let `runWorkerSimulationTick` pass checkpoint recovery options through its existing `projectionHydration` input.

It does not create snapshots automatically, decide checkpoint cadence, compact event logs, mutate checkpoint metadata during ticks, add worker leases, or introduce remote/object storage adapters.

## File Structure

- Modify `apps/worker/src/projectionHydration.test.ts`: TDD coverage for checkpoint snapshot recovery, missing snapshot detection, and replay fallback.
- Modify `apps/worker/src/projectionHydration.ts`: optional checkpoint recovery input and replay start sequence selection.
- Modify `apps/worker/src/tickRunner.test.ts`: tick integration coverage for checkpoint-backed hydration.
- Modify `apps/worker/src/tickRunner.ts`: pass checkpoint recovery options into hydration.
- Modify this plan file as tasks complete.

## Task 1: Checkpoint-Backed Hydration Tests

**Files:**

- Modify: `apps/worker/src/projectionHydration.test.ts`
- Modify: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 1: Write failing tests for snapshot-backed projection hydration**

Create helper tests that require:

- A saved projection snapshot at sequence `N` is loaded from the snapshot store.
- Hydration replays only events after sequence `N`.
- Missing checkpoint snapshot blobs fail loudly instead of silently replaying from an invalid boundary.

Add a tick runner test that:

- Runs an initial tick with an explicit projection.
- Saves that resulting projection as a snapshot and checkpoint.
- Runs a second tick using `projectionHydration.checkpoint`.
- Verifies the second tick continues from the checkpoint-backed projection state and appends after the prior stream version.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because worker hydration has no checkpoint recovery input.

## Task 2: Hydration Helper Implementation

**Files:**

- Modify: `apps/worker/src/projectionHydration.ts`

- [x] **Step 2: Implement checkpoint snapshot recovery**

Add:

- `WorldProjectionCheckpointHydrationInput`
- Optional `checkpoint` field on `WorldProjectionHydrationInput`
- `replayFromSequence`, optional `checkpoint`, and optional `snapshot` on `WorldProjectionHydrationResult`

Behavior:

- Validate existing `fromSequence`/`toSequence` bounds first.
- Read latest checkpoint by `{ simulationId, partitionKey }`.
- If no checkpoint or no checkpoint snapshot exists, replay from `fromSequence`.
- If the checkpoint snapshot sequence is ahead of `toSequence`, ignore it so bounded retry hydration remains possible.
- If the checkpoint snapshot sequence is ahead of the current stream version, throw a corrupt checkpoint error.
- If the checkpoint snapshot is usable and newer than `fromSequence`, load it and replay events after its sequence.
- If the snapshot reference exists but the blob is missing, throw a missing snapshot error.

## Task 3: Tick Runner Integration

**Files:**

- Modify: `apps/worker/src/tickRunner.ts`

- [x] **Step 3: Pass checkpoint recovery options through tick hydration**

Update `WorkerTickProjectionHydrationInput` with optional:

- `checkpoint: { partitionKey, checkpointStore, snapshotStore }`

When hydrating a tick:

- Build checkpoint lookup from `input.simulationId` and `checkpoint.partitionKey`.
- Pass checkpoint store, snapshot store, and lookup to `hydrateWorldProjectionFromEventStream`.
- Preserve explicit projection behavior unchanged.
- Preserve existing hydration behavior when checkpoint recovery is absent.

## Task 4: Verification

**Files:**

- Modify: this plan file

- [x] **Step 4: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

## Verification Results

- `pnpm --filter @aivilization/worker test` failed before implementation because hydration replayed from sequence `0` and missing snapshot blobs were ignored.
- `pnpm --filter @aivilization/worker test` passed after implementation.
- `pnpm --filter @aivilization/worker typecheck` passed.
- `pnpm --filter @aivilization/worker test` passed after targeted formatting.
- `pnpm --filter @aivilization/worker typecheck` passed after targeted formatting.
- `pnpm check` passed.
- `pnpm build` passed.
