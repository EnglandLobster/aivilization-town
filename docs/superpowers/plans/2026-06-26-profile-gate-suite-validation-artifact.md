# Profile Gate Suite Validation Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the multi-profile gate suite trigger paper experiment validation artifacts through the same report-backed path as the single profile runner CLI.

**Architecture:** Keep validation generation inside `runLocalRuntimeTownDaemonScenarioProfile`. The gate suite only parses/accepts an `experimentValidation` switch, requires a report root so planner ablation rows come from durable runtime profile reports, and passes a profile-scoped validation schedule into each profile run.

**Tech Stack:** TypeScript, Vitest, `@aivilization/server`, `@aivilization/observability`.

---

### Task 1: Gate Suite Experiment Validation Switch

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuiteCli.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts`

- [x] **Step 1: Write the failing tests**

Add tests that:

- parse `--experiment-validation` in the suite CLI;
- pass `experimentValidation: true` into the injected suite runner;
- reject experiment validation without `reportRootDir`;
- inject an `experimentValidationSchedule` into every profile runner input with `plannerRunSource.repository`, profile-specific `profileId`, and a suite-scoped pass/watch report gate.

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts --run
```

Expected RED: `--experiment-validation` is not parsed and suite runner inputs do not include `experimentValidationSchedule`.

Observed RED: CLI treats `--experiment-validation` as a value flag, suite runner inputs omit `experimentValidationSchedule`, and missing `reportRootDir` still reaches the injected runner.

- [x] **Step 3: Write minimal implementation**

Extend `LocalRuntimeTownProfileGateSuiteInput` and CLI config with `experimentValidation?: boolean`; parse it as a boolean flag; require `reportRootDir` when enabled; and pass a schedule shaped as:

```ts
experimentValidationSchedule: {
  plannerRunSource: {
    repository: profileRunReportRepository,
    profileId,
  },
  reportGate: {
    criteriaId: `${profileId}:profile-gate-suite:experiment-validation-gate`,
    defaultAllowedStatuses: ['pass', 'watch'],
  },
}
```

- [x] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts --run
```

Expected GREEN: suite tests pass and validation artifact generation remains profile-runner owned.

Observed GREEN: `pnpm vitest apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts --run` passes with 18 tests.

## Review

- Spec coverage: moves Section 5-style validation artifact generation from single profile runs toward multi-profile gate-suite runs.
- Boundary: no synthetic planner rows are created in the suite; planner ablation evidence still comes from durable runtime profile reports filtered by profile id.
- Remaining gap: add a consolidated bundle manifest that indexes suite-level profile reports, validation reports, OHLC windows, and wealth snapshots for published long-horizon experiment packages.
