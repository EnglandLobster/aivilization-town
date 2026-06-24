# Local Runtime Orchestration Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract local runtime daemon composition into a dedicated orchestration profile boundary so the HTTP server no longer owns queue worker, scheduler, and recovery construction details.

**Architecture:** Add `apps/server/src/localRuntimeTownOrchestration.ts` as the local composition layer for run queue repository, worker host, scheduler host, recovery host, and API adapters. Keep `localRuntimeTownServer.ts` focused on host bootstrap, HTTP handler creation, Node server wrapping, and lifecycle delegation to orchestration start/stop helpers.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing local runtime worker and API adapters.

---

### Task 1: Orchestration Module Contract

**Files:**

- Create: `apps/server/src/localRuntimeTownOrchestration.test.ts`
- Create: `apps/server/src/localRuntimeTownOrchestration.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/localRuntimeTownOrchestration.test.ts` with a test that bootstraps a local runtime host, creates a supervisor, calls `createLocalRuntimeTownOrchestration`, schedules a run through `runtimeSchedulerApi`, drains it through `runtimeRecoveryApi`, and verifies the completed run job through `runtimeRunQueueApi`.

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownOrchestration.test.ts`

Expected: FAIL because `createLocalRuntimeTownOrchestration` is not exported.

- [ ] **Step 3: Implement the module**

Create the orchestration input/profile types, construct the shared file-backed run queue repository under `host.rootDir/operations`, build run queue worker host, optional scheduler host, optional recovery host, and their API adapters.

- [ ] **Step 4: Run test to verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownOrchestration.test.ts`

Expected: PASS.

### Task 2: Server Delegates To Orchestration

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [ ] **Step 1: Write failing server lifecycle coverage**

Add coverage that `createLocalRuntimeTownNodeHttpServer` returns `runtimeOrchestration`, auto-starts configured daemon hosts via orchestration helpers, and stops them when the node server closes.

- [ ] **Step 2: Run server tests and verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: FAIL until the server exposes and delegates through `runtimeOrchestration`.

- [ ] **Step 3: Refactor server wiring**

Remove direct queue/scheduler/recovery construction from `localRuntimeTownServer.ts`. Call `createLocalRuntimeTownOrchestration`, pass its API services into `createTownHttpApiHandler`, expose existing compatibility fields plus the new `runtimeOrchestration`, and delegate start/stop lifecycle to `startLocalRuntimeTownOrchestration` and `stopLocalRuntimeTownOrchestration`.

- [ ] **Step 4: Run server tests and verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- Modify: all files above

- [ ] **Step 1: Format touched files**

Run: `pnpm exec prettier --write docs/superpowers/plans/2026-06-25-local-runtime-orchestration-profile-slice.md apps/server/src/localRuntimeTownOrchestration.ts apps/server/src/localRuntimeTownOrchestration.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts apps/server/src/index.ts`

- [ ] **Step 2: Run focused and full verification**

Run: `pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test -- localRuntimeTownOrchestration.test.ts localRuntimeTownServer.test.ts && pnpm lint && pnpm typecheck && pnpm test && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-local-runtime-orchestration-profile-slice.md apps/server/src/localRuntimeTownOrchestration.ts apps/server/src/localRuntimeTownOrchestration.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts apps/server/src/index.ts
git commit -m "feat: add local runtime orchestration profile"
```
