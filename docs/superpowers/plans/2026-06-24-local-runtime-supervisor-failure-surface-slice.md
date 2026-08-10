# Local Runtime Supervisor Failure Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make supervisor bulk lifecycle commands return structured per-partition success and failure results instead of rejecting the entire operation on the first partition failure.

**Architecture:** Keep lifecycle failure behavior inside each backend, but make the supervisor a reliable control-plane boundary that catches per-partition errors, serializes them, and refreshes aggregate runtime status. This preserves the existing registry and lifecycle contracts while giving future API, ops, and Godot adapters an observable failure surface.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local runtime supervisor.

---

## Scope

This slice improves supervisor bulk command results for partial failures.

It does not change lifecycle semantics, materialize resets, add retry policy, add distributed leases, or add external API routes.

## File Structure

- Modify `apps/worker/src/localSimulationRuntimeSupervisor.ts`: add structured command outcomes and per-partition failure serialization.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`: cover partial failure caused by one partition being `reset-requested`.
- Create `docs/superpowers/plans/2026-06-24-local-runtime-supervisor-failure-surface-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Partial-Failure Test

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

- [x] **Step 1: Write failing test**

Add a test that:

- bootstraps a two-partition host;
- marks `world-east` as `reset-requested` through `host.registry.api.resetSimulation`;
- calls `supervisor.startAll`;
- expects `world-main` to succeed and `world-east` to return a structured failure with the reset error message;
- expects the refreshed supervisor status to mark `world-east` as `attention`.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeSupervisor.test.ts
```

Expected: FAIL because `startAll` rejects the whole Promise when one partition throws.

### Task 2: Structured Supervisor Command Results

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.ts`

- [x] **Step 1: Add command result envelope types**

Add:

- `LocalSimulationRuntimeSupervisorCommandOutcome`
- `LocalSimulationRuntimeSupervisorPartitionCommandError`
- success and failure partition result union types.

- [x] **Step 2: Catch per-partition errors**

Update `startAll` and `pauseAll` so each partition operation is executed independently. Successful partitions keep the existing `status` and `result`; failed partitions return `status: 'failed'`, `outcome: 'failed'`, and a serialized error.

- [x] **Step 3: Return aggregate command outcome**

Add aggregate fields to bulk results:

- `outcome`
- `succeededPartitionCount`
- `failedPartitionCount`

Use `succeeded`, `partial-failure`, or `failed`.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeSupervisor.test.ts
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
git diff --check
```

Expected: all commands pass.

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-local-runtime-supervisor-failure-surface-slice.md apps/worker/src/localSimulationRuntimeSupervisor.ts apps/worker/src/localSimulationRuntimeSupervisor.test.ts
git commit -m "feat: surface supervisor partition failures"
```

## Self-Review

- Spec coverage: Adds production-grade control-plane failure visibility needed for large game backend operations.
- Boundary review: Supervisor handles orchestration result shape; backend lifecycle behavior remains the source of truth.
- Placeholder scan: No deferred implementation markers remain.
