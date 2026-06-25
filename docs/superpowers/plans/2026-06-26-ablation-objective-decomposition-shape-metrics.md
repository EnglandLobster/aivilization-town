# Ablation Objective Decomposition Shape Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make planner ablation reports quantify whether objective decomposition is present inside branch plans.

**Architecture:** Keep artifact reading in `apps/server/src/localRuntimeTownPlannerShapeMetrics.ts`, where planner shape metrics already derive from durable `BranchPlanRecord`s. Add branch-level decomposition metrics so Section 5 ablations can distinguish "parallel branches with direct action lists" from branches that contain decomposed objective subtask sequences.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, `@aivilization/server`, `@aivilization/agent-runtime`.

---

### Task 1: Branch-Level Objective Decomposition Metrics

**Files:**
- Modify: `apps/server/src/localRuntimeTownPlannerShapeMetrics.ts`
- Modify: `apps/server/src/localRuntimeTownPlannerShapeMetrics.test.ts`
- Modify: `apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`

- [x] **Step 1: Write failing shape metrics test**

In `localRuntimeTownPlannerShapeMetrics.test.ts`, extend the mixed branch-plan fixture to expect:

```ts
{ metricId: 'planner-mean-subtasks-per-branch', value: 1.5, higherIsBetter: true }
{ metricId: 'planner-multi-subtask-branch-ratio', value: 0.25, higherIsBetter: true }
```

Use two plans with four total branches and six total subtasks so the expected values prove branch-level decomposition, not only plan-level subtask totals.

- [x] **Step 2: Verify shape metrics RED**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownPlannerShapeMetrics.test.ts
```

Expected: FAIL because the two new metrics are missing.

- [x] **Step 3: Implement branch-level metrics**

In `createPlannerShapeMetricsFromBranchPlans`, compute:

- `totalBranchCount`
- `totalSubtaskCount`
- `multiSubtaskBranchCount`, where a branch has objective decomposition evidence when `branch.subtasks.length > 1`

Return two new metrics:

```ts
planner-mean-subtasks-per-branch = totalSubtaskCount / totalBranchCount
planner-multi-subtask-branch-ratio = multiSubtaskBranchCount / totalBranchCount
```

Use the existing zero-safe `average` helper.

- [x] **Step 4: Write failing ablation suite expectation**

In `localRuntimeTownPlannerAblationSuite.test.ts`, extend the durable artifact metrics test:

- default fixture should include `planner-mean-subtasks-per-branch: 1.5` and `planner-multi-subtask-branch-ratio: 0.5`
- without-branch fixture should include `planner-mean-subtasks-per-branch: 1` and `planner-multi-subtask-branch-ratio: 0`

- [x] **Step 5: Verify ablation focused GREEN**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownPlannerShapeMetrics.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts
```

- [x] **Step 6: Verify full checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 7: Commit**

Commit only this stage's plan and planner metric files. Leave unrelated untracked paper/report directories untouched.
