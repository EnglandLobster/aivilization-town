# Simulation Sync SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend Server-Sent Events transport for simulation sync so future Godot and web clients can open a live partition stream instead of relying only on polling.

**Architecture:** Keep SSE framing and Node transport support inside `apps/api`. Build a simulation sync SSE route that depends only on a `getSync` port, then let `apps/server` compose that route with the local runtime registry. Worker/domain packages remain transport-agnostic.

**Tech Stack:** TypeScript, Vitest, Node `http`, Fetch streaming tests, pnpm workspaces.

---

## Scope

This slice adds:

- reusable SSE event formatting
- optional SSE route support in the Node HTTP adapter
- `createSimulationSyncSseRoute` for `/simulations/:simulationId/partitions/:partitionKey/sync-stream`
- local runtime server composition of the sync SSE route
- tests for event framing, adapter routing, sync stream generation, and local server integration

It does not add WebSocket, client SDKs, authentication, multi-partition fanout, Redis pub/sub, backpressure queues, or a durable subscription registry.

## Runtime Semantics

- Clients connect with `Accept: text/event-stream`.
- The SSE route is `GET /simulations/:simulationId/partitions/:partitionKey/sync-stream`.
- Query params:
  - `afterSequence`: optional non-negative integer client cursor.
  - `limit`: optional positive integer batch size.
- The stream emits an initial `sync` event immediately.
- Event `id` is the returned `nextAfterSequence`.
- Event `data` is the same sync envelope as the JSON `/sync` route.
- The stream polls `getSync` behind the port so later worker/storage implementations can replace polling with push without changing Node transport.
- The stream stops when the request is aborted.

## File Structure

- Create `apps/api/src/serverSentEvents.ts`: SSE event types, route type, formatter, and small async helpers.
- Create `apps/api/src/serverSentEvents.test.ts`: formatting tests.
- Create `apps/api/src/simulationSyncSse.ts`: route matcher and sync async generator.
- Create `apps/api/src/simulationSyncSse.test.ts`: sync route unit tests.
- Modify `apps/api/src/nodeHttpServer.ts`: support optional SSE routes.
- Modify `apps/api/src/nodeHttpServer.test.ts`: prove SSE requests stream `text/event-stream` and bypass JSON handler.
- Modify `apps/api/src/index.ts`: export SSE modules.
- Modify `apps/server/src/localRuntimeTownServer.ts`: register the local runtime sync SSE route.
- Modify `apps/server/src/localRuntimeTownServer.test.ts`: prove real local server emits a sync SSE event.
- Create `docs/superpowers/plans/2026-06-24-simulation-sync-sse-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing API SSE Tests

**Files:**

- Create: `apps/api/src/serverSentEvents.test.ts`
- Create: `apps/api/src/simulationSyncSse.test.ts`
- Modify: `apps/api/src/nodeHttpServer.test.ts`

- [x] **Step 1: Add SSE formatter test**

Prove `formatServerSentEvent({ event, id, data })` writes `id`, `event`, JSON `data`, and a blank-line terminator.

- [x] **Step 2: Add simulation sync route test**

Create a fake `getSync` service and assert the route matches `/sync-stream`, parses cursor params, emits one initial `sync` SSE event, and carries `nextAfterSequence` as event id.

- [x] **Step 3: Add Node adapter SSE test**

Start `createTownNodeHttpServer` with one SSE route. Fetch with `Accept: text/event-stream`, read the first event block, assert headers/body, and assert the JSON handler was not invoked.

### Task 2: Failing Server Integration Test

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [x] **Step 1: Add local runtime SSE test**

After `POST /runtime/start`, fetch `/simulations/sim-1/partitions/world-main/sync-stream?afterSequence=0&limit=1` with `Accept: text/event-stream`, read one event block, and assert it contains the current sync envelope.

### Task 3: Implementation

**Files:**

- Create: `apps/api/src/serverSentEvents.ts`
- Create: `apps/api/src/simulationSyncSse.ts`
- Modify: `apps/api/src/nodeHttpServer.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/server/src/localRuntimeTownServer.ts`

- [x] **Step 1: Implement SSE formatter and route contract**

Add `TownServerSentEvent`, `TownServerSentEventRoute`, `TownServerSentEventRouteContext`, and `formatServerSentEvent`.

- [x] **Step 2: Implement Node adapter SSE branch**

When `Accept` includes `text/event-stream`, build a body-less town request, find a matching SSE route, set SSE headers, and write formatted events until the route completes or the request closes.

- [x] **Step 3: Implement simulation sync SSE route**

Parse the path and cursor query params, call `sync.getSync`, yield an initial `sync` event, and continue polling until `AbortSignal` aborts.

- [x] **Step 4: Wire local runtime server**

Pass `createSimulationSyncSseRoute({ sync: host.registry.api })` into `createTownNodeHttpServer`.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @aivilization/api test -- serverSentEvents.test.ts simulationSyncSse.test.ts nodeHttpServer.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

- [x] **Step 2: Run full verification**

Run:

```bash
pnpm check
pnpm build
git diff --check
```

- [x] **Step 3: Commit**

Commit this slice after all verification passes.

## Self-Review

- Boundary review: SSE transport stays in API/server, worker remains transport-agnostic.
- Data-flow review: SSE uses the existing sync envelope and cursor semantics instead of inventing a second client protocol.
- Extension review: The route contract can later be backed by Redis, queue fanout, or WebSocket without changing the simulation sync port.
