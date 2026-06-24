# Runtime Run Queue Worker Control API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose runtime run queue worker lifecycle and drain controls through stable API and HTTP boundaries.

**Architecture:** Add an API-layer control service for worker status/start/stop/drain that knows nothing about local worker host internals. Add a worker adapter that maps that generic API service onto `LocalSimulationRuntimeRunQueueWorkerHost`. Inject the service into the HTTP router and local server composition so operations tooling can manage async run execution.

**Tech Stack:** TypeScript, Vitest, pnpm, existing HTTP router and local runtime worker host.

---

### Task 1: API Control Service

**Files:**

- Create: `apps/api/src/runtimeRunQueueWorkerApi.ts`
- Create: `apps/api/src/runtimeRunQueueWorkerApi.test.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write the failing API service test**

Test that `createRuntimeRunQueueWorkerApiService` delegates `getStatus`, `start`, `stop`, and `drain`, normalizes optional `maxJobs`, and rejects invalid drain requests before hitting the control port.

- [ ] **Step 2: Run API tests and verify RED**

Run: `pnpm --filter @aivilization/api test -- runtimeRunQueueWorkerApi.test.ts`

Expected: FAIL because `createRuntimeRunQueueWorkerApiService` is not exported.

- [ ] **Step 3: Implement the API service**

Create generic types for status/drain result and a control port. Normalize `maxJobs` as an optional positive integer.

- [ ] **Step 4: Run API tests and verify GREEN**

Run: `pnpm --filter @aivilization/api test -- runtimeRunQueueWorkerApi.test.ts`

Expected: PASS.

### Task 2: HTTP Router

**Files:**

- Modify: `apps/api/src/httpApi.ts`
- Modify: `apps/api/src/httpApi.test.ts`

- [ ] **Step 1: Write failing HTTP route tests**

Add route coverage for:

- `GET /runtime/run-queue-worker/status`
- `POST /runtime/run-queue-worker/start`
- `POST /runtime/run-queue-worker/stop`
- `POST /runtime/run-queue-worker/drain`

- [ ] **Step 2: Run HTTP tests and verify RED**

Run: `pnpm --filter @aivilization/api test -- httpApi.test.ts`

Expected: FAIL with `not_found` for the new routes.

- [ ] **Step 3: Implement routes**

Extend `TownHttpApiServices` with `runtimeRunQueueWorker` and route the four endpoints without changing synchronous `/runtime/run` or job submit/query semantics.

- [ ] **Step 4: Run HTTP tests and verify GREEN**

Run: `pnpm --filter @aivilization/api test -- httpApi.test.ts`

Expected: PASS.

### Task 3: Worker Adapter And Server Wiring

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeRunQueueWorkerApi.ts`
- Create: `apps/worker/src/localSimulationRuntimeRunQueueWorkerApi.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/server/src/localRuntimeTownServer.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [ ] **Step 1: Write failing adapter and server tests**

Test that the worker adapter returns host status after start/stop and delegates drain. In the server test, submit a run job through HTTP, drain through `/runtime/run-queue-worker/drain`, then verify the job is completed and the worker status counters advanced.

- [ ] **Step 2: Run worker/server tests and verify RED**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueueWorkerApi.test.ts`

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: FAIL because the adapter and server injection do not exist.

- [ ] **Step 3: Implement adapter and server injection**

Create `createLocalSimulationRuntimeRunQueueWorkerApiService({ host })`, export it, create the service in the local runtime server, and pass it into the HTTP handler.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same worker/server tests again. Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- All files above.

- [ ] **Step 1: Format touched files**

Run: `pnpm exec prettier --write <touched files>`

- [ ] **Step 2: Run targeted package checks**

Run:

- `pnpm --filter @aivilization/api typecheck && pnpm --filter @aivilization/api test`
- `pnpm --filter @aivilization/worker typecheck && pnpm --filter @aivilization/worker test`
- `pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test`

- [ ] **Step 3: Run repository checks**

Run:

- `pnpm lint`
- `pnpm typecheck`
- `git diff --check`

- [ ] **Step 4: Commit**

Run: `git add <touched files> && git commit -m "feat: expose runtime run queue worker controls"`
