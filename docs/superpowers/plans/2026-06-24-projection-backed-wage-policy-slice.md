# Projection-Backed Wage Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a worker-side wage policy adapter that derives `AgentWork` wages from the current world projection, latest macro price index, and society wage formulas.

**Architecture:** Keep `packages/society` as the owner of wage formulas and keep `packages/world` command handlers policy-driven. Add a focused worker adapter that turns projection state into a `WorldCommandPolicies.wageCalculator`, so scheduled ticks and future runtime builders can refresh wage policy without coupling world handlers to macroeconomic projection details.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/world`, `@aivilization/society`.

---

## Scope

This slice wires existing society wage formulas into runtime policy creation. It covers static wages for lower occupation tiers, dynamic wages for higher occupation tiers, latest market price index selection, population education score extraction, and end-to-end `AgentWork` command dispatch through a derived policy.

It does not add new wage formulas, UI surfaces, durable configuration storage, or automatic tick-runner policy refresh. The adapter is intentionally pure and explicit so later scenario presets can own formula coefficients.

## File Structure

- Create `apps/worker/src/wagePolicy.ts`: projection-backed wage calculator and full policy composition helper.
- Create `apps/worker/src/wagePolicy.test.ts`: adapter tests and `AgentWork` integration through world dispatch.
- Modify `apps/worker/src/index.ts`: export wage policy helpers.
- Modify `apps/worker/package.json`: declare the direct `@aivilization/society` dependency used by the worker adapter.
- Modify `packages/society/src/index.ts`: export occupation catalog resolvers as the society-owned boundary for wage regime lookup.

## Tasks

### Task 1: Projection Wage Calculator Tests

**Files:**

- Create: `apps/worker/src/wagePolicy.test.ts`
- Modify: `docs/superpowers/plans/2026-06-24-projection-backed-wage-policy-slice.md`

- [x] **Step 1: Write failing tests**

Add tests that call `createProjectionBackedWageCalculator` and verify these behaviors:

```ts
expect(calculator('Cleaner')).toBe(750);
expect(calculator('Doctor')).toBeCloseTo(1824.3225);
expect(() =>
  createProjectionBackedWageCalculator({
    projection,
    knowledgePremium: (effectiveKnowledgeThreshold) => 1 + effectiveKnowledgeThreshold / 1000,
  }),
).toThrow(/market price index/i);
```

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- wagePolicy.test.ts
```

Expected: FAIL because `createProjectionBackedWageCalculator` is not exported.

### Task 2: Projection Wage Calculator Implementation

**Files:**

- Create: `apps/worker/src/wagePolicy.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/package.json`
- Modify: `packages/society/src/index.ts`

- [x] **Step 1: Implement helper API**

Create this public API:

```ts
export type ProjectionBackedWagePolicyInput = {
  readonly projection: WorldProjection;
  readonly knowledgePremium: KnowledgePremiumFunction;
  readonly shortTermAdjustment?: number;
  readonly maxShortTermAdjustment?: number;
};

export function createProjectionBackedWageCalculator(
  input: ProjectionBackedWagePolicyInput,
): (occupationName: string) => number;
```

- [x] **Step 2: Run focused worker tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- wagePolicy.test.ts
```

Expected: PASS.

### Task 3: World Policy Composition Integration

**Files:**

- Modify: `apps/worker/src/wagePolicy.ts`
- Modify: `apps/worker/src/wagePolicy.test.ts`

- [x] **Step 1: Write failing integration test**

Add `createProjectionBackedWorldCommandPolicies` and verify dispatching `AgentWork` pays the projection-derived wage:

```ts
const policies = createProjectionBackedWorldCommandPolicies({
  basePolicies,
  projection,
});
const events = dispatchWorldCommand({ command, projection, policies, nextSequence: 1 });
expect(events[0]).toMatchObject({
  type: 'WagePaid',
  payload: { amount: 1891.54275 },
});
```

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- wagePolicy.test.ts
```

Expected: FAIL because `createProjectionBackedWorldCommandPolicies` is not exported.

- [x] **Step 3: Implement composition helper**

Add this public API:

```ts
export function createProjectionBackedWorldCommandPolicies(input: {
  readonly basePolicies: WorldCommandPolicies;
  readonly projection: WorldProjection;
  readonly knowledgePremium: KnowledgePremiumFunction;
  readonly shortTermAdjustment?: number;
  readonly maxShortTermAdjustment?: number;
}): WorldCommandPolicies;
```

- [x] **Step 4: Run focused worker tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- wagePolicy.test.ts
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
git add docs/superpowers/plans/2026-06-24-projection-backed-wage-policy-slice.md apps/worker/package.json apps/worker/src/index.ts apps/worker/src/wagePolicy.ts apps/worker/src/wagePolicy.test.ts packages/society/src/index.ts
git commit -m "feat: derive wages from world projection"
```

## Self-Review

- Spec coverage: The plan wires macro price index and effective knowledge threshold inputs into runtime wage policy for static and dynamic occupation regimes.
- Boundary review: Society owns formulas, world owns command validation/event emission, and worker owns runtime policy assembly.
- Placeholder scan: No deferred implementation markers remain.
