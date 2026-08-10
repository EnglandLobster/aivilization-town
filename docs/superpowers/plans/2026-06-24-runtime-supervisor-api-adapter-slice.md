# Runtime Supervisor API Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the runtime supervisor control plane through a framework-agnostic API service and a worker-side local runtime adapter.

**Architecture:** Keep `apps/api` as the stable application boundary. It owns request DTOs, port contracts, and delegation semantics, while `apps/worker` adapts the existing local supervisor implementation into that contract. This preserves the dependency direction needed for future HTTP, RPC, CLI, Godot gateway, and distributed worker control adapters.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/api`, local runtime supervisor.

---

## Scope

This slice adds a runtime supervisor API service and a local worker adapter for status, bulk start/pause, and operation trace retrieval.

It does not add HTTP routes, authentication, scheduler daemons, WebSocket streaming, leases, or Godot protocol messages.

## File Structure

- Create `apps/api/src/runtimeSupervisorApi.ts`: framework-agnostic runtime supervisor API service and port contracts.
- Create `apps/api/src/runtimeSupervisorApi.test.ts`: behavior tests for delegation and boundary validation.
- Modify `apps/api/src/index.ts`: export runtime supervisor API service.
- Create `apps/worker/src/localSimulationRuntimeSupervisorApi.ts`: local supervisor adapter for the API service.
- Create `apps/worker/src/localSimulationRuntimeSupervisorApi.test.ts`: adapter tests.
- Modify `apps/worker/src/index.ts`: export the adapter.
- Create `docs/superpowers/plans/2026-06-24-runtime-supervisor-api-adapter-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing API Service Tests

**Files:**

- Create: `apps/api/src/runtimeSupervisorApi.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:

- `getRuntimeStatus` delegates to the injected runtime supervisor control port.
- `startRuntime` and `pauseRuntime` normalize bulk operation requests and delegate to the port.
- `getRuntimeOperationTrace` and `queryRuntimeOperationTraces` delegate trace reads without importing worker internals.
- Empty trace identifiers fail at the API boundary before hitting the port.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/api test -- runtimeSupervisorApi.test.ts
```

Expected: FAIL because `createRuntimeSupervisorApiService` is not exported yet.

### Task 2: API Service Implementation

**Files:**

- Create: `apps/api/src/runtimeSupervisorApi.ts`
- Modify: `apps/api/src/index.ts`

- [x] **Step 1: Implement generic runtime supervisor contracts**

Add:

- `RuntimeSupervisorOperationRequest`
- `RuntimeSupervisorOperationTraceRequest`
- `RuntimeSupervisorOperationTraceQuery`
- `RuntimeSupervisorControlPort`
- `RuntimeSupervisorApiService`
- `createRuntimeSupervisorApiService`

The service should own boundary validation and delegate execution to the injected port.

- [x] **Step 2: Verify green**

Run:

```bash
pnpm --filter @aivilization/api test -- runtimeSupervisorApi.test.ts
pnpm --filter @aivilization/api typecheck
```

Expected: PASS.

### Task 3: Local Worker Adapter

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeSupervisorApi.test.ts`
- Create: `apps/worker/src/localSimulationRuntimeSupervisorApi.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Write failing adapter test**

Add a focused test proving `createLocalSimulationRuntimeSupervisorApiService` exposes the local supervisor through the API service methods and preserves results.

- [x] **Step 2: Implement adapter**

Adapt `LocalSimulationRuntimeSupervisor` to `createRuntimeSupervisorApiService` without adding API-to-worker imports.

- [x] **Step 3: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeSupervisorApi.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
git diff --check
```

Expected: all commands pass.

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-runtime-supervisor-api-adapter-slice.md apps/api/src/index.ts apps/api/src/runtimeSupervisorApi.ts apps/api/src/runtimeSupervisorApi.test.ts apps/worker/src/index.ts apps/worker/src/localSimulationRuntimeSupervisorApi.ts apps/worker/src/localSimulationRuntimeSupervisorApi.test.ts
git commit -m "feat: add runtime supervisor api adapter"
```

## Self-Review

- Spec coverage: Raises the supervisor from a local worker implementation into a reusable backend control boundary.
- Boundary review: `apps/api` remains framework-agnostic and implementation-free; `apps/worker` owns the local adapter.
- Placeholder scan: No deferred implementation markers should remain.
