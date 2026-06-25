# Durable Social Reflection Observations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist scheduled social reflection artifacts as observability read-model rows.

**Architecture:** `packages/memory` continues to synthesize social reflection artifacts.
`packages/observability` owns durable queryable observations. `apps/worker` maps memory records into
observability records during scheduled consolidation, and local runtime storage wires a file-backed
repository for restart-safe game-server diagnostics.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/memory`,
`@aivilization/observability`, `apps/worker`.

---

### Task 1: Observability Social Reflection Repository

**Files:**

- Create: `packages/observability/src/socialReflectionObservationRepository.test.ts`
- Create: `packages/observability/src/socialReflectionObservationRepository.ts`
- Modify: `packages/observability/src/index.ts`

- [x] **Step 1: Write failing repository tests**

Add tests that import `InMemorySocialReflectionObservationRepository` and
`FileSocialReflectionObservationRepository`, record duplicate social reflection observations, query
by simulation/partition/agent/target/time, mutate a returned row, and reopen the file repository.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/observability test -- socialReflectionObservationRepository.test.ts
```

Expected: FAIL because the repository module is not exported yet.

- [x] **Step 3: Implement repository**

Create the social reflection observation types, in-memory repository, JSONL file repository,
validation, cloning, idempotent writes, and stable chronological query ordering.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/observability test -- socialReflectionObservationRepository.test.ts
pnpm --filter @aivilization/observability typecheck
```

Expected: PASS.

### Task 2: Worker Scheduled Consolidation Sink

**Files:**

- Modify: `apps/worker/src/memoryConsolidation.test.ts`
- Modify: `apps/worker/src/memoryConsolidation.ts`

- [x] **Step 1: Write failing scheduled sink test**

Add a test that schedules consolidation for one social memory with
`socialReflectionObservationSink`, then asserts the returned `socialReflectionObservationCount` is
`1` and the observability repository can query the persisted observation.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
```

Expected: FAIL because the schedule input/result do not support the sink or count.

- [x] **Step 3: Implement sink mapping**

Add `socialReflectionObservationSink` to scheduled consolidation input, map each
`SocialInteractionReflectionRecord` to a `SocialReflectionObservation`, record observations
idempotently, and return `socialReflectionObservationCount`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

### Task 3: Local Runtime Storage Wiring

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.test.ts`
- Modify: `apps/worker/src/localRuntimeStorage.ts`
- Modify: `apps/worker/src/localSimulationLifecycle.ts`
- Modify: `apps/worker/src/localSimulationLifecycle.test.ts`

- [x] **Step 1: Write failing storage/lifecycle tests**

Add storage restart coverage for `socialReflectionObservationRepository`, and extend lifecycle
memory consolidation coverage to assert the repository receives scheduled social reflection
observations and lifecycle state records the count.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts localSimulationLifecycle.test.ts
```

Expected: FAIL because local storage and lifecycle state do not expose or wire the repository.

- [x] **Step 3: Wire storage and lifecycle**

Instantiate `FileSocialReflectionObservationRepository` in local runtime storage, add the latest
observation count to lifecycle state, and pass the sink into scheduled memory consolidation.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts localSimulationLifecycle.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

### Task 4: Final Verification And Commit

- [x] **Step 1: Format/check changed files**

Run:

```bash
pnpm exec prettier --check docs/superpowers/specs/2026-06-25-durable-social-reflection-observations-design.md docs/superpowers/plans/2026-06-25-durable-social-reflection-observations-slice.md packages/observability/src/socialReflectionObservationRepository.ts packages/observability/src/socialReflectionObservationRepository.test.ts packages/observability/src/index.ts apps/worker/src/memoryConsolidation.ts apps/worker/src/memoryConsolidation.test.ts apps/worker/src/localRuntimeStorage.ts apps/worker/src/localRuntimeStorage.test.ts apps/worker/src/localSimulationLifecycle.ts apps/worker/src/localSimulationLifecycle.test.ts
pnpm --filter @aivilization/observability test -- socialReflectionObservationRepository.test.ts
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts localRuntimeStorage.test.ts localSimulationLifecycle.test.ts
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker typecheck
git diff --check
```

- [ ] **Step 2: Commit**

Stage only this slice and commit with a Conventional Commit message in Chinese.
