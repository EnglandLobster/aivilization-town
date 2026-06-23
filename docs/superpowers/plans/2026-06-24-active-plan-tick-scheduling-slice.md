# Active Plan Tick Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a worker scheduling layer that turns active long-horizon objectives and durable branch plans into `WorkerTickAgentInput` entries for simulation ticks.

**Architecture:** Add a focused `apps/worker/src/agentScheduling.ts` module. It reads each agent in a world projection, loads that agent's active objective from `AgentIntentionRepository`, checks that the matching `BranchPlanRecord` exists in `BranchPlanRepository`, and returns deterministic tick agent inputs with `planId`, state summary, contextual signals, and injected runtime bindings. `runWorkerSimulationTick` remains an executor and does not learn repository scanning or scheduling policy.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/memory`, `@aivilization/world`, `apps/worker`.

---

## Scope

This slice connects durable plans to tick execution without adding queues or distributed workers:

- Add `buildWorkerTickAgentsFromActivePlans`.
- Add `WorkerAgentRuntimeBinding` and `WorkerAgentRuntimeResolver`.
- For every projected agent with an active objective and matching plan record, create a `WorkerTickAgentInput` with `planId`.
- Generate a deterministic observed-state summary from the current world projection.
- Convert active objective affinity tags into `ContextSignal[]` for contextual prioritization.
- Keep scheduler output sorted by agent id for deterministic tick ordering.
- Skip agents with no active objective, no matching plan record, or no runtime binding.

It does not execute the tick, own micro-planner registration, decide partition membership, or run a queue. Those remain separate backend orchestration slices.

## File Structure

- Add `apps/worker/src/agentScheduling.test.ts`: TDD coverage for active objective and plan scheduling.
- Add `apps/worker/src/agentScheduling.ts`: scheduler types and implementation.
- Modify `apps/worker/src/index.ts`: export scheduling APIs.
- Modify this plan file as tasks complete.

## Task 1: Scheduler Tests

**Files:**

- Add: `apps/worker/src/agentScheduling.test.ts`

- [ ] **Step 1: Write failing tests for active objective scheduling**

Create tests that require:

- Agents with active objectives and matching saved plan records become `WorkerTickAgentInput` entries using `planId`.
- Agents without active objectives are skipped.
- Agents with active objectives but no matching plan record are skipped.
- Agent entries are sorted by `agentId`.
- `observedStateSummary` includes energy, satiety, health, education, balance, residential tier, job, and inventory.
- Objective affinity tags become contextual signals with weight equal to objective priority.
- Missing runtime bindings skip the agent instead of throwing.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because `buildWorkerTickAgentsFromActivePlans` does not exist.

## Task 2: Scheduler Implementation

**Files:**

- Add: `apps/worker/src/agentScheduling.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 2: Implement active plan scheduler**

Behavior:

- `buildWorkerTickAgentsFromActivePlans(input)` returns a `Promise<readonly WorkerTickAgentInput[]>`.
- Inputs:
  - `projection: WorldProjection`
  - `intentionRepository: AgentIntentionRepository`
  - `planRepository: BranchPlanRepository`
  - `resolveRuntime: WorkerAgentRuntimeResolver`
- Iterate projected agents by sorted agent id.
- Load each intention state with `intentionRepository.getOrCreate(agentId)`.
- Skip if `activeObjective` is missing.
- Check `planRepository.get({ planId: activeObjective.id, agentId })`.
- Skip if no matching plan exists.
- Call `resolveRuntime({ agentId, agent, projection, activeObjective, planRecord })`.
- Skip if runtime binding is `undefined`.
- Return tick agent input with `planId: activeObjective.id`, generated summary, signals from objective affinity tags, and binding micro-planners/simulator/repair.

## Task 3: Focused Verification

**Files:**

- Modify: this plan file

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

Expected after implementation: worker tests and typecheck pass.

## Task 4: Full Verification

**Files:**

- Modify: this plan file

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.
