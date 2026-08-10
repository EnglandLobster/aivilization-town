# Economic Sensitivity Probe Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the standard planner economic-sensitivity probe from a single price/balance scenario into a matrix covering the dynamic state fields called out by the paper.

**Architecture:** Keep the matrix in `apps/server/src/localRuntimeTownPlannerEconomicSensitivityProbe.ts` as experiment orchestration fixtures, while continuing to execute each scenario through `@aivilization/agent-runtime`'s generic `runSubtaskPrioritizationSensitivityProbe`. Each scenario should perturb a different world-decision context slice but expose the same stable `SubtaskPrioritizationSensitivityProbeResult[]` contract already consumed by metrics and validation.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `WorldDecisionContext`, `SubtaskPrioritizer`, local runtime planner ablation suite.

---

### Task 1: Standard Economic Sensitivity Probe Matrix

**Files:**
- Create: `apps/server/src/localRuntimeTownPlannerEconomicSensitivityProbe.test.ts`
- Modify: `apps/server/src/localRuntimeTownPlannerEconomicSensitivityProbe.ts`
- Modify: `apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`
- Add: `docs/superpowers/plans/2026-06-26-economic-sensitivity-probe-matrix.md`

- [x] **Step 1: Write the failing probe helper test**

Create `apps/server/src/localRuntimeTownPlannerEconomicSensitivityProbe.test.ts` with a matrix-aware `SubtaskPrioritizer` that selects subtasks from actual `worldDecisionContext` values. Assert that `createLocalRuntimeTownPlannerEconomicSensitivityProbeResults` returns four sensitive, complete-context scenarios:
- `fish-price-affordability`;
- `inventory-food-buffer`;
- `occupation-eligibility-gate`;
- `production-input-readiness`.

- [x] **Step 2: Run the targeted helper test to verify RED**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownPlannerEconomicSensitivityProbe.test.ts --run
```

Expected: FAIL because the helper currently returns only the Fish price/balance scenario.

- [x] **Step 3: Implement the scenario matrix**

In `apps/server/src/localRuntimeTownPlannerEconomicSensitivityProbe.ts`:
- replace the single hard-coded scenario with a small scenario definition array;
- keep the default-only and missing-prioritizer guards;
- add helper builders for complete `WorldDecisionContext` fixtures;
- ensure each scenario has complete economic context with balance, inventory, market prices, latest price index, and rules.

- [x] **Step 4: Update suite expectations**

In `apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`, update the automatic probe test to expect:
- `planner-economic-sensitivity-scenario-count = 4`;
- `planner-economic-sensitivity-selection-change-count = 4`;
- `planner-economic-sensitivity-complete-economic-context-count = 4`.

- [x] **Step 5: Run targeted tests**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownPlannerEconomicSensitivityProbe.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts --run
```

Expected: PASS.

- [x] **Step 6: Run full verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 7: Commit**

Stage only this slice:

```bash
git add apps/server/src/localRuntimeTownPlannerEconomicSensitivityProbe.ts \
  apps/server/src/localRuntimeTownPlannerEconomicSensitivityProbe.test.ts \
  apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts \
  docs/superpowers/plans/2026-06-26-economic-sensitivity-probe-matrix.md
```

Commit with a Conventional Commit message explaining why the matrix exists, which paper state fields it covers, how the probe boundary stays separated from agent cognition, user-visible metric changes, and verification commands.
