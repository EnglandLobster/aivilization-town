# Runtime Daemon Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single runtime daemon health status boundary that aggregates supervisor, queue, worker, scheduler, and recovery state for future Godot controls, operations tooling, and scale tests.

**Architecture:** Keep `apps/api` transport-neutral by adding a generic `RuntimeDaemonApiService` and `/runtime/daemon/status` route. Keep local health derivation in `apps/server/src/localRuntimeTownOrchestration.ts`, where the local queue repository and daemon host statuses are available without leaking file-backed implementation details into the router.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing runtime orchestration and HTTP router.

---

### Task 1: Generic Daemon API And HTTP Route

**Files:**

- Create: `apps/api/src/runtimeDaemonApi.test.ts`
- Create: `apps/api/src/runtimeDaemonApi.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/api/src/httpApi.ts`

- [ ] **Step 1: Write failing API and router tests**

Add coverage for `createRuntimeDaemonApiService` delegation and `GET /runtime/daemon/status` routing through an optional daemon service.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @aivilization/api test -- runtimeDaemonApi.test.ts httpApi.test.ts`

Expected: FAIL because the daemon API service and route are not exported or wired.

- [ ] **Step 3: Implement generic service and route**

Create `RuntimeDaemonApiService<TStatus>` with `getRuntimeDaemonStatus`. Add optional `runtimeDaemon` to `TownHttpApiServices` and route `GET /runtime/daemon/status`, returning 404 if absent.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm --filter @aivilization/api test -- runtimeDaemonApi.test.ts httpApi.test.ts`

Expected: PASS.

### Task 2: Local Orchestration Health Aggregation

**Files:**

- Modify: `apps/server/src/localRuntimeTownOrchestration.test.ts`
- Modify: `apps/server/src/localRuntimeTownOrchestration.ts`

- [ ] **Step 1: Write failing local aggregate test**

Extend orchestration tests to require `runtimeDaemonApi.getRuntimeDaemonStatus()` to return manifest id, observed time, supervisor health, run queue stats, daemon component statuses, and attention health when the queue contains dead-lettered jobs.

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownOrchestration.test.ts`

Expected: FAIL because `runtimeDaemonApi` is missing.

- [ ] **Step 3: Implement local health aggregation**

Store orchestration profile and supervisor in the orchestration object, add an injectable daemon health clock, derive component health from existing statuses and queue stats, and expose the generic daemon API service.

- [ ] **Step 4: Run test and verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownOrchestration.test.ts`

Expected: PASS.

### Task 3: Server Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.ts`

- [ ] **Step 1: Write failing HTTP integration test**

Add coverage that `GET /runtime/daemon/status` works through `createLocalRuntimeTownNodeHttpServer` and includes the local runtime manifest id plus worker component status.

- [ ] **Step 2: Run server test and verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: FAIL until server passes `runtimeDaemon` into `createTownHttpApiHandler`.

- [ ] **Step 3: Wire the daemon service**

Pass `runtimeOrchestration.runtimeDaemonApi` into the HTTP handler and expose it on `LocalRuntimeTownApi`.

- [ ] **Step 4: Run server tests and verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- Modify: all files above

- [ ] **Step 1: Format touched files**

Run: `pnpm exec prettier --write docs/superpowers/plans/2026-06-25-runtime-daemon-health-slice.md apps/api/src/runtimeDaemonApi.ts apps/api/src/runtimeDaemonApi.test.ts apps/api/src/index.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/server/src/localRuntimeTownOrchestration.ts apps/server/src/localRuntimeTownOrchestration.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts`

- [ ] **Step 2: Run focused and full verification**

Run: `pnpm --filter @aivilization/api typecheck && pnpm --filter @aivilization/api test -- runtimeDaemonApi.test.ts httpApi.test.ts && pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test -- localRuntimeTownOrchestration.test.ts localRuntimeTownServer.test.ts && pnpm lint && pnpm typecheck && pnpm test && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-runtime-daemon-health-slice.md apps/api/src/runtimeDaemonApi.ts apps/api/src/runtimeDaemonApi.test.ts apps/api/src/index.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/server/src/localRuntimeTownOrchestration.ts apps/server/src/localRuntimeTownOrchestration.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
git commit -m "feat: add runtime daemon health status"
```
