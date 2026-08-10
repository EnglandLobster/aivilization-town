# Worker OHLC Price Binning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the paper's transaction-log-to-OHLC time-binning step to the worker experiment
validation runner.

**Architecture:** Keep transaction extraction and OHLC aggregation in `apps/worker` because they are
runtime observation assembly concerns. `packages/observability` remains the authority for validation
statistics, and domain packages remain free of experiment-reporting logic.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces.

---

## Scope

This slice adds:

- typed trade-price observations extracted from `TradeExecuted` events
- deterministic OHLC bars grouped by commodity and interval
- optional runner `priceBinning` configuration that feeds OHLC close prices into the validation
  report
- tests for open/high/low/close ordering, close-series wiring, and invalid interval validation

It does not add durable OHLC storage, API endpoints, Ljung-Box statistics, dashboard rendering,
historical backfill jobs, or a scheduled experiment runner.

## Runtime Semantics

- Trade prices are still computed as `currencyQuantity / commodityQuantity`.
- Within a bin, Open is the first trade by `(observedAt, sourceSequence)`, High and Low are extrema,
  and Close is the last trade by `(observedAt, sourceSequence)`.
- Interval start is `originAt + floor((observedAt - originAt) / intervalMs) * intervalMs`.
- The runner keeps raw-per-trade close observations unless `priceBinning` is provided. Paper-style
  validation callers should pass `intervalMs: 5 * 60 * 1000`.
- OHLC bars expose trade count and summed commodity/currency volume for future market dashboards.

## File Structure

- Modify `apps/worker/src/experimentValidationRunner.test.ts`: add OHLC binning tests.
- Modify `apps/worker/src/experimentValidationRunner.ts`: add trade observation and OHLC helpers,
  plus optional runner binning configuration.
- Create `docs/superpowers/plans/2026-06-24-worker-ohlc-price-binning-slice.md`: track this
  implementation slice.

## Tasks

### Task 1: Failing OHLC Tests

**Files:**

- Modify: `apps/worker/src/experimentValidationRunner.test.ts`

- [x] **Step 1: Add OHLC helper test**

Create out-of-order fish transaction events across two intervals and assert the generated bars have
correct open, high, low, close, trade count, and volumes.

- [x] **Step 2: Add runner integration test**

Pass `priceBinning: { intervalMs: 60 }` into `createWorkerExperimentValidationReport` and assert the
market-stability evidence is computed from binned close prices rather than every raw transaction.

- [x] **Step 3: Add invalid interval test**

Assert `intervalMs: 0` fails with a clear error before report creation.

### Task 2: Implementation

**Files:**

- Modify: `apps/worker/src/experimentValidationRunner.ts`

- [x] **Step 1: Add trade price observation type and extractor**

Extract `TradeExecuted` events into sorted observations carrying commodity id, timestamp, source
sequence, price, commodity quantity, and currency quantity.

- [x] **Step 2: Add OHLC bar helper**

Group trade observations by commodity and interval, then calculate open/high/low/close, trade count,
commodity volume, and currency volume.

- [x] **Step 3: Add OHLC close conversion**

Convert OHLC bars into `PriceCloseObservation` rows using interval start as `observedAt`.

- [x] **Step 4: Wire optional runner binning**

Add `priceBinning` to `WorkerExperimentValidationReportInput` and use OHLC close observations when
provided.

### Task 3: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts
pnpm --filter @aivilization/worker typecheck
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

- Boundary review: worker owns data assembly from runtime events; observability owns metrics.
- Data-flow review: raw trades become trade observations, then OHLC bars, then close-price
  observations for the existing validation contract.
- Extension review: durable OHLC stores, APIs, and dashboards can later consume the same helper
  without changing simulation rules.
