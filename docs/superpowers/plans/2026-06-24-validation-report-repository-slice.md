# Validation Report Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make experiment validation reports durable and queryable through stable repository ports.

**Architecture:** `packages/observability` owns the storage-neutral report repository contract and
in-memory/file adapters. `apps/worker` wires the file adapter into local runtime storage and offers a
small helper that creates then records a worker validation report.

**Tech Stack:** TypeScript, Vitest, JSONL file repositories, pnpm workspaces.

---

## Scope

This slice adds:

- `ExperimentValidationReportRepository` contract
- in-memory and file-backed validation report repositories
- query by simulation id, generated-at range, run id, and limit
- defensive cloning so report reads cannot mutate stored state
- local runtime storage wiring for validation reports
- worker helper to create and persist validation reports

It does not add HTTP routes, report scheduling, automatic experiment execution, dashboard rendering,
or database adapters.

## Runtime Semantics

- `record(report)` is idempotent by `report.run.runId`.
- `get(runId)` returns one report regardless of simulation id.
- `query({ simulationId })` returns reports for that simulation latest-first by `run.generatedAt`,
  breaking ties by `run.runId`.
- file storage uses `experiment-validation-reports.jsonl` in the existing observability directory.
- worker helpers create the report through the existing validation runner, then record it through
  the injected repository.

## File Structure

- Create `packages/observability/src/experimentValidationReportRepository.test.ts`: repository tests.
- Create `packages/observability/src/experimentValidationReportRepository.ts`: repository contract
  and adapters.
- Modify `packages/observability/src/index.ts`: export the repository.
- Modify `apps/worker/src/localRuntimeStorage.ts`: add a file-backed validation report repository.
- Modify `apps/worker/src/localRuntimeStorage.test.ts`: prove reports persist across storage
  restarts.
- Modify `apps/worker/src/experimentValidationRunner.ts`: add `recordWorkerExperimentValidationReport`.
- Modify `apps/worker/src/experimentValidationRunner.test.ts`: prove the helper records reports.
- Create `docs/superpowers/plans/2026-06-24-validation-report-repository-slice.md`: track this
  implementation slice.

## Tasks

### Task 1: Failing Observability Repository Tests

**Files:**

- Create: `packages/observability/src/experimentValidationReportRepository.test.ts`

- [x] **Step 1: Add in-memory repository test**

Create three validation reports, record them idempotently, query by simulation id/time range/limit,
and assert read results are defensive clones.

- [x] **Step 2: Add file repository test**

Record a report, create a second repository instance over the same root, and assert the report can
be read and queried after restart.

### Task 2: Failing Worker Storage Tests

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.test.ts`
- Modify: `apps/worker/src/experimentValidationRunner.test.ts`

- [x] **Step 1: Add local runtime storage persistence test**

Record a validation report through `storage.experimentValidationReportRepository`, restart storage,
and assert the report persists.

- [x] **Step 2: Add worker record helper test**

Use `recordWorkerExperimentValidationReport` with an in-memory repository and assert the returned
report is persisted by run id.

### Task 3: Implementation

**Files:**

- Create: `packages/observability/src/experimentValidationReportRepository.ts`
- Modify: `packages/observability/src/index.ts`
- Modify: `apps/worker/src/localRuntimeStorage.ts`
- Modify: `apps/worker/src/experimentValidationRunner.ts`

- [x] **Step 1: Implement repository contract and in-memory adapter**

Add `ExperimentValidationReportQuery`, `ExperimentValidationReportRepository`, and
`InMemoryExperimentValidationReportRepository`.

- [x] **Step 2: Implement file adapter**

Add `FileExperimentValidationReportRepository` using JSONL append, restart-safe file creation, and
idempotent `runId` handling.

- [x] **Step 3: Wire local runtime storage**

Instantiate the file report repository inside the existing partition observability directory.

- [x] **Step 4: Implement worker record helper**

Add `recordWorkerExperimentValidationReport` that delegates report creation to
`createWorkerExperimentValidationReport` and records the result.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @aivilization/observability test -- experimentValidationReportRepository.test.ts
pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts experimentValidationRunner.test.ts
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker typecheck
```

- [x] **Step 2: Run full verification**

Run:

```bash
pnpm check
pnpm build
git diff --check
```

- [x] **Step 3: Commit**

Commit this slice after all verification passes.

## Self-Review

- Boundary review: observability owns report persistence; worker composes reports and injects a
  repository.
- Data-flow review: report creation stays pure until explicitly recorded.
- Extension review: API routes, schedulers, and database adapters can wrap this repository without
  changing validation math or simulation rules.
