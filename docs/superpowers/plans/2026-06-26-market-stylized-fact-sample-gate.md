# Market Stylized Fact Sample Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent short toy price series from passing the paper-aligned heavy-tail and volatility-clustering validation metrics.

**Architecture:** Keep market observation storage and metric formulas unchanged. Tighten the observability validation layer by carrying log-return sample count through price diagnostics and requiring a configurable minimum sample size before stylized market facts can pass.

**Tech Stack:** TypeScript, Vitest, `@aivilization/observability` experiment validation.

---

### Task 1: Stylized Fact Sample Gate

**Files:**

- Modify: `packages/observability/src/experimentValidation.ts`
- Test: `packages/observability/src/experimentValidation.test.ts`

- [x] **Step 1: Write the failing test**

Add `requires mature price sample size before accepting stylized market facts`, with four Fish close prices, permissive kurtosis/autocorrelation thresholds, and `minimumReturnObservationCount: 5`. Expect both `heavy-tail-returns` and `volatility-clustering` to return `watch` with `returnObservationCount: 3`.

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest packages/observability/src/experimentValidation.test.ts --run
```

Expected RED:

```text
expected 'pass' to be 'watch'
```

- [x] **Step 3: Write minimal implementation**

Extend `HeavyTailThresholds` and `VolatilityClusteringThresholds` with `minimumReturnObservationCount`, set default sample gates, carry `returnObservationCount` through `PriceSeriesDiagnostics`, and require enough returns before either stylized fact metric can pass.

- [x] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest packages/observability/src/experimentValidation.test.ts --run
```

Expected GREEN: the observability validation test file passes.

## Review

- Spec coverage: advances the paper Section 5 validation path by making mature high-frequency market facts require sample-size evidence, not only favorable moment estimates.
- Boundary: does not change AMM pricing, OHLC recording, agent behavior, or validation report persistence.
- Remaining gap: a future stage should connect long-run profile execution to published validation reports with real mature-phase price series, rather than relying on synthetic fixtures.
