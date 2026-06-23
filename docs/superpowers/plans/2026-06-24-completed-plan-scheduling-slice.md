# Completed Active Plan Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let durable active-plan ticks continue safely after a branch plan has no remaining selectable subtasks.

**Architecture:** Completed progress is a scheduler concern, not an exception to catch inside the cycle. `agent-runtime` should expose a small selectable-subtask query, progress repositories should support read-only lookup, `buildWorkerTickAgentsFromActivePlans` should skip active plans whose saved progress leaves no selectable subtask, and `runWorkerSimulationTick` should treat an empty agent phase as a valid time-only tick.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

This slice makes completed durable plans safe in recurring ticks:

- Add a read-only `get` method to `BranchPlanProgressRepository`.
- Add an agent-runtime query for whether a branch plan has selectable subtasks under optional progress.
- Let active-plan scheduling inspect saved progress without creating new progress records.
- Skip active durable plans whose saved progress has no selectable subtasks.
- Let `runWorkerSimulationTick` advance time even when `agents` is empty.
- Let canonical active-plan ticks return a time-only tick when no active plans are schedulable.

It does not clear objectives, generate replacement plans, or choose a new long-horizon objective. Those should be separate intention/replanning slices.

## File Structure

- Modify `packages/agent-runtime/src/planner.test.ts`: add coverage for selectable-subtask availability under completed progress.
- Modify `packages/agent-runtime/src/planner.ts`: expose selectable-subtask availability.
- Modify `packages/agent-runtime/src/planProgressRepository.test.ts`: add read-only get coverage.
- Modify `packages/agent-runtime/src/planProgressRepository.ts`: add `get` to repository implementations.
- Modify `apps/worker/src/agentScheduling.test.ts`: add coverage that completed active plans are skipped.
- Modify `apps/worker/src/agentScheduling.ts`: inspect saved progress before resolving runtimes.
- Modify `apps/worker/src/tickRunner.test.ts`: add coverage for time-only ticks with no agents.
- Modify `apps/worker/src/tickRunner.ts`: allow empty agent batches.
- Modify `apps/worker/src/canonicalActivePlanTick.test.ts`: add coverage for completed active durable plans and update empty scheduling expectations.
- Modify `apps/worker/src/canonicalActivePlanTick.ts`: pass progress repository to active-plan scheduling.
- Modify this plan file as tasks complete.

## Task 1: Tests

**Files:**

- Modify: `packages/agent-runtime/src/planner.test.ts`
- Modify: `packages/agent-runtime/src/planProgressRepository.test.ts`
- Modify: `apps/worker/src/agentScheduling.test.ts`
- Modify: `apps/worker/src/tickRunner.test.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [ ] **Step 1: Write failing tests for completed-plan scheduling**

Add tests that require:

- `hasSelectableSubtasks` returns `false` when progress completes every subtask in a branch plan.
- Progress repositories can `get` existing progress without creating missing rows.
- `buildWorkerTickAgentsFromActivePlans` skips an active durable plan when saved progress leaves no selectable subtask.
- `runWorkerSimulationTick` accepts `agents: []` and commits only `SimulationTimeAdvanced`.
- `runCanonicalWorkerActivePlanTick` with completed progress returns a time-only tick instead of throwing.

Run:

```bash
pnpm test -- packages/agent-runtime/src/planner.test.ts packages/agent-runtime/src/planProgressRepository.test.ts apps/worker/src/agentScheduling.test.ts apps/worker/src/tickRunner.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
```

Expected before implementation: tests fail because progress repositories lack read-only `get`, schedulers do not inspect progress, and worker ticks reject empty agent batches.

## Task 2: Implementation

**Files:**

- Modify: `packages/agent-runtime/src/planner.ts`
- Modify: `packages/agent-runtime/src/planProgressRepository.ts`
- Modify: `apps/worker/src/agentScheduling.ts`
- Modify: `apps/worker/src/tickRunner.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.ts`

- [ ] **Step 2: Add completed-plan scheduling support**

Behavior:

- Implement `hasSelectableSubtasks(input)` in `packages/agent-runtime/src/planner.ts` using the same progress filtering as `selectPrioritizedSubtask`.
- Add `get({ planId, agentId })` to `BranchPlanProgressRepository`, returning a cloned progress record or `undefined`.
- Use `get` inside repository `getOrCreate` implementations.
- Add optional `planProgressRepository` to `buildWorkerTickAgentsFromActivePlans`.
- Skip active plans when saved progress exists and `hasSelectableSubtasks` is false.
- Remove the non-empty agent assertion from `runWorkerSimulationTick`; the tick still advances time and returns empty agent results.
- Forward `planProgressRepository` from canonical active-plan tick scheduling.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
pnpm test -- packages/agent-runtime/src/planner.test.ts packages/agent-runtime/src/planProgressRepository.test.ts apps/worker/src/agentScheduling.test.ts apps/worker/src/tickRunner.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.
