# Worker Scenario Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a worker-owned adapter that converts content scenario presets into `WorldProjection` inputs for local simulation startup and experiment runners.

**Architecture:** Keep `@aivilization/content` as pure source config and `@aivilization/world` as projection/domain state. `apps/worker` composes both packages because runtime startup is an application concern, not a content or domain rule concern.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, worker orchestration modules.

---

## Scope

This slice maps scenario agent seeds, town locations, explicit market pool seeds, clock, and initial circulating money into a `WorldProjection`.

It does not persist simulations, create objectives, start tick loops, or inject worker economic policy constants.

## File Structure

- Create `apps/worker/src/scenarioProjection.ts`: adapter from content presets to world projections.
- Create `apps/worker/src/scenarioProjection.test.ts`: focused adapter tests.
- Modify `apps/worker/src/index.ts`: export the adapter.
- Create `docs/superpowers/plans/2026-06-24-worker-scenario-projection-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Scenario Projection Tests

**Files:**

- Create: `apps/worker/src/scenarioProjection.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that assert:

- `createWorldProjectionFromScenario` maps the AIvilization ablation preset into 80 agents and 7 locations.
- Explicit market pool seeds become projection AMM pools and exclude Gold Apple.
- Initial money supply defaults to the sum of agent balances and can be overridden.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- scenarioProjection.test.ts
```

Expected: FAIL because the adapter is not exported yet.

### Task 2: Scenario Projection Adapter

**Files:**

- Create: `apps/worker/src/scenarioProjection.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Implement adapter**

Add:

- `ScenarioProjectionInput`
- `createWorldProjectionFromScenario`

The adapter should pass only projection-relevant fields into `createWorldProjection`; profile seed data remains outside world state.

- [x] **Step 2: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- scenarioProjection.test.ts
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
git add docs/superpowers/plans/2026-06-24-worker-scenario-projection-slice.md apps/worker/src/scenarioProjection.ts apps/worker/src/scenarioProjection.test.ts apps/worker/src/index.ts
git commit -m "feat: map scenario presets to world projections"
```

## Self-Review

- Spec coverage: Makes content-owned scenario presets directly usable by backend startup code.
- Boundary review: Worker owns cross-package composition; content and world remain decoupled.
- Placeholder scan: No deferred implementation markers remain.
