# Local Runtime Supervisor Operation Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist supervisor bulk lifecycle operation traces so runtime control actions can be audited and queried after restart.

**Architecture:** Keep supervisor execution responsible for bulk lifecycle orchestration, and move trace storage into a small repository contract with in-memory and file-backed adapters. Default supervisors use the host root directory for a restart-safe file log, while tests and future API adapters can inject repositories explicitly.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, file-backed JSONL operation trace log.

---

## Scope

This slice adds operation trace recording and querying for supervisor `startAll` and `pauseAll`.

It does not add external HTTP endpoints, retention policies, distributed locks, async event buses, or real-time subscriptions.

## File Structure

- Create `apps/worker/src/localSimulationRuntimeOperationTrace.ts`: operation trace types, query contract, in-memory repository, and file-backed repository.
- Modify `apps/worker/src/localSimulationRuntimeHost.ts`: expose `rootDir` on the host so default supervisor trace storage can be restart-safe.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.ts`: record trace after each bulk command and expose trace query methods.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`: verify restart-safe trace persistence and partial-failure trace contents.
- Modify `apps/worker/src/index.ts`: export operation trace APIs.
- Create `docs/superpowers/plans/2026-06-24-local-runtime-supervisor-operation-trace-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Operation Trace Tests

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:

- `startAll({ operationId, requestedAt })` returns `traceId`.
- `queryOperationTraces({ manifestId })` returns the recorded trace.
- A new supervisor constructed from the same host/root can query the prior trace.
- Partial failures are recorded with partition-level error messages and an `attention` status snapshot.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeSupervisor.test.ts
```

Expected: FAIL because operation trace methods and `operationId` support are not implemented.

### Task 2: Operation Trace Repository

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeOperationTrace.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Add trace types and repository contract**

Add:

- `LocalSimulationRuntimeOperationTrace`
- `LocalSimulationRuntimeOperationTraceQuery`
- `LocalSimulationRuntimeOperationTraceRepository`

- [x] **Step 2: Add repository adapters**

Add:

- `InMemoryLocalSimulationRuntimeOperationTraceRepository`
- `FileLocalSimulationRuntimeOperationTraceRepository`

Both adapters must record idempotently by trace id, return defensive copies, and query latest-first.

### Task 3: Supervisor Integration

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeHost.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.ts`

- [x] **Step 1: Expose host root directory**

Add `rootDir` to `LocalSimulationRuntimeHost` and return it from `bootstrapLocalSimulationRuntimeHostFromManifest`.

- [x] **Step 2: Record bulk command traces**

Update `startAll` and `pauseAll` to:

- accept optional `operationId`;
- compute a deterministic trace id when omitted;
- record a trace containing command, requestedAt, outcome, partition summaries, and refreshed status;
- return `traceId`.

- [x] **Step 3: Add trace query methods**

Add `getOperationTrace(traceId)` and `queryOperationTraces(query)` to the supervisor.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeSupervisor.test.ts
```

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
git diff --check
```

Expected: all commands pass.

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-local-runtime-supervisor-operation-trace-slice.md apps/worker/src/index.ts apps/worker/src/localSimulationRuntimeHost.ts apps/worker/src/localSimulationRuntimeOperationTrace.ts apps/worker/src/localSimulationRuntimeSupervisor.ts apps/worker/src/localSimulationRuntimeSupervisor.test.ts
git commit -m "feat: record supervisor operation traces"
```

## Self-Review

- Spec coverage: Adds durable backend control-plane auditability needed for production-scale game server operations.
- Boundary review: Trace persistence is isolated in a repository; supervisor only records orchestration outcomes.
- Placeholder scan: No deferred implementation markers remain.
