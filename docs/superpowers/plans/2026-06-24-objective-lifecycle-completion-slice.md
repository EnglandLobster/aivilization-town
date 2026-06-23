# Objective Lifecycle Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete an agent's active long-horizon objective when its durable branch plan has no remaining selectable subtasks.

**Architecture:** Keep objective lifecycle state in `@aivilization/memory`, because active objectives are durable agent memory rather than worker-local scheduling details. Add a worker lifecycle finalizer that reads active objectives, branch plans, and saved progress, then calls the repository completion method after a canonical tick. This keeps `runWorkerSimulationTick` as an executor, `buildWorkerTickAgentsFromActivePlans` as a scheduler, and objective lifecycle as its own orchestration seam.

**Tech Stack:** TypeScript, Vitest, `@aivilization/memory`, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

This slice closes the completed-plan lifecycle gap:

- Add completed-objective history to `AgentIntentionState`.
- Add `completeLongHorizonObjective` in memory domain logic.
- Add `completeObjective` to in-memory and file-backed intention repositories.
- Mark objective-linked scheduled intentions completed when their objective completes.
- Add `completeFinishedActiveObjectives` in `apps/worker`.
- Invoke the lifecycle finalizer after `runCanonicalWorkerActivePlanTick` when a progress repository is available.
- Preserve time-only tick behavior and return shape.

It does not generate replacement objectives, delete plan records, or write world events for objective completion. Those are separate AI goal-generation and eventing slices.

## File Structure

- Modify `packages/memory/src/intentions.test.ts`: add objective completion behavior tests.
- Modify `packages/memory/src/intentions.ts`: add completed-objective records and completion reducer.
- Modify `packages/memory/src/intentionRepository.test.ts`: add repository completion tests.
- Modify `packages/memory/src/intentionRepository.ts`: add in-memory completion method and clone support.
- Modify `packages/memory/src/fileRepositories.test.ts`: add file-backed completion persistence tests.
- Modify `packages/memory/src/fileRepositories.ts`: add file-backed completion method and clone support.
- Create `apps/worker/src/objectiveLifecycle.test.ts`: add lifecycle finalizer tests.
- Create `apps/worker/src/objectiveLifecycle.ts`: implement completed-plan lifecycle finalizer.
- Modify `apps/worker/src/canonicalActivePlanTick.test.ts`: assert completed plans clear active objectives after tick.
- Modify `apps/worker/src/canonicalActivePlanTick.ts`: invoke lifecycle finalizer after tick.
- Modify `apps/worker/src/index.ts`: export lifecycle module.
- Modify this plan file as tasks complete.

## Task 1: Tests

**Files:**

- Modify: `packages/memory/src/intentions.test.ts`
- Modify: `packages/memory/src/intentionRepository.test.ts`
- Modify: `packages/memory/src/fileRepositories.test.ts`
- Create: `apps/worker/src/objectiveLifecycle.test.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [ ] **Step 1: Write failing tests for objective completion lifecycle**

Add tests that require:

- `completeLongHorizonObjective` clears `activeObjective`, appends a completed-objective record, and marks objective-linked scheduled intentions completed.
- `AgentIntentionRepository.completeObjective` persists that state and returns defensive clones.
- `FileAgentIntentionRepository.completeObjective` survives repository restart.
- `completeFinishedActiveObjectives` completes an active objective when saved branch-plan progress leaves no selectable subtasks.
- `runCanonicalWorkerActivePlanTick` clears completed active objectives after a time-only completed-plan tick.

Run:

```bash
pnpm test -- packages/memory/src/intentions.test.ts packages/memory/src/intentionRepository.test.ts packages/memory/src/fileRepositories.test.ts apps/worker/src/objectiveLifecycle.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
```

Expected before implementation: tests fail because objective completion records, repository completion methods, and worker lifecycle finalizer do not exist.

## Task 2: Memory Domain And Repository Implementation

**Files:**

- Modify: `packages/memory/src/intentions.ts`
- Modify: `packages/memory/src/intentionRepository.ts`
- Modify: `packages/memory/src/fileRepositories.ts`

- [ ] **Step 2: Implement objective completion in memory**

Behavior:

- Add `CompletedLongHorizonObjective` with `objective`, `completedAt`, `reason`, and optional `planId`.
- Add `completedObjectives: readonly CompletedLongHorizonObjective[]` to `AgentIntentionState`.
- `createEmptyAgentIntentionState` returns `completedObjectives: []`.
- `setLongHorizonObjective` and `upsertScheduledIntentions` preserve completed-objective history.
- `completeLongHorizonObjective(state, input)`:
  - Requires the requested objective to be the active objective.
  - Removes `activeObjective`.
  - Appends or replaces the completion record for the objective id.
  - Marks scheduled intentions with the same `objectiveId` and non-terminal status as `completed`.
  - Sets `updatedAt` to at least `completedAt`.
- Repository implementations expose `completeObjective(agentId, input)`.
- Clone helpers defensively clone completed-objective records and default old persisted states to `[]`.

## Task 3: Worker Lifecycle Finalizer

**Files:**

- Create: `apps/worker/src/objectiveLifecycle.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 3: Implement lifecycle finalization after canonical ticks**

Behavior:

- `completeFinishedActiveObjectives(input)` loops projection agents in deterministic id order.
- It reads each agent's active objective from `intentionRepository`.
- It reads the matching plan record and progress record.
- If both exist and `hasSelectableSubtasks({ plan, progress })` is false, it calls `intentionRepository.completeObjective(agentId, { objectiveId, completedAt, reason: 'plan-completed', planId })`.
- It returns the completed objective ids for observability/tests.
- `runCanonicalWorkerActivePlanTick` invokes it after `runWorkerSimulationTick` only when `planProgressRepository` is supplied.

## Task 4: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
pnpm test -- packages/memory/src/intentions.test.ts packages/memory/src/intentionRepository.test.ts packages/memory/src/fileRepositories.test.ts apps/worker/src/objectiveLifecycle.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/memory test
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.
