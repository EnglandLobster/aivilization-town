# Lifecycle Validation Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let local simulation lifecycle runs generate durable experiment validation reports
automatically when a configured tick batch completes.

**Architecture:** `apps/worker` keeps validation generation as a reusable schedule use case and adds
a narrow lifecycle hook that calls it after a completed local loop. Lifecycle owns the trigger timing
and deterministic run id; the existing validation schedule still owns event-window hydration, metric
assembly, and repository persistence.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local file-backed runtime storage.

---

## Scope

This slice adds:

- optional `validationSchedule` wiring on `LocalSimulationLifecycleControllerInput`
- `validationReport` on completed lifecycle start results
- lifecycle default event window from the stream version before start to the final applied sequence
- deterministic run ids using `<prefix>:<requestedAt>:<lastAppliedSequence>`
- manifest and runtime host propagation for global validation schedule wiring

It does not add cron workers, distributed queues, HTTP mutation routes, dashboard rendering, or
per-partition manifest overrides.

## Runtime Semantics

- The hook is disabled by default.
- The hook runs only when `start` finishes with `completed`.
- `paused` and `command-drain-failed` starts do not generate reports.
- If no explicit event window is configured, the schedule validates the events written by that
  lifecycle start.
- `source` defaults to `local-lifecycle-validation`.
- `runIdPrefix` defaults to `<loopId>:validation`.

## File Structure

- Modify `apps/worker/src/localSimulationLifecycle.ts`: add hook configuration, trigger, and result.
- Modify `apps/worker/src/localSimulationLifecycle.test.ts`: prove completed and paused semantics.
- Modify `apps/worker/src/localSimulationRuntimeManifest.ts`: propagate schedule through wiring.
- Modify `apps/worker/src/localSimulationRuntimeManifest.test.ts`: prove registration propagation.
- Modify `apps/worker/src/localSimulationRuntimeHost.ts`: preserve host bootstrap parity.

## Tasks

### Task 1: Failing Lifecycle Tests

**Files:**

- Modify: `apps/worker/src/localSimulationLifecycle.test.ts`

- [x] **Step 1: Completed start generates and records report**

Configure a validation schedule, run `controller.start`, and assert the returned
`validationReport`, deterministic run id, event-window metadata, and repository record.

- [x] **Step 2: Paused start skips validation**

Configure the same hook with `pauseBeforeTick`, run `controller.start`, and assert no report is
returned or persisted.

### Task 2: Lifecycle Implementation

**Files:**

- Modify: `apps/worker/src/localSimulationLifecycle.ts`

- [x] **Step 1: Add hook configuration type**

Expose `LocalSimulationLifecycleValidationSchedule` as a lifecycle-facing subset of
`LocalExperimentValidationScheduleInput` plus optional `runIdPrefix`.

- [x] **Step 2: Trigger schedule after completed starts**

Call `runLocalExperimentValidationSchedule` after lifecycle state is saved, using the default
batch event window when the schedule does not supply one.

- [x] **Step 3: Return the validation result**

Attach `validationReport` to completed start results when the hook runs.

### Task 3: Runtime Wiring

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeManifest.ts`
- Modify: `apps/worker/src/localSimulationRuntimeManifest.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeHost.ts`

- [x] **Step 1: Add manifest wiring input**

Thread `validationSchedule` through global runtime wiring into backend registrations.

- [x] **Step 2: Preserve host bootstrap parity**

Ensure `bootstrapLocalSimulationRuntimeHostFromManifest` passes the same schedule into resolved
manifest registrations.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted red/green tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationLifecycle.test.ts localSimulationRuntimeManifest.test.ts
```

- [x] **Step 2: Run package verification**

Run:

```bash
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/worker test
```

- [x] **Step 3: Commit**

Commit with:

```bash
git commit -m "feat: add lifecycle validation hook"
```

## Self-Review

- Boundary review: lifecycle controls trigger timing; validation schedule owns report assembly.
- Data-flow review: lifecycle state -> deterministic run id/window -> schedule runner -> repository.
- Extension review: future cron, queue, or per-partition manifest settings can reuse the same schedule
  contract without changing validation math.
