# Trade Market Microstructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the paper's AMM micro-price mechanics directly in trade execution events so downstream OHLC, validation, and diagnostics can observe effective price, spot movement, slippage, and invariant preservation.

**Architecture:** `@aivilization/economy` remains the owner of AMM math and exposes invariant metadata on `AmmTradeResult`. `@aivilization/world` records that metadata on newly emitted `TradeExecuted` events, while keeping the payload fields optional for historical event compatibility. `apps/worker` validates the optional metadata when present and uses `effectivePrice` as the authoritative transaction close price.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, event-sourced world projection.

---

### Task 1: Economy AMM Metadata

**Files:**
- Modify: `packages/economy/src/amm.ts`
- Modify: `packages/economy/src/amm.test.ts`

- [x] **Step 1: Write the failing AMM test**

Add expectations to buy/sell tests:

```ts
expect(trade.invariantBefore).toBeCloseTo(100000, 8);
expect(trade.invariantAfter).toBeCloseTo(100000, 8);
```

- [x] **Step 2: Run the economy test to verify RED**

Run: `pnpm --filter @aivilization/economy test -- amm.test.ts`

Expected: FAIL because `invariantBefore` and `invariantAfter` are not present on `AmmTradeResult`.

- [x] **Step 3: Implement AMM metadata**

Add readonly fields to `AmmTradeResult`:

```ts
readonly invariantBefore: number;
readonly invariantAfter: number;
```

For buys and sells, set `invariantBefore` from the original pool invariant and `invariantAfter` from `getInvariant(poolAfter)`.

- [x] **Step 4: Run the economy test to verify GREEN**

Run: `pnpm --filter @aivilization/economy test -- amm.test.ts`

Expected: PASS.

### Task 2: World Trade Event Metadata

**Files:**
- Modify: `packages/world/src/events.ts`
- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/agentActions.test.ts`

- [x] **Step 1: Write the failing world tests**

In the buy test, assert:

```ts
expect(events[0]).toMatchObject({
  type: 'TradeExecuted',
  payload: {
    effectivePrice: 11.11111111111111,
    spotPriceBefore: 10,
    spotPriceAfter: 12.345679012345679,
    slippageRatio: 0.11111111111111116,
    invariantBefore: 100000,
    invariantAfter: 100000,
  },
});
```

Add a sell-side assertion with `effectivePrice`, lower post-trade spot, negative slippage, and invariant metadata.

- [x] **Step 2: Run the world test to verify RED**

Run: `pnpm --filter @aivilization/world test -- agentActions.test.ts`

Expected: FAIL because emitted `TradeExecuted` events do not include microstructure metadata.

- [x] **Step 3: Extend event payload type and wiring**

Add optional fields to `TradeExecutedPayload`:

```ts
readonly effectivePrice?: number;
readonly spotPriceBefore?: number;
readonly spotPriceAfter?: number;
readonly slippageRatio?: number;
readonly invariantBefore?: number;
readonly invariantAfter?: number;
```

Pass the full `AmmTradeResult` into `createTradeEvents` and emit those fields for newly executed trades.

- [x] **Step 4: Run the world test to verify GREEN**

Run: `pnpm --filter @aivilization/world test -- agentActions.test.ts`

Expected: PASS.

### Task 3: Worker Validation Uses and Checks Metadata

**Files:**
- Modify: `apps/worker/src/experimentValidationRunner.ts`
- Modify: `apps/worker/src/experimentValidationRunner.test.ts`

- [x] **Step 1: Write failing worker tests**

Add one test proving `createTradePriceObservationsFromWorldEvents` uses present `effectivePrice` as the price. Add another proving a mismatch between `effectivePrice` and `currencyQuantity / commodityQuantity` is rejected with `TradeExecuted effectivePrice must match currencyQuantity / commodityQuantity`.

- [x] **Step 2: Run the worker test to verify RED**

Run: `pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts`

Expected: FAIL because the extractor ignores `effectivePrice` metadata.

- [x] **Step 3: Implement metadata validation**

When `event.payload.effectivePrice` is present:

```ts
const quantityPrice = event.payload.currencyQuantity / event.payload.commodityQuantity;
const closePrice = event.payload.effectivePrice ?? quantityPrice;
if (event.payload.effectivePrice !== undefined && Math.abs(closePrice - quantityPrice) > 1e-9) {
  throw new Error('TradeExecuted effectivePrice must match currencyQuantity / commodityQuantity');
}
```

- [x] **Step 4: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/economy test -- amm.test.ts
pnpm --filter @aivilization/world test -- agentActions.test.ts
pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts
pnpm typecheck
pnpm lint
pnpm test
git diff --check
```

Expected: all commands exit 0.

### Task 4: Commit

**Files:**
- Modify this plan checklist to checked boxes.
- Commit all changed files.

- [x] **Step 1: Commit the slice**

```bash
git add docs/superpowers/plans/2026-06-25-trade-market-microstructure-slice.md \
  packages/economy/src/amm.ts packages/economy/src/amm.test.ts \
  packages/world/src/events.ts packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts \
  apps/worker/src/experimentValidationRunner.ts apps/worker/src/experimentValidationRunner.test.ts
git commit -m "feat: record trade market microstructure"
```

- [x] **Step 2: Report overview**

Summarize completed work, verification, current branch status, remaining gaps, and an updated tree diagram.
