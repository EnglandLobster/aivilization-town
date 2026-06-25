# Ablation Structure Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automatic structural gate proving planner ablation variants match the paper's definitions.

**Architecture:** Keep planner metrics as the evidence layer and add a small server-side evaluator that consumes `PlannerExperimentMetric[]`. `runLocalRuntimeTownPlannerAblationSuite` should attach per-variant structure gate results and a suite-level structure status without changing how profile runs execute.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, `@aivilization/server`, `@aivilization/observability`.

---

### Task 1: Planner Ablation Structure Gate

**Files:**
- Create: `apps/server/src/localRuntimeTownPlannerAblationStructureGate.ts`
- Create: `apps/server/src/localRuntimeTownPlannerAblationStructureGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownPlannerAblationSuite.ts`
- Modify: `apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`
- Modify: `apps/server/src/index.ts`

- [x] **Step 1: Write failing structure gate unit tests**

Create tests for:

- `default` passes only when it has `planner-plan-count >= 1`, `planner-mean-branch-count >= 2`, and `planner-multi-subtask-branch-ratio > 0`
- `without-branch` passes only when `planner-single-branch-plan-ratio === 1`
- `without-objective-decomposition` passes only when it retains branch decomposition (`planner-mean-branch-count >= 2`) and removes branch-internal objective decomposition (`planner-multi-subtask-branch-ratio === 0`)

- [x] **Step 2: Verify structure gate RED**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownPlannerAblationStructureGate.test.ts
```

Expected: FAIL because the structure gate module does not exist.

- [x] **Step 3: Implement structure gate evaluator**

Create `evaluateLocalRuntimeTownPlannerAblationStructureGate(input)` returning:

```ts
{
  variant: string,
  status: 'pass' | 'fail',
  failureCount: number,
  failures: [{ code, message, evidence }]
}
```

Use metric IDs:

- `planner-plan-count`
- `planner-mean-branch-count`
- `planner-single-branch-plan-ratio`
- `planner-multi-subtask-branch-ratio`

- [x] **Step 4: Write failing suite integration tests**

Extend `localRuntimeTownPlannerAblationSuite.test.ts` so durable artifact runs expect:

- top-level `structureStatus: 'pass'`
- each default variant has `structureGate.status === 'pass'`
- a fixture with `without-objective-decomposition` and `planner-multi-subtask-branch-ratio > 0` reports `structureStatus: 'fail'`

- [x] **Step 5: Verify suite RED**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts -t "structure"
```

Expected: FAIL because the suite does not yet attach structure gate results.

- [x] **Step 6: Integrate structure gate into suite**

Add `structureGate` to each variant result. Add suite-level:

```ts
structureStatus: 'pass' | 'fail'
structureFailureCount: number
```

Evaluate after the report is created and before pushing the result.

- [x] **Step 7: Export and verify focused tests**

Export the new evaluator from `apps/server/src/index.ts` and run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownPlannerAblationStructureGate.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts
```

- [x] **Step 8: Verify full checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 9: Commit**

Commit only this stage's plan, structure gate module/tests, suite wiring, and exports. Leave unrelated untracked paper/report directories untouched.
