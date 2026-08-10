# Event Feed API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a polling event feed through the simulation API and HTTP gateway so clients can synchronize from the immutable world event stream without bypassing backend boundaries.

**Architecture:** `apps/api` owns the transport-neutral event feed port and HTTP route contract. `apps/worker` adapts local runtime storage to that port by reading the partition event stream. `apps/server` remains a composition layer and receives the capability through the existing local runtime registry.

**Tech Stack:** TypeScript, Vitest, Node `http`, pnpm workspaces, `@aivilization/api`, `@aivilization/worker`, `@aivilization/sim-core`.

---

## Scope

This slice adds:

- a `SimulationEventFeedPort` abstraction
- a `getEvents` simulation API method
- `GET /simulations/:simulationId/partitions/:partitionKey/events`
- local runtime event feed backing from `EventStore.readStream`
- integration coverage through the local runtime HTTP gateway

It does not add SSE, WebSocket sessions, distributed stream leases, auth, resumable subscription state, client SDKs, or non-local storage backends.

## File Structure

- Modify `apps/api/src/simulationApi.ts`: add event feed request/port/service method.
- Modify `apps/api/src/httpApi.ts`: add event feed route and cursor query parsing.
- Modify `apps/api/src/simulationApi.test.ts`: cover service delegation.
- Modify `apps/api/src/httpApi.test.ts`: cover HTTP routing and bad cursor validation.
- Modify `apps/worker/src/localSimulationBackend.ts`: add local event feed port.
- Modify `apps/worker/src/localSimulationBackendRegistry.ts`: route registry-level requests to the matching backend feed.
- Modify `apps/worker/src/localSimulationBackend.test.ts`: cover event feed data and partition validation.
- Modify `apps/server/src/localRuntimeTownServer.test.ts`: prove the composed HTTP server exposes runtime events.
- Create `docs/superpowers/plans/2026-06-24-event-feed-api-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing API And HTTP Tests

**Files:**

- Modify: `apps/api/src/simulationApi.test.ts`
- Modify: `apps/api/src/httpApi.test.ts`

- [x] **Step 1: Add service delegation test**

Prove `SimulationApiService.getEvents` delegates to the injected event feed port with `simulationId`, `partitionKey`, `afterSequence`, and `limit`.

- [x] **Step 2: Add HTTP route test**

Prove `GET /simulations/:simulationId/partitions/:partitionKey/events?afterSequence=...&limit=...` returns the feed result and records a `getEvents` call.

- [x] **Step 3: Add bad cursor validation test**

Prove invalid event feed query parameters return structured `400 bad_request` responses before service invocation.

### Task 2: Failing Worker And Server Tests

**Files:**

- Modify: `apps/worker/src/localSimulationBackend.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [x] **Step 1: Add local backend event feed test**

After a local runtime start appends events, prove `backend.api.getEvents` returns stream metadata, events after the requested sequence, and the next polling cursor.

- [x] **Step 2: Add server integration test**

After `POST /runtime/start`, prove the composed HTTP server can read the main partition event feed.

### Task 3: Implementation

**Files:**

- Modify: `apps/api/src/simulationApi.ts`
- Modify: `apps/api/src/httpApi.ts`
- Modify: `apps/worker/src/localSimulationBackend.ts`
- Modify: `apps/worker/src/localSimulationBackendRegistry.ts`

- [x] **Step 1: Add API event feed abstractions**

Add `SimulationEventFeedRequest`, `SimulationEventFeedPort<TResult>`, and `getEvents` on `SimulationApiService`.

- [x] **Step 2: Add HTTP route**

Route `events` as a `GET`, parse `afterSequence` as a non-negative integer and `limit` as a positive integer, and return the simulation service result.

- [x] **Step 3: Add local worker adapter**

Read from `storage.eventStore.readStream(storage.partition.eventStreamName, { afterSequence, limit })`, include `streamVersion`, and compute `nextAfterSequence`.

- [x] **Step 4: Wire registry**

Forward registry-level event feed requests to the matching cached backend.

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

- Boundary review: API remains storage-agnostic, worker remains transport-agnostic, server only composes.
- Data-flow review: client cursor enters HTTP, maps to API request, maps to event store read options, returns immutable events plus stream metadata.
- Extension review: SSE/WebSocket can reuse the same event feed port and cursor semantics.
