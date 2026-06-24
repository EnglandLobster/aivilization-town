# Runtime Scheduler Policy Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runtime scheduler policy boundary that can deterministically enqueue asynchronous run-cycle jobs from queue health, giving the backend a real orchestration layer instead of only manual run submission.

**Architecture:** Implement scheduler core in the worker package, depending only on the run queue repository's `getStats` and `enqueue` methods. Add a small scheduler host with injected clock/timer for periodic execution and counters, then make the local server optionally create and stop the host without exposing HTTP controls yet.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local in-memory/file-backed queue repositories.

---

### Task 1: Scheduler Core

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeScheduler.test.ts`
- Create: `apps/worker/src/localSimulationRuntimeScheduler.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
const repository = new InMemoryLocalSimulationRuntimeRunQueueRepository();
const scheduler = createLocalSimulationRuntimeScheduler({
  manifestId: 'town-runtime',
  queueRepository: repository,
  policy: {
    schedulerId: 'main-loop',
    cycleCount: 3,
    cycleIntervalMs: 50,
    stopOnAttention: true,
  },
});

await expect(scheduler.schedule({ observedAt: 1_000 })).resolves.toMatchObject({
  status: 'enqueued',
  job: {
    jobId: 'town-runtime:scheduler:main-loop:run:1000',
    manifestId: 'town-runtime',
    status: 'queued',
    enqueuedAt: 1_000,
    runRequest: {
      operationId: 'town-runtime:scheduler:main-loop:run:1000:operation',
      requestedAt: 1_000,
      cycleCount: 3,
      cycleIntervalMs: 50,
      stopOnAttention: true,
    },
  },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeScheduler.test.ts`

Expected: FAIL because `createLocalSimulationRuntimeScheduler` is not exported.

- [ ] **Step 3: Implement minimal scheduler**

Create scheduler types and `createLocalSimulationRuntimeScheduler`. The scheduler fetches stats at `observedAt`, skips when dead-lettered jobs exist unless explicitly allowed, skips when queued+leased jobs reach `maxPendingJobs`, and otherwise enqueues one deterministic run job.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeScheduler.test.ts`

Expected: PASS.

### Task 2: Scheduler Host

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeScheduler.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeScheduler.ts`

- [ ] **Step 1: Write the failing host test**

```ts
const host = createLocalSimulationRuntimeSchedulerHost({
  scheduler: createScheduler([{ status: 'enqueued' }, { status: 'skipped' }]),
  scheduleIntervalMs: 25,
  clock: createClock([100, 150, 200, 250]),
});

await host.runOnce();
await host.runOnce();

expect(host.getStatus()).toMatchObject({
  running: false,
  inFlight: false,
  scheduleIntervalMs: 25,
  attemptedScheduleCount: 2,
  enqueuedScheduleCount: 1,
  skippedScheduleCount: 1,
  lastScheduleStartedAt: 200,
  lastScheduleCompletedAt: 250,
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeScheduler.test.ts`

Expected: FAIL until scheduler host is implemented.

- [ ] **Step 3: Implement host**

Add `createLocalSimulationRuntimeSchedulerHost` with `runOnce`, `start`, `stop`, and `getStatus`, mirroring the existing run queue worker host's injected scheduler/clock pattern.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeScheduler.test.ts`

Expected: PASS.

### Task 3: Optional Local Server Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [ ] **Step 1: Write failing server integration test**

```ts
const scheduled = await runtime.runQueueSchedulerHost?.runOnce();
expect(scheduled).toMatchObject({
  status: 'enqueued',
  job: {
    manifestId: 'town-runtime',
    status: 'queued',
    runRequest: { cycleCount: 2, cycleIntervalMs: 50 },
  },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: FAIL until server input and return types expose an optional scheduler host.

- [ ] **Step 3: Wire optional scheduler host**

Add `runtimeScheduler` input options, create scheduler/host when configured, stop it on server close, and auto-start it only when requested.

- [ ] **Step 4: Run server test**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: PASS.

### Task 4: Final Verification And Commit

**Files:**

- Modify: all files above

- [ ] **Step 1: Format changed files**

Run: `pnpm exec prettier --write apps/worker/src/localSimulationRuntimeScheduler.ts apps/worker/src/localSimulationRuntimeScheduler.test.ts apps/worker/src/index.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts docs/superpowers/plans/2026-06-25-runtime-scheduler-policy-slice.md`

- [ ] **Step 2: Run focused and full verification**

Run: `pnpm --filter @aivilization/worker typecheck && pnpm --filter @aivilization/worker test -- localSimulationRuntimeScheduler.test.ts && pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts && pnpm lint && pnpm typecheck && pnpm test && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-runtime-scheduler-policy-slice.md apps/worker/src/localSimulationRuntimeScheduler.ts apps/worker/src/localSimulationRuntimeScheduler.test.ts apps/worker/src/index.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
git commit -m "feat: add runtime scheduler policy"
```
