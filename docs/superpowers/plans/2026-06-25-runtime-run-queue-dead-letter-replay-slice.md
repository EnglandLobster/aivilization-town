# Runtime Run Queue Dead Letter Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dead-letter querying and safe replay for failed runtime run queue jobs.

**Architecture:** Keep durable job state transitions in the queue repository. Extend the API boundary with query and replay operations, then map them to HTTP routes and the local server adapter. Replay turns a `dead-lettered` job back into `queued` while preserving attempt history and assigning enough `maxAttempts` for another try.

**Tech Stack:** TypeScript, Vitest, pnpm, existing runtime run queue API, worker adapter, HTTP router, and file-backed queue repository.

---

### Task 1: Repository Query And Replay

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeRunQueue.ts`
- Modify: `apps/worker/src/localSimulationRuntimeRunQueue.test.ts`

- [ ] **Step 1: Write failing query/replay tests**

Add tests that create dead-lettered jobs, query by `status: "dead-lettered"`, replay one job at a concrete timestamp, and verify it returns to `queued` with preserved attempts, `lastReplayedAt`, `replayCount`, and a higher `maxAttempts`.

- [ ] **Step 2: Run worker tests and verify RED**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueue.test.ts`

Expected: FAIL because repositories do not expose `query` or `replayDeadLetter`.

- [ ] **Step 3: Implement repository operations**

Add `query(request)` and `replayDeadLetter(request)` to the repository interface and both in-memory/file implementations.

- [ ] **Step 4: Run worker tests and verify GREEN**

Run the same worker test. Expected: PASS.

### Task 2: API And HTTP Routes

**Files:**

- Modify: `apps/api/src/runtimeRunQueueApi.ts`
- Modify: `apps/api/src/runtimeRunQueueApi.test.ts`
- Modify: `apps/api/src/httpApi.ts`
- Modify: `apps/api/src/httpApi.test.ts`

- [ ] **Step 1: Write failing API/HTTP tests**

Cover:

- `queryRuntimeRunJobs({ status: "dead-lettered", limit: 2 })`
- `replayRuntimeRunJob({ jobId, replayedAt, maxAttempts })`
- `GET /runtime/run-jobs?status=dead-lettered&limit=2`
- `POST /runtime/run-jobs/:jobId/replay`

- [ ] **Step 2: Run API tests and verify RED**

Run: `pnpm --filter @aivilization/api test -- runtimeRunQueueApi.test.ts httpApi.test.ts`

Expected: FAIL because API methods/routes do not exist.

- [ ] **Step 3: Implement API and HTTP route parsing**

Normalize status enum, positive limit, replay timestamp, optional nextAttemptAt, and optional maxAttempts.

- [ ] **Step 4: Run API tests and verify GREEN**

Run the same API tests. Expected: PASS.

### Task 3: Worker Adapter And Server Integration

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeRunQueueApi.ts`
- Modify: `apps/worker/src/localSimulationRuntimeRunQueueApi.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [ ] **Step 1: Write failing adapter/server tests**

Adapter test delegates query/replay to repository. Server test creates a dead-lettered file-backed queue job, queries it over HTTP, replays it over HTTP, and verifies it is queued again.

- [ ] **Step 2: Run tests and verify RED**

Run:

- `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueueApi.test.ts`
- `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: FAIL until adapter and server handler routes are implemented.

- [ ] **Step 3: Implement adapter changes**

Extend `createLocalSimulationRuntimeRunQueueApiService` to require repository `query` and `replayDeadLetter`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same worker/server tests. Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- All files above plus this plan.

- [ ] **Step 1: Format touched files**

Run: `pnpm exec prettier --write <touched files>`

- [ ] **Step 2: Run targeted checks**

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

Run: `git add <touched files> && git commit -m "feat: add runtime run queue dead-letter replay"`
