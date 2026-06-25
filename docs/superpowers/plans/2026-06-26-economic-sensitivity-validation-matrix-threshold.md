# Economic Sensitivity Validation Matrix Threshold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make experiment validation require the full four-scenario planner economic-sensitivity matrix by default.

**Architecture:** Keep probe execution and metric production unchanged. Strengthen the observability validation boundary so a report only passes `planner-economic-sensitivity` when it contains the complete matrix count, a fully sensitive selection-change ratio, and complete economic context for every scenario.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `ExperimentValidationReport`, planner experiment metrics.

---

### Task 1: Default Matrix Threshold

**Files:**
- Modify: `packages/observability/src/experimentValidation.test.ts`
- Modify: `packages/observability/src/experimentValidation.ts`
- Add: `docs/superpowers/plans/2026-06-26-economic-sensitivity-validation-matrix-threshold.md`

- [x] **Step 1: Write the failing default-threshold test**

Add a test in `packages/observability/src/experimentValidation.test.ts` that creates a report with one complete and sensitive economic probe scenario, does not override `plannerEconomicSensitivity`, and expects the `planner-economic-sensitivity` metric to be `watch` with `scenarioCount: 1`.

- [x] **Step 2: Run the targeted test to verify RED**

Run:

```bash
pnpm vitest packages/observability/src/experimentValidation.test.ts --run
```

Expected: FAIL because the default threshold currently accepts `minimumScenarioCount: 1`.

Observed: FAIL with `expected 'pass' to be 'watch'`, proving the single-scenario report still passed under the previous default.

- [x] **Step 3: Raise the default matrix threshold**

In `packages/observability/src/experimentValidation.ts`, change the default `plannerEconomicSensitivity.minimumScenarioCount` from `1` to `4`.

- [x] **Step 4: Update the positive validation fixture**

Update the existing planner economic sensitivity validation test to use four scenarios, four selection changes, and four complete economic-context scenarios when it relies on matrix-level behavior.

- [x] **Step 5: Run targeted tests**

Run:

```bash
pnpm vitest packages/observability/src/experimentValidation.test.ts --run
```

Expected: PASS.

Observed: PASS with 9 tests in `packages/observability/src/experimentValidation.test.ts`.

- [x] **Step 6: Run full verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0.

Observed: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `git diff --check` all exited 0. Full test suite passed with 173 files and 963 tests.

- [x] **Step 7: Commit**

Stage only this slice:

```bash
git add packages/observability/src/experimentValidation.ts \
  packages/observability/src/experimentValidation.test.ts \
  docs/superpowers/plans/2026-06-26-economic-sensitivity-validation-matrix-threshold.md
```

Commit with a Conventional Commit message explaining why the matrix threshold changed, which observability boundary was strengthened, user-visible validation behavior, and verification commands executed.

Observed: staged the observability threshold, its regression tests, and this plan; committed as `feat(observability): 提高规划经济敏感性矩阵验收门槛`.
