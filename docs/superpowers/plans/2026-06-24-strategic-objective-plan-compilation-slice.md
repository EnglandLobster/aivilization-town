# Strategic Objective Plan Compilation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert human long-horizon steering objectives into durable Branch-Thinking Planner records so strategic guidance becomes executable planner state.

**Architecture:** `@aivilization/agent-runtime` owns the strategic plan compiler contract and a deterministic default compiler. `apps/worker` handles `SetLongHorizonObjective` by persisting the intention first, then optionally compiling and saving a `BranchPlanRecord` through the existing plan repository boundary. Local runtime storage already exposes the repository and only needs wiring verified through steering tests.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/memory`, `apps/worker`.

---

## Scope

This slice connects human strategic steering to durable planner state:

- Add a `StrategicPlanCompiler` interface.
- Add a default deterministic compiler that decomposes a `LongHorizonObjective` into parallel plan branches.
- Let `handleWorkerSteeringCommand` accept an optional `planRepository` and optional compiler.
- When handling `SetLongHorizonObjective`, save a `BranchPlanRecord` with `planId` equal to the objective id.
- Return the saved `planRecord` from the steering result so callers know which plan id to schedule in ticks.
- Preserve existing behavior when no plan repository is supplied.

It does not call an LLM, replace existing plans during adaptive re-planning, or add an API endpoint. Those are future slices that can plug into the compiler and repository contracts.

## File Structure

- Add `packages/agent-runtime/src/strategicPlanning.test.ts`: tests for deterministic objective-to-plan compilation.
- Add `packages/agent-runtime/src/strategicPlanning.ts`: compiler interface and default compiler.
- Modify `packages/agent-runtime/src/index.ts`: export strategic planning APIs.
- Modify `apps/worker/src/steering.test.ts`: steering command saves a plan record when a plan repository is provided.
- Modify `apps/worker/src/steering.ts`: compile and save plan records after objective persistence.
- Modify `apps/worker/src/localRuntimeStorage.test.ts`: prove the storage `repositories` bundle can be passed to steering and persist a plan.
- Modify this plan file as tasks complete.

## Task 1: Strategic Compiler Tests

**Files:**

- Add: `packages/agent-runtime/src/strategicPlanning.test.ts`

- [x] **Step 1: Write failing tests for objective-to-plan compilation**

Create tests that require:

- A study-oriented human objective compiles to a Branch-Thinking plan with a development branch and a study subtask.
- The compiled plan preserves the objective statement as the top-level plan objective.
- The compiler creates at least two branches so the result is structurally branch-thinking, not a single flat task list.
- Affinity tags flow into subtask affinity tags for contextual prioritization.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: tests fail because strategic planning APIs are missing.

Observed: test failed before implementation because `compileStrategicObjectiveToBranchPlan` was missing. It now passes after adding the compiler.

## Task 2: Worker Steering Plan Persistence Tests

**Files:**

- Modify: `apps/worker/src/steering.test.ts`

- [x] **Step 2: Write failing tests for strategic steering plan persistence**

Create tests that require:

- `handleWorkerSteeringCommand` saves the long-horizon objective to `intentionRepository`.
- When `planRepository` is provided, it also saves a `BranchPlanRecord`.
- The saved record uses `planId === objective.id`, `agentId === command.actorId`, `createdAt === issuedAt`, and `updatedAt === issuedAt`.
- The steering result returns the saved `planRecord`.
- Existing calls without `planRepository` still return no command drafts and no STM records.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because steering does not accept or save plan repositories.

Observed: test failed before implementation because the plan repository had no `objective-study` record after steering. It now passes after steering saves `planRecord`.

## Task 3: Local Runtime Steering Wiring Test

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.test.ts`

- [x] **Step 3: Write failing test for storage repositories and steering**

Extend the restart test so it:

- Calls `handleWorkerSteeringCommand` with `...storage.repositories`.
- Verifies `restarted.planRepository.require({ planId, agentId })` recovers the generated plan.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because steering ignores `planRepository`.

Observed: test failed before implementation because `restarted.planRepository` could not find the generated objective plan. It now passes after steering consumes the storage repository bundle.

## Task 4: Implementation

**Files:**

- Add: `packages/agent-runtime/src/strategicPlanning.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `apps/worker/src/steering.ts`

- [x] **Step 4: Implement strategic plan compiler and worker wiring**

Behavior:

- `StrategicPlanCompiler` accepts `{ objective, issuedAt }` and returns a `BranchPlan`.
- `compileStrategicObjectiveToBranchPlan` is deterministic and contains:
  - a `development` branch when the objective tags or statement mention study or education;
  - a `wellbeing` branch for health, satiety, energy, or maintenance context;
  - a `primary-objective` branch for the literal objective statement.
- Each subtask has stable ids, non-empty descriptions, finite priorities, and affinity tags.
- `handleWorkerSteeringCommand` saves the intention exactly as before.
- If `planRepository` is provided, compile a plan using the supplied compiler or the default compiler, save a `BranchPlanRecord`, and include it in the result.
- If no repository is provided, preserve existing output shape.

## Task 5: Verification

**Files:**

- Modify: this plan file

- [x] **Step 5: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

Observed: focused package tests and typechecks passed. Full `pnpm check` passed with 47 test files and 205 tests. Full `pnpm build` passed.
