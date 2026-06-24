# Market Observation Query API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose runtime-recorded market trade observations and OHLC bars through the simulation API and HTTP gateway so diagnostics, validation, and future UI surfaces can query the market data plane without reading files directly.

**Architecture:** `@aivilization/api` defines market observation query requests and a `MarketObservationQueryPort`. The simulation service delegates to that port. The worker local backend adapts the port to `storage.marketObservationRepository`. HTTP routes parse bounded query params and call the simulation service.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, file-backed local runtime repository.

---

### Task 1: Simulation Service Contract

**Files:**
- Modify: `apps/api/src/simulationApi.ts`
- Modify: `apps/api/src/simulationApi.test.ts`

- [x] **Step 1: Write failing service delegation tests**

Assert `queryMarketTradeObservations` and `queryMarketOhlcBars` delegate to an injected market observation query port.

- [x] **Step 2: Add market observation query types and service methods**

Add query request types, the port interface, and concrete service methods.

### Task 2: HTTP Query Routes

**Files:**
- Modify: `apps/api/src/httpApi.ts`
- Modify: `apps/api/src/httpApi.test.ts`

- [x] **Step 1: Write failing route tests**

Add GET coverage for `/simulations/:simulationId/partitions/:partitionKey/market-observations/trades` and `/market-observations/ohlc-bars`.

- [x] **Step 2: Implement route matching and query parsing**

Parse `commodityId`, numeric time windows, and positive `limit`, returning `400` for invalid bounds.

### Task 3: Worker Backend Adapter

**Files:**
- Modify: `apps/worker/src/localSimulationBackend.ts`
- Modify: `apps/worker/src/localSimulationBackend.test.ts`
- Modify: `apps/worker/src/localSimulationBackendRegistry.ts`

- [x] **Step 1: Write failing local backend query tests**

Persist observations through storage and assert backend API and direct port queries return partition-scoped results.

- [x] **Step 2: Implement local market observation query port**

Adapt the API port to `storage.marketObservationRepository` and wire it into backend and registry services.

### Task 4: Verification and Commit

**Files:**
- Modify this plan checklist to checked boxes.
- Commit all changed files.

- [x] **Step 1: Run focused verification**

```bash
pnpm --filter @aivilization/api test -- simulationApi.test.ts
pnpm --filter @aivilization/api test -- httpApi.test.ts
pnpm --filter @aivilization/worker test -- localSimulationBackend.test.ts
pnpm --filter @aivilization/worker test -- localSimulationBackendRegistry.test.ts
```

- [x] **Step 2: Run full verification**

```bash
pnpm typecheck
pnpm lint
pnpm test
git diff --check
```

- [x] **Step 3: Commit the slice**

```bash
git add docs/superpowers/plans/2026-06-25-market-observation-query-api-slice.md \
  apps/api/src/simulationApi.ts apps/api/src/simulationApi.test.ts \
  apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts \
  apps/worker/src/localSimulationBackend.ts apps/worker/src/localSimulationBackend.test.ts \
  apps/worker/src/localSimulationBackendRegistry.ts
git commit -m "feat: expose market observation queries"
```

- [x] **Step 4: Report overview**

Summarize completed work, verification, current branch status, remaining gaps, and an updated tree diagram.
