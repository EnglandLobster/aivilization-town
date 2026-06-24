# Runtime Run Session Stop Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable stop-request boundary for supervisor run sessions so long town runs can be
stopped safely between cycles.

**Architecture:** Store stop intent on the run-session latest-state record instead of process-local
memory. `runCycles` refreshes the session after each completed cycle, stops at the next cycle
boundary when a stop request is present, and writes a terminal `stopped` session with
`stop-requested`. The API and HTTP layers expose a narrow stop command without coupling callers to
runtime internals.

**Tech Stack:** TypeScript, Vitest, generic API service, local runtime supervisor, JSONL-backed
session repository, local Node HTTP server.

---

## Scope

This slice adds:

- stop request fields on run-session state
- repository method to request a stop idempotently
- supervisor `requestRunSessionStop`
- `stop-requested` run-cycle stop reason
- generic API method `stopRuntimeRunSession`
- HTTP route `POST /runtime/run-sessions/:traceId/stop`
- server e2e coverage that requests stop before a resumed run and proves only the next missing cycle
  executes before terminal stop

It does not add mid-cycle interruption, worker leases, queue scheduling, auth, distributed locking,
or force-kill semantics. Those can wrap this durable boundary later.

## File Structure

- Modify `apps/worker/src/localSimulationRuntimeRunSession.ts`: add stop fields and repository stop
  method.
- Modify `apps/worker/src/localSimulationRuntimeRunSession.test.ts`: prove stop request persistence
  and idempotency.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.ts`: add stop method and cycle-boundary
  stop handling.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`: prove a persisted stop request
  stops a resumed run after one additional cycle.
- Modify `apps/api/src/runtimeSupervisorApi.ts`: add generic stop request/response method.
- Modify `apps/api/src/runtimeSupervisorApi.test.ts`: prove API delegation and validation.
- Modify `apps/api/src/httpApi.ts`: add stop route.
- Modify `apps/api/src/httpApi.test.ts`: prove HTTP routing.
- Modify `apps/worker/src/localSimulationRuntimeSupervisorApi.ts` and test: bind local adapter.
- Modify `apps/server/src/localRuntimeTownServer.test.ts`: prove local HTTP stop route.

## Tasks

### Task 1: Failing Repository And Supervisor Tests

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeRunSession.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

- [x] **Step 1: Add repository stop request test**

Save a running session, call `requestStop({ traceId, requestedAt })`, assert the returned and
restarted latest state contains `stopRequestedAt`, then call it again with a later timestamp and
assert the original request timestamp is preserved.

- [x] **Step 2: Add supervisor resume stop-boundary test**

Seed a running session with one completed cycle, call `requestRunSessionStop`, then call `runCycles`
for three requested cycles. Assert cycle two runs, cycle three does not, and the final session is
`stopped` with `stopReason: 'stop-requested'`.

- [x] **Step 3: Run worker targeted tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunSession.test.ts localSimulationRuntimeSupervisor.test.ts
```

Expected: fail because repository/supervisor stop methods and `stop-requested` are missing.

### Task 2: Failing API And HTTP Tests

**Files:**

- Modify: `apps/api/src/runtimeSupervisorApi.test.ts`
- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisorApi.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [x] **Step 1: Add generic API stop delegation test**

Assert `stopRuntimeRunSession({ traceId, requestedAt })` normalizes input and delegates to
`control.requestRunSessionStop`.

- [x] **Step 2: Add HTTP stop route test**

Assert `POST /runtime/run-sessions/op-run-200/stop` delegates to
`runtimeSupervisor.stopRuntimeRunSession({ traceId: 'op-run-200', requestedAt: 260 })`.

- [x] **Step 3: Add local adapter stop delegation test**

Assert the local adapter exposes `stopRuntimeRunSession` and delegates to
`supervisor.requestRunSessionStop`.

- [x] **Step 4: Add local server stop route e2e test**

Run one cycle, request stop over HTTP, resume the run, and assert the final run session is stopped
after two total cycles.

- [x] **Step 5: Run targeted tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/api test -- runtimeSupervisorApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/worker test -- localSimulationRuntimeSupervisorApi.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

Expected: fail because the stop API route and adapter methods are missing.

### Task 3: Stop Request Implementation

**Files:**

- Modify all files listed in Tasks 1 and 2.

- [x] **Step 1: Extend run-session state and repository**

Add optional `stopRequestedAt` and a repository `requestStop` method that returns `undefined` when
the session does not exist, preserves the first stop request timestamp, and persists updated state.

- [x] **Step 2: Extend supervisor stop semantics**

Add `requestRunSessionStop`, extend stop reason to `stop-requested`, and make `runCycles` stop after
the current completed cycle when the refreshed session has `stopRequestedAt`.

- [x] **Step 3: Extend API and HTTP control plane**

Add generic `stopRuntimeRunSession`, local adapter typing, and
`POST /runtime/run-sessions/:traceId/stop`.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunSession.test.ts localSimulationRuntimeSupervisor.test.ts
pnpm --filter @aivilization/api test -- runtimeSupervisorApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/worker test -- localSimulationRuntimeSupervisorApi.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

- [x] **Step 2: Run package verification**

Run:

```bash
pnpm --filter @aivilization/api typecheck
pnpm --filter @aivilization/api test
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/server typecheck
pnpm --filter @aivilization/server test
pnpm lint
git diff --check
```

- [x] **Step 3: Commit**

Commit with:

```bash
git commit -m "feat: add runtime run session stop requests"
```

## Self-Review

- Boundary review: stop intent is durable session state, not process-local cancellation.
- Data-flow review: HTTP/API stop request -> supervisor -> session repository -> runCycles refresh
  -> stopped terminal session.
- Extension review: background queues, distributed leases, and Godot UI polling can reuse the same
  stop fields and route without changing cycle execution internals.
