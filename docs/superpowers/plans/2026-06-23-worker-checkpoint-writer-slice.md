# Worker Checkpoint Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a successful worker tick optionally persist its final world projection as a snapshot and save matching checkpoint metadata.

**Architecture:** `apps/worker` should close the recovery loop without owning storage details. Tick orchestration receives checkpoint writer ports from `@aivilization/sim-core`, saves the final `WorldProjection` through the snapshot store, saves metadata through the checkpoint store, and returns those references to the caller for observability.

**Tech Stack:** TypeScript, Vitest, `@aivilization/sim-core`, `@aivilization/world`, `apps/worker`.

---

## Scope

This slice adds optional tick checkpoint writing:

- Add an optional tick-level `checkpointing` input.
- Save the final projection snapshot at the final stream version.
- Save a `ProjectionCheckpoint` pointing at that snapshot.
- Return the saved checkpoint and snapshot reference in `WorkerTickResult`.
- Reuse the saved checkpoint in a follow-up tick hydration test.

It does not decide checkpoint cadence, run checkpointing in the background, compact event logs, add snapshot retention, add distributed locks, or write checkpoints for failed/partial ticks.

## File Structure

- Modify `apps/worker/src/tickRunner.test.ts`: TDD coverage for checkpoint writing and recovery from automatically saved checkpoints.
- Modify `apps/worker/src/tickRunner.ts`: optional checkpoint writer input and result fields.
- Modify this plan file as tasks complete.

## Task 1: Checkpoint Writer Tests

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`

- [ ] **Step 1: Write failing tests for automatic tick checkpoint writing**

Create tests that require:

- A successful tick with `checkpointing` saves a snapshot at the final stream version.
- The saved checkpoint is readable from the checkpoint store by `{ simulationId, partitionKey }`.
- The saved snapshot loads back to the final projection.
- A subsequent tick can use the automatically saved checkpoint through `projectionHydration.checkpoint`.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because tick runner does not expose `checkpointing` and returns no saved checkpoint metadata.

## Task 2: Tick Checkpoint Writer Implementation

**Files:**

- Modify: `apps/worker/src/tickRunner.ts`

- [ ] **Step 2: Implement optional tick checkpointing**

Add:

- `WorkerTickProjectionCheckpointingInput`
- Optional `checkpointing` field on tick input
- Optional `checkpoint` and `snapshot` fields on `WorkerTickResult`

Behavior:

- Preserve existing explicit projection and hydration behavior when `checkpointing` is absent.
- After all tick events have been appended and final projection is known, save a projection snapshot with:
  - `simulationId`
  - `partitionKey`
  - `sequence: final streamVersion`
  - `createdAt: issuedAt`
  - `projection`
- Save `createProjectionCheckpoint({ lastAppliedSequence: final streamVersion, snapshot })`.
- Return the saved snapshot reference and checkpoint.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

