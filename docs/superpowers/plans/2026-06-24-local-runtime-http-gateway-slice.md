# Local Runtime HTTP Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a process-level local runtime HTTP gateway that composes the API router, Node server adapter, local runtime host, and local runtime supervisor.

**Architecture:** Keep `apps/api` as transport and API routing, keep `apps/worker` as runtime orchestration, and introduce `apps/server` as the composition boundary. The server app wires local manifests into a host, creates a supervisor API service, builds the town HTTP handler, and returns a Node server ready to listen. This preserves dependency direction while giving the backend a real runnable process seam.

**Tech Stack:** TypeScript, Vitest, Node `http`, pnpm workspaces, `@aivilization/api`, `@aivilization/worker`.

---

## Scope

This slice adds:

- `@aivilization/server` package shell
- a local runtime API composition factory
- a local runtime Node HTTP server factory
- integration tests that hit a real ephemeral HTTP server with `fetch`

It does not add CLI flags, environment file loading, authentication, TLS, streaming, distributed worker leases, cloud deployment config, or live LLM provider setup.

## File Structure

- Create `apps/server/package.json`: workspace package metadata and scripts.
- Create `apps/server/tsconfig.json`: TypeScript project config.
- Create `apps/server/vitest.config.ts`: Vitest config with workspace aliases.
- Create `apps/server/src/index.ts`: server app exports.
- Create `apps/server/src/localRuntimeTownServer.ts`: local runtime API/server composition.
- Create `apps/server/src/localRuntimeTownServer.test.ts`: end-to-end local runtime HTTP tests.
- Modify `tsconfig.base.json`: add `@aivilization/server` path alias.
- Modify `vitest.workspace-aliases.ts`: add API, worker, and server aliases for source-level workspace tests.
- Create `docs/superpowers/plans/2026-06-24-local-runtime-http-gateway-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Server Package Test

**Files:**

- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/vitest.config.ts`
- Create: `apps/server/src/localRuntimeTownServer.test.ts`

- [x] **Step 1: Write failing integration test**

Add a test proving:

- `createLocalRuntimeTownNodeHttpServer` bootstraps a manifest-backed local runtime.
- `GET /runtime/status` exposes supervisor state.
- `GET /simulations/:simulationId/partitions/:partitionKey/projection` exposes hydrated projection state.
- `POST /runtime/start` starts all hosted partitions and records a trace.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

Expected: FAIL because `createLocalRuntimeTownNodeHttpServer` is not implemented or exported yet.

### Task 2: Server Composition Implementation

**Files:**

- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/localRuntimeTownServer.ts`
- Modify: `tsconfig.base.json`
- Modify: `vitest.workspace-aliases.ts`

- [x] **Step 1: Implement local runtime API composition**

Add:

- `LocalRuntimeTownServerInput`
- `LocalRuntimeTownApi`
- `createLocalRuntimeTownApi`

`createLocalRuntimeTownApi` should bootstrap `LocalSimulationRuntimeHost`, create `LocalSimulationRuntimeSupervisor`, adapt it with `createLocalSimulationRuntimeSupervisorApiService`, and build `createTownHttpApiHandler`.

- [x] **Step 2: Implement Node HTTP server composition**

Add:

- `LocalRuntimeTownNodeHttpServer`
- `createLocalRuntimeTownNodeHttpServer`

It should call `createLocalRuntimeTownApi` and wrap the returned handler with `createTownNodeHttpServer`.

- [x] **Step 3: Verify green**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
pnpm --filter @aivilization/server typecheck
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
git add docs/superpowers/plans/2026-06-24-local-runtime-http-gateway-slice.md apps/server package.json pnpm-workspace.yaml tsconfig.base.json vitest.workspace-aliases.ts
git commit -m "feat: add local runtime http gateway"
```

## Self-Review

- Spec coverage: Adds a runnable backend process seam for the already-built API and local runtime layers.
- Boundary review: `apps/api` remains worker-agnostic; `apps/worker` remains transport-agnostic; `apps/server` owns composition.
- Placeholder scan: No deferred implementation markers should remain.
