# Planner Ablation Validation Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make experiment validation consume planner shape and outcome metrics from planner ablation reports.

**Architecture:** Keep `PlannerExperimentRun` and `ExperimentValidationMetric` contracts unchanged. Extend observability diagnostics so `planner-ablation` keeps the aggregate default win-rate and also exposes named shape/outcome summaries in evidence.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, observability validation reports.

---

### Task 1: Planner Ablation Evidence

**Files:**
- Modify: `packages/observability/src/experimentValidation.ts`
- Test: `packages/observability/src/experimentValidation.test.ts`

- [ ] **Step 1: Write the failing test**

Add a validation test where planner runs include `planner-command-emitting-cycle-ratio`, `planner-simulator-rejected-ratio`, `planner-replanning-cycle-ratio`, and `planner-single-branch-plan-ratio`. Assert the `planner-ablation` metric evidence exposes default/ablated summaries and changes status when default command emission misses the configured threshold.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run packages/observability/src/experimentValidation.test.ts -t "consumes planner shape and outcome metrics"`
Expected: FAIL because planner ablation evidence currently only exposes aggregate win-rate and normalized advantage.

- [ ] **Step 3: Implement diagnostics**

Extend `PlannerAblationThresholds`, default thresholds, `calculatePlannerDiagnostics`, and `createPlannerAblationMetric` to summarize named shape/outcome metrics while preserving compatibility for planner runs that do not include them.

- [ ] **Step 4: Run GREEN**

Run: `pnpm vitest run packages/observability/src/experimentValidation.test.ts -t "consumes planner shape and outcome metrics"`
Expected: PASS.

### Task 2: Verification and Commit

- [ ] **Step 1: Run focused tests**

Run: `pnpm vitest run packages/observability/src/experimentValidation.test.ts`

- [ ] **Step 2: Run workspace verification**

Run:
`pnpm typecheck`
`pnpm lint`
`pnpm test`
`git diff --check`

- [ ] **Step 3: Commit**

Run:
`git add packages/observability/src/experimentValidation.ts packages/observability/src/experimentValidation.test.ts docs/superpowers/plans/2026-06-25-planner-ablation-validation-metrics-slice.md`
`git commit -m "feat: validate planner ablation metrics"`
