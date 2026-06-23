# Branch Plan Progress Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Branch-Thinking Planner progress so full-replan progress updates survive worker cycles and local runtime restarts.

**Architecture:** `@aivilization/agent-runtime` owns progress repository interfaces and adapters because progress is planner runtime state. `apps/worker` wires optional repository loading/saving into agent cycles. Local file runtime storage exposes a file-backed progress repository alongside event, snapshot, and memory repositories.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path`, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

This slice makes plan progress durable:

- Add `BranchPlanProgressRepository`.
- Add `InMemoryBranchPlanProgressRepository`.
- Add `FileBranchPlanProgressRepository` using append-only JSONL snapshots.
- Let `runWorkerAgentCycle` load progress by `planProgressId` when a repository is supplied.
- Save `progressUpdate` back to the repository after full-replan transitions.
- Expose the file-backed repository through `createLocalWorldRuntimeStorage`.

It does not persist full `BranchPlan` definitions, generate new plans, or coordinate distributed locks. Those are separate orchestration slices.

## File Structure

- Add `packages/agent-runtime/src/planProgressRepository.test.ts`: TDD coverage for in-memory and file-backed repositories.
- Add `packages/agent-runtime/src/planProgressRepository.ts`: repository interface and adapters.
- Modify `packages/agent-runtime/src/index.ts`: export repository APIs.
- Modify `apps/worker/src/agentCycleRunner.test.ts`: worker loads/saves progress through repository.
- Modify `apps/worker/src/agentCycleRunner.ts`: optional progress repository wiring.
- Modify `apps/worker/src/localRuntimeStorage.test.ts`: local runtime exposes restart-safe plan progress repository.
- Modify `apps/worker/src/localRuntimeStorage.ts`: create file-backed progress repository.
- Modify this plan file as tasks complete.

## Task 1: Repository Adapter Tests

**Files:**

- Add: `packages/agent-runtime/src/planProgressRepository.test.ts`

- [ ] **Step 1: Write failing tests for progress repositories**

Create tests that require:

- In-memory repository `getOrCreate` creates empty progress and returns clones.
- Saving an updated progress makes it the latest state for the same `planId` and `agentId`.
- File repository recovers the latest saved progress after restart.
- Different agents or plan ids remain isolated.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: tests fail because progress repositories are missing.

## Task 2: Worker Persistence Tests

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.test.ts`

- [ ] **Step 2: Write failing tests for worker progress repository wiring**

Create tests that require:

- `runWorkerAgentCycle` can load progress from `planProgressRepository` and `planProgressId`.
- A full-replan `progressUpdate` is saved into the repository.
- A later repository read returns the blocked subtask update.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because worker does not know plan progress repositories.

## Task 3: Local Runtime Storage Tests

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.test.ts`

- [ ] **Step 3: Write failing tests for local file-backed progress storage**

Create tests that require:

- `createLocalWorldRuntimeStorage` exposes `planProgressRepository`.
- Progress saved through the first storage instance is visible after recreating storage with the same root.
- The plan progress file lives under the partition runtime directory.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because local runtime storage does not create a plan progress repository.

## Task 4: Implementation

**Files:**

- Add: `packages/agent-runtime/src/planProgressRepository.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`
- Modify: `apps/worker/src/localRuntimeStorage.ts`

- [ ] **Step 4: Implement repositories and worker wiring**

Behavior:

- `BranchPlanProgressRepository.getOrCreate({ planId, agentId, createdAt })` returns the latest progress for that key or creates an empty one.
- `save(progress)` stores a defensive clone.
- File adapter writes to `branch-plan-progress.jsonl`.
- Worker resolves progress in this order: explicit `progress`, repository-loaded progress, undefined.
- If a repository is supplied without explicit `progress`, `planProgressId` is required.
- If `cycleResult.progressUpdate` exists and a repository is supplied, save it before returning.
- Local runtime storage creates `FileBranchPlanProgressRepository` under a new `planningDir`.

## Task 5: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 5: Run focused and full verification**

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
