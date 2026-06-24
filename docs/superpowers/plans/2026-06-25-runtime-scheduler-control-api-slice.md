# Runtime Scheduler Control API Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the runtime scheduler host through stable API and HTTP controls so operators, tests, and the future Godot management layer can inspect, start, stop, and manually trigger scheduler decisions.

**Architecture:** Add a generic API service in `apps/api` that mirrors the existing run-queue-worker control pattern. Add a worker adapter that delegates to `LocalSimulationRuntimeSchedulerHost`, then wire the optional scheduler service into the HTTP router and local server only when a scheduler host is configured.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local HTTP router.

---

### Task 1: Generic Scheduler API Service

**Files:**

- Create: `apps/api/src/runtimeSchedulerApi.test.ts`
- Create: `apps/api/src/runtimeSchedulerApi.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
const service = createRuntimeSchedulerApiService({
  control: {
    getStatus: () => ({ running: false }),
    start: () => ({ running: true }),
    stop: () => ({ running: false }),
    runOnce: () => ({ status: 'skipped', reason: 'pending-job-limit-reached' }),
  },
});

await expect(service.getRuntimeSchedulerStatus()).resolves.toEqual({ running: false });
await expect(service.startRuntimeScheduler()).resolves.toEqual({ running: true });
await expect(service.runRuntimeSchedulerOnce()).resolves.toEqual({
  status: 'skipped',
  reason: 'pending-job-limit-reached',
});
await expect(service.stopRuntimeScheduler()).resolves.toEqual({ running: false });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/api test -- runtimeSchedulerApi.test.ts`

Expected: FAIL because `createRuntimeSchedulerApiService` is not exported.

- [ ] **Step 3: Implement minimal API service**

Create `RuntimeSchedulerControlPort<TStatus, TDecision>` and `RuntimeSchedulerApiService<TStatus, TDecision>` with `getRuntimeSchedulerStatus`, `startRuntimeScheduler`, `stopRuntimeScheduler`, and `runRuntimeSchedulerOnce`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aivilization/api test -- runtimeSchedulerApi.test.ts`

Expected: PASS.

### Task 2: HTTP Scheduler Routes

**Files:**

- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/api/src/httpApi.ts`

- [ ] **Step 1: Write failing HTTP route test**

```ts
await expect(handler({ method: 'GET', path: '/runtime/scheduler/status' })).resolves.toMatchObject({
  status: 200,
  body: { running: false },
});
await expect(
  handler({ method: 'POST', path: '/runtime/scheduler/run-once', body: {} }),
).resolves.toMatchObject({
  status: 202,
  body: { status: 'enqueued' },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/api test -- httpApi.test.ts`

Expected: FAIL because `/runtime/scheduler/*` routes are not implemented.

- [ ] **Step 3: Implement routes**

Add optional `runtimeScheduler` to `TownHttpApiServices`, route `GET /runtime/scheduler/status`, `POST /runtime/scheduler/start`, `POST /runtime/scheduler/stop`, and `POST /runtime/scheduler/run-once`. If the service is absent, return 404.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aivilization/api test -- httpApi.test.ts`

Expected: PASS.

### Task 3: Local Scheduler Adapter And Server Wiring

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeSchedulerApi.test.ts`
- Create: `apps/worker/src/localSimulationRuntimeSchedulerApi.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/server/src/localRuntimeTownServer.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [ ] **Step 1: Write failing adapter and server tests**

```ts
await expect(service.runRuntimeSchedulerOnce()).resolves.toMatchObject({
  status: 'enqueued',
});
```

```ts
await expect(fetchJson(`${server.baseUrl}/runtime/scheduler/status`)).resolves.toMatchObject({
  running: false,
});
await expect(
  fetchJson(`${server.baseUrl}/runtime/scheduler/run-once`, { method: 'POST' }),
).resolves.toMatchObject({ status: 'enqueued' });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeSchedulerApi.test.ts && pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: FAIL until the local adapter and server HTTP service wiring exist.

- [ ] **Step 3: Implement adapter and server service wiring**

Create `createLocalSimulationRuntimeSchedulerApiService`, expose it from worker index, store optional `runtimeSchedulerApi` on `LocalRuntimeTownApi`, and pass it into `createTownHttpApiHandler` when configured.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeSchedulerApi.test.ts && pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: PASS.

### Task 4: Final Verification And Commit

**Files:**

- Modify: all files above

- [ ] **Step 1: Format changed files**

Run: `pnpm exec prettier --write apps/api/src/runtimeSchedulerApi.ts apps/api/src/runtimeSchedulerApi.test.ts apps/api/src/index.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/worker/src/localSimulationRuntimeSchedulerApi.ts apps/worker/src/localSimulationRuntimeSchedulerApi.test.ts apps/worker/src/index.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts docs/superpowers/plans/2026-06-25-runtime-scheduler-control-api-slice.md`

- [ ] **Step 2: Run focused and full verification**

Run: `pnpm --filter @aivilization/api typecheck && pnpm --filter @aivilization/api test -- runtimeSchedulerApi.test.ts httpApi.test.ts && pnpm --filter @aivilization/worker typecheck && pnpm --filter @aivilization/worker test -- localSimulationRuntimeSchedulerApi.test.ts && pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts && pnpm lint && pnpm typecheck && pnpm test && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-runtime-scheduler-control-api-slice.md apps/api/src/runtimeSchedulerApi.ts apps/api/src/runtimeSchedulerApi.test.ts apps/api/src/index.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/worker/src/localSimulationRuntimeSchedulerApi.ts apps/worker/src/localSimulationRuntimeSchedulerApi.test.ts apps/worker/src/index.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
git commit -m "feat: expose runtime scheduler controls"
```
