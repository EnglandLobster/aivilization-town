# Economic Runtime Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a reusable worker helper that bundles projection-backed world policy resolution with tick market-metric configuration for scenario presets and canonical worker entrypoints.

**Architecture:** Keep all formula coefficients explicit inputs. The helper composes existing `createProjectionBackedWorldCommandPolicySource` and `WorkerTickMarketMetricsInput` into one small runtime config object; it does not invent economic constants or mutate projections.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, worker orchestration modules.

---

## Scope

This slice adds a composition helper only. It covers policy resolver wiring, market metric baseline wiring, optional append idempotency key forwarding, exports, and focused tests.

It does not create durable scenario presets, hard-coded gameplay constants, or automatic baseline selection.

## File Structure

- Create `apps/worker/src/economicRuntime.ts`: projection-backed economic runtime config factory.
- Create `apps/worker/src/economicRuntime.test.ts`: focused tests for policy and market metric wiring.
- Modify `apps/worker/src/index.ts`: export the helper.
- Create `docs/superpowers/plans/2026-06-24-economic-runtime-config-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Economic Runtime Test

**Files:**

- Create: `apps/worker/src/economicRuntime.test.ts`

- [x] **Step 1: Write failing test**

Add a test that calls `createProjectionBackedEconomicRuntimeConfig`, resolves `runtime.policies(projection)`, and asserts:

```ts
expect(resolved.wageCalculator('Doctor')).toBeCloseTo(1824.3225);
expect(resolved.jobApplication?.populationEducationScores).toEqual([0, 50, 100, 150, 200, 250, 300, 350, 400, 450]);
expect(runtime.marketMetrics).toMatchObject({ baselineAt: 0 });
```

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- economicRuntime.test.ts
```

Expected: FAIL because the helper does not exist.

### Task 2: Runtime Config Implementation

**Files:**

- Create: `apps/worker/src/economicRuntime.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Implement helper**

Add:

```ts
export type ProjectionBackedEconomicRuntimeConfigInput = {
  readonly basePolicies: WorldCommandPolicies;
  readonly baselineProjection: WorldProjection;
  readonly baselineAt: SimulationTimestamp;
  readonly knowledgePremium: KnowledgePremiumFunction;
  readonly shortTermAdjustment?: number;
  readonly maxShortTermAdjustment?: number;
  readonly marketMetricAppendIdempotencyKey?: string;
};
```

Return `{ policies, marketMetrics }`, where `policies` is a `WorldCommandPolicyResolver`.

- [x] **Step 2: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- economicRuntime.test.ts
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
git add docs/superpowers/plans/2026-06-24-economic-runtime-config-slice.md apps/worker/src/economicRuntime.ts apps/worker/src/economicRuntime.test.ts apps/worker/src/index.ts
git commit -m "feat: add projection-backed economic runtime config"
```

## Self-Review

- Spec coverage: The plan improves reusable backend assembly for dynamic wages, dynamic job thresholds, and market metrics without collapsing domain boundaries.
- Boundary review: The helper composes existing worker seams and keeps scenario coefficients explicit.
- Placeholder scan: No deferred implementation markers remain.
