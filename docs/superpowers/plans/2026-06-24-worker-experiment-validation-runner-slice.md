# Worker Experiment Validation Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a worker-side runner that turns simulation projections, transaction events, planner
ablation rows, and agent-cycle traces into the observability experiment validation report contract.

**Architecture:** `apps/worker` owns runtime data assembly while `packages/observability` owns the
statistical validation definitions. The runner accepts explicit ports and data snapshots so local
files, future databases, offline runs, and API endpoints can reuse the same boundary.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces.

---

## Scope

This slice adds:

- `createWorkerExperimentValidationReport` in `apps/worker`
- conversion from `TradeExecuted` events into close-price observations
- conversion from `WorldProjection` agent state into wealth snapshot observations
- conversion from `AgentCycleTraceRepository` records into replayable trajectory coverage rows
- tests proving the runner composes paper validation metrics without duplicating observability math

It does not add a durable report repository, API route, scheduler, experiment execution loop, OHLC
time-binning, or Godot/UI integration.

## Runtime Semantics

- The runner is pure except for optional async reads from `AgentCycleTraceRepository`.
- Trade prices are computed from `TradeExecuted.currencyQuantity / commodityQuantity`, matching the
  paper's transaction-log basis for high-frequency price series.
- Wealth snapshots are computed from projected balance plus inventory marked to current AMM spot
  prices.
- Expected trajectory agents default to all agents in the projection, sorted by id.
- Trajectories can be passed explicitly or derived from traces. If both are provided, explicit
  trajectories win.
- Planner ablation results are passed as explicit reviewed rows because the runner does not execute
  planner cohorts yet.
- Invalid transaction quantities fail before reaching the report layer so non-finite values do not
  leak into validation evidence.

## File Structure

- Create `apps/worker/src/experimentValidationRunner.test.ts`: runner composition and validation
  tests.
- Create `apps/worker/src/experimentValidationRunner.ts`: data assembly helpers and runner.
- Modify `apps/worker/src/index.ts`: export the runner.
- Modify `apps/worker/package.json`: declare the worker's direct economy dependency.
- Modify `pnpm-lock.yaml`: keep workspace dependency metadata synchronized.
- Create `docs/superpowers/plans/2026-06-24-worker-experiment-validation-runner-slice.md`: track
  this implementation slice.

## Tasks

### Task 1: Failing Runner Tests

**Files:**

- Create: `apps/worker/src/experimentValidationRunner.test.ts`

- [x] **Step 1: Add report composition test**

Build a projection with AMM pools and agents, six `TradeExecuted` fish events, planner ablation
rows, and agent-cycle traces. Assert the worker runner emits the six observability metric ids, a
passing market-stability metric, a Gini coefficient from projection net worth, and trajectory
coverage from trace counts.

- [x] **Step 2: Add invalid transaction test**

Pass a `TradeExecuted` event with zero commodity quantity and assert the runner throws before
creating a report.

### Task 2: Implementation

**Files:**

- Create: `apps/worker/src/experimentValidationRunner.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Implement world event price extraction**

Add `createPriceCloseObservationsFromWorldEvents` that filters `TradeExecuted` events, validates
simulation id and positive finite quantities, and emits `PriceCloseObservation` rows.

- [x] **Step 2: Implement projection wealth extraction**

Add `createWealthSnapshotFromWorldProjection` that computes net worth with economy valuation and
maps jobs to optional occupation ids.

- [x] **Step 3: Implement trace trajectory extraction**

Add `createAgentTrajectoriesFromTraceRepository` that queries traces by simulation id, groups by
agent id, and counts cycle records for expected agents.

- [x] **Step 4: Implement runner composition**

Add `createWorkerExperimentValidationReport` that assembles price, wealth, planner, and trajectory
inputs and delegates final statistics to `createExperimentValidationReport`.

- [x] **Step 5: Export the module**

Add the runner export to `apps/worker/src/index.ts`.

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

- Boundary review: worker assembles runtime observations; observability remains the validation math
  authority.
- Data-flow review: transaction events, projection state, planner rows, and trace records flow into
  one report contract with no UI assumptions.
- Extension review: later OHLC aggregation, scheduled experiment cohorts, report storage, and API
  routes can wrap this runner without changing domain packages.
