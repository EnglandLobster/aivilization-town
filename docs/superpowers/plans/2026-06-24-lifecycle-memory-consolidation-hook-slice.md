# Lifecycle Memory Consolidation Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run scheduled STM-to-LTM memory consolidation automatically after completed local lifecycle
starts.

**Architecture:** `packages/memory` owns consolidation semantics and profile mutation. `apps/worker`
already has a cursor-aware consolidation schedule runner; this slice wires that runner into local
lifecycle orchestration as an optional side effect, using storage-owned repositories and cursor
store. Lifecycle owns trigger timing and failure isolation; memory remains the source of truth for
what becomes long-term profile state.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local file-backed runtime storage.

---

## Scope

This slice adds:

- file-backed memory consolidation cursor store to `LocalWorldRuntimeStorage`
- optional lifecycle memory consolidation schedule config
- completed-start hook that runs `runWorkerMemoryConsolidationSchedule`
- lifecycle result fields for `memoryConsolidation` or `memoryConsolidationFailure`
- manifest/host wiring propagation for memory consolidation schedule

It does not add queue leases, cron timers, retry policy, supervisor trace metadata, health escalation,
vector retrieval, or LLM-generated reflection text.

## Runtime Semantics

- The hook is disabled by default.
- The hook runs only after lifecycle `start` finishes with `completed`.
- `agentIds` defaults to the agents present in the initial projection.
- The hook uses the partition-local short-term memory repository, long-term profile repository, and
  memory consolidation cursor store.
- `proposedAt` is the lifecycle request time.
- Memory consolidation failures are returned as `memoryConsolidationFailure` and do not turn a
  completed tick batch into a failed lifecycle command.

## File Structure

- Modify `apps/worker/src/localRuntimeStorage.ts`: add memory consolidation cursor store.
- Modify `apps/worker/src/localSimulationLifecycle.ts`: add memory consolidation config and hook.
- Modify `apps/worker/src/localSimulationLifecycle.test.ts`: prove hook success, cursor persistence,
  and paused-start skip.
- Modify `apps/worker/src/localSimulationRuntimeManifest.ts`: propagate schedule through wiring.
- Modify `apps/worker/src/localSimulationRuntimeHost.ts`: preserve host bootstrap parity.
- Modify `apps/worker/src/localSimulationRuntimeManifest.test.ts`: prove registration propagation.

## Tasks

### Task 1: Failing Lifecycle Tests

**Files:**

- Modify: `apps/worker/src/localSimulationLifecycle.test.ts`

- [x] **Step 1: Completed start consolidates STM into LTM**

Append three short-term memories with the same habit hint, configure lifecycle memory consolidation,
run `start`, and assert `memoryConsolidation.patchCount`, the saved cursor, and the long-term profile
habit.

- [x] **Step 2: Repeated start skips already consolidated records**

Run a second completed start without new STM and assert `memoryConsolidation.patchCount` is `0` and
no new cursor is written.

- [x] **Step 3: Paused start skips memory consolidation**

Configure `pauseBeforeTick`, run `start`, and assert no consolidation result is returned.

### Task 2: Storage And Lifecycle Implementation

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.ts`
- Modify: `apps/worker/src/localSimulationLifecycle.ts`

- [x] **Step 1: Add cursor store to storage**

Instantiate `FileMemoryConsolidationCursorStore` in local runtime storage and expose it as
`memoryConsolidationCursorStore`.

- [x] **Step 2: Add schedule config and result fields**

Define lifecycle memory consolidation schedule input with retrieval limits, pattern count, and
optional agent ids; add result/failure fields to completed start results.

- [x] **Step 3: Run schedule after completed starts**

Call `runWorkerMemoryConsolidationSchedule` with storage repositories and the cursor store. Catch
errors and serialize them into `memoryConsolidationFailure`.

### Task 3: Runtime Wiring

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeManifest.ts`
- Modify: `apps/worker/src/localSimulationRuntimeManifest.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeHost.ts`

- [x] **Step 1: Add wiring input**

Propagate `memoryConsolidationSchedule` from runtime wiring to backend registrations.

- [x] **Step 2: Preserve host parity**

Pass the same schedule through `bootstrapLocalSimulationRuntimeHostFromManifest`.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted red/green tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationLifecycle.test.ts localSimulationRuntimeManifest.test.ts localRuntimeStorage.test.ts
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
git commit -m "feat: add lifecycle memory consolidation hook"
```

## Self-Review

- Boundary review: lifecycle triggers schedule timing; memory owns consolidation semantics.
- Data-flow review: STM repository -> cursor-aware schedule -> LTM profile repository -> lifecycle
  result.
- Extension review: future queue/cron workers can reuse the schedule runner without changing memory
  domain rules.
