# Worker Local Runtime Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend local world runtime storage so restartable worker ticks use durable memory repositories as well as durable world event/checkpoint storage.

**Architecture:** `apps/worker` composes local runtime dependencies; `@aivilization/memory` owns file-backed memory repository adapters. This slice wires memory repositories into the local runtime factory and exposes a tick-ready repository bundle.

**Tech Stack:** TypeScript, Vitest, `@aivilization/memory`, `@aivilization/sim-core`, `apps/worker`.

---

## Scope

This slice connects local runtime storage to durable memory repositories:

- Add file-backed short-term memory, intention, and long-term profile repositories to `createLocalWorldRuntimeStorage`.
- Add a `repositories` bundle that can be spread directly into `runWorkerSimulationTick`.
- Add stable memory repository paths under the local simulation partition directory.
- Verify that a restarted local runtime can retrieve STM written by a previous tick and continue writing more STM.

It does not add memory compaction, vector search, semantic embeddings, retention policies, remote repositories, or automatic long-term consolidation scheduling.

## File Structure

- Modify `apps/worker/src/localRuntimeStorage.test.ts`: TDD coverage for durable runtime memory repositories.
- Modify `apps/worker/src/localRuntimeStorage.ts`: compose file-backed memory repositories and expose a tick-ready bundle.
- Modify this plan file as tasks complete.

## Task 1: Runtime Memory Tests

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.test.ts`

- [x] **Step 1: Write failing tests for runtime memory persistence**

Update the existing local runtime storage test to require:

- `storage.repositories` supplies `intentionRepository`, `longTermProfileRepository`, and `shortTermMemoryRepository`.
- The first tick writes short-term memory records through local file-backed memory repositories.
- A restarted storage instance can retrieve those records using `shortTermMemoryRepository.retrieve`.
- The second tick uses the restarted repository bundle and leaves four persisted study STM records.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because `repositories` and durable memory repository fields are missing from local runtime storage.

## Task 2: Runtime Memory Composition

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.ts`

- [x] **Step 2: Wire file-backed memory repositories into local runtime storage**

Add:

- `memoryDir` to `LocalWorldRuntimeStoragePaths`
- `shortTermMemoryRepository`
- `intentionRepository`
- `longTermProfileRepository`
- `repositories`

Behavior:

- Directory layout:
  - `rootDir/simulations/<simulationId>/partitions/<partitionKey>/memory`
- Instantiate:
  - `FileShortTermMemoryRepository`
  - `FileAgentIntentionRepository`
  - `FileLongTermProfileRepository`
- Return `repositories` shaped for `runWorkerSimulationTick`.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [x] **Step 3: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

## Verification Results

- `pnpm --filter @aivilization/worker test` failed before implementation because local runtime storage did not expose durable memory repositories.
- `pnpm --filter @aivilization/worker test` passed after implementation.
- `pnpm --filter @aivilization/worker typecheck` passed after implementation.
- `pnpm --filter @aivilization/worker test` passed after targeted formatting.
- `pnpm --filter @aivilization/worker typecheck` passed after targeted formatting.
- `pnpm check` passed.
- `pnpm build` passed.
