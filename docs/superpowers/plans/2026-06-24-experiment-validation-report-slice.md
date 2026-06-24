# Experiment Validation Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a storage- and transport-neutral validation report contract for the paper's empirical
surfaces: market stability, heavy-tail returns, volatility clustering, wealth stratification,
planner ablations, and replayable agent trajectories.

**Architecture:** Keep deterministic validation math in `packages/observability`. Worker experiment
runners, API endpoints, and future dashboards should consume this contract instead of duplicating
statistical definitions in adapters.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces.

---

## Scope

This slice adds:

- typed experiment validation observations and report contracts
- deterministic market stability diagnostics from close-price series
- log-return heavy-tail and volatility-clustering summaries
- wealth-stratification summaries from cross-sectional agent snapshots
- planner ablation comparison summaries against the default planner
- trajectory coverage summaries for replay/debug surfaces
- tests that lock the report shape and invalid-data behavior

It does not add experiment execution, OHLC aggregation from raw trades, dashboards, API endpoints,
database persistence, or statistical significance tests such as Ljung-Box.

## Runtime Semantics

- Report creation is pure and deterministic.
- Inputs are already reviewed observations from a worker or offline analysis job.
- Market diagnostics use last-traded close prices grouped by commodity and sorted by observation
  timestamp.
- Stability computes log-price range and maximum drawdown.
- Return diagnostics compute log returns, excess kurtosis, skewness, and lag-1 autocorrelation of
  absolute returns.
- Wealth diagnostics compute Gini coefficient, top-decile wealth share, education-gradient medians,
  and occupation median spread when occupation labels are available.
- Ablation diagnostics compare `default` planner rows against all non-default variants for matching
  task metrics.
- Trajectory diagnostics compare expected agent ids against recorded trajectory step counts.

## File Structure

- Create `packages/observability/src/experimentValidation.test.ts`: report contract and validation
  tests.
- Create `packages/observability/src/experimentValidation.ts`: report types and deterministic
  metric helpers.
- Modify `packages/observability/src/index.ts`: export the validation report module.
- Create `docs/superpowers/plans/2026-06-24-experiment-validation-report-slice.md`: track this
  implementation slice.

## Tasks

### Task 1: Failing Observability Tests

**Files:**

- Create: `packages/observability/src/experimentValidation.test.ts`

- [x] **Step 1: Add report contract test**

Build a deterministic paper-style observation set and assert market stability, wealth
stratification, planner ablation, and trajectory coverage metrics.

- [x] **Step 2: Add invalid-input test**

Prove invalid prices, non-finite values, and incomplete planner ablation groups fail before a report
is emitted.

### Task 2: Implementation

**Files:**

- Create: `packages/observability/src/experimentValidation.ts`
- Modify: `packages/observability/src/index.ts`

- [x] **Step 1: Define report contracts**

Add run metadata, observation inputs, metric records, status/finding types, and threshold options.

- [x] **Step 2: Implement market validation helpers**

Compute grouped close-price diagnostics, log returns, drawdown, excess kurtosis, skewness, and
absolute-return autocorrelation.

- [x] **Step 3: Implement socioeconomic and planner validation helpers**

Compute wealth inequality, education-gradient, occupation median spread, planner default win rate,
and trajectory coverage.

- [x] **Step 4: Export the module**

Add the validation report API to `packages/observability/src/index.ts`.

### Task 3: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @aivilization/observability test -- experimentValidation.test.ts
pnpm --filter @aivilization/observability typecheck
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

- Boundary review: statistical definitions live in observability, while worker/API remain adapters.
- Data-flow review: reports consume reviewed observations and emit stable metrics plus findings.
- Extension review: later runners can add OHLC aggregation, Ljung-Box tests, durable storage, and UI
  views without changing domain simulation packages.
