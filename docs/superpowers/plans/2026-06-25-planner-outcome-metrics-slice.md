# Planner Outcome Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable planner outcome metrics to planner ablation reports so experiments can compare whether selected plans produced commands, repairs, rejections, and replanning.

**Architecture:** Keep outcome extraction in a server-owned read model that consumes `AgentCycleTraceRepository` artifacts from each profile partition. Reuse `PlannerExperimentMetric` so report storage and validation APIs keep their current contract.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, file-backed agent cycle trace repositories, runtime profile run reports.

---

### Task 1: Planner Outcome Metrics

**Files:**
- Create: `apps/server/src/localRuntimeTownPlannerOutcomeMetrics.ts`
- Create: `apps/server/src/localRuntimeTownPlannerOutcomeMetrics.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests for a pure `createPlannerOutcomeMetricsFromAgentCycleTraces(traces)` function and a file-backed `createLocalRuntimeTownProfilePlannerOutcomeMetrics(summary)` function. The expected metrics are cycle count, command-emitting ratio, simulator accepted/repaired/rejected ratios, replanning ratio, mean accepted action count, mean emitted command count, and distinct selected branch count.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run apps/server/src/localRuntimeTownPlannerOutcomeMetrics.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement metrics**

Create the pure metric aggregator and the profile artifact reader. Read each partition from `<rootDir>/simulations/<simulationId>/partitions/<partitionKey>/observability` using `FileAgentCycleTraceRepository`.

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run apps/server/src/localRuntimeTownPlannerOutcomeMetrics.test.ts`
Expected: PASS.

### Task 2: Ablation Suite Wiring

**Files:**
- Modify: `apps/server/src/localRuntimeTownPlannerAblationSuite.ts`
- Test: `apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`

- [ ] **Step 1: Write the failing test**

Add a suite test where fake profile runs write agent cycle trace artifacts and assert generated reports include planner outcome metrics.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts -t "adds planner outcome metrics"`
Expected: FAIL because suite metrics currently append shape metrics only.

- [ ] **Step 3: Wire metrics**

Append `createLocalRuntimeTownProfilePlannerOutcomeMetrics(summary)` to the default planner experiment metrics.

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts -t "adds planner outcome metrics"`
Expected: PASS.

### Task 3: Verification and Commit

- [ ] **Step 1: Run focused tests**

Run:
`pnpm vitest run apps/server/src/localRuntimeTownPlannerOutcomeMetrics.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`

- [ ] **Step 2: Run workspace verification**

Run:
`pnpm typecheck`
`pnpm lint`
`pnpm test`
`git diff --check`

- [ ] **Step 3: Commit**

Run:
`git add apps/server/src/localRuntimeTownPlannerOutcomeMetrics.ts apps/server/src/localRuntimeTownPlannerOutcomeMetrics.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts docs/superpowers/plans/2026-06-25-planner-outcome-metrics-slice.md`
`git commit -m "feat: report planner outcome metrics"`
