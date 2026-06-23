# Economy Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first deterministic AIvilization economy core: seeded randomness, AMM pricing/trading, Leontief production constraints, price indices, and net-worth valuation.

**Architecture:** Keep economic rules in `packages/economy`, with deterministic randomness supplied by `packages/sim-core` and source-derived tables supplied by `packages/content`. Functions are pure and return immutable result records so API, worker, agent runtime, and future persistence adapters can compose them without hidden state mutation.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`, `@aivilization/content`.

---

## Scope

This plan implements the first Phase 2 slice from `docs/superpowers/specs/2026-06-23-aivilization-town-design.md`.

It covers:

- Deterministic seeded random numbers for stochastic production rewards.
- Constant-product AMM pools with buy/sell execution, spot price, effective price, slippage, and money supply deltas.
- Production planning against residential tier, non-substitutable inputs, energy, satiety, and labor time.
- Food/non-food/overall price-change ratio indices using the paper's geometric and weighted arithmetic formulas.
- Inventory valuation and net worth from current AMM spot prices.

It does not implement society-layer wages, education, occupations, agent planning, memory, API endpoints, persistence, or UI.

## File Structure

- Create `packages/sim-core/src/random.ts`: deterministic seeded random generator and probability roll helper.
- Modify `packages/sim-core/src/index.ts`: export random helpers.
- Create `packages/sim-core/src/random.test.ts`: deterministic random tests.
- Create `packages/economy/src/amm.ts`: constant-product AMM quote and execution functions.
- Create `packages/economy/src/amm.test.ts`: AMM invariant and slippage tests.
- Create `packages/economy/src/inventory.ts`: immutable inventory helpers.
- Create `packages/economy/src/production.ts`: Leontief-style production planning.
- Create `packages/economy/src/production.test.ts`: residential, input, physiology, labor, and reward tests.
- Create `packages/economy/src/priceIndex.ts`: food/non-food/overall price-change ratios.
- Create `packages/economy/src/valuation.ts`: inventory valuation and net-worth helpers.
- Create `packages/economy/src/valuation.test.ts`: price index and valuation tests.
- Modify `packages/economy/src/index.ts`: export economy public API.

## Task 1: Deterministic Random Source

**Files:**

- Create: `packages/sim-core/src/random.ts`
- Create: `packages/sim-core/src/random.test.ts`
- Modify: `packages/sim-core/src/index.ts`

- [ ] **Step 1: Write the failing deterministic random test**

Create `packages/sim-core/src/random.test.ts` with tests proving that the same seed yields the same first three values, different seeds diverge, and `rollProbabilityPercent(100, rng)` is always true while `rollProbabilityPercent(0, rng)` is always false.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @aivilization/sim-core test
```

Expected: FAIL because random helpers are not exported.

- [ ] **Step 3: Implement deterministic random helpers**

Create `packages/sim-core/src/random.ts` with:

```ts
export type SeededRandom = {
  readonly seed: string;
  nextFloat(): number;
};

export function createSeededRandom(seed: string): SeededRandom;
export function rollProbabilityPercent(probabilityPercent: number, rng: SeededRandom): boolean;
```

Use a deterministic string hash plus xorshift-style state update. Reject empty seeds and probabilities outside `[0, 100]`.

- [ ] **Step 4: Export and verify**

Add `export * from './random';` to `packages/sim-core/src/index.ts`, then run:

```bash
pnpm --filter @aivilization/sim-core test
pnpm --filter @aivilization/sim-core typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/sim-core/src/random.ts packages/sim-core/src/random.test.ts packages/sim-core/src/index.ts
git commit -m "feat: add deterministic random source"
```

## Task 2: Constant-Product AMM

**Files:**

- Create: `packages/economy/src/amm.ts`
- Create: `packages/economy/src/amm.test.ts`
- Modify: `packages/economy/src/index.ts`

- [ ] **Step 1: Write failing AMM tests**

Create `packages/economy/src/amm.test.ts` with tests for:

- Spot price equals `currencyReserve / commodityReserve`.
- Buying a finite amount decreases commodity reserve, increases currency reserve, preserves `k`, raises spot price, and reports negative money supply delta.
- Selling a finite amount increases commodity reserve, decreases currency reserve, preserves `k`, lowers spot price, and reports positive money supply delta.
- Trades with non-positive amounts or exhausted reserves are rejected.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @aivilization/economy test
```

Expected: FAIL because AMM functions do not exist.

- [ ] **Step 3: Implement AMM**

Create `packages/economy/src/amm.ts` with:

```ts
export type AmmPool = {
  readonly commodity: string;
  readonly commodityReserve: number;
  readonly currencyReserve: number;
};

export type AmmTradeResult = {
  readonly poolBefore: AmmPool;
  readonly poolAfter: AmmPool;
  readonly commodityDelta: number;
  readonly currencyDelta: number;
  readonly effectivePrice: number;
  readonly spotPriceBefore: number;
  readonly spotPriceAfter: number;
  readonly slippageRatio: number;
  readonly moneySupplyDelta: number;
};

