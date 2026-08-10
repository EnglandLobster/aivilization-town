# Runtime Run Session Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist supervisor run-cycle progress so a long town run can be inspected and resumed
after process restart.

**Architecture:** Keep operation traces immutable and add a separate run-session repository for
current run state. `runCycles` writes a running session before work starts, checkpoints after each
cycle, and writes terminal state when stopped or completed. If the same run id is invoked while a
session is still running, the supervisor resumes from the persisted cycle checkpoint rather than
rerunning completed cycles.

**Tech Stack:** TypeScript, Vitest, Node file-backed JSONL repository, local runtime supervisor.

---

## Scope

This slice adds:

- in-memory and file-backed local runtime run-session repositories
- persisted run session state for supervisor `runCycles`
- `getRunSession(traceId)` on the local supervisor
- resume behavior for an existing running session with completed cycle checkpoints

It does not add HTTP routes for run sessions, background workers, wall-clock timers, distributed
leases, cancellation, or concurrent run locking. Those will wrap this state boundary later.

## Runtime Semantics

- A run session has `running`, `completed`, or `stopped` status.
- `completed` means all requested cycles ran.
- `stopped` means the run stopped early due to partition failure or attention.
- `runCycles` persists a `running` session before executing the first missing cycle.
- After each cycle, `runCycles` updates completed cycle count, cycle summaries, status snapshot, and
  `updatedAt`.
- If a persisted running session exists for the same trace id, `runCycles` resumes at
  `completedCycleCount + 1`.
- If a terminal session exists for the same trace id, `runCycles` returns it idempotently.
- Operation traces remain immutable audit records; run sessions are latest-state records.

## File Structure

- Create `apps/worker/src/localSimulationRuntimeRunSession.ts`: repository contracts,
  in-memory/file adapters, clone helpers.
- Create `apps/worker/src/localSimulationRuntimeRunSession.test.ts`: repository clone and restart
  behavior.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.ts`: inject/default the repository,
  expose `getRunSession`, checkpoint and resume `runCycles`.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`: prove session persistence and
  resume behavior.
- Modify `apps/worker/src/index.ts`: export the run-session module.

## Tasks

### Task 1: Failing Repository Tests

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeRunSession.test.ts`

- [x] **Step 1: In-memory repository clones saved state**

Write a test that saves a running session, mutates the original object, reads it back, mutates the
read copy, and verifies a second read remains unchanged.

- [x] **Step 2: File repository recovers latest session after restart**

Write a test that saves a running session, constructs a new file repository from the same root,
reads the session, then saves a completed update and verifies another restarted repository returns
the completed version.

### Task 2: Failing Supervisor Tests

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

- [x] **Step 1: Completed run cycles persist terminal session**

Run two cycles through the default supervisor, create a new supervisor over the same host/root, and
assert `getRunSession(traceId)` returns a completed session with two cycles and the final status
snapshot.

- [x] **Step 2: Running session resumes from completed checkpoint**

Run the first cycle manually with `startAll`, save a running session containing that first cycle,
then call `runCycles` with the same trace id and three requested cycles. Assert the result includes
all three cycle summaries, only cycles two and three are newly run, and final partition tick indexes
reflect three total cycles.

### Task 3: Run Session Repository Implementation

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeRunSession.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Define session state contract**

Define status, state, and repository types. Include trace id, manifest id, requested time, requested
cycle count, cycle interval, stop-on-attention policy, completed cycle count, cycle summaries,
status snapshot, `updatedAt`, and optional terminal outcome/stop reason.

- [x] **Step 2: Implement in-memory repository**

Store defensive clones keyed by trace id.

- [x] **Step 3: Implement file repository**

Append cloned states to `supervisor-run-sessions.jsonl`, read latest state for a trace id by scanning
from newest to oldest, and create the file directory during construction.

- [x] **Step 4: Export module**

Export the run-session module from `apps/worker/src/index.ts`.

### Task 4: Supervisor Integration

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.ts`

- [x] **Step 1: Add repository injection and default file adapter**

Accept `runSessionRepository` in `createLocalSimulationRuntimeSupervisor` and default it to a
file-backed repository under the host operations directory.

- [x] **Step 2: Add getRunSession**

Expose `getRunSession(traceId)` on the supervisor.

- [x] **Step 3: Checkpoint runCycles**

Before the first missing cycle, save a running session. After each cycle, save the updated running
session. At terminal stop, save completed/stopped session and record the run operation trace.

- [x] **Step 4: Resume and idempotency**

If an existing running session is found, validate compatible run input and continue from the saved
cycles. If an existing terminal session is found, return it without rerunning cycles.

### Task 5: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunSession.test.ts localSimulationRuntimeSupervisor.test.ts
```

- [x] **Step 2: Run package verification**

Run:

```bash
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/worker test
pnpm lint
git diff --check
```

- [x] **Step 3: Commit**

Commit with:

```bash
git commit -m "feat: persist runtime run sessions"
```

## Self-Review

- Boundary review: run sessions hold mutable/latest run state; operation traces remain immutable
  audit facts.
- Data-flow review: run request -> session checkpoint -> start-all cycle traces -> session update ->
  terminal run trace.
- Extension review: HTTP run-session inspection, cancellation, queue workers, and leases can use the
  repository without changing lifecycle or domain packages.
