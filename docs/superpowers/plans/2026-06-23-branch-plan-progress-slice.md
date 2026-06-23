# Branch Plan Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add branch plan progress and dependency gating so the Branch-Thinking Planner selects only runnable subtasks from active objective branches.

**Architecture:** `@aivilization/agent-runtime` owns planning semantics. `BranchPlan` remains the durable structural decomposition, while `BranchPlanProgress` is a small runtime state object that records completed and blocked subtasks. The selector filters by progress and dependency availability before applying existing signal, intention, memory, and profile scoring.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/sim-core`.

---

## Scope

This slice moves the planner closer to AIvilization's Branch-Thinking Planner:

- Add optional `dependsOnSubtaskIds` to `PlannerSubtask`.
- Validate subtask ids are globally unique within a plan so progress and influence maps remain unambiguous.
- Validate dependencies point to subtasks in the same branch and do not point forward.
- Add `BranchPlanProgress` helpers for completed and blocked subtasks.
- Make `selectPrioritizedSubtask` ignore completed, blocked, and dependency-blocked subtasks.
- Make `runAgentPlanningCycle` accept optional `progress`.

It does not add persistent plan repositories, LLM objective decomposition, global synthesis across multi-action sequences, or full adaptive re-planning. Those will build on this state boundary.

## File Structure

- Add `packages/agent-runtime/src/planProgress.test.ts`: TDD coverage for progress state helpers.
- Add `packages/agent-runtime/src/planProgress.ts`: progress type and immutable update helpers.
- Modify `packages/agent-runtime/src/planner.test.ts`: dependency validation and runnable selection tests.
- Modify `packages/agent-runtime/src/planner.ts`: dependency metadata, validation, and progress-aware selection.
- Modify `packages/agent-runtime/src/cycle.test.ts`: cycle-level progress gating test.
- Modify `packages/agent-runtime/src/cycle.ts`: pass progress into planner selection.
- Modify `packages/agent-runtime/src/index.ts`: export progress helpers.
- Modify this plan file as tasks complete.

## Task 1: Plan Progress Tests

**Files:**

- Add: `packages/agent-runtime/src/planProgress.test.ts`

- [x] **Step 1: Write failing tests for immutable plan progress helpers**

Create tests that require:

- `createBranchPlanProgress` starts with empty completed and blocked sets.
- `markSubtaskCompleted` records a subtask once and updates `updatedAt`.
- `markSubtaskBlocked` records a reason, deduplicates by subtask id, and updates the latest reason.
- Returned arrays are deterministic by subtask id.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: tests fail because plan progress helpers are missing.

Observed red test: `pnpm --filter @aivilization/agent-runtime test` failed because `createBranchPlanProgress` and progress update helpers were not implemented/exported.

## Task 2: Planner Dependency Tests

**Files:**

- Modify: `packages/agent-runtime/src/planner.test.ts`

- [x] **Step 2: Write failing tests for dependency-aware selection**

Create tests that require:

- A high-priority subtask with an unmet same-branch dependency is not selectable.
- After the dependency is completed in `BranchPlanProgress`, the dependent subtask can be selected.
- `createBranchPlan` rejects dependencies pointing forward or outside the branch.
- Existing scoring behavior without progress remains unchanged.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: tests fail because planner ignores dependencies and progress.

Observed red test: planner accepted forward/out-of-branch dependencies and selected from raw priority without progress gating.

## Task 3: Cycle Progress Tests

**Files:**

- Modify: `packages/agent-runtime/src/cycle.test.ts`

- [x] **Step 3: Write failing tests for cycle-level progress gating**

Create a cycle test where:

- `craft-ingot` has higher base priority but depends on `gather-ore`.
- Without completed progress, the cycle selects `gather-ore`.
- With `gather-ore` completed, the cycle selects `craft-ingot`.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: the cycle selects the highest raw score regardless of dependency progress.

Observed red test: cycle could not use plan progress because progress helpers and cycle input were missing.

## Task 4: Implementation

**Files:**

- Add: `packages/agent-runtime/src/planProgress.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `packages/agent-runtime/src/planner.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`

- [x] **Step 4: Implement progress-aware Branch-Thinking selection**

Behavior:

- `PlannerSubtask.dependsOnSubtaskIds` is optional and copied defensively.
- `createBranchPlan` enforces globally unique subtask ids.
- Dependency ids must appear earlier in the same branch.
- `BranchPlanProgress` contains `completedSubtaskIds`, `blockedSubtasks`, and `updatedAt`.
- `selectPrioritizedSubtask` filters out completed, explicitly blocked, and dependency-blocked subtasks before scoring.
- If all subtasks are unavailable, throw `branch plan produced no selectable subtasks`.
- `runAgentPlanningCycle` accepts optional `progress` and passes it to selection.

Implemented in `packages/agent-runtime/src/planProgress.ts`, `packages/agent-runtime/src/planner.ts`, and `packages/agent-runtime/src/cycle.ts`.

## Task 5: Verification

**Files:**

- Modify: this plan file

- [x] **Step 5: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/agent-runtime typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

Verification passed:

- `pnpm --filter @aivilization/agent-runtime test`
- `pnpm --filter @aivilization/agent-runtime typecheck`
- `pnpm check`
- `pnpm build`
