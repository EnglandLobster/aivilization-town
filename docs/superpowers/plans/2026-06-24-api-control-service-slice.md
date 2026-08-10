# API Control Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a framework-agnostic API control service for projection queries, human steering commands, and simulation lifecycle operations.

**Architecture:** Keep `apps/api` as an application boundary that normalizes external requests into command envelopes and delegates to injected ports. It must not import worker runtime implementations or mutate world projections directly.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`.

---

## Scope

This slice adds an API application service and tests. It provides ports for projection reads, steering command submission, and lifecycle controls.

It does not add HTTP routing, authentication, WebSocket streaming, or a Godot client protocol.

## File Structure

- Create `apps/api/vitest.config.ts`: API test project configuration.
- Create `apps/api/src/simulationApi.ts`: framework-agnostic API service and port contracts.
- Create `apps/api/src/simulationApi.test.ts`: focused API service tests.
- Modify `apps/api/package.json`: add test script.
- Modify `apps/api/src/index.ts`: export API service.
- Create `docs/superpowers/plans/2026-06-24-api-control-service-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing API Service Tests

**Files:**

- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/simulationApi.test.ts`
- Modify: `apps/api/package.json`

- [x] **Step 1: Write failing tests**

Add tests that assert:

- `submitLongHorizonObjective` creates a `SetLongHorizonObjective` command envelope and delegates it to the steering port.
- `submitReactiveCommand` creates an `IssueReactiveCommand` command envelope.
- Projection and lifecycle methods delegate to their injected ports without importing worker internals.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/api test -- simulationApi.test.ts
```

Expected: FAIL because `createSimulationApiService` is not exported yet.

### Task 2: API Service Implementation

**Files:**

- Create: `apps/api/src/simulationApi.ts`
- Modify: `apps/api/src/index.ts`

- [x] **Step 1: Implement service and ports**

Add:

- `ProjectionQueryPort`
- `SteeringCommandSubmissionPort`
- `SimulationLifecyclePort`
- `createSimulationApiService`

The service should create command envelopes with `source: 'human'` for human steering and leave execution to the injected port.

- [x] **Step 2: Verify green**

Run:

```bash
pnpm --filter @aivilization/api test -- simulationApi.test.ts
pnpm --filter @aivilization/api typecheck
```

Expected: PASS.

### Task 3: Verification And Commit

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
git add docs/superpowers/plans/2026-06-24-api-control-service-slice.md apps/api/package.json apps/api/vitest.config.ts apps/api/src/index.ts apps/api/src/simulationApi.ts apps/api/src/simulationApi.test.ts
git commit -m "feat: add simulation api control service"
```

## Self-Review

- Spec coverage: Starts the API-owned backend control surface named by the architecture spec.
- Boundary review: API uses injected ports and command envelopes; worker/domain runtime implementations remain outside this package.
- Placeholder scan: No deferred implementation markers remain.
