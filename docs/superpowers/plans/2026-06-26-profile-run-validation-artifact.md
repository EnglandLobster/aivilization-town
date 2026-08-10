# Profile Run Validation Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let headless profile runs produce durable experiment validation reports after the run completes, and expose compact validation summaries from the profile runner result.

**Architecture:** Reuse the worker `runLocalExperimentValidationSchedule` after the profile run and after runtime profile reports have been recorded. The server profile runner owns orchestration only: each partition validates against its local storage, while full report persistence remains in the worker storage repository.

**Tech Stack:** TypeScript, Vitest, `@aivilization/server`, `@aivilization/worker`, `@aivilization/observability`.

---

### Task 1: Profile Runner Post-Run Validation Schedule

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Test: `apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [x] **Step 1: Write the failing test**

Add a profile runner test that passes an `experimentValidationSchedule`, runs the smoke profile, expects `summary.experimentValidationReports` to contain the partition validation summary, and verifies the durable report exists in that partition's `experimentValidationReportRepository`.

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileRunner.test.ts --run
```

Expected RED: TypeScript/test failure because profile runner input and summary do not yet expose post-run validation artifacts.

- [x] **Step 3: Write minimal implementation**

Add `LocalRuntimeTownProfileExperimentValidationSchedule`, accept it on `LocalRuntimeTownProfileRunnerInput`, run `runLocalExperimentValidationSchedule` per hosted partition after runtime profile report recording, and summarize run id, partition, gate status, failure count, metric status counts, and event/projection windows.

- [x] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileRunner.test.ts --run
```

Expected GREEN: profile runner test file passes and durable partition validation reports are recorded.

## Review

- Spec coverage: advances the paper Section 5 validation path by connecting headless profile execution to experiment validation artifacts.
- Boundary: does not change LLM cognition, planner selection, AMM pricing, market observation recording, or validation formulas.
- Remaining gap: future stages should add a CLI/report-root switch and a consolidated cross-partition manifest that bundles OHLC, wealth snapshots, planner ablations, and validation report IDs for long-horizon mature runs.
