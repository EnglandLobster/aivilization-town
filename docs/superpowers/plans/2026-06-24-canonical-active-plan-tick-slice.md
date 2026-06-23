# Canonical Active Plan Tick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a high-level worker tick entrypoint that runs canonical domain runtimes for agents with active durable plans.

**Architecture:** Keep `runWorkerSimulationTick` as the low-level executor that receives already-built tick agents. Add a new orchestration module in `apps/worker` that hydrates or accepts a projection, builds tick agents with `buildWorkerTickAgentsFromActivePlans`, wires `createCanonicalWorkerRuntimeResolver`, and then delegates to `runWorkerSimulationTick`. This gives API/server code one stable entrypoint without coupling it to micro-planner registration details.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/memory`, `@aivilization/sim-core`, `@aivilization/world`, `apps/worker`.

---

## Scope

This slice introduces canonical active-plan tick orchestration:

- Add `runCanonicalWorkerActivePlanTick`.
- Add `CanonicalWorkerActivePlanTickInput`.
- Support direct `projection`.
- Support `projectionHydration` by hydrating the scheduling projection before building tick agents.
- Require `planRepository` because generated tick agents use durable `planId`.
- Build tick agents from active objectives and saved branch plans.
- Use `createCanonicalWorkerRuntimeResolver` for default runtime binding.
- Pass canonical domain config, additional domain registrations, and repair policy through to the resolver.
- Delegate event dispatch, checkpointing, traces, memory writes, plan progress, and idempotency to `runWorkerSimulationTick`.

It does not change low-level tick execution, planner selection, event store semantics, or the world command handlers.

## File Structure

- Add `apps/worker/src/canonicalActivePlanTick.test.ts`: TDD coverage for direct projection and hydrated projection orchestration.
- Add `apps/worker/src/canonicalActivePlanTick.ts`: high-level active-plan tick entrypoint.
- Modify `apps/worker/src/index.ts`: export the orchestration API.
- Modify this plan file as tasks complete.

## Task 1: Orchestration Tests

**Files:**

- Add: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [ ] **Step 1: Write failing tests for canonical active-plan tick orchestration**

Create tests that require:

- A direct-projection call with one active study plan advances time and emits an `AgentStudy` command through the canonical runtime path.
- The same entrypoint can run a second tick from `projectionHydration`, continuing from the event stream and hydrated projection.
- Agents without active objectives or saved plans are not scheduled.
- The function throws the existing low-level `worker tick requires at least one agent` error when no active saved plan can produce tick agents.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because `runCanonicalWorkerActivePlanTick` does not exist.

## Task 2: Orchestration Implementation

**Files:**

- Add: `apps/worker/src/canonicalActivePlanTick.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 2: Implement canonical active-plan tick orchestration**

Behavior:

- Export `CanonicalWorkerActivePlanTickInput`.
- Export `runCanonicalWorkerActivePlanTick(input)`.
- Define the input as the same base dependencies as `runWorkerSimulationTick`, except callers provide no `agents`.
- Require `planRepository` in the high-level input.
- Accept either:
  - `{ projection }`
  - `{ projectionHydration }`
- Resolve the scheduling projection:
  - use `input.projection` when supplied.
  - otherwise call `hydrateWorldProjectionFromEventStream` with `initialProjection`, `eventStore`, `streamName`, optional `fromSequence`, optional `expectedVersion` as `toSequence`, and optional checkpoint lookup.
- Build agents with `buildWorkerTickAgentsFromActivePlans`.
- Use `createCanonicalWorkerRuntimeResolver` with:
  - `simulationId`
  - `policies`
  - optional `domainConfig`
  - optional `additionalRegistrations`
  - optional `repair`
  - `issuedAt`
  - `commandIdPrefix = ${tickId}-dry-run`
- Call `runWorkerSimulationTick` with the resolved scheduling projection, built agents, required repositories, optional checkpointing, optional trace sink, optional time delta, and optional expected version.

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
