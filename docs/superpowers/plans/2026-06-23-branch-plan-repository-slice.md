# Branch Plan Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Branch-Thinking Planner plan definitions so worker cycles can resolve stable long-horizon plans by id instead of requiring every tick caller to inject an in-memory `BranchPlan`.

**Architecture:** `@aivilization/agent-runtime` owns the plan repository contract because `BranchPlan` is cognition runtime state. `apps/worker` keeps direct plan input for focused tests and simple callers, but adds a repository-backed `planId` path that composes with existing progress persistence. Local runtime storage exposes file-backed plan and progress repositories under the same partition `planning` directory.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path`, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

This slice makes long-horizon Branch-Thinking Planner definitions durable and addressable:

- Add `BranchPlanRecord` with `planId`, `agentId`, `plan`, `createdAt`, and `updatedAt`.
- Add `BranchPlanRepository` with `get`, `require`, and `save`.
- Add `InMemoryBranchPlanRepository`.
- Add `FileBranchPlanRepository` using append-only JSONL snapshots.
- Let `runWorkerAgentCycle` resolve `plan` from explicit input or `{ planRepository, planId }`.
- Let `runWorkerSimulationTick` pass repository-backed plan ids from tick agent inputs to agent cycles.
- Expose the file-backed plan repository through `createLocalWorldRuntimeStorage`.

It does not generate plans from LLMs, replace full plans during re-planning, or persist strategic human objectives. Those remain separate slices built on top of this stable plan-instance boundary.

## File Structure

- Add `packages/agent-runtime/src/branchPlanRepository.test.ts`: TDD coverage for in-memory and file-backed plan repositories.
- Add `packages/agent-runtime/src/branchPlanRepository.ts`: repository interface, record type, and adapters.
- Modify `packages/agent-runtime/src/index.ts`: export repository APIs.
- Modify `apps/worker/src/agentCycleRunner.test.ts`: worker resolves plans through repository.
- Modify `apps/worker/src/agentCycleRunner.ts`: optional repository-backed plan resolution.
- Modify `apps/worker/src/tickRunner.test.ts`: tick agent input can carry `planId` and use shared plan repository.
- Modify `apps/worker/src/tickRunner.ts`: thread plan repository and plan ids into cycle runner.
- Modify `apps/worker/src/localRuntimeStorage.test.ts`: local runtime exposes restart-safe branch plan repository.
- Modify `apps/worker/src/localRuntimeStorage.ts`: create file-backed branch plan repository.
- Modify this plan file as tasks complete.

## Task 1: Branch Plan Repository Tests

**Files:**

- Add: `packages/agent-runtime/src/branchPlanRepository.test.ts`

- [ ] **Step 1: Write failing tests for plan repositories**

Create tests that require:

- In-memory repository saves and returns defensive clones of `BranchPlanRecord`.
- Missing plans return `undefined` from `get` and throw from `require`.
- File repository recovers the latest saved plan after restart.
- Different agents and plan ids remain isolated.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: tests fail because branch plan repositories are missing.

## Task 2: Worker Agent Cycle Repository Tests

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.test.ts`

- [ ] **Step 2: Write failing tests for worker plan repository resolution**

Create a test that:

- Saves a `BranchPlanRecord` into `InMemoryBranchPlanRepository`.
- Calls `runWorkerAgentCycle` with `planRepository` and `planId`, without direct `plan`.
- Verifies the selected subtask and emitted world events came from the stored plan.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because `runWorkerAgentCycle` requires direct `plan`.

## Task 3: Worker Tick Repository Tests

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`

- [ ] **Step 3: Write failing tests for tick-level plan ids**

Create a test that:

- Saves two agent-specific plan records into a shared `InMemoryBranchPlanRepository`.
- Calls `runWorkerSimulationTick` with `planRepository` and agent inputs carrying `planId` instead of direct `plan`.
- Verifies both agents execute plans loaded by id and preserve cycle order.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because tick agent input only accepts direct `plan`.

## Task 4: Local Runtime Storage Tests

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.test.ts`

- [ ] **Step 4: Write failing tests for local file-backed plan storage**

Extend the restart test so it:

- Saves a branch plan through `storage.planRepository`.
- Recreates storage with the same root.
- Reads the plan back through `restarted.planRepository.require`.
- Confirms the plan is stored under `paths.planningDir` and remains distinct from progress records.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because local runtime storage does not expose `planRepository`.

## Task 5: Implementation

**Files:**

- Add: `packages/agent-runtime/src/branchPlanRepository.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`
- Modify: `apps/worker/src/tickRunner.ts`
- Modify: `apps/worker/src/localRuntimeStorage.ts`

- [ ] **Step 5: Implement repositories and worker wiring**

Behavior:

- `BranchPlanRepository.get({ planId, agentId })` returns the latest record for that key or `undefined`.
- `BranchPlanRepository.require({ planId, agentId })` returns the latest record or throws `branch plan <planId> for agent <agentId> was not found`.
- `BranchPlanRepository.save(record)` stores a defensive clone.
- File adapter writes to `branch-plans.jsonl`.
- Worker cycle resolves plans in this order: explicit `plan`, repository-loaded plan.
- If a cycle omits direct `plan`, both `planRepository` and `planId` are required.
- Tick runner passes shared `planRepository` to cycles and supports per-agent `planId`.
- Local runtime storage creates `FileBranchPlanRepository` under `planningDir`.

## Task 6: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 6: Run focused and full verification**

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
