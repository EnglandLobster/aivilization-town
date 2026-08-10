# Planner Shape Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable planner structure metrics to planner ablation reports so experiments can prove how plan shape changes across variants.

**Architecture:** Add a query method to the durable `BranchPlanRepository` abstraction instead of reading JSONL directly from server code. Build server-owned profile planner metrics from queried branch plan records and append them to the existing planner experiment metric list.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, file-backed branch plan repositories, runtime profile run reports.

---

### Task 1: Branch Plan Query

**Files:**
- Modify: `packages/agent-runtime/src/branchPlanRepository.ts`
- Test: `packages/agent-runtime/src/branchPlanRepository.test.ts`

- [ ] **Step 1: Write the failing test**

Add repository tests that save multiple records, query latest records, filter by agent, and verify file repository restart keeps only the latest record per `(agentId, planId)`.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run packages/agent-runtime/src/branchPlanRepository.test.ts -t "queries latest branch plan records"`
Expected: FAIL because `query` is not implemented.

- [ ] **Step 3: Implement query**

Add `BranchPlanQuery` and `query()` to the repository interface. Return defensive clones sorted by latest `updatedAt`, collapsing file-backed duplicate append records by `(agentId, planId)`.

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run packages/agent-runtime/src/branchPlanRepository.test.ts -t "queries latest branch plan records"`
Expected: PASS.

### Task 2: Planner Shape Metrics

**Files:**
- Create: `apps/server/src/localRuntimeTownPlannerShapeMetrics.ts`
- Create: `apps/server/src/localRuntimeTownPlannerShapeMetrics.test.ts`

- [ ] **Step 1: Write the failing test**

Add a pure aggregation test that computes plan count, mean branch count, mean subtask count, single-branch ratio, and planning source counts from branch plan records.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run apps/server/src/localRuntimeTownPlannerShapeMetrics.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement metrics**

Implement pure `createPlannerShapeMetricsFromBranchPlans(records)` and file-backed `createLocalRuntimeTownProfilePlannerShapeMetrics(summary)`.

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run apps/server/src/localRuntimeTownPlannerShapeMetrics.test.ts`
Expected: PASS.

### Task 3: Ablation Suite Wiring

**Files:**
- Modify: `apps/server/src/localRuntimeTownPlannerAblationSuite.ts`
- Test: `apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`

- [ ] **Step 1: Write the failing test**

Add a suite test where fake profile runs write branch plan artifacts and assert the generated report includes planner shape metrics.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts -t "adds planner shape metrics"`
Expected: FAIL because suite metrics currently only include run counters.

- [ ] **Step 3: Wire metrics**

Make default metric creation async and append planner shape metrics after each profile run.

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts -t "adds planner shape metrics"`
Expected: PASS.

### Task 4: Verification and Commit

- [ ] **Step 1: Run focused tests**

Run:
`pnpm vitest run packages/agent-runtime/src/branchPlanRepository.test.ts apps/server/src/localRuntimeTownPlannerShapeMetrics.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`

- [ ] **Step 2: Run workspace verification**

Run:
`pnpm typecheck`
`pnpm lint`
`pnpm test`
`git diff --check`

- [ ] **Step 3: Commit**

Run:
`git add packages/agent-runtime/src/branchPlanRepository.ts packages/agent-runtime/src/branchPlanRepository.test.ts apps/server/src/localRuntimeTownPlannerShapeMetrics.ts apps/server/src/localRuntimeTownPlannerShapeMetrics.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts docs/superpowers/plans/2026-06-25-planner-shape-metrics-slice.md`
`git commit -m "feat: report planner shape metrics"`
