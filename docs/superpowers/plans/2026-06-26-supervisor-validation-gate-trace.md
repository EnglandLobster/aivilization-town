# Supervisor Validation Gate Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long-running supervisor operation artifacts show whether generated experiment validation reports actually passed, watched, or failed, including compact metric status counts.

**Architecture:** Keep validation report generation and gate evaluation in the lifecycle layer. Extend the supervisor operation trace as a read-side summary that references the durable report and exposes gate/metric health without duplicating the full report payload.

**Tech Stack:** TypeScript, Vitest, worker local simulation runtime supervisor.

---

### Task 1: Validation Gate Summary in Operation Trace

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeOperationTrace.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.ts`
- Test: `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

- [x] **Step 1: Write the failing test**

Update the start-all validation trace test to expect each partition's `validationReport` trace to include the lifecycle validation gate status and metric status counts.

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest apps/worker/src/localSimulationRuntimeSupervisor.test.ts --run
```

Expected RED: the trace only contains report identity/window fields, not gate or metric summary fields.

- [x] **Step 3: Write minimal implementation**

Extend `LocalSimulationRuntimeOperationValidationReportTrace` with optional gate metadata plus required metric counts, and populate it from `LocalExperimentValidationScheduleResult`.

- [x] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm vitest apps/worker/src/localSimulationRuntimeSupervisor.test.ts --run
```

Expected GREEN: supervisor operation traces summarize the durable validation report and its gate state.

## Review

- Spec coverage: improves the paper-aligned experiment-validation loop by making profile-run artifacts inspectable at the supervisor level.
- Boundary: does not alter validation metric formulas, AMM pricing, planner behavior, or report persistence.
- Remaining gap: a future stage should run mature long-horizon profiles and publish a consolidated validation bundle with OHLC, wealth snapshots, planner ablations, and full report links.
