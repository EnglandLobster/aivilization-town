# Counterfactual Dry-Run Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make canonical world dry-run simulation validate action sequences against a cumulative counterfactual projection.

**Architecture:** `apps/worker` keeps the dry-run adapter as the boundary between agent-runtime and world rules. The simulator closure owns an internal `rolloutProjection`, dispatches candidate commands through existing world handlers, and replays accepted dry-run events with `applyWorldEvent`.

**Tech Stack:** TypeScript, Vitest, `@aivilization/world`, `apps/worker`.

---

## Scope

- Add a dry-run sequence test proving accepted events affect later dry-run actions.
- Update `createWorldCommandDryRunSimulator` to maintain a counterfactual projection.
- Preserve the existing simulator return shape and rejection behavior.
- Run focused and full verification.

## Task 1: Dry-Run Rollout Test

**Files:**

- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`

- [x] **Step 1: Write failing sequence test**

Add a test that:

- creates a projection where `agent-a` has `{ Apple: 1 }`;
- creates one `createWorldCommandDryRunSimulator` instance;
- simulates `AgentEat` with `Apple` twice;
- expects the first result to be accepted;
- expects the second result to be rejected because the first dry-run consumed the only Apple.

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts
```

Expected: FAIL because both dry-runs currently use the original projection.

Observed: FAIL, the second `AgentEat` dry-run was still accepted.

## Task 2: Counterfactual Projection Rollout

**Files:**

- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`

- [x] **Step 2: Implement rollout projection**

In `createWorldCommandDryRunSimulator`:

- import `applyWorldEvent`;
- initialize `let rolloutProjection = config.projection`;
- dispatch commands against `rolloutProjection`;
- resolve policies against `rolloutProjection`;
- when no `ActionRejected` event is emitted, update `rolloutProjection` by reducing emitted events
  through `applyWorldEvent`.

- [x] **Step 3: Verify focused worker test**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

## Task 3: Verification And Commit

**Files:**

- Modify: this plan file.

- [x] **Step 4: Run full verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: PASS.

- [x] **Step 5: Inspect diff**

Confirm the diff is limited to:

- design and plan docs;
- `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`;
- `apps/worker/src/canonicalWorkerRuntimeResolver.ts`.

- [x] **Step 6: Commit**

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-counterfactual-dry-run-rollout-design.md docs/superpowers/plans/2026-06-25-counterfactual-dry-run-rollout-slice.md apps/worker/src/canonicalWorkerRuntimeResolver.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts
git commit -m "feat: roll out dry-run world simulation"
```
