# Runtime Market Observation Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move market observation persistence from a manually callable worker helper into the runtime tick data flow, so every local world tick can durably record transaction-level prices and optional OHLC bars for later validation and diagnostics.

**Architecture:** `tickRunner` owns post-event observation recording through a `MarketObservationRepository` port. Local runtime storage owns the default file-backed repository. Manifest/lifecycle/runtime wiring passes an optional recording config through existing runtime boundaries without teaching the tick layer about filesystem paths or HTTP concerns.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, event-sourced world projection.

---

### Task 1: Recording Adapter Runtime Semantics

**Files:**
- Modify: `apps/worker/src/marketObservationRecording.ts`
- Modify: `apps/worker/src/marketObservationRecording.test.ts`

- [x] **Step 1: Write the failing empty-event test**

Verify that recording with non-trade events returns zero counts instead of throwing.

- [x] **Step 2: Implement empty-trade no-op behavior**

Return `{ tradeObservationCount: 0, ohlcBarCount: 0 }` when a tick has no `TradeExecuted` events.

### Task 2: Tick Runner Observation Recording

**Files:**
- Modify: `apps/worker/src/tickRunner.ts`
- Modify: `apps/worker/src/tickRunner.test.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.ts`

- [x] **Step 1: Write the failing tick recording test**

Configure a market observation repository on a trading tick and assert the tick result includes recording counts while the repository persists trade and OHLC observations.

- [x] **Step 2: Add the tick-level recording port**

Introduce `WorkerTickMarketObservationsInput`, add `marketObservations` to tick inputs/results, and call `recordWorkerMarketObservations` after all tick events are assembled.

- [x] **Step 3: Pass the config through canonical active-plan ticks**

Forward `marketObservations` alongside existing `marketMetrics`.

### Task 3: Local Runtime Storage and Wiring

**Files:**
- Modify: `apps/worker/src/localRuntimeStorage.ts`
- Modify: `apps/worker/src/localRuntimeStorage.test.ts`
- Modify: `apps/worker/src/localRuntimeStep.ts`
- Modify: `apps/worker/src/localRuntimeLoop.ts`
- Modify: `apps/worker/src/localSimulationLifecycle.ts`
- Modify: `apps/worker/src/localSimulationRuntimeManifest.ts`
- Modify: `apps/worker/src/localSimulationRuntimeHost.ts`

- [x] **Step 1: Write the failing local runtime default-flow test**

Run a local runtime step with a trade action and assert `storage.marketObservationRepository` records trade and OHLC observations without passing a repository directly to the step.

- [x] **Step 2: Add the file-backed repository to local storage**

Create `FileMarketObservationRepository` under the existing observability directory and expose it on `LocalWorldRuntimeStorage`.

- [x] **Step 3: Pass runtime market observation config through local runtime boundaries**

Allow runtime wiring to pass optional `marketObservations` config down to each tick, defaulting local runtime steps to storage-backed recording.

### Task 4: Verification and Commit

**Files:**
- Modify this plan checklist to checked boxes.
- Commit all changed files.

- [x] **Step 1: Run focused verification**

```bash
pnpm --filter @aivilization/worker test -- marketObservationRecording.test.ts
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
pnpm --filter @aivilization/worker test -- localRuntimeStep.test.ts
pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts
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
git add docs/superpowers/plans/2026-06-25-runtime-market-observation-recording-slice.md \
  apps/worker/src/marketObservationRecording.ts apps/worker/src/marketObservationRecording.test.ts \
  apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts \
  apps/worker/src/canonicalActivePlanTick.ts \
  apps/worker/src/localRuntimeStorage.ts apps/worker/src/localRuntimeStorage.test.ts \
  apps/worker/src/localRuntimeStep.ts apps/worker/src/localRuntimeLoop.ts \
  apps/worker/src/localSimulationLifecycle.ts apps/worker/src/localSimulationRuntimeManifest.ts \
  apps/worker/src/localSimulationRuntimeHost.ts
git commit -m "feat: record market observations during ticks"
```

- [x] **Step 4: Report overview**

Summarize completed work, verification, current branch status, remaining gaps, and an updated tree diagram.