export function createAmmPool(input: AmmPool): AmmPool;
export function getSpotPrice(pool: AmmPool): number;
export function getInvariant(pool: AmmPool): number;
export function buyFromPool(pool: AmmPool, commodityAmount: number): AmmTradeResult;
export function sellToPool(pool: AmmPool, commodityAmount: number): AmmTradeResult;
```

- [ ] **Step 4: Export and verify**

Add AMM exports to `packages/economy/src/index.ts`, then run:

```bash
pnpm --filter @aivilization/economy test
pnpm --filter @aivilization/economy typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/economy/src/amm.ts packages/economy/src/amm.test.ts packages/economy/src/index.ts
git commit -m "feat: add constant product amm"
```

## Task 3: Leontief Production Planning

**Files:**

- Create: `packages/economy/src/inventory.ts`
- Create: `packages/economy/src/production.ts`
- Create: `packages/economy/src/production.test.ts`
- Modify: `packages/economy/src/index.ts`

- [ ] **Step 1: Write failing production tests**

Create tests proving:

- Chip production consumes exactly one `Transistor` and one `Circuit Board`, 100 energy, 25 satiety, and 5 labor seconds.
- Missing one non-substitutable input rejects the production request.
- Residential tier below commodity requirement rejects the production request.
- Insufficient energy, satiety, or labor rejects with a specific constraint reason.
- A 100 percent reward recipe produces `Gold Apple` with deterministic seeded random.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @aivilization/economy test
```

Expected: FAIL because production functions do not exist.

- [ ] **Step 3: Implement immutable inventory and production planner**

Create `packages/economy/src/inventory.ts` with read/add/remove helpers over `Readonly<Record<string, number>>`.

Create `packages/economy/src/production.ts` with:

```ts
export type ProductionAgentState = {
  readonly residentialTier: number;
  readonly energy: number;
  readonly satiety: number;
  readonly availableLaborSeconds: number;
  readonly inventory: Readonly<Record<string, number>>;
};

export type ProductionPlan =
  | {
      readonly status: 'accepted';
      readonly produced: Readonly<Record<string, number>>;
      readonly consumedInputs: Readonly<Record<string, number>>;
      readonly energyCost: number;
      readonly satietyCost: number;
      readonly laborSeconds: number;
    }
  | {
      readonly status: 'rejected';
      readonly reason:
        | 'commodity-not-producible'
        | 'residential-tier-too-low'
        | 'insufficient-input'
        | 'insufficient-energy'
        | 'insufficient-satiety'
        | 'insufficient-labor';
      readonly detail: string;
    };

export function planProduction(input: {
  readonly commodityName: string;
  readonly quantity: number;
  readonly agent: ProductionAgentState;
  readonly rng?: SeededRandom;
}): ProductionPlan;
```

- [ ] **Step 4: Export and verify**

Add production exports to `packages/economy/src/index.ts`, then run:

```bash
pnpm --filter @aivilization/economy test
pnpm --filter @aivilization/economy typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/economy/src/inventory.ts packages/economy/src/production.ts packages/economy/src/production.test.ts packages/economy/src/index.ts
git commit -m "feat: add production constraint planning"
```

## Task 4: Price Indices and Valuation

**Files:**

- Create: `packages/economy/src/priceIndex.ts`
- Create: `packages/economy/src/valuation.ts`
- Create: `packages/economy/src/valuation.test.ts`
- Modify: `packages/economy/src/index.ts`

- [ ] **Step 1: Write failing valuation tests**

Create tests proving:

- Price change ratio is `current / baseline`.
- Food and non-food category rates use geometric means.
- Overall rate uses the paper's weighted arithmetic mean by category counts.
- Inventory value uses current AMM spot prices.
- Net worth is currency balance plus inventory value.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @aivilization/economy test
```

Expected: FAIL because index and valuation helpers do not exist.

- [ ] **Step 3: Implement price index and valuation helpers**

Create `priceIndex.ts` with category classification derived from content metadata and the paper formulas.

Create `valuation.ts` with:

```ts
export function valueInventory(input: {
  readonly inventory: Readonly<Record<string, number>>;
  readonly pools: readonly AmmPool[];
}): number;

export function calculateNetWorth(input: {
  readonly currencyBalance: number;
  readonly inventory: Readonly<Record<string, number>>;
  readonly pools: readonly AmmPool[];
}): number;
```

- [ ] **Step 4: Export and verify**

Add index and valuation exports, then run:

```bash
pnpm --filter @aivilization/economy test
pnpm --filter @aivilization/economy typecheck
pnpm check
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/economy/src/priceIndex.ts packages/economy/src/valuation.ts packages/economy/src/valuation.test.ts packages/economy/src/index.ts
git commit -m "feat: add economy price indices and valuation"
```

## Self-Review

- Spec coverage: This plan covers the Phase 2 economy slice for AMM pricing, slippage, money supply coupling, production hard constraints, stochastic reward hooks, price-change indices, and net-worth calculation.
- Red-flag scan: No forbidden marker strings remain in this plan.
- Type consistency: Public function names and result fields are stable across tests, implementations, exports, and verification commands.
