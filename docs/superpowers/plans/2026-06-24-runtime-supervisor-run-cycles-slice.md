# Runtime Supervisor Run Cycles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a supervisor-controlled multi-cycle runtime operation so the backend can advance town
partitions repeatedly under one observable run session.

**Architecture:** Keep the lifecycle controller as the single-partition execution unit and keep
`startAll` as the bulk partition step. Add `runCycles` to the supervisor as orchestration only: it
runs deterministic `startAll` cycles in sequence, records each cycle trace, records a bounded
top-level run trace, and stops on partition command failure or health attention. API and HTTP layers
remain thin adapters over the supervisor contract.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local runtime supervisor, runtime API service,
town HTTP API.

---

## Scope

This slice adds:

- worker supervisor `runCycles` command
- top-level `run-cycles` operation trace with per-cycle summaries
- runtime API service `runRuntime`
- HTTP `POST /runtime/run`
- local server/API adapter support for the new command

It does not add wall-clock timers, cron, distributed queue leases, async background processes,
cluster scheduling, or retry policy. Those can wrap this deterministic operation later.

## Runtime Semantics

- `cycleCount` must be a positive integer.
- `cycleIntervalMs` defaults to `0` and must be a non-negative finite number when provided.
- Each cycle calls `startAll` with operation id `<runTraceId>:cycle:<cycleIndex>`.
- Each cycle requested time is `requestedAt + (cycleIndex - 1) * cycleIntervalMs`.
- The run stops immediately if a cycle outcome is not `succeeded`.
- The run also stops when `stopOnAttention` is unset or `true` and the cycle status has attention
  partitions.
- The run result reports `stopReason` as `cycle-count-completed`, `partition-failure`, or
  `attention`.
- The run-level operation trace stores bounded cycle summaries, not full nested traces.

## File Structure

- Modify `apps/worker/src/localSimulationRuntimeOperationTrace.ts`: add `run-cycles` command and
  bounded cycle summary trace metadata.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.ts`: add request/result types and
  `runCycles` orchestration.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`: cover completed multi-cycle
  runs and attention stops.
- Modify `apps/api/src/runtimeSupervisorApi.ts`: add generic run request and service method.
- Modify `apps/api/src/runtimeSupervisorApi.test.ts`: cover delegation and validation.
- Modify `apps/api/src/httpApi.ts`: route `POST /runtime/run`.
- Modify `apps/api/src/httpApi.test.ts`: cover HTTP routing and invalid body behavior.
- Modify `apps/worker/src/localSimulationRuntimeSupervisorApi.ts`: expose local run result through
  the API service type.
- Modify `apps/worker/src/localSimulationRuntimeSupervisorApi.test.ts`: cover adapter delegation.
- Modify `apps/server/src/localRuntimeTownServer.test.ts`: prove the local HTTP gateway can run
  multiple cycles end to end.

## Tasks

### Task 1: Failing Tests

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`
- Modify: `apps/api/src/runtimeSupervisorApi.test.ts`
- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisorApi.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [x] **Step 1: Worker run cycles happy path**

Add a supervisor test that runs three cycles with `cycleIntervalMs: 50`, then asserts:

- completed cycle count is three
- stop reason is `cycle-count-completed`
- cycle trace ids are deterministic
- partition `nextTickIndex` advances to four
- the top-level `run-cycles` operation trace stores bounded cycle summaries

- [x] **Step 2: Worker run cycles attention stop**

Add a supervisor test with failing memory consolidation and default `stopOnAttention`, then assert
the run stops after one cycle with `stopReason: attention` while cycle outcome remains `succeeded`.

- [x] **Step 3: API service delegates runRuntime**

Add a runtime API test that calls `runRuntime({ operationId, requestedAt, cycleCount,
cycleIntervalMs })` and asserts the normalized request reaches the injected control port.

- [x] **Step 4: HTTP router exposes POST /runtime/run**

Add an HTTP router test for `POST /runtime/run`, and add an invalid body assertion for
`cycleCount: 0`.

- [x] **Step 5: Local adapters expose run cycles**

Add worker API adapter and local server tests proving the local supervisor run operation is reachable
through the local runtime API and HTTP gateway.

### Task 2: Worker Supervisor Implementation

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeOperationTrace.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.ts`

- [x] **Step 1: Extend operation trace types**

Add `run-cycles` to the command union and add an optional `cycles` array with bounded summary fields:
cycle index, trace id, requested time, outcome, succeeded partition count, failed partition count,
and attention partition count.

- [x] **Step 2: Add runCycles request/result types**

Add request/result types with `cycleCount`, optional `cycleIntervalMs`, optional
`stopOnAttention`, completed cycle summaries, final status, and stop reason.

- [x] **Step 3: Implement runCycles orchestration**

Refactor existing `startAll`/`pauseAll` bodies into local helper functions if needed. Implement
`runCycles` by validating input, sequentially calling `startAll`, deciding stop reason, deriving the
aggregate outcome, and recording a top-level trace.

### Task 3: API And HTTP Wiring

**Files:**

- Modify: `apps/api/src/runtimeSupervisorApi.ts`
- Modify: `apps/api/src/httpApi.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisorApi.ts`

- [x] **Step 1: Add runtime API run method**

Extend the generic control port and API service with `runRuntime`.

- [x] **Step 2: Normalize run request**

Validate `requestedAt`, optional `operationId`, positive integer `cycleCount`, optional
non-negative `cycleIntervalMs`, and optional boolean `stopOnAttention`.

- [x] **Step 3: Add HTTP route**

Route `POST /runtime/run` to `runtimeSupervisor.runRuntime(...)`.

- [x] **Step 4: Update local adapter type**

Thread local supervisor run result and `run-cycles` command typing through the local API adapter.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted red/green tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeSupervisor.test.ts localSimulationRuntimeSupervisorApi.test.ts
pnpm --filter @aivilization/api test -- runtimeSupervisorApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

- [x] **Step 2: Run package verification**

Run:

```bash
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/api typecheck
pnpm --filter @aivilization/server typecheck
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/api test
pnpm --filter @aivilization/server test
pnpm lint
git diff --check
```

- [x] **Step 3: Commit**

Commit with:

```bash
git commit -m "feat: add supervisor run cycles"
```

## Self-Review

- Boundary review: supervisor orchestrates cycles; lifecycle and tick runner remain execution units.
- Data-flow review: run request -> runCycles -> startAll cycle traces -> top-level run trace ->
  status/API/HTTP.
- Extension review: future wall-clock daemons, queue workers, distributed leases, and Godot controls
  can wrap `runCycles` without changing domain packages.
