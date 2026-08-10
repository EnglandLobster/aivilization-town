# Runtime Run Queue Worker Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable runtime run queue worker host so queued runtime jobs can be drained manually or processed by a controlled start/stop loop.

**Architecture:** Keep `LocalSimulationRuntimeRunQueueWorker` as the single-job executor. Add a separate worker host that owns polling, drain limits, clock/scheduler injection, lifecycle state, and lightweight status counters. Wire the local town server to compose repository, worker, and host while keeping HTTP and supervisor boundaries unchanged.

**Tech Stack:** TypeScript, Vitest, pnpm, local file-backed runtime run queue repository.

---

### Task 1: Worker Host Unit Boundary

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeRunQueueWorkerHost.ts`
- Create: `apps/worker/src/localSimulationRuntimeRunQueueWorkerHost.test.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Write the failing host drain test**

Test that a host drains completed and failed worker results until idle, uses injected clock values for `claimedAt`, and exposes counters through `getStatus()`.

- [ ] **Step 2: Run the worker test and verify RED**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueueWorkerHost.test.ts`

Expected: FAIL because `createLocalSimulationRuntimeRunQueueWorkerHost` is not exported.

- [ ] **Step 3: Implement the host**

Create a worker host with `runOnce`, `drain`, `start`, `stop`, and `getStatus`. Keep scheduler and clock injectable; default to `Date.now`, `setTimeout`, and `clearTimeout`.

- [ ] **Step 4: Run the worker test and verify GREEN**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueueWorkerHost.test.ts`

Expected: PASS.

### Task 2: Server Composition

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [ ] **Step 1: Write the failing server composition test**

Submit a runtime run job through HTTP, assert it is queued, call `runtime.runQueueWorkerHost.drain({ maxJobs: 1 })`, then assert the same job is completed and the run session is available.

- [ ] **Step 2: Run the server test and verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: FAIL because `runQueueWorkerHost` is not part of the local runtime API.

- [ ] **Step 3: Wire the local server**

Create the run queue worker and host beside the existing file queue repository. Expose the host on `LocalRuntimeTownApi`, allow optional worker settings, and stop the host when the node server closes.

- [ ] **Step 4: Run the server test and verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- All files above.

- [ ] **Step 1: Format touched files**

Run: `pnpm exec prettier --write apps/worker/src/localSimulationRuntimeRunQueueWorkerHost.ts apps/worker/src/localSimulationRuntimeRunQueueWorkerHost.test.ts apps/worker/src/index.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts docs/superpowers/plans/2026-06-25-runtime-run-queue-worker-host-slice.md`

- [ ] **Step 2: Run package checks**

Run: `pnpm --filter @aivilization/worker typecheck && pnpm --filter @aivilization/worker test`

Run: `pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test`

- [ ] **Step 3: Run repository checks**

Run: `pnpm lint`

Run: `git diff --check`

- [ ] **Step 4: Commit**

Run: `git add <touched files> && git commit -m "feat: add runtime run queue worker host"`
