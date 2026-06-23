# Active Plan Progress Tick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist branch-plan progress during worker ticks so active durable plans advance across ticks.

**Architecture:** `runWorkerAgentCycle` already owns loading and saving `BranchPlanProgress` when given a repository and plan-progress id. This slice threads that existing capability through `runWorkerSimulationTick` and `runCanonicalWorkerActivePlanTick`, using the durable plan id already attached to scheduled tick agents. The low-level cycle remains the only place that decides how progress changes; tick orchestration only supplies persistence.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

This slice connects existing progress persistence to the tick paths:

- Add optional `planProgressRepository` to `runWorkerSimulationTick`.
- Pass `planProgressRepository` and `planProgressId` into `runWorkerAgentCycle` when a tick agent has a durable `planId`.
- Preserve current behavior when no progress repository is supplied.
- Add optional `planProgressRepository` to `runCanonicalWorkerActivePlanTick`.
- Pass it through to the low-level tick runner.
- Keep direct-plan tick agents without `planId` working as they do today.

It does not change `runAgentPlanningCycle`, adaptive replanning rules, branch plan structure, or progress repository implementations.

## File Structure

- Modify `apps/worker/src/tickRunner.test.ts`: add coverage that a durable plan id saves progress through a tick.
- Modify `apps/worker/src/canonicalActivePlanTick.test.ts`: add coverage that the canonical active-plan tick path saves progress.
- Modify `apps/worker/src/tickRunner.ts`: thread progress repository into agent cycles.
- Modify `apps/worker/src/canonicalActivePlanTick.ts`: expose and forward the progress repository.
- Modify this plan file as tasks complete.

## Task 1: Progress Persistence Tests

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [ ] **Step 1: Write failing tests for tick-level plan progress persistence**

Add tests that require:

- `runWorkerSimulationTick` with `planRepository`, `planProgressRepository`, and a tick agent using `planId` saves a progress update for that plan id after an accepted action.
- `runCanonicalWorkerActivePlanTick` with `planProgressRepository` saves progress for the active durable plan id.
- The saved progress contains the selected subtask id in `completedSubtaskIds`.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because tick runners ignore `planProgressRepository`.

## Task 2: Progress Repository Threading

**Files:**

- Modify: `apps/worker/src/tickRunner.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.ts`

- [ ] **Step 2: Thread plan progress repository through tick execution**

Behavior:

- Import `BranchPlanProgressRepository` in `apps/worker/src/tickRunner.ts`.
- Add `readonly planProgressRepository?: BranchPlanProgressRepository` to the tick base input.
- When calling `runWorkerAgentCycle`, pass:
  - `planProgressRepository` only when supplied and the tick agent has `planId`.
  - `planProgressId: agent.planId` only when supplied.
- Do not pass `planProgressRepository` for direct-plan agents without `planId`.
- Import `BranchPlanProgressRepository` in `apps/worker/src/canonicalActivePlanTick.ts`.
- Add optional `planProgressRepository` to `CanonicalWorkerActivePlanTickBaseInput`.
- Forward it to `runWorkerSimulationTick` when supplied.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.
