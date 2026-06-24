# Runtime Profile Planner Ablation Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let validation reports build planner ablation rows from durable runtime profile run reports instead of requiring every validation schedule to pass manual `plannerRuns` fixtures.

**Architecture:** `@aivilization/observability` owns optional planner experiment metadata on runtime profile reports plus a pure adapter from reports to `PlannerExperimentRun[]`. The server profile runner can stamp this metadata when running a profile as an experiment variant. Worker validation schedules can either keep explicit planner rows or query a runtime profile report repository through a narrow source object.

**Tech Stack:** TypeScript, Vitest, `@aivilization/observability`, worker validation schedules, local runtime profile runner.

---

### Task 1: Observability Runtime Profile Experiment Metadata

**Files:**

- Modify: `packages/observability/src/runtimeProfileRunReport.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`

- [x] **Step 1: Write failing metadata and adapter tests**

Add tests proving runtime profile reports persist optional `plannerExperiment` metadata and that durable reports map to sorted `PlannerExperimentRun[]`.

- [x] **Step 2: Add report metadata and mapping function**

Add `RuntimeProfilePlannerExperiment`, validate and clone it in `createRuntimeProfileRunReport`, and export `createPlannerExperimentRunsFromRuntimeProfileReports`.

### Task 2: Profile Runner Writes Planner Experiment Metadata

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [x] **Step 1: Write failing profile runner test**

Add a test proving `runLocalRuntimeTownDaemonScenarioProfile` records `plannerExperiment` metadata when supplied.

- [x] **Step 2: Thread metadata into recorded reports**

Add optional `plannerExperiment` to profile runner input and include it in the runtime profile run report.

### Task 3: Worker Validation Schedule Planner Run Source

**Files:**

- Modify: `apps/worker/src/localExperimentValidationSchedule.ts`
- Modify: `apps/worker/src/localExperimentValidationSchedule.test.ts`
- Modify: `apps/worker/src/localSimulationLifecycle.ts`

- [x] **Step 1: Write failing schedule source test**

Add a validation schedule test that omits manual `plannerRuns`, queries an in-memory runtime profile report repository, and produces a passing `planner-ablation` metric.

- [x] **Step 2: Add planner run source input**

Add `LocalExperimentValidationPlannerRunSource` with a `RuntimeProfileRunReportRepository` and query filters. Resolve explicit `plannerRuns` first; otherwise query the source and map reports through observability.

- [x] **Step 3: Forward lifecycle schedule config**

Allow lifecycle validation schedules to pass `plannerRunSource` and only forward `plannerRuns` when present.

### Task 4: Verification and Commit

**Files:**

- Modify this plan checklist to checked boxes.
- Commit all changed files.

- [x] **Step 1: Run focused red/green verification**

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
pnpm --filter @aivilization/worker test -- localExperimentValidationSchedule.test.ts localSimulationLifecycle.test.ts
```

- [x] **Step 2: Run full verification**

```bash
pnpm typecheck
pnpm lint
pnpm test
git diff --check
```

- [x] **Step 3: Commit the slice**

```bash
git add docs/superpowers/plans/2026-06-25-runtime-profile-planner-ablation-source-slice.md \
  packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts \
  apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts \
  apps/worker/src/localExperimentValidationSchedule.ts apps/worker/src/localExperimentValidationSchedule.test.ts \
  apps/worker/src/localSimulationLifecycle.ts
git commit -m "feat: source planner ablations from profile runs"
```

- [x] **Step 4: Report overview**

Summarize completed work, verification, current branch status, remaining gaps, and an updated tree diagram.
