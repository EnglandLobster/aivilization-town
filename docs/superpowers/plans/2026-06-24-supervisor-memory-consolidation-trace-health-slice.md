# Supervisor Memory Consolidation Trace Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface lifecycle memory consolidation outcomes through supervisor operation traces and
partition health.

**Architecture:** Lifecycle remains the trigger for optional STM-to-LTM consolidation. Lifecycle
state stores the latest memory consolidation outcome so status snapshots can derive health without
scanning repositories. Supervisor operation traces store bounded consolidation metadata, while memory
repositories remain the source of truth for profile content.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local runtime supervisor and file-backed
lifecycle state.

---

## Scope

This slice adds:

- latest memory consolidation status fields on `LocalSimulationLifecycleState`
- memory consolidation success/failure metadata on supervisor partition status
- memory consolidation success/failure metadata on successful operation trace partitions
- `attention` health when the latest memory consolidation outcome failed

It does not change consolidation rules, add retry policy, add alert delivery, add HTTP routes, or
duplicate full long-term profile content inside operation traces.

## Runtime Semantics

- Successful consolidation records patch count, consolidated agent count, cursor count, and run time.
- Failed consolidation records serialized failure metadata.
- Starts without configured memory consolidation leave memory consolidation status unset.
- Supervisor partition health is `attention` when lifecycle status requires attention, validation
  failed, or memory consolidation failed.
- Operation traces store only bounded metadata, not profile patches or full STM/LTM content.

## File Structure

- Modify `apps/worker/src/localSimulationLifecycle.ts`: persist memory consolidation outcome in
  lifecycle state.
- Modify `apps/worker/src/localSimulationLifecycle.test.ts`: prove success/failure outcome state.
- Modify `apps/worker/src/localSimulationRuntimeOperationTrace.ts`: add memory consolidation trace
  metadata type.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.ts`: expose memory status and trace
  metadata.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`: prove trace/status behavior.

## Tasks

### Task 1: Failing Tests

**Files:**

- Modify: `apps/worker/src/localSimulationLifecycle.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

- [x] **Step 1: Lifecycle state records memory consolidation success**

After a completed start with memory consolidation, assert returned and persisted lifecycle state
contains `lastMemoryConsolidationStatus: succeeded`, patch count, cursor count, consolidated agent
count, and timestamp.

- [x] **Step 2: Lifecycle state records memory consolidation failure**

Configure invalid memory consolidation input, run a completed start, and assert lifecycle result and
persisted state contain `memoryConsolidationFailure`.

- [x] **Step 3: Supervisor operation trace records memory consolidation metadata**

Run `startAll` with memory consolidation and assert operation traces include bounded consolidation
metadata for each successful partition.

- [x] **Step 4: Supervisor health reflects memory consolidation failure**

Run `startAll` with failing memory consolidation and assert command outcome remains succeeded while
partition health becomes `attention`.

### Task 2: Lifecycle State Persistence

**Files:**

- Modify: `apps/worker/src/localSimulationLifecycle.ts`

- [x] **Step 1: Add memory consolidation state fields**

Add latest memory consolidation status, timestamp, patch count, cursor count, consolidated agent
count, and failure metadata to `LocalSimulationLifecycleState`.

- [x] **Step 2: Save memory consolidation outcome**

After the optional memory consolidation hook runs, save state again with the memory outcome fields.

- [x] **Step 3: Parse persisted memory state**

Extend file state parsing to validate successful and failed memory consolidation metadata.

### Task 3: Supervisor Trace And Health

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeOperationTrace.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.ts`

- [x] **Step 1: Add operation trace metadata**

Allow successful operation trace partitions to carry optional `memoryConsolidation` or
`memoryConsolidationFailure` metadata.

- [x] **Step 2: Expose status metadata**

Include latest memory consolidation outcome fields in supervisor partition status.

- [x] **Step 3: Mark failed memory consolidation as attention**

Update partition health derivation to include failed memory consolidation status.

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
git commit -m "feat: surface memory consolidation health"
```

## Self-Review

- Boundary review: lifecycle state owns latest outcome; supervisor only derives status and traces.
- Data-flow review: memory consolidation result/failure -> lifecycle state -> supervisor status and
  operation trace.
- Extension review: future API/Godot control panels can observe memory consolidation health without
  reading profile repositories directly.
