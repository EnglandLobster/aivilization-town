# Steering Validation Metric Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a paper-aligned validation metric for human steering propagation through planning and memory.

**Architecture:** Keep the metric in `packages/observability` as a pure report calculation over a validation DTO. Keep durable `SteeringTrace` repository queries in `apps/worker`, where local runtime storage already owns persistence boundaries.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages, `@aivilization/observability`, `@aivilization/worker`.

---

### Task 1: Observability Metric

**Files:**

- Modify: `packages/observability/src/experimentValidation.test.ts`
- Modify: `packages/observability/src/experimentValidation.ts`

- [x] **Step 1: Write failing tests**

Add steering validation traces to the main validation report test, expect the new
`steering-memory-propagation` metric between `social-reflection-coverage` and
`trajectory-coverage`, assert pass evidence, add a missing-steering watch test, and add an invalid
reactive trace case with no STM records.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/observability test -- experimentValidation.test.ts
```

Expected: FAIL because `SteeringValidationTrace`, `steeringTraces`, and
`steeringMemoryPropagation` are not yet part of `ExperimentValidationReportInput`.

Observed: FAIL because the new metric was missing and invalid reactive steering traces were not
rejected.

- [x] **Step 3: Implement minimal metric**

Add `SteeringValidationTrace`, `SteeringMemoryPropagationThresholds`, default thresholds,
diagnostics, validation, and metric creation in `experimentValidation.ts`.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/observability test -- experimentValidation.test.ts
```

Expected: PASS.

Observed: PASS.

### Task 2: Worker Report Input

**Files:**

- Modify: `apps/worker/src/experimentValidationRunner.test.ts`
- Modify: `apps/worker/src/experimentValidationRunner.ts`

- [x] **Step 1: Write failing test**

Add explicit `steeringTraces` to the worker validation report test and assert the metric pass
evidence.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts
```

Expected: FAIL because the worker report input type does not accept the new field.

Observed: FAIL because `steering-memory-propagation` existed but stayed `watch` with zero steering
evidence.

- [x] **Step 3: Pass data through**

Import `SteeringValidationTrace`, add optional `steeringTraces` to
`WorkerExperimentValidationReportInput`, and forward it to `createExperimentValidationReport`.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts
```

Expected: PASS.

Observed: PASS.

### Task 3: Local Durable Source

**Files:**

- Modify: `apps/worker/src/localExperimentValidationSchedule.test.ts`
- Modify: `apps/worker/src/localExperimentValidationSchedule.ts`

- [x] **Step 1: Write failing test**

Record one long-horizon and one reactive `SteeringTrace` into
`storage.steeringTraceRepository`, configure `steeringTraceSource`, and assert the validation report
emits a passing `steering-memory-propagation` metric.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- localExperimentValidationSchedule.test.ts
```

Expected: FAIL because the schedule input has no durable steering source option.

Observed: FAIL because the report metric stayed `watch` with zero durable steering evidence.

- [x] **Step 3: Query durable rows**

Add a bounded source type, query the current simulation and partition from `steeringTraceRepository`,
map rows into validation DTOs, and forward them to the worker report.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- localExperimentValidationSchedule.test.ts
```

Expected: PASS.

Observed: PASS.

### Task 4: Final Verification and Commit

**Files:**

- Verify all changed files

- [x] **Step 1: Run focused checks**

Run:

```bash
pnpm --filter @aivilization/observability test -- experimentValidation.test.ts
pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts localExperimentValidationSchedule.test.ts
```

Observed:

- `pnpm --filter @aivilization/observability test -- experimentValidation.test.ts`: PASS.
- `pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts localExperimentValidationSchedule.test.ts`: PASS.

- [x] **Step 2: Run workspace checks**

Run:

```bash
pnpm check
```

Observed: PASS, including lint, typecheck, and 155 test files / 789 tests.

- [x] **Step 3: Review diff and commit**

Run `git diff --check`, review `git diff`, stage the changed docs/tests/code, and commit with a
detailed Conventional Commit message in Chinese.

Observed: `git diff --check` and staged diff review passed before commit.
