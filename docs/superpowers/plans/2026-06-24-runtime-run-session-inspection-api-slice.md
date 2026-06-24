# Runtime Run Session Inspection API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose persisted supervisor run-session state through the runtime control API and HTTP
gateway.

**Architecture:** Keep run sessions as mutable/latest run state owned by the supervisor, then add a
read-only lookup method to the generic runtime supervisor API. The HTTP layer gets a narrow
`GET /runtime/run-sessions/:traceId` route, while local server integration proves the route can
inspect completed long-run state after `POST /runtime/run`.

**Tech Stack:** TypeScript, Vitest, generic API service, local runtime supervisor, Node HTTP server.

---

## Scope

This slice adds:

- `RuntimeSupervisorRunSessionRequest`
- `getRuntimeRunSession` on the generic runtime supervisor API service
- local worker adapter wiring from API service to `supervisor.getRunSession`
- `GET /runtime/run-sessions/:traceId` in the HTTP router
- local Node server e2e coverage for inspecting a completed run session

It does not add cancellation, queue workers, leases, run-session search, retention policies, or
authorization. Those should wrap this inspection boundary later.

## File Structure

- Modify `apps/api/src/runtimeSupervisorApi.ts`: add generic run-session type and lookup method.
- Modify `apps/api/src/runtimeSupervisorApi.test.ts`: prove delegation and invalid trace-id guard.
- Modify `apps/api/src/httpApi.ts`: add `GET /runtime/run-sessions/:traceId`.
- Modify `apps/api/src/httpApi.test.ts`: prove route parsing and service delegation.
- Modify `apps/worker/src/localSimulationRuntimeSupervisorApi.ts`: include local run-session type.
- Modify `apps/worker/src/localSimulationRuntimeSupervisorApi.test.ts`: prove adapter delegation.
- Modify `apps/server/src/localRuntimeTownServer.test.ts`: prove HTTP inspection after a run.

## Tasks

### Task 1: Failing API Contract Tests

**Files:**

- Modify: `apps/api/src/runtimeSupervisorApi.test.ts`

- [x] **Step 1: Add run-session delegation expectation**

Add a test expectation that `getRuntimeRunSession({ traceId: 'op-run-200' })` delegates to
`control.getRunSession('op-run-200')` and returns the session object unchanged.

- [x] **Step 2: Add invalid run-session request guard**

Add a rejection assertion for `getRuntimeRunSession({ traceId: '   ' })` and verify no control port
method is called.

- [x] **Step 3: Run the API test and verify RED**

Run:

```bash
pnpm --filter @aivilization/api test -- runtimeSupervisorApi.test.ts
```

Expected: fail because `getRuntimeRunSession` and `getRunSession` do not exist yet.

### Task 2: Failing HTTP And Local Adapter Tests

**Files:**

- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisorApi.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [x] **Step 1: Add HTTP route expectation**

Assert `GET /runtime/run-sessions/op-run-200` calls
`runtimeSupervisor.getRuntimeRunSession({ traceId: 'op-run-200' })` and returns the session body.

- [x] **Step 2: Add local adapter expectation**

Assert `createLocalSimulationRuntimeSupervisorApiService` exposes `getRuntimeRunSession` by
delegating to `supervisor.getRunSession`.

- [x] **Step 3: Add local server e2e expectation**

After `POST /runtime/run`, fetch `/runtime/run-sessions/<traceId>` and assert the completed session
has the same trace id, completed status, completed cycle count, and terminal stop reason.

- [x] **Step 4: Run targeted tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/api test -- runtimeSupervisorApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/worker test -- localSimulationRuntimeSupervisorApi.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

Expected: fail at type/runtime boundaries because the new API method and route are missing.

### Task 3: API And HTTP Implementation

**Files:**

- Modify: `apps/api/src/runtimeSupervisorApi.ts`
- Modify: `apps/api/src/httpApi.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisorApi.ts`

- [x] **Step 1: Add generic run-session API contract**

Add `RuntimeSupervisorRunSessionRequest`, `getRunSession` on the control port, and
`getRuntimeRunSession` on the API service. Reuse trace-id normalization.

- [x] **Step 2: Add HTTP route**

Route `GET /runtime/run-sessions/:traceId` to
`runtimeSupervisor.getRuntimeRunSession({ traceId })`.

- [x] **Step 3: Wire local worker adapter**

Extend `LocalSimulationRuntimeSupervisorApiService` with `LocalSimulationRuntimeRunSessionState` as
the run-session type and pass through the supervisor control port.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
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
git commit -m "feat: expose runtime run session inspection"
```

## Self-Review

- Boundary review: the route is read-only and exposes supervisor-owned latest run state.
- Data-flow review: HTTP trace id -> runtime API normalization -> local supervisor -> run-session
  repository.
- Extension review: cancellation, leases, run queues, and UI polling can reuse this route without
  changing lifecycle execution code.
