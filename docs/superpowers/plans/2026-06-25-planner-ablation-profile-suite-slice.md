# Planner Ablation Profile Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local server-side planner ablation suite that runs default and ablated profile variants and writes validation-ready runtime profile run reports.

**Architecture:** `localRuntimeTownProfileRunner` gets an optional `runIdSuffix` so multiple variants can share the same requested timestamp without colliding report ids. A new `localRuntimeTownPlannerAblationSuite` composes profile runner inputs, stamps `plannerExperiment` metadata, records runtime profile reports, and exposes deterministic per-variant summaries. Worker validation remains decoupled and consumes these reports through the existing `plannerRunSource`.

**Tech Stack:** TypeScript, Vitest, `@aivilization/observability`, local runtime town profile runner.

---

### Task 1: Variant-Safe Profile Runner IDs

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [x] **Step 1: Write failing run id suffix test**

Add a test proving a supplied `runIdSuffix` appears in the recorded runtime profile run report id, while existing calls without suffix keep the current id shape.

- [x] **Step 2: Add optional `runIdSuffix`**

Validate non-empty suffixes and include them in the `runCycles.operationId` only when supplied.

### Task 2: Planner Ablation Profile Suite

**Files:**

- Create: `apps/server/src/localRuntimeTownPlannerAblationSuite.ts`
- Create: `apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`
- Modify: `apps/server/src/index.ts`

- [x] **Step 1: Write failing suite test**

Add a test that injects a fake `runProfile`, runs `default` and `without-branch` variants for `smoke-25`, records reports into an in-memory repository, and maps them through `createPlannerExperimentRunsFromRuntimeProfileReports`.

- [x] **Step 2: Implement suite types and orchestration**

Add `runLocalRuntimeTownPlannerAblationSuite` with default variants `default` and `without-branch`, deterministic variant roots, `runIdSuffix`, `plannerExperiment` metadata, and default metrics from summary: `completed-cycle-count`, `total-agent-trace-count`, and `total-event-count`.

- [x] **Step 3: Export suite**

Export the new module from `apps/server/src/index.ts`.

### Task 3: Verification and Commit

**Files:**

- Modify this plan checklist to checked boxes.
- Commit all changed files.

- [x] **Step 1: Run focused verification**

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts localRuntimeTownPlannerAblationSuite.test.ts
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
git add docs/superpowers/plans/2026-06-25-planner-ablation-profile-suite-slice.md \
  apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts \
  apps/server/src/localRuntimeTownPlannerAblationSuite.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts \
  apps/server/src/index.ts
git commit -m "feat: run planner ablation profile suites"
```

- [x] **Step 4: Report overview**

Summarize completed work, verification, current branch status, remaining gaps, and an updated tree diagram.
