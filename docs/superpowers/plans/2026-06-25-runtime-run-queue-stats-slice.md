# Runtime Run Queue Stats Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic runtime run queue stats snapshot so operators, future Godot tooling, and automated recovery logic can observe backlog, delayed retries, expired leases, dead letters, attempts, and replay pressure without scanning queue internals.

**Architecture:** Keep stats at the run queue repository boundary because the repository owns latest job state and eligibility rules. The API layer validates a caller-supplied `observedAt` timestamp and exposes a reserved HTTP route, while the worker adapter simply delegates to the repository.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local in-memory/file-backed queue repositories.

---

### Task 1: Repository Stats Contract

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeRunQueue.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeRunQueue.ts`

- [ ] **Step 1: Write the failing test**

```ts
await expect(
  repository.getStats({ observedAt: 260, manifestId: 'town-runtime' }),
).resolves.toMatchObject({
  observedAt: 260,
  manifestId: 'town-runtime',
  totalJobCount: 4,
  statusCounts: {
    queued: 2,
    leased: 1,
    completed: 0,
    failed: 0,
    'dead-lettered': 1,
  },
  readyQueueCount: 1,
  delayedQueueCount: 1,
  activeLeaseCount: 0,
  expiredLeaseCount: 1,
  failedAttemptCount: 2,
  replayCount: 1,
  oldestQueuedAt: 100,
  oldestReadyJobEnqueuedAt: 100,
  newestUpdatedAt: 250,
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueue.test.ts`

Expected: TypeScript/Vitest failure because `getStats` is not implemented on the repository contract.

- [ ] **Step 3: Implement minimal repository stats**

Add `LocalSimulationRuntimeRunQueueStatsRequest`, `LocalSimulationRuntimeRunQueueStats`, and `getStats` to both repository implementations. Compute stats from latest jobs only and reuse the same job eligibility rules used by claiming.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueue.test.ts`

Expected: PASS with queue stats for both in-memory and file-backed behavior covered.

### Task 2: API And HTTP Route

**Files:**

- Modify: `apps/api/src/runtimeRunQueueApi.test.ts`
- Modify: `apps/api/src/runtimeRunQueueApi.ts`
- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/api/src/httpApi.ts`

- [ ] **Step 1: Write failing API and HTTP tests**

```ts
await expect(
  service.getRuntimeRunQueueStats({ observedAt: 260, manifestId: 'town-runtime' }),
).resolves.toMatchObject({
  observedAt: 260,
  manifestId: 'town-runtime',
  totalJobCount: 4,
});
```

```ts
await expect(
  handler({
    method: 'GET',
    path: '/runtime/run-jobs/stats',
    query: { observedAt: '260', manifestId: 'town-runtime' },
  }),
).resolves.toMatchObject({
  status: 200,
  body: {
    observedAt: 260,
    manifestId: 'town-runtime',
    totalJobCount: 4,
  },
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @aivilization/api test -- runtimeRunQueueApi.test.ts httpApi.test.ts`

Expected: failure because the API service and HTTP router do not expose stats yet.

- [ ] **Step 3: Implement API and HTTP stats support**

Add `getRunQueueStats` to the control port, `getRuntimeRunQueueStats` to the service, and route `GET /runtime/run-jobs/stats` before the generic job-id route. Require a non-negative finite query `observedAt`; accept optional `manifestId`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @aivilization/api test -- runtimeRunQueueApi.test.ts httpApi.test.ts`

Expected: PASS with validation and routing covered.

### Task 3: Local Adapter And Server Integration

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeRunQueueApi.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeRunQueueApi.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [ ] **Step 1: Write failing adapter/server tests**

```ts
await expect(
  service.getRuntimeRunQueueStats({ observedAt: 260, manifestId: 'town-runtime' }),
).resolves.toMatchObject({
  observedAt: 260,
  manifestId: 'town-runtime',
  totalJobCount: 1,
});
```

```ts
await expect(
  fetchJson(`${server.baseUrl}/runtime/run-jobs/stats?observedAt=910&manifestId=town-runtime`),
).resolves.toMatchObject({
  observedAt: 910,
  manifestId: 'town-runtime',
  totalJobCount: 2,
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueueApi.test.ts && pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: failure until the local adapter exposes repository stats through the generic API service.

- [ ] **Step 3: Implement local adapter delegation**

Extend the adapter repository pick with `getStats` and delegate `getRunQueueStats` directly.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueue.test.ts localSimulationRuntimeRunQueueApi.test.ts && pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: PASS.

### Task 4: Final Verification And Commit

**Files:**

- Modify: all files above

- [ ] **Step 1: Format changed files**

Run: `pnpm exec prettier --write apps/worker/src/localSimulationRuntimeRunQueue.ts apps/worker/src/localSimulationRuntimeRunQueue.test.ts apps/worker/src/localSimulationRuntimeRunQueueApi.ts apps/worker/src/localSimulationRuntimeRunQueueApi.test.ts apps/api/src/runtimeRunQueueApi.ts apps/api/src/runtimeRunQueueApi.test.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/server/src/localRuntimeTownServer.test.ts docs/superpowers/plans/2026-06-25-runtime-run-queue-stats-slice.md`

- [ ] **Step 2: Run full relevant verification**

Run: `pnpm --filter @aivilization/api typecheck && pnpm --filter @aivilization/api test && pnpm --filter @aivilization/worker typecheck && pnpm --filter @aivilization/worker test && pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test && pnpm lint && pnpm typecheck && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-runtime-run-queue-stats-slice.md apps/worker/src/localSimulationRuntimeRunQueue.ts apps/worker/src/localSimulationRuntimeRunQueue.test.ts apps/worker/src/localSimulationRuntimeRunQueueApi.ts apps/worker/src/localSimulationRuntimeRunQueueApi.test.ts apps/api/src/runtimeRunQueueApi.ts apps/api/src/runtimeRunQueueApi.test.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/server/src/localRuntimeTownServer.test.ts
git commit -m "feat: add runtime run queue stats"
```
