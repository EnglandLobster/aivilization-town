# Social Reflection Validation Metric Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a paper-aligned validation metric for durable social reflection observations and wire it through worker/local validation inputs.

**Architecture:** Keep the metric in `packages/observability` as a pure report calculation over a validation DTO. Keep durable repository queries in `apps/worker`, where local runtime storage already owns persistence and projection hydration.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages, existing `@aivilization/observability` and `@aivilization/worker` boundaries.

---

### Task 1: Observability Metric

**Files:**

- Modify: `packages/observability/src/experimentValidation.test.ts`
- Modify: `packages/observability/src/experimentValidation.ts`

- [ ] **Step 1: Write failing tests**

Add social reflection observations to the main validation report test, expect the new
`social-reflection-coverage` metric between `planner-ablation` and `trajectory-coverage`, assert
pass evidence, add a missing-reflection watch test, and add an invalid self-target observation case.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @aivilization/observability test -- experimentValidation.test.ts`

Expected: FAIL because `socialReflectionObservations` and `socialReflectionCoverage` are not yet part
of `ExperimentValidationReportInput`.

- [ ] **Step 3: Implement minimal metric**

Add `SocialReflectionValidationObservation`, `SocialReflectionCoverageThresholds`, default
thresholds, diagnostics, validation, and metric creation in `experimentValidation.ts`.

- [ ] **Step 4: Verify green**

Run: `pnpm --filter @aivilization/observability test -- experimentValidation.test.ts`

Expected: PASS.

### Task 2: Worker Report Input

**Files:**

- Modify: `apps/worker/src/experimentValidationRunner.test.ts`
- Modify: `apps/worker/src/experimentValidationRunner.ts`

- [ ] **Step 1: Write failing test**

Add explicit `socialReflectionObservations` to the worker validation report test and assert the
metric pass evidence.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts`

Expected: FAIL because the worker report input type does not accept the new field.

- [ ] **Step 3: Pass data through**

Import `SocialReflectionValidationObservation`, add optional `socialReflectionObservations` to
`WorkerExperimentValidationReportInput`, and forward it to `createExperimentValidationReport`.

- [ ] **Step 4: Verify green**

Run: `pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts`

Expected: PASS.

### Task 3: Local Durable Source

**Files:**

- Modify: `apps/worker/src/localExperimentValidationSchedule.test.ts`
- Modify: `apps/worker/src/localExperimentValidationSchedule.ts`

- [ ] **Step 1: Write failing test**

Record social reflection observations into `storage.socialReflectionObservationRepository`, configure
`socialReflectionObservationSource`, and assert the validation report emits a passing
`social-reflection-coverage` metric.

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @aivilization/worker test -- localExperimentValidationSchedule.test.ts`

Expected: FAIL because the schedule input has no durable source option.

- [ ] **Step 3: Query durable rows**

Add a bounded source type, query the current simulation and partition from
`socialReflectionObservationRepository`, map rows into validation DTOs, and forward them to the worker
report.

- [ ] **Step 4: Verify green**

Run: `pnpm --filter @aivilization/worker test -- localExperimentValidationSchedule.test.ts`

Expected: PASS.

### Task 4: Final Verification and Commit

**Files:**

- Verify all changed files

- [ ] **Step 1: Run focused checks**

Run:
`pnpm --filter @aivilization/observability test -- experimentValidation.test.ts`
`pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts localExperimentValidationSchedule.test.ts`

- [ ] **Step 2: Run workspace checks**

Run: `pnpm check`

- [ ] **Step 3: Review diff and commit**

Run: `git diff --check`, review `git diff`, stage the changed docs/tests/code, and commit with a
detailed Conventional Commit message in Chinese.
