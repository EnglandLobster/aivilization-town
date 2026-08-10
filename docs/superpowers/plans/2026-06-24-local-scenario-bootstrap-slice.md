# Local Scenario Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a local worker bootstrap entrypoint that turns a content scenario preset into restart-safe runtime storage, baseline projection, checkpoint, and seeded long-term profiles.

**Architecture:** Keep content presets, world projections, memory repositories, and storage adapters separated. `apps/worker` owns this orchestration because it composes package boundaries for backend startup without adding domain rules.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, file-backed local runtime storage.

---

## Scope

This slice composes existing scenario projection, profile seeding, snapshot, checkpoint, and local runtime storage helpers.

It does not start a tick loop, schedule agents, create API endpoints, or introduce production database adapters.

## File Structure

- Create `apps/worker/src/localScenarioBootstrap.ts`: local scenario runtime bootstrap helper.
- Create `apps/worker/src/localScenarioBootstrap.test.ts`: focused restart-safety tests.
- Modify `apps/worker/src/index.ts`: export the helper.
- Create `docs/superpowers/plans/2026-06-24-local-scenario-bootstrap-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Bootstrap Tests

**Files:**

- Create: `apps/worker/src/localScenarioBootstrap.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that assert:

- `bootstrapLocalScenarioRuntime` creates file-backed storage, an 80-agent initial projection, seeded profile entries, and a sequence-0 snapshot/checkpoint.
- Re-running bootstrap for the same simulation skips profile seeding for already seeded agents and preserves the existing checkpoint.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- localScenarioBootstrap.test.ts
```

Expected: FAIL because the helper is not exported yet.

### Task 2: Bootstrap Helper

**Files:**

- Create: `apps/worker/src/localScenarioBootstrap.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Implement helper**

Add:

- `LocalScenarioRuntimeBootstrapInput`
- `LocalScenarioRuntimeBootstrapResult`
- `bootstrapLocalScenarioRuntime`

The helper should:

- call `createLocalWorldRuntimeStorage`
- call `createWorldProjectionFromScenario`
- call `seedLongTermProfilesFromScenario`
- save a sequence-0 projection snapshot and checkpoint when no checkpoint exists
- skip checkpoint creation when a checkpoint already exists

- [x] **Step 2: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- localScenarioBootstrap.test.ts
pnpm --filter @aivilization/worker typecheck
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
git add docs/superpowers/plans/2026-06-24-local-scenario-bootstrap-slice.md apps/worker/src/localScenarioBootstrap.ts apps/worker/src/localScenarioBootstrap.test.ts apps/worker/src/index.ts
git commit -m "feat: bootstrap local scenario runtimes"
```

## Self-Review

- Spec coverage: Provides a concrete backend startup seam for source-backed scenarios, profiles, projection snapshots, and restart-safe local storage.
- Boundary review: Worker owns orchestration; content, memory, world, and sim-core stay decoupled.
- Placeholder scan: No deferred implementation markers remain.
