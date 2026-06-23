# Canonical Worker Runtime Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default worker runtime resolver that wires canonical domain adapters to a world-command dry-run simulator.

**Architecture:** Keep domain adapters focused on proposing candidate actions, and add a separate worker composition module that binds those adapters to server-authoritative world command validation. The resolver delegates domain matching to `createDomainRuntimeResolver`, then replaces the placeholder simulator with a context-bound simulator that calls `dispatchWorldCommand` against the current projection without appending events. This gives active branch plans a real default runtime path while preserving extension seams for custom registrations and repair policy.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/sim-core`, `@aivilization/world`, `apps/worker`.

---

## Scope

This slice introduces the first default runtime composition entrypoint:

- Add `createCanonicalWorkerRuntimeResolver`.
- Add `createWorldCommandDryRunSimulator`.
- Compose `createCanonicalDomainRuntimeRegistrations` with optional `additionalRegistrations`.
- Preserve `repair` by returning it on runtime bindings.
- Bind the simulator to each resolver context so it uses the current `agentId`, `projection`, and world policies.
- Simulate actions through `dispatchWorldCommand`.
- Accept actions when the dry run produces no `ActionRejected` event.
- Reject actions with the world rejection reason when an `ActionRejected` event appears.
- Reject actions with thrown world errors when command dispatch throws.

It does not change event dispatch, tick ordering, durable storage, or domain policy selection.

## File Structure

- Add `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`: TDD coverage for scheduling integration and dry-run simulator behavior.
- Add `apps/worker/src/canonicalWorkerRuntimeResolver.ts`: default canonical runtime resolver and world dry-run simulator.
- Modify `apps/worker/src/index.ts`: export resolver APIs.
- Modify this plan file as tasks complete.

## Task 1: Resolver Tests

**Files:**

- Add: `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`

- [x] **Step 1: Write failing tests for canonical worker runtime resolver**

Create tests that require:

- `buildWorkerTickAgentsFromActivePlans` can use `createCanonicalWorkerRuntimeResolver` to build a tick agent for an active study plan.
- The returned binding uses canonical planners and preserves a supplied `repair` reference.
- The context-bound simulator accepts a valid `AgentStudy` action.
- The simulator rejects an invalid `AgentTrade` action with the world reason `missing AMM pool for Ghost`.
- A plan with no canonical or additional domain match returns `undefined`.
- `additionalRegistrations` can add a custom domain planner after canonical registrations.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because `createCanonicalWorkerRuntimeResolver` does not exist.

Observed before implementation: `pnpm --filter @aivilization/worker test` failed because
`createCanonicalWorkerRuntimeResolver` and `createWorldCommandDryRunSimulator` were not exported.

## Task 2: Resolver Implementation

**Files:**

- Add: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 2: Implement canonical worker runtime resolver**

Behavior:

- Export `CanonicalWorkerRuntimeResolverConfig`.
- Export `WorldCommandDryRunSimulatorConfig`.
- Export `createCanonicalWorkerRuntimeResolver(config)`.
- Export `createWorldCommandDryRunSimulator(config)`.
- `createCanonicalWorkerRuntimeResolver` must:
  - create canonical registrations from `config.domainConfig`.
  - append `config.additionalRegistrations ?? []`.
  - use `createDomainRuntimeResolver` to perform plan-domain matching.
  - return `undefined` when the registry returns `undefined`.
  - return a binding with registry micro-planners, a context-bound dry-run simulator, and optional repair.
- `createWorldCommandDryRunSimulator` must:
  - build a command envelope from the candidate action.
  - use `source: 'agent-runtime'`.
  - use the provided `simulationId`, `agentId`, `projection`, `policies`, `issuedAt`, `nextSequence`, and `commandIdPrefix`.
  - default `issuedAt` to `projection.clock.now`.
  - default `nextSequence` to `1`.
  - default `commandIdPrefix` to `canonical-runtime-dry-run`.
  - call `dispatchWorldCommand`.
  - return rejected with the `ActionRejected` reason when present.
  - catch thrown errors and return rejected with the error message.
  - otherwise return accepted.

Observed after implementation:

- `pnpm --filter @aivilization/worker test` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [x] **Step 3: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

Observed verification:

- `pnpm --filter @aivilization/worker test` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.
- `pnpm check` passed.
- `pnpm build` passed.
