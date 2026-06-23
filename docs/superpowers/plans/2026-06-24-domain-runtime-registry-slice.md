# Domain Runtime Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a worker-side domain runtime registry that resolves durable branch plans into domain micro-planners with a shared action simulator.

**Architecture:** `apps/worker` owns the registry because it composes runtime adapters, domain micro-planners, and world simulation policy for worker execution. The registry produces the `WorkerAgentRuntimeResolver` already consumed by `buildWorkerTickAgentsFromActivePlans`, keeping the scheduler generic and keeping `runWorkerSimulationTick` as an executor. Domain registrations provide micro-planners only; simulator and repair remain shared worker-level contracts.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

This slice adds the first reusable runtime registration surface:

- Add `createDomainRuntimeResolver`.
- Add `WorkerDomainRuntimeRegistration`.
- Match registrations against a `BranchPlanRecord` using branch ids, branch objectives, subtask ids, subtask descriptions, and subtask affinity tags.
- Return a `WorkerAgentRuntimeBinding` with matching micro-planners and the shared simulator/repair.
- Return `undefined` when no registered domain matches the plan.
- Validate registrations for empty domains, duplicate domains, and empty micro-planner lists.

It does not implement concrete study/work/trade/sleep/social micro-planners. Those domain adapters will register through this boundary in later slices.

## File Structure

- Add `apps/worker/src/domainRuntimeRegistry.test.ts`: TDD coverage for matching and validation.
- Add `apps/worker/src/domainRuntimeRegistry.ts`: registry types and resolver implementation.
- Modify `apps/worker/src/index.ts`: export registry APIs.
- Modify this plan file as tasks complete.

## Task 1: Registry Tests

**Files:**

- Add: `apps/worker/src/domainRuntimeRegistry.test.ts`

- [ ] **Step 1: Write failing tests for domain runtime registry**

Create tests that require:

- A plan containing `study` and `trade` domains resolves to those micro-planners only.
- Registration order is preserved in the resolved micro-planner list.
- The resolver returns the shared `simulate` and `repair` references.
- A plan with no matching domain returns `undefined`.
- Duplicate domains, empty domains, and empty micro-planner lists throw deterministic errors.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because `createDomainRuntimeResolver` does not exist.

## Task 2: Registry Implementation

**Files:**

- Add: `apps/worker/src/domainRuntimeRegistry.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 2: Implement domain runtime registry**

Behavior:

- `createDomainRuntimeResolver({ registrations, simulate, repair })` returns a `WorkerAgentRuntimeResolver`.
- Validate each registration:
  - `domain` must be non-empty after trimming.
  - domains must be unique after trimming.
  - `microPlanners` must contain at least one planner.
- Build a searchable lowercase text corpus from the plan record:
  - plan objective
  - branch ids and objectives
  - subtask ids and descriptions
  - subtask `intentionAffinityTags`, `memoryAffinityTags`, and `profileAffinityTags`
- A registration matches when the corpus contains the registration domain as a token.
- Return `undefined` if no registrations match.
- Return `{ microPlanners, simulate, repair }`, omitting `repair` when it is not supplied.

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
