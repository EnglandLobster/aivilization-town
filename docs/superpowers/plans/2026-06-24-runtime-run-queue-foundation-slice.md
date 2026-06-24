# Runtime Run Queue Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable run queue and lease-based executor foundation for supervisor run-cycle jobs.

**Architecture:** Keep the existing synchronous `runCycles` control path intact and introduce a
separate queue boundary owned by the worker package. Queue records are append-only latest-state
records, jobs are claimed by lease, and a small executor claims one job and calls the existing
supervisor. Later HTTP/background workers can use this boundary without changing supervisor
execution semantics.

**Tech Stack:** TypeScript, Vitest, Node JSONL file repository, local runtime supervisor contracts.

---

## Scope

This slice adds:

- in-memory and file-backed local runtime run queue repositories
- queued, leased, completed, and failed job states
- lease claiming with expired-lease takeover
- a single-job run queue worker that claims one job and executes `supervisor.runCycles`

It does not change `POST /runtime/run`, add async HTTP routes, add distributed locks beyond a
single durable lease record, add concurrent workers, or add retention. Those should wrap this
foundation later.

## File Structure

- Create `apps/worker/src/localSimulationRuntimeRunQueue.ts`: queue contracts,
  in-memory/file-backed repositories, lease worker.
- Create `apps/worker/src/localSimulationRuntimeRunQueue.test.ts`: repository and worker behavior.
- Modify `apps/worker/src/index.ts`: export the run queue module.

## Tasks

### Task 1: Failing Queue Repository Tests

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeRunQueue.test.ts`

- [x] **Step 1: Add in-memory clone and lease test**

Create an in-memory repository, enqueue two jobs, mutate the original enqueue input, claim the first
job with `worker-a`, verify it becomes `leased`, verify a second immediate claim skips the active
lease and claims the second job, then verify an expired lease can be reclaimed by `worker-b`.

- [x] **Step 2: Add file-backed restart test**

Save a queued job in a file repository, create a new repository over the same root, claim the job,
complete it, then create another repository and verify the latest state is `completed`.

- [x] **Step 3: Run queue repository tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueue.test.ts
```

Expected: fail because the module and repository classes do not exist.

### Task 2: Failing Queue Worker Test

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeRunQueue.test.ts`

- [x] **Step 1: Add worker executes claimed job test**

Enqueue one job, create a queue worker with a fake supervisor that records the `runCycles` request,
run one job, assert the supervisor received the request and the queue job is `completed`.

- [x] **Step 2: Add worker marks failed job test**

Enqueue one job, create a queue worker whose supervisor throws, run one job, assert the queue job is
`failed` with serialized error metadata.

- [x] **Step 3: Run targeted tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueue.test.ts
```

Expected: fail until queue worker and repository implementation exist.

### Task 3: Queue Foundation Implementation

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeRunQueue.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Define queue job contracts**

Add job status, run request, lease claim, error, repository, and worker result types.

- [x] **Step 2: Implement repositories**

Implement in-memory and JSONL file repositories with defensive clones, append-only state updates,
earliest eligible claim selection, and expired-lease takeover.

- [x] **Step 3: Implement queue worker**

Implement `createLocalSimulationRuntimeRunQueueWorker` with `runNext({ claimedAt })`, claim one job,
call `supervisor.runCycles(job.runRequest)`, and complete or fail the job.

- [x] **Step 4: Export module**

Export the run queue module from `apps/worker/src/index.ts`.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueue.test.ts
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
git commit -m "feat: add runtime run queue foundation"
```

## Self-Review

- Boundary review: queue owns scheduling state; supervisor still owns execution and run-session
  state.
- Data-flow review: enqueue job -> claim lease -> run supervisor -> complete/fail queue job.
- Extension review: async HTTP submission, background processes, leases with heartbeats, retention,
  and distributed workers can build on this module without changing `runCycles`.
