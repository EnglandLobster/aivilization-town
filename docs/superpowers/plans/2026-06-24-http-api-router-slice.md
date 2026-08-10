# HTTP API Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a framework-agnostic HTTP-shaped router for simulation control, human steering, and runtime supervisor operations.

**Architecture:** Keep `apps/api` as the external server boundary without binding it to Express, Fastify, Hono, Node `http`, or worker implementations. The router accepts plain request objects, delegates to injected `SimulationApiService` and `RuntimeSupervisorApiService` instances, and returns plain JSON response objects. Future Node servers, Godot gateways, test clients, or RPC adapters can wrap this handler without changing domain or worker code.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/api`, `@aivilization/sim-core`.

---

## Scope

This slice adds an HTTP-shaped router contract and tests for:

- projection queries
- long-horizon objective submission
- reactive command submission
- partition lifecycle controls
- runtime supervisor status, bulk start/pause, and operation trace reads

It does not add a real network listener, authentication, WebSocket streaming, request body parsers, CORS, rate limiting, or Godot-specific protocol messages.

## File Structure

- Create `apps/api/src/httpApi.ts`: plain request/response contracts, route matching, request validation, and delegation.
- Create `apps/api/src/httpApi.test.ts`: route behavior tests with injected fake services.
- Modify `apps/api/src/index.ts`: export the HTTP router.
- Create `docs/superpowers/plans/2026-06-24-http-api-router-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Router Tests

**Files:**

- Create: `apps/api/src/httpApi.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:

- `GET /simulations/:simulationId/partitions/:partitionKey/projection` delegates to `simulation.getProjection`.
- `POST /simulations/:simulationId/partitions/:partitionKey/objectives` injects path ids into the body and delegates to `simulation.submitLongHorizonObjective`.
- `POST /simulations/:simulationId/partitions/:partitionKey/reactive-commands` delegates to `simulation.submitReactiveCommand`.
- `POST /simulations/:simulationId/partitions/:partitionKey/start` delegates to `simulation.startSimulation`.
- Runtime supervisor routes delegate to `runtimeSupervisor`.
- Unknown routes return `404`, wrong methods return `405`, and invalid request bodies return `400`.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/api test -- httpApi.test.ts
```

Expected: FAIL because `createTownHttpApiHandler` is not exported yet.

### Task 2: Router Implementation

**Files:**

- Create: `apps/api/src/httpApi.ts`
- Modify: `apps/api/src/index.ts`

- [x] **Step 1: Implement plain request/response contracts**

Add:

- `TownHttpApiRequest`
- `TownHttpApiResponse`
- `TownHttpApiHandler`
- `TownHttpApiServices`
- `createTownHttpApiHandler`

The handler should not import worker implementations or concrete HTTP framework types.

- [x] **Step 2: Implement route matching and validation**

Support:

- `GET /simulations/:simulationId/partitions/:partitionKey/projection`
- `POST /simulations/:simulationId/partitions/:partitionKey/objectives`
- `POST /simulations/:simulationId/partitions/:partitionKey/reactive-commands`
- `POST /simulations/:simulationId/partitions/:partitionKey/start`
- `POST /simulations/:simulationId/partitions/:partitionKey/pause`
- `POST /simulations/:simulationId/partitions/:partitionKey/reset`
- `POST /simulations/:simulationId/partitions/:partitionKey/replay`
- `GET /runtime/status`
- `POST /runtime/start`
- `POST /runtime/pause`
- `GET /runtime/operation-traces/:traceId`
- `GET /runtime/operation-traces`

- [x] **Step 3: Verify green**

Run:

```bash
pnpm --filter @aivilization/api test -- httpApi.test.ts
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
git add docs/superpowers/plans/2026-06-24-http-api-router-slice.md apps/api/src/index.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts
git commit -m "feat: add town http api router"
```

## Self-Review

- Spec coverage: Adds the external API adapter layer called for by the large-game backend plan without introducing UI or concrete network infrastructure.
- Boundary review: API owns route normalization; worker/domain packages stay behind injected service contracts.
- Placeholder scan: No deferred implementation markers should remain.
