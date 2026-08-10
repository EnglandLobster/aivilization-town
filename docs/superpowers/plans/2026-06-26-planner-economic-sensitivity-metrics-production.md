# Planner Economic Sensitivity Metrics Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let local runtime planner ablation/profile reports produce standardized economic-sensitivity planner metrics from agent-runtime probe results.

**Architecture:** Keep probe execution at the server orchestration boundary and keep observability as a metrics consumer. Add a small server metrics helper that converts `SubtaskPrioritizationSensitivityProbeResult[]` into the three standardized `planner-economic-sensitivity-*` metrics, then let the default ablation-suite metrics pipeline append those metrics when a probe-result provider is supplied.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime` sensitivity probe result type, `@aivilization/observability` planner experiment metrics.

---

### Task 1: Metrics Helper and Suite Wiring

**Files:**
- Create: `apps/server/src/localRuntimeTownPlannerEconomicSensitivityMetrics.ts`
- Modify: `apps/server/src/localRuntimeTownPlannerAblationSuite.ts`
- Modify: `apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`
- Add: `docs/superpowers/plans/2026-06-26-planner-economic-sensitivity-metrics-production.md`

- [x] **Step 1: Write the failing suite test**

Add a test in `apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts` that calls `runLocalRuntimeTownPlannerAblationSuite` without a custom `createMetrics`, but with `createEconomicSensitivityProbeResults`. Return two default-variant probe results: one sensitive with complete economic context and one insensitive fixture with missing market context. Assert that the default report includes:
- `planner-economic-sensitivity-scenario-count = 2`
- `planner-economic-sensitivity-selection-change-count = 1`
- `planner-economic-sensitivity-complete-economic-context-count = 1`

- [x] **Step 2: Run test to verify RED**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts --run
```

Expected: FAIL because `createEconomicSensitivityProbeResults` is not accepted or the expected metrics are missing.

- [x] **Step 3: Implement metrics helper**

Create `apps/server/src/localRuntimeTownPlannerEconomicSensitivityMetrics.ts` with:
- `createPlannerEconomicSensitivityMetricsFromProbeResults(results)`;
- empty input returns `[]`;
- non-empty input returns the three standardized metrics;
- validate the result invariant that `status === "sensitive"` matches `selectionChanged`.

- [x] **Step 4: Wire helper into default ablation metrics**

In `apps/server/src/localRuntimeTownPlannerAblationSuite.ts`:
- add `createEconomicSensitivityProbeResults` to the suite input type;
- pass it to the default metrics builder only when `createMetrics` is not overridden;
- append helper-produced metrics after shape/outcome metrics.

- [x] **Step 5: Run targeted tests**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts --run
```

Expected: PASS.

- [x] **Step 6: Run full verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 7: Commit**

Stage only this slice:

```bash
git add apps/server/src/localRuntimeTownPlannerEconomicSensitivityMetrics.ts \
  apps/server/src/localRuntimeTownPlannerAblationSuite.ts \
  apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts \
  docs/superpowers/plans/2026-06-26-planner-economic-sensitivity-metrics-production.md
```

Commit with a Conventional Commit message explaining the production path, module boundary, user-visible metrics, and verification commands.
