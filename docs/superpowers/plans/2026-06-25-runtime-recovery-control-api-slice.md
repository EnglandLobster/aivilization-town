# Runtime Recovery Control API Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote runtime recovery from a one-shot policy object into an observable, controllable runtime subsystem that operators and the future game management layer can inspect, start, stop, and trigger manually.

**Architecture:** Keep recovery decisions in `apps/worker`, expose a generic control API in `apps/api`, add a local worker adapter, then wire optional recovery controls into the HTTP router and local server composition. The recovery host mirrors scheduler/worker-host lifecycle semantics while preserving recovery policy as a separate dependency.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local HTTP router and file-backed run queue.

---

### Task 1: Recovery Host

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeRecoveryHost.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeRecovery.ts`

- [ ] **Step 1: Write failing host tests**

Cover deterministic `runOnce` counters with injected time, plus idempotent start/stop timer lifecycle.

- [ ] **Step 2: Run host tests and verify RED**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRecoveryHost.test.ts`

Expected: FAIL because `createLocalSimulationRuntimeRecoveryHost` is not exported.

- [ ] **Step 3: Implement recovery host**

Add `LocalSimulationRuntimeRecoveryHost` with `runOnce`, `start`, `stop`, and `getStatus`. Track running/in-flight state, interval, attempts, recovered/idle counters, last report, and serialized errors.

- [ ] **Step 4: Run host tests and verify GREEN**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRecoveryHost.test.ts`

Expected: PASS.

### Task 2: API And HTTP Recovery Controls

**Files:**

- Create: `apps/api/src/runtimeRecoveryApi.test.ts`
- Create: `apps/api/src/runtimeRecoveryApi.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/api/src/httpApi.ts`

- [ ] **Step 1: Write failing API and router tests**

Cover generic control delegation and HTTP routes:

- `GET /runtime/recovery/status`
- `POST /runtime/recovery/start`
- `POST /runtime/recovery/stop`
- `POST /runtime/recovery/run-once`

- [ ] **Step 2: Run API tests and verify RED**

Run: `pnpm --filter @aivilization/api test -- runtimeRecoveryApi.test.ts httpApi.test.ts`

Expected: FAIL until the generic service and router branch exist.

- [ ] **Step 3: Implement API service and routes**

Add `RuntimeRecoveryApiService<TStatus, TReport>` and optional `runtimeRecovery` service injection in `TownHttpApiServices`. Return 404 when recovery is not configured.

- [ ] **Step 4: Run API tests and verify GREEN**

Run: `pnpm --filter @aivilization/api test -- runtimeRecoveryApi.test.ts httpApi.test.ts`

Expected: PASS.

### Task 3: Local Adapter And Server Wiring

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeRecoveryApi.test.ts`
- Create: `apps/worker/src/localSimulationRuntimeRecoveryApi.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/server/src/localRuntimeTownServer.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [ ] **Step 1: Write failing adapter and server tests**

Cover adapter delegation to `LocalSimulationRuntimeRecoveryHost`, and local server recovery wiring that can drain an HTTP-submitted queued run job via `/runtime/recovery/run-once`.

- [ ] **Step 2: Run worker/server tests and verify RED**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRecoveryApi.test.ts`

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: FAIL until the adapter and server composition exist.

- [ ] **Step 3: Implement local wiring**

Build recovery from the shared run queue repository and run queue worker host, expose `runQueueRecoveryHost` and `runtimeRecoveryApi`, pass the API into the HTTP handler, and stop/autostart it with the local node server.

- [ ] **Step 4: Run focused tests**

Run the same worker/server tests again. Expected: PASS.

### Task 4: Final Verification And Commit

**Files:**

- Modify: all files above

- [ ] **Step 1: Format touched files**

Run: `pnpm exec prettier --write <touched files>`

- [ ] **Step 2: Run focused and full verification**

Run: `pnpm --filter @aivilization/api typecheck && pnpm --filter @aivilization/api test -- runtimeRecoveryApi.test.ts httpApi.test.ts && pnpm --filter @aivilization/worker typecheck && pnpm --filter @aivilization/worker test -- localSimulationRuntimeRecoveryHost.test.ts localSimulationRuntimeRecoveryApi.test.ts && pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts && pnpm lint && pnpm typecheck && pnpm test && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-runtime-recovery-control-api-slice.md apps/api/src/runtimeRecoveryApi.ts apps/api/src/runtimeRecoveryApi.test.ts apps/api/src/index.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/worker/src/localSimulationRuntimeRecovery.ts apps/worker/src/localSimulationRuntimeRecoveryHost.test.ts apps/worker/src/localSimulationRuntimeRecoveryApi.ts apps/worker/src/localSimulationRuntimeRecoveryApi.test.ts apps/worker/src/index.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
git commit -m "feat: expose runtime recovery controls"
```
