# Local Validation Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and persist experiment validation reports from local runtime storage without
manual assembly.

**Architecture:** `apps/worker` owns a local schedule runner that reads a partition's event stream,
hydrates the projection, derives trace-backed trajectories, delegates validation math to the existing
worker report runner, and records through the existing report repository. The runner is a reusable
backend use case that future lifecycle hooks, cron jobs, experiment queues, and Godot tools can call
without depending on storage internals.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local file-backed runtime storage.

---

## Scope

This slice adds:

- `runLocalExperimentValidationSchedule`
- event-window support via `afterSequence` and `toSequence`
- projection hydration at the chosen `toSequence`
- trace-backed trajectory derivation through the existing validation runner
- idempotent persistence through `storage.experimentValidationReportRepository`

It does not add HTTP mutation routes, cron/queue infrastructure, automatic lifecycle invocation,
dashboard rendering, or database adapters.

## Runtime Semantics

- Default event window reads the full partition event stream.
- `toSequence` limits both the hydrated projection and the event sample used for report generation.
- `afterSequence` excludes earlier events from the report's price series without changing the
  projection hydration target.
- `runId` is caller-provided so schedulers can choose deterministic idempotency keys.
- `source` defaults to `local-validation-schedule`.
- The report is recorded idempotently by the repository's existing `runId` semantics.

## File Structure

- Create `apps/worker/src/localExperimentValidationSchedule.test.ts`: schedule runner tests.
- Create `apps/worker/src/localExperimentValidationSchedule.ts`: local schedule runner.
- Modify `apps/worker/src/index.ts`: export the runner.
- Create `docs/superpowers/plans/2026-06-24-local-validation-schedule-slice.md`: track this slice.

## Tasks

### Task 1: Failing Scheduler Tests

**Files:**

- Create: `apps/worker/src/localExperimentValidationSchedule.test.ts`

- [x] **Step 1: Add storage-backed generation test**

Create local runtime storage, append deterministic `TradeExecuted` events, record cycle traces, run
`runLocalExperimentValidationSchedule`, and assert:

```ts
expect(result.report.run).toEqual({
  runId: 'validation-schedule-1',
  simulationId: 'sim-1',
  generatedAt: 500,
  source: 'local-validation-schedule',
});
await expect(
  storage.experimentValidationReportRepository.get('validation-schedule-1'),
).resolves.toEqual(result.report);
expect(getMetric(result.report, 'trajectory-coverage').evidence.maximumStepCount).toBe(2);
```

- [x] **Step 2: Add event-window test**

Append three trade events, run with `eventWindow: { afterSequence: 1, toSequence: 3 }`, and assert
the market metric observation count is `2`.

- [x] **Step 3: Run scheduler test red**

Run:

```bash
pnpm --filter @aivilization/worker test -- localExperimentValidationSchedule.test.ts
```

Expected: FAIL because `runLocalExperimentValidationSchedule` does not exist.

### Task 2: Implementation

**Files:**

- Create: `apps/worker/src/localExperimentValidationSchedule.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Define schedule input and result types**

Define:

```ts
export type LocalExperimentValidationEventWindow = {
  readonly afterSequence?: number;
  readonly toSequence?: number;
};

export type LocalExperimentValidationScheduleInput = {
  readonly storage: LocalWorldRuntimeStorage;
  readonly initialProjection: WorldProjection;
  readonly runId: string;
  readonly generatedAt: number;
  readonly source?: string;
  readonly eventWindow?: LocalExperimentValidationEventWindow;
  readonly plannerRuns: readonly PlannerExperimentRun[];
  readonly priceBinning?: WorkerExperimentValidationPriceBinning;
  readonly expectedTrajectoryAgentIds?: readonly string[];
  readonly traceWindow?: WorkerExperimentValidationTraceWindow;
  readonly thresholds?: ExperimentValidationThresholds;
};
```

- [x] **Step 2: Read and validate the event window**

Use `storage.eventStore.getStreamVersion(storage.partition.eventStreamName)` for default
`toSequence`. Reject non-integer negative bounds, `toSequence < afterSequence`, or
`toSequence > streamVersion`.

- [x] **Step 3: Hydrate projection and collect events**

Hydrate through `hydrateWorldProjectionFromEventStream` with `toSequence`, then read events after
`afterSequence` and filter to `event.sequence <= toSequence`.

- [x] **Step 4: Delegate report creation and recording**

Call `recordWorkerExperimentValidationReport` with storage's report repository, event sample,
hydrated projection, trace repository, planner runs, thresholds, and optional binning/window fields.

- [x] **Step 5: Export the schedule runner**

Add `export * from './localExperimentValidationSchedule';` to `apps/worker/src/index.ts`.

### Task 3: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @aivilization/worker test -- localExperimentValidationSchedule.test.ts experimentValidationRunner.test.ts localRuntimeStorage.test.ts
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

Commit with:

```bash
git commit -m "feat: add local validation schedule runner"
```

## Self-Review

- Boundary review: schedule orchestration lives in worker; validation math stays in observability
  and `experimentValidationRunner`.
- Data-flow review: storage -> event window/projection/trace -> report runner -> repository.
- Extension review: lifecycle hooks and distributed schedulers can call this use case later without
  changing validation calculations or report storage.
