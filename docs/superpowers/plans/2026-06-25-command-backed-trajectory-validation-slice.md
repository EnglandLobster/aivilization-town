# Command Backed Trajectory Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make trajectory validation replay-oriented by deriving first/last command evidence from durable agent cycle traces.

**Architecture:** `@aivilization/observability` keeps trajectory observations as validation input and adds optional command span metadata plus metric evidence for replayable trajectories. `apps/worker` remains the adapter from durable `AgentCycleTraceRepository` to validation observations, sorting traces chronologically per agent before computing command spans. Local validation schedules keep using the worker runner, so they inherit command-backed trajectory coverage without another storage dependency.

**Tech Stack:** TypeScript, Vitest, `@aivilization/observability`, worker experiment validation runner, local validation schedule.

---

### Task 1: Observability Trajectory Command Span Evidence

**Files:**

- Modify: `packages/observability/src/experimentValidation.ts`
- Modify: `packages/observability/src/experimentValidation.test.ts`

- [x] **Step 1: Write failing metric evidence test**

Add a test where trajectory observations include `firstCommandId` and `lastCommandId`; assert the `trajectory-coverage` metric evidence includes `commandBackedTrajectoryCount`.

- [x] **Step 2: Add command span fields and diagnostics**

Extend `AgentTrajectoryObservation` with optional `firstCommandId` and `lastCommandId`, validate non-empty strings, and count command-backed covered trajectories.

### Task 2: Worker Trace Adapter Command Spans

**Files:**

- Modify: `apps/worker/src/experimentValidationRunner.ts`
- Modify: `apps/worker/src/experimentValidationRunner.test.ts`

- [x] **Step 1: Write failing adapter test**

Add a test proving `createAgentTrajectoriesFromTraceRepository` returns per-agent `stepCount`, `firstCommandId`, and `lastCommandId` from durable traces in chronological order.

- [x] **Step 2: Derive command spans from traces**

Group queried traces by agent, sort each group by `cycleStartedAt` and `traceId`, count all cycles as steps, and use earliest/latest emitted command IDs as optional command span fields.

### Task 3: Local Schedule Integration

**Files:**

- Modify: `apps/worker/src/localExperimentValidationSchedule.test.ts`

- [x] **Step 1: Add schedule-level evidence assertion**

Update the existing trace-backed local validation schedule test to assert `trajectory-coverage.evidence.commandBackedTrajectoryCount`.

### Task 4: Verification and Commit

**Files:**

- Modify this plan checklist to checked boxes.
- Commit all changed files.

- [x] **Step 1: Run focused verification**

```bash
pnpm --filter @aivilization/observability test -- experimentValidation.test.ts
pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts localExperimentValidationSchedule.test.ts
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
git add docs/superpowers/plans/2026-06-25-command-backed-trajectory-validation-slice.md \
  packages/observability/src/experimentValidation.ts packages/observability/src/experimentValidation.test.ts \
  apps/worker/src/experimentValidationRunner.ts apps/worker/src/experimentValidationRunner.test.ts \
  apps/worker/src/localExperimentValidationSchedule.test.ts
git commit -m "feat: validate command-backed trajectories"
```

- [x] **Step 4: Report overview**

Summarize completed work, verification, current branch status, remaining gaps, and an updated tree diagram.
