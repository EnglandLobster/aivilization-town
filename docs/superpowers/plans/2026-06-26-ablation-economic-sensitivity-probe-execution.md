# Ablation Economic Sensitivity Probe Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the planner ablation suite automatically execute the standard market-price contextual-prioritization sensitivity probe when a subtask prioritizer is configured.

**Architecture:** Keep the probe scenario builder in `apps/server` because it is profile/experiment orchestration, while the actual cognitive probe remains in `@aivilization/agent-runtime`. The ablation suite should pass the same subtask-prioritization stage into profile runs and, for the default variant, run a standard Fish price/balance probe that produces the existing `SubtaskPrioritizationSensitivityProbeResult` consumed by metrics and validation.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime` branch plans and sensitivity probe, local runtime profile suite orchestration.

---

### Task 1: Standard Probe Execution Helper

**Files:**
- Create: `apps/server/src/localRuntimeTownPlannerEconomicSensitivityProbe.ts`
- Modify: `apps/server/src/localRuntimeTownPlannerAblationSuite.ts`
- Modify: `apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`
- Add: `docs/superpowers/plans/2026-06-26-ablation-economic-sensitivity-probe-execution.md`

- [x] **Step 1: Write the failing suite test**

Add a test in `apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts` that calls `runLocalRuntimeTownPlannerAblationSuite` without custom `createMetrics` and without custom `createEconomicSensitivityProbeResults`, but with an injected `subtaskPrioritizer`. The prioritizer should inspect `worldDecisionContext.market.spotPrices` and rank `buy-food` first when Fish is affordable, then rank `work` first when Fish is expensive. Assert:
- the default variant report includes `planner-economic-sensitivity-scenario-count = 1`;
- the default variant report includes `planner-economic-sensitivity-selection-change-count = 1`;
- the default variant report includes `planner-economic-sensitivity-complete-economic-context-count = 1`;
- the without-branch variant does not include the economic-sensitivity metric group;
- the profile runner receives the same subtask prioritizer.

- [x] **Step 2: Run the targeted test to verify RED**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts --run
```

Expected: FAIL because the ablation suite does not accept or execute a default economic-sensitivity probe from a configured subtask prioritizer.

- [x] **Step 3: Implement the standard probe helper**

Create `apps/server/src/localRuntimeTownPlannerEconomicSensitivityProbe.ts` with:
- `createLocalRuntimeTownPlannerEconomicSensitivityProbeResults(input)`;
- an optional `subtaskPrioritizer` input and optional `subtaskPrioritization` config input;
- a default-only guard so ablated variants return `[]`;
- a standard `fish-price-affordability` branch plan containing `income/work` and `recovery/buy-food`;
- paired baseline/comparison `SubtaskPrioritizerInput` objects with complete dynamic state and market price context;
- execution through `runSubtaskPrioritizationSensitivityProbe`.

- [x] **Step 4: Wire suite runtime and metric paths**

In `apps/server/src/localRuntimeTownPlannerAblationSuite.ts`:
- add `subtaskPrioritizer` and `subtaskPrioritization` to suite input and variant types;
- pass resolved prioritizer/config into `runProfile`;
- when `createMetrics` is not overridden and `createEconomicSensitivityProbeResults` is not supplied, call the standard probe helper and append its metrics through the existing metrics helper.

- [x] **Step 5: Run targeted tests**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts --run
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
  apps/server/src/localRuntimeTownPlannerAblationSuite.ts \
  apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts \
  docs/superpowers/plans/2026-06-26-ablation-economic-sensitivity-probe-execution.md
```

Commit with a Conventional Commit message explaining why probe execution belongs at the server orchestration boundary, how the LLM prioritization stage is reused, user-visible metrics, and verification commands.
