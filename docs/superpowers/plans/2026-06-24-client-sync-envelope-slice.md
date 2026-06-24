# Client Sync Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend sync envelope that gives future Godot and web clients a consistent projection snapshot plus event cursor for partition synchronization.

**Architecture:** Keep transport-neutral API contracts in `apps/api`. Let `apps/worker` build a local sync envelope from the same projection hydrator and event store used by projection and event feed queries. Keep `apps/server` as composition only; it should expose sync through the existing registry-backed API.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/api`, `@aivilization/worker`, local event store/projection hydration.

---

## Scope

This slice adds:

- `SimulationSyncRequest` and `SimulationSyncPort<TResult>`
- `SimulationApiService.getSync`
- `GET /simulations/:simulationId/partitions/:partitionKey/sync`
- local runtime sync envelope backed by hydrated projection plus bounded events after a client cursor
- HTTP integration coverage through the local runtime server

It does not add SSE, WebSocket, Godot client code, auth, multi-partition batch sync, transport-level subscriptions, or conflict reconciliation.

## Sync Semantics

- `afterSequence` is the client's last applied event sequence.
- If `afterSequence` is omitted, the server returns the latest projection and no historical events.
- If `afterSequence` is provided, the server returns events after that sequence, bounded by `limit`.
- The returned projection is hydrated to the same `streamVersion` reported in the envelope.
- Events are filtered so they never exceed the projection's `streamVersion`.
- `nextAfterSequence` is the last returned event sequence, or the requested/default cursor when no events are returned.
- `hasMoreEvents` is true when more events exist between `nextAfterSequence` and `streamVersion`.

## File Structure

- Modify `apps/api/src/simulationApi.ts`: add sync request/port/service method.
- Modify `apps/api/src/httpApi.ts`: route `/sync` and reuse event cursor query validation.
- Modify `apps/api/src/simulationApi.test.ts`: cover sync service delegation.
- Modify `apps/api/src/httpApi.test.ts`: cover sync HTTP routing and validation.
- Modify `apps/api/src/commandStoreSubmission.test.ts`: add sync stub to existing service setup.
- Modify `apps/worker/src/localSimulationBackend.ts`: add local sync port and result type.
- Modify `apps/worker/src/localSimulationBackendRegistry.ts`: route registry sync requests to the matching backend.
- Modify `apps/worker/src/localSimulationBackend.test.ts`: cover local sync envelope consistency and partition validation.
- Modify `apps/server/src/localRuntimeTownServer.test.ts`: cover composed HTTP sync route.
- Create `docs/superpowers/plans/2026-06-24-client-sync-envelope-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing API And HTTP Tests

**Files:**

- Modify: `apps/api/src/simulationApi.test.ts`
- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/api/src/commandStoreSubmission.test.ts`

- [x] **Step 1: Add service delegation test**

Extend the existing delegation test so `service.getSync({ simulationId, partitionKey, afterSequence, limit })` returns the injected sync port result and records the exact request.

- [x] **Step 2: Add HTTP sync route test**

Extend the HTTP router test so `GET /simulations/sim-1/partitions/world-main/sync?afterSequence=2&limit=3` returns a sync envelope and records a `getSync` call.

- [x] **Step 3: Add invalid sync cursor tests**

Prove invalid `afterSequence` and `limit` query values return structured `400 bad_request` responses before service invocation.

### Task 2: Failing Worker And Server Tests

**Files:**

- Modify: `apps/worker/src/localSimulationBackend.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [x] **Step 1: Add local backend sync test**

After a runtime start appends events, call `backend.api.getSync({ afterSequence: 1, limit: 1 })` and assert:

- `projectionSequence` equals the current stream version.
- returned `projection` reflects all events through the current stream version.
- returned `events` contains only sequence `2`.
- `nextAfterSequence` is `2`.
- `hasMoreEvents` is true when stream version is `3`.

- [x] **Step 2: Add partition validation test**

Prove sync requests for the wrong partition reject before reading the local event stream.

- [x] **Step 3: Add HTTP server sync integration test**

After `POST /runtime/start`, call `/sync?afterSequence=0&limit=1` on the real local HTTP server and assert the response includes the current projection and bounded event cursor.

### Task 3: Implementation

**Files:**

- Modify: `apps/api/src/simulationApi.ts`
- Modify: `apps/api/src/httpApi.ts`
- Modify: `apps/worker/src/localSimulationBackend.ts`
- Modify: `apps/worker/src/localSimulationBackendRegistry.ts`

- [x] **Step 1: Add API sync abstractions**

Add `SimulationSyncRequest`, `SimulationSyncPort<TResult>`, and `getSync` on `SimulationApiService`.

- [x] **Step 2: Add HTTP sync route**

Route `sync` as `GET`, parse `afterSequence` as a non-negative integer and `limit` as a positive integer, then delegate to `simulation.getSync`.

- [x] **Step 3: Add local worker sync adapter**

Hydrate projection first, use its `streamVersion` as the consistency boundary, then read events after `afterSequence ?? streamVersion` and filter to that boundary.

- [x] **Step 4: Wire registry**

Forward registry-level sync requests to the matching backend sync port.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @aivilization/api test -- simulationApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/worker test -- localSimulationBackend.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

- [x] **Step 2: Run full verification**

Run:

```bash
pnpm check
pnpm build
git diff --check
```

- [ ] **Step 3: Commit**

Commit this slice after all verification passes.

## Self-Review

- Boundary review: API remains storage-agnostic; worker owns local event/projection reads; server only composes.
- Data-flow review: client cursor enters HTTP, maps to sync request, projection hydrates to a stream version, events are bounded to that same stream version.
- Extension review: SSE/WebSocket can emit the same envelope on connect before switching to live event pushes.
