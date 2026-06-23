# Contextual Domain Runtime Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow worker domain runtime registrations to build micro-planners from the current agent, world projection, objective, and branch plan context.

**Architecture:** Keep `@aivilization/agent-runtime` generic and let `apps/worker` own world-aware composition. The registry still returns the existing `WorkerAgentRuntimeResolver`, but each matching domain may now either provide static micro-planners or a factory that receives the resolver input and returns context-bound micro-planners. This enables later study/work/trade/sleep/social adapters to use current world state without coupling the core cycle package to the world package.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

This slice evolves the worker-side runtime registration surface:

- Add `WorkerDomainRuntimeFactory`.
- Let `WorkerDomainRuntimeRegistration` accept either `microPlanners` or `createMicroPlanners`.
- Pass `agentId`, `agent`, `projection`, `activeObjective`, and `planRecord` into factories.
- Preserve registration-order planner aggregation across static and factory registrations.
- Preserve static registration behavior and validation.
- Reject registrations that provide both static micro-planners and a factory.
- Reject factory registrations that return an empty planner list for a matched domain.

It does not implement concrete domain adapters yet. The next slice can add canonical study/work/trade/sleep/social adapters on top of this factory boundary.

## File Structure

- Modify `apps/worker/src/domainRuntimeRegistry.test.ts`: add factory behavior and validation coverage.
- Modify `apps/worker/src/domainRuntimeRegistry.ts`: add factory registration support.
- Modify this plan file as tasks complete.

## Task 1: Factory Registration Tests

**Files:**

- Modify: `apps/worker/src/domainRuntimeRegistry.test.ts`

- [ ] **Step 1: Write failing tests for contextual domain factories**

Add tests that require:

- A matching factory receives the same resolver context object fields: `agentId`, `agent`, `projection`, `activeObjective`, and `planRecord`.
- Static and factory registrations aggregate micro-planners in registration order.
- A non-matching factory is not called.
- A registration that provides both `microPlanners` and `createMicroPlanners` throws `domain runtime registration study cannot define both microPlanners and createMicroPlanners`.
- A matching factory that returns an empty array rejects with `domain runtime registration study requires at least one micro-planner`.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because `createMicroPlanners` is not part of `WorkerDomainRuntimeRegistration`.

## Task 2: Factory Implementation

**Files:**

- Modify: `apps/worker/src/domainRuntimeRegistry.ts`

- [ ] **Step 2: Implement context-aware runtime factories**

Behavior:

- Export `WorkerDomainRuntimeFactory`.
- Define `WorkerDomainRuntimeRegistration` as either:
  - `{ domain, microPlanners }`
  - `{ domain, createMicroPlanners }`
- Normalize registrations into a discriminated internal form.
- Validate each registration:
  - `domain` must be non-empty after trimming.
  - domains must be unique after trimming and lowercasing.
  - static `microPlanners` must contain at least one planner.
  - exactly one of `microPlanners` or `createMicroPlanners` must be provided.
- When resolving:
  - build the plan token set once.
  - skip non-matching registrations.
  - append static micro-planners as-is.
  - call matching factories with the full resolver input.
  - await factory results.
  - reject empty factory results with the same deterministic empty-planner error.
- Continue returning `undefined` when no matching registration contributes planners.

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
