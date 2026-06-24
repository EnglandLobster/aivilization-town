# Local Runtime Supervisor Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local runtime supervisor control plane that observes and controls all partitions in a manifest-bootstrapped town runtime.

**Architecture:** Keep host bootstrap responsible for storage and registry construction, then layer a supervisor on top for game-server control semantics: status snapshots, partition health, and bulk lifecycle commands. This gives future HTTP, CLI, worker daemon, and Godot gateway adapters one stable backend control contract instead of coupling them to registry internals.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local runtime host and lifecycle APIs.

---

## Scope

This slice adds a framework-agnostic supervisor for local manifest runtimes.

It does not add HTTP routing, a scheduler daemon, distributed leases, WebSocket streaming, or Godot protocol messages.

## File Structure

- Create `apps/worker/src/localSimulationRuntimeSupervisor.ts`: supervisor types and implementation.
- Create `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`: behavior tests for status snapshots and bulk lifecycle control.
- Modify `apps/worker/src/index.ts`: export the supervisor API.
- Create `docs/superpowers/plans/2026-06-24-local-runtime-supervisor-control-plane-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Supervisor Tests

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:

- `createLocalSimulationRuntimeSupervisor` reports every host partition as `bootstrapped` before lifecycle commands run.
- `startAll({ requestedAt })` starts each partition through the existing registry lifecycle API.
- `getStatus()` reflects lifecycle state after `startAll`.
- `pauseAll({ requestedAt })` pauses each partition and refreshes status.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeSupervisor.test.ts
```

Expected: FAIL because `createLocalSimulationRuntimeSupervisor` is not exported yet.

### Task 2: Supervisor Implementation

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeSupervisor.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Implement status snapshot**

Add:

- `LocalSimulationRuntimeSupervisorPartitionStatus`
- `LocalSimulationRuntimeSupervisorStatus`
- `createLocalSimulationRuntimeSupervisor`

The supervisor should derive status from each partition's lifecycle state store. If no lifecycle state exists, the partition status is `bootstrapped`.

- [x] **Step 2: Implement bulk lifecycle controls**

Add:

- `startAll({ requestedAt })`
- `pauseAll({ requestedAt })`

Each command should route through `host.registry.api`, preserve per-partition results, and return a refreshed supervisor status.

- [x] **Step 3: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeSupervisor.test.ts localSimulationRuntimeHost.test.ts
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
git add docs/superpowers/plans/2026-06-24-local-runtime-supervisor-control-plane-slice.md apps/worker/src/index.ts apps/worker/src/localSimulationRuntimeSupervisor.ts apps/worker/src/localSimulationRuntimeSupervisor.test.ts
git commit -m "feat: add local runtime supervisor control plane"
```

## Self-Review

- Spec coverage: Adds the next backend control-plane layer needed for a large-game runtime: observe and control a manifest town as a whole.
- Boundary review: Supervisor depends on host and registry contracts; it does not duplicate tick, lifecycle, storage, or bootstrap logic.
- Placeholder scan: No deferred implementation markers remain.
