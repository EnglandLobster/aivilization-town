# Canonical Economic Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make canonical worker entrypoints compose projection-backed world policies and tick-level market metrics without caller-side boilerplate.

**Architecture:** Keep the world package policy-driven and keep formula logic in society/economy. Add a worker-side `createProjectionBackedWorldCommandPolicySource` factory for reusable projection-resolving policies, and pass `marketMetrics` through `runCanonicalWorkerActivePlanTick` into `runWorkerSimulationTick` so canonical active-plan ticks can record macro price-index events after canonical trade actions.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/world`, worker orchestration modules.

---

## Scope

This slice connects previously implemented lower-level pieces at the canonical worker boundary. It covers reusable projection-backed policy source creation and canonical active-plan tick market-metric propagation.

It does not add automatic baseline selection, scheduler cadence, durable scenario presets, dashboards, or new domain formulas.

## File Structure

- Modify `apps/worker/src/wagePolicy.ts`: add a projection-backed `WorldCommandPolicySource` factory.
- Modify `apps/worker/src/wagePolicy.test.ts`: prove the policy source resolves wages from the supplied projection.
- Modify `apps/worker/src/canonicalActivePlanTick.ts`: accept `marketMetrics` and pass it into `runWorkerSimulationTick`.
- Modify `apps/worker/src/canonicalActivePlanTick.test.ts`: prove canonical trade ticks append a market price-index event when metrics are configured.
- Create `docs/superpowers/plans/2026-06-24-canonical-economic-loop-slice.md`: track this implementation slice.

## Tasks

### Task 1: Projection-Backed Policy Source

**Files:**

- Modify: `apps/worker/src/wagePolicy.ts`
- Modify: `apps/worker/src/wagePolicy.test.ts`

- [x] **Step 1: Write failing test**

Add a test that imports `createProjectionBackedWorldCommandPolicySource`, resolves it against `createProjectionWithPriceIndices()`, and verifies `wageCalculator('Doctor')` returns `expectedDoctorWage`.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- wagePolicy.test.ts
```

Expected: FAIL because the helper is not exported.

- [x] **Step 3: Implement helper**

Add:

```ts
export type ProjectionBackedWorldCommandPolicySourceInput =
  Omit<ProjectionBackedWorldCommandPoliciesInput, 'projection'>;

export function createProjectionBackedWorldCommandPolicySource(
  input: ProjectionBackedWorldCommandPolicySourceInput,
): WorldCommandPolicySource;
```

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- wagePolicy.test.ts
```

Expected: PASS.

### Task 2: Canonical Tick Market Metrics

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [x] **Step 1: Write failing test**

Add a canonical active-plan test that runs a trade subtask with:

```ts
marketMetrics: { baselineProjection, baselineAt: 0 }
```

and expects the final event list to include `MarketPriceIndexRecorded`.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
```

Expected: FAIL because canonical active-plan ticks do not pass `marketMetrics` to the lower tick runner.

- [x] **Step 3: Implement propagation**

Import `WorkerTickMarketMetricsInput`, add `marketMetrics?: WorkerTickMarketMetricsInput` to `CanonicalWorkerActivePlanTickBaseInput`, and pass it through to `runWorkerSimulationTick` only when defined.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
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
git add docs/superpowers/plans/2026-06-24-canonical-economic-loop-slice.md apps/worker/src/wagePolicy.ts apps/worker/src/wagePolicy.test.ts apps/worker/src/canonicalActivePlanTick.ts apps/worker/src/canonicalActivePlanTick.test.ts
git commit -m "feat: wire canonical economic loop"
```

## Self-Review

- Spec coverage: The plan strengthens the labor-consumption/market feedback loop by making canonical worker ticks able to record macro price indices and expose projection-backed policies as a reusable source.
- Boundary review: Worker composes policies and metric scheduling; society/economy/world ownership stays unchanged.
- Placeholder scan: No deferred implementation markers remain.
