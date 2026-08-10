# Validation Market Observation Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let local validation schedules build paper-style market diagnostics from durable market observations, so runtime-recorded trade/OHLC data feeds validation reports without re-reading raw trade events.

**Architecture:** `experimentValidationRunner` gains an optional `priceSeries` override for callers that already have validated close-price observations. `localExperimentValidationSchedule` owns the adapter from `storage.marketObservationRepository` to validation price series, while preserving the existing event-derived fallback.

**Tech Stack:** TypeScript, Vitest, `@aivilization/observability`, worker local runtime storage.

---

### Task 1: Worker Validation Price Series Override

**Files:**
- Modify: `apps/worker/src/experimentValidationRunner.ts`
- Modify: `apps/worker/src/experimentValidationRunner.test.ts`

- [x] **Step 1: Write failing override test**

Add a test proving `createWorkerExperimentValidationReport` can use an explicit `priceSeries` even when `events` has no `TradeExecuted` events.

- [x] **Step 2: Add optional `priceSeries` input**

Use the explicit `priceSeries` when present; otherwise keep deriving prices from world events exactly as before.

### Task 2: Local Schedule Market Observation Source

**Files:**
- Modify: `apps/worker/src/localExperimentValidationSchedule.ts`
- Modify: `apps/worker/src/localExperimentValidationSchedule.test.ts`
- Modify: `apps/worker/src/localSimulationLifecycle.ts`

- [x] **Step 1: Write failing local schedule tests**

Add one OHLC-backed validation schedule test and one trade-observation-backed schedule test. Both should pass with an empty event stream and prove market diagnostics use repository observations.

- [x] **Step 2: Add market observation source input**

Introduce `LocalExperimentValidationMarketObservationSource` with optional commodity and time-window filters.

- [x] **Step 3: Query repository and map to close-price observations**

When `priceBinning` is present, query OHLC bars. Otherwise query trade observations. Pass the resulting price series into `recordWorkerExperimentValidationReport`.

- [x] **Step 4: Forward lifecycle validation schedule config**

Allow lifecycle validation schedules to specify `marketObservationSource`.

### Task 3: Verification and Commit

**Files:**
- Modify this plan checklist to checked boxes.
- Commit all changed files.

- [x] **Step 1: Run focused verification**

```bash
pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts
pnpm --filter @aivilization/worker test -- localExperimentValidationSchedule.test.ts
pnpm --filter @aivilization/worker test -- localSimulationLifecycle.test.ts
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
git add docs/superpowers/plans/2026-06-25-validation-market-observation-source-slice.md \
  apps/worker/src/experimentValidationRunner.ts apps/worker/src/experimentValidationRunner.test.ts \
  apps/worker/src/localExperimentValidationSchedule.ts apps/worker/src/localExperimentValidationSchedule.test.ts \
  apps/worker/src/localSimulationLifecycle.ts
git commit -m "feat: validate from market observations"
```

- [x] **Step 4: Report overview**

Summarize completed work, verification, current branch status, remaining gaps, and an updated tree diagram.
