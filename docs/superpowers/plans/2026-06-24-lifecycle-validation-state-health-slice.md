# Lifecycle Validation State Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the latest lifecycle validation outcome and expose validation failures through
supervisor partition health.

**Architecture:** Lifecycle state is the partition-local source of truth for recent command progress.
When a completed start runs validation, the state should record whether validation succeeded or
failed. Supervisor status can then derive partition health from both lifecycle status and validation
outcome without scanning report repositories or operation traces.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, file-backed lifecycle state store.

---

## Scope

This slice adds:

- latest validation status fields on `LocalSimulationLifecycleState`
- lifecycle state parser support for persisted validation metadata
- supervisor status fields for latest validation outcome
- `attention` health when the latest validation outcome failed

It does not add alert delivery, health acknowledgements, retry policy, or historical validation
state beyond the latest lifecycle validation outcome.

## Runtime Semantics

- Successful validation records `lastValidationStatus: succeeded` and the report run id.
- Failed validation records `lastValidationStatus: failed` and serialized failure metadata.
- Starts without configured validation leave validation status unset.
- Supervisor partition health is `attention` when lifecycle status requires attention or the latest
  validation status is failed.

## File Structure

- Modify `apps/worker/src/localSimulationLifecycle.ts`: persist validation outcome fields and parse
  them from file state.
- Modify `apps/worker/src/localSimulationLifecycle.test.ts`: prove success and failure outcomes are
  saved in state.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.ts`: include validation outcome fields in
  status and health derivation.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`: prove validation failure makes
  status attention.

## Tasks

### Task 1: Failing Tests

**Files:**

- Modify: `apps/worker/src/localSimulationLifecycle.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

- [x] **Step 1: Lifecycle state records validation success**

Assert a completed start with a generated report returns state metadata with the report run id and
the file-backed lifecycle store can read it back.

- [x] **Step 2: Lifecycle state records validation failure**

Assert a completed start with validation failure returns state metadata with failure details and the
file-backed lifecycle store can read it back.

- [x] **Step 3: Supervisor health reflects validation failure**

Assert `startAll` with validation failure keeps command outcome succeeded but status partitions are
`attention` with validation failure metadata.

### Task 2: Lifecycle State Persistence

**Files:**

- Modify: `apps/worker/src/localSimulationLifecycle.ts`

- [x] **Step 1: Add validation state fields**

Add latest validation status, report run id, generated timestamp, and failure metadata to
`LocalSimulationLifecycleState`.

- [x] **Step 2: Save validation outcome after completed starts**

After validation finishes, save lifecycle state again with validation outcome metadata before
returning the result.

- [x] **Step 3: Parse persisted validation state**

Extend the file state parser with validation metadata validation.

### Task 3: Supervisor Status Health

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.ts`

- [x] **Step 1: Expose latest validation metadata**

Include validation status/report/failure metadata in supervisor partition status.

- [x] **Step 2: Mark failed validation as attention**

Update health derivation so validation failures are visible in status snapshots.

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
git commit -m "feat: surface lifecycle validation health"
```

## Self-Review

- Boundary review: lifecycle persists latest validation outcome; supervisor only derives health.
- Data-flow review: validation result/failure -> lifecycle state -> supervisor status.
- Extension review: future dashboards can render current validation health without scanning command
  history or report repositories.
