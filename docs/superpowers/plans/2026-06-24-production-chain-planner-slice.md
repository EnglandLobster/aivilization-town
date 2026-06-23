# Production Chain Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure economy production-chain planner that expands target commodities into dependency ordered production steps with cumulative resource budgets.

**Architecture:** `@aivilization/economy` owns recipe dependency reasoning because it already owns production constraints and imports source-derived content tables. `planProduction` remains the executable single-step validator; `planProductionChain` adds deterministic multi-step planning without touching worker progress semantics.

**Tech Stack:** TypeScript, Vitest, `@aivilization/content`, `@aivilization/economy`.

---

## Scope

This slice adds:

- catalog-resolution sharing for production rules;
- `planProductionChain`;
- unit tests for dependency ordering, inventory reuse, shared intermediate aggregation, gates, and
  cumulative budgets.

It does not change worker runtime, active-plan completion, world commands, market trading, or UI.

## File Structure

- Modify `packages/economy/src/production.ts`: expose reusable production definition resolution.
- Create `packages/economy/src/productionChain.ts`: pure chain planner.
- Create `packages/economy/src/productionChain.test.ts`: TDD coverage for chain behavior.
- Modify `packages/economy/src/index.ts`: export the chain planner.

## Task 1: Red Tests

**Files:**

- Create: `packages/economy/src/productionChain.test.ts`

- [x] **Step 1: Write failing dependency-order and inventory-reuse tests**

Add tests that import `planProductionChain` from `./index` and assert:

```ts
const baseAgent = {
  residentialTier: 5,
  energy: 500,
  satiety: 500,
  availableLaborSeconds: 500,
  inventory: {},
} satisfies ProductionAgentState;

expect(planProductionChain({
  commodityName: 'Book',
  quantity: 1,
  agent: baseAgent,
})).toMatchObject({
  status: 'accepted',
  steps: [
    { commodityName: 'Wood', quantity: 1 },
    { commodityName: 'Book', quantity: 1 },
  ],
  energyCost: 40,
  satietyCost: 10,
  laborSeconds: 2,
  inventoryAfter: { Book: 1 },
  inventoryDelta: { Book: 1 },
});
```

Also assert that an agent starting with `{ Wood: 1 }` plans only the `Book` step and reports
`inventoryDelta: { Wood: -1, Book: 1 }`.

- [x] **Step 2: Write failing shared-intermediate and rejection tests**

Add tests that assert:

```ts
const chipPlan = planProductionChain({
  commodityName: 'Chip',
  quantity: 1,
  agent: baseAgent,
});
```

The accepted chip plan must include one `Copper Ingot` step with `quantity: 2`, one `Coal` step with
`quantity: 2`, and the final `Chip` step last. Add rejection tests for residential tier 4 attempting
`Chip`, and energy 499 attempting `Chip` from empty inventory.

- [x] **Step 3: Run tests to verify red**

Run:

```bash
pnpm --filter @aivilization/economy test -- productionChain.test.ts
```

Expected: FAIL because `planProductionChain` is not exported.

## Task 2: Shared Production Definition Resolution

**Files:**

- Modify: `packages/economy/src/production.ts`

- [x] **Step 4: Export catalog resolution types and helper**

Add exported types:

```ts
export type ProductionCatalogInput = {
  readonly commodityCatalog?: readonly CommodityConfig[];
  readonly recipeCatalog?: readonly ProductionRecipe[];
  readonly recipeOverrides?: readonly ProductionRecipeOverride[];
};

export type ProductionDefinition = {
  readonly commodity: CommodityConfig;
  readonly recipe: ProductionRecipe;
};
```

Add:

```ts
export function resolveProductionDefinition(
  commodityName: string,
  input: ProductionCatalogInput = {},
): ProductionDefinition | undefined;
```

Update `planProduction` to call this helper instead of doing local catalog lookup.

- [x] **Step 5: Verify existing production tests**

Run:

```bash
pnpm --filter @aivilization/economy test -- production.test.ts
pnpm --filter @aivilization/economy typecheck
```

Expected: PASS.

## Task 3: Production Chain Planner

**Files:**

- Create: `packages/economy/src/productionChain.ts`
- Modify: `packages/economy/src/index.ts`

- [x] **Step 6: Implement `planProductionChain`**

Create the planner with these exported types:

```ts
export type ProductionChainStep = {
  readonly commodityName: string;
  readonly quantity: number;
  readonly produced: Inventory;
  readonly consumedInputs: Inventory;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly laborSeconds: number;
};
```

The implementation must:

- validate positive integer quantity;
- recursively produce missing upstream inputs;
- consume virtual inventory before planning upstream production;
- append steps after dependencies;
- merge adjacent or repeated steps for the same commodity when no intervening dependency requires
  them separately;
- reject residential gates and unknown commodities;
- reject cumulative energy, satiety, and labor budget overruns;
- return `inventoryAfter` and signed `inventoryDelta`.

Export it from `packages/economy/src/index.ts`.

- [x] **Step 7: Run chain tests to verify green**

Run:

```bash
pnpm --filter @aivilization/economy test -- productionChain.test.ts
pnpm --filter @aivilization/economy typecheck
```

Expected: PASS.

## Task 4: Full Verification and Commit

**Files:**

- Modify this plan file after commands pass.

- [x] **Step 8: Run economy and full checks**

Run:

```bash
pnpm --filter @aivilization/economy test
pnpm --filter @aivilization/economy typecheck
pnpm check
pnpm build
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add packages/economy/src docs/superpowers/specs/2026-06-24-production-chain-planner-design.md docs/superpowers/plans/2026-06-24-production-chain-planner-slice.md
git commit -m "feat: add production chain planner"
```

## Self-Review

- Spec coverage: The plan covers pure dependency expansion, inventory reuse, resource aggregation,
  residential gates, cumulative budget rejection, exports, and verification.
- Placeholder scan: No placeholder or TODO markers remain.
- Type consistency: Public names match the design doc and planned tests.
