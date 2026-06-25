# Planner Economic Sensitivity Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote planner market-price sensitivity probe output into experiment validation so backend runs can gate whether economic signals affect planning decisions.

**Architecture:** Keep probe execution in `@aivilization/agent-runtime`; observability consumes standardized planner experiment metrics only. Economic-sensitivity metrics are classified separately from planner ablation metrics so a default-only probe result can be validated without polluting Section 5 ablation comparisons.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing `ExperimentValidationReport`, `PlannerExperimentRun`, and `PlannerExperimentMetric`.

---

### Task 1: Experiment Validation Metric

**Files:**
- Modify: `packages/observability/src/experimentValidation.ts`
- Modify: `packages/observability/src/experimentValidation.test.ts`
- Add: `docs/superpowers/plans/2026-06-26-planner-economic-sensitivity-validation.md`

- [ ] **Step 1: Write the failing test**

Add a test in `packages/observability/src/experimentValidation.test.ts` that:
- includes ordinary planner metrics for `default`, `without-branch`, and `without-objective-decomposition`;
- includes `planner-economic-sensitivity-scenario-count`, `planner-economic-sensitivity-selection-change-count`, and `planner-economic-sensitivity-complete-economic-context-count` only on the default run;
- expects a new `planner-economic-sensitivity` validation metric with `status: "pass"`;
- expects the existing `planner-ablation` comparison count to ignore the economic-sensitivity metric group.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm vitest packages/observability/src/experimentValidation.test.ts --run
```

Expected: FAIL because `planner-economic-sensitivity` is not a supported metric id.

- [ ] **Step 3: Implement metric types and defaults**

In `packages/observability/src/experimentValidation.ts`:
- add `planner-economic-sensitivity` to `ExperimentValidationMetricId`;
- add `PlannerEconomicSensitivityThresholds`;
- add `plannerEconomicSensitivity` to `ExperimentValidationThresholds`;
- add default thresholds: minimum scenario count `1`, minimum sensitivity ratio `1`, and minimum complete economic context ratio `1`.

- [ ] **Step 4: Implement diagnostics and metric creation**

Add diagnostics that sum standardized planner metrics:
- `planner-economic-sensitivity-scenario-count`
- `planner-economic-sensitivity-selection-change-count`
- `planner-economic-sensitivity-complete-economic-context-count`

Create an `ExperimentValidationMetric` with evidence for counts and ratios.

- [ ] **Step 5: Isolate economic-sensitivity metrics from ablation comparisons**

Exclude the economic-sensitivity metric ids from `calculatePlannerDiagnostics` grouping so default-only probe metrics do not require ablated variants.

- [ ] **Step 6: Run targeted test to verify GREEN**

Run:

```bash
pnpm vitest packages/observability/src/experimentValidation.test.ts --run
```

Expected: PASS.

- [ ] **Step 7: Run full verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test -- --reporter=dot
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

Stage only this slice:

```bash
git add packages/observability/src/experimentValidation.ts \
  packages/observability/src/experimentValidation.test.ts \
  docs/superpowers/plans/2026-06-26-planner-economic-sensitivity-validation.md
```

Commit with a Conventional Commit message explaining why the validation metric exists, how the ablation boundary is preserved, user-visible validation behavior, and the verification commands executed.

