# Lifecycle Validation Failure Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep simulation lifecycle command semantics consistent when post-start validation report
generation fails.

**Architecture:** A lifecycle start consists of two layers: the authoritative simulation tick batch
and an optional validation side effect. The tick batch may complete even when validation cannot
produce a report. Lifecycle results and supervisor operation traces should surface validation failure
explicitly instead of throwing after the lifecycle state has already been saved as completed.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local lifecycle, supervisor operation traces.

---

## Scope

This slice adds:

- `validationFailure` metadata on completed lifecycle start results
- validation error serialization at the lifecycle boundary
- supervisor operation trace metadata for validation failures on otherwise successful partitions
- tests proving validation failures do not turn completed lifecycle starts into supervisor partition
  command failures

It does not add retry policy, alert routing, health-state escalation, or report repository failure
classification.

## Runtime Semantics

- A completed tick batch remains `status: completed` even if validation report generation fails.
- A successful validation hook returns `validationReport`.
- A failed validation hook returns `validationFailure`.
- Supervisor partition command outcome remains `succeeded` when lifecycle start completed; operation
  traces retain the validation failure metadata for auditability.

## File Structure

- Modify `apps/worker/src/localSimulationLifecycle.ts`: catch validation errors and return a
  serialized failure.
- Modify `apps/worker/src/localSimulationLifecycle.test.ts`: prove completed start with validation
  failure does not throw.
- Modify `apps/worker/src/localSimulationRuntimeOperationTrace.ts`: add validation failure metadata
  to successful partition traces.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.ts`: copy validation failure metadata
  into operation traces.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`: prove supervisor command
  outcome remains succeeded and trace contains validation failure.

## Tasks

### Task 1: Failing Tests

**Files:**

- Modify: `apps/worker/src/localSimulationLifecycle.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

- [x] **Step 1: Lifecycle validation failure test**

Configure validation without trade observations, run `controller.start`, and assert the lifecycle
result is completed with `validationFailure` instead of a thrown error.

- [x] **Step 2: Supervisor validation failure trace test**

Bootstrap a validation-enabled host without trade observations, run `startAll`, and assert the bulk
command succeeds while operation trace partition entries include validation failure metadata.

### Task 2: Lifecycle Error Boundary

**Files:**

- Modify: `apps/worker/src/localSimulationLifecycle.ts`

- [x] **Step 1: Add failure metadata type**

Define `LocalSimulationLifecycleValidationFailure` with serialized error name, message, and optional
stack.

- [x] **Step 2: Catch validation schedule errors**

Wrap the optional validation schedule invocation after completed starts and return either
`validationReport` or `validationFailure`.

### Task 3: Supervisor Trace Metadata

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeOperationTrace.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.ts`

- [x] **Step 1: Add operation trace failure metadata**

Allow successful partition trace entries to carry optional `validationFailure`.

- [x] **Step 2: Copy lifecycle validation failure into traces**

Extract validation failure metadata from lifecycle start results when creating operation traces.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationLifecycle.test.ts localSimulationRuntimeSupervisor.test.ts
```

- [x] **Step 2: Run package verification**

Run:

```bash
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/worker test
git diff --check
```

- [x] **Step 3: Commit**

Commit with:

```bash
git commit -m "feat: isolate lifecycle validation failures"
```

## Self-Review

- Boundary review: lifecycle state reflects simulation progress; validation failure is explicit
  side-effect metadata.
- Data-flow review: validation exception -> lifecycle failure metadata -> supervisor trace audit
  metadata.
- Extension review: future alerting or health policies can consume `validationFailure` without
  changing tick execution semantics.
