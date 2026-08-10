# Strategic Steering Profile Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long-horizon human steering flow into memory provenance and long-term profile state.

**Architecture:** Keep steering as the command ingestion boundary. Reuse `ShortTermMemoryRepository`
for command provenance and `LongTermProfileRepository.applyPatches` for durable profile mutation.
Avoid coupling downstream planners to steering internals.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages, `@aivilization/memory`,
`@aivilization/worker`.

---

### Task 1: Worker Steering Semantics

**Files:**

- Modify: `apps/worker/src/steering.test.ts`
- Modify: `apps/worker/src/steering.ts`

- [x] **Step 1: Write failing tests**

Update the strategic steering tests to expect one strategic STM record. Add a profile repository
case that expects a `values` entry keyed by the objective id and backed by the STM provenance id.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- steering.test.ts
```

Expected: FAIL because strategic commands currently return no STM records and do not apply LTM
profile patches.

Observed: FAIL because strategic command results returned no STM records, no LTM patches, and
local steering traces had empty strategic memory provenance.

- [x] **Step 3: Implement minimal semantics**

Create helper functions for strategic STM record creation, profile patch creation, tag
deduplication, and confidence normalization. Extend the handler input with optional
`longTermProfileRepository` and return applied patch/profile evidence on long-horizon results.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- steering.test.ts
```

Expected: PASS.

Observed: PASS.

### Task 2: Local Runtime Drain Evidence

**Files:**

- Modify: `apps/worker/src/localCommandDrain.test.ts`
- Modify if needed: `apps/worker/src/localCommandDrain.ts`

- [x] **Step 1: Write failing or changed behavior test**

Assert that draining a strategic steering command persists the long-term profile values entry and
records the strategic STM id in the durable steering trace.

- [x] **Step 2: Implement wiring if needed**

The storage repositories are already spread into `handleWorkerSteeringCommand`; only adjust the
drain if the handler type requires explicit mapping.

- [x] **Step 3: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- localCommandDrain.test.ts
```

Expected: PASS.

Observed: PASS; no explicit local drain wiring was needed because storage repositories already
include `longTermProfileRepository`.

### Task 3: Final Verification and Commit

**Files:**

- Verify all changed files

- [x] **Step 1: Run focused checks**

Run:

```bash
pnpm --filter @aivilization/worker test -- steering.test.ts localCommandDrain.test.ts
```

Observed: PASS.

- [x] **Step 2: Run workspace checks**

Run:

```bash
pnpm check
```

Observed: PASS, including lint, typecheck, and 155 test files / 790 tests.

- [x] **Step 3: Review diff and commit**

Run `git diff --check`, review the diff, stage only this slice, and commit with a detailed Chinese
Conventional Commit message.

Observed: `git diff --check` and staged diff review passed before commit.
