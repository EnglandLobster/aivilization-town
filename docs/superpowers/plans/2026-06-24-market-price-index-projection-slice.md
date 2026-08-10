# Market Price Index Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist food, non-food, and overall price-change indices as replayable world projection state for later dynamic wages and experiment reporting.

**Architecture:** Keep `@aivilization/economy` as the pure formula owner and add a world event/projection state for recorded market indices. Add a focused worker aggregation module that compares current AMM pool spot prices against a baseline projection, emits one `MarketPriceIndexRecorded` event, appends it idempotently, and applies the event to the projection. Do not modify tick scheduling or wage policy in this slice.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/economy`, `@aivilization/world`, `apps/worker`.

---

### Task 1: World Market Price Index Projection

**Files:**

- Modify: `packages/sim-core/src/event.ts`
- Modify: `packages/world/src/events.ts`
- Modify: `packages/world/src/projection.ts`
- Modify: `packages/world/src/projection.test.ts`
- Modify: this plan file

- [x] **Step 1: Write failing projection test**

Add a test to `packages/world/src/projection.test.ts` proving `MarketPriceIndexRecorded` events replay into projection state:

```ts
test('replays market price index records into projection state', () => {
  const initial = createWorldProjection({ agents: [] });
  const events = [
    createEventEnvelope({
      id: 'event-market-index',
      simulationId: 'sim-1',
      type: 'MarketPriceIndexRecorded',
      payload: {
        baselineAt: 0,
        food: 4,
        nonFood: 2,
        overall: 3,
        foodCount: 2,
        nonFoodCount: 2,
        ratios: { Apple: 2, Bread: 8, Wood: 4, Book: 1 },
      },
      occurredAt: 100,
      sequence: 1,
    }),
  ];

  const projection = replayEvents(initial, events, applyWorldEvent);

  expect(projection.marketPriceIndices).toEqual([
    {
      baselineAt: 0,
      recordedAt: 100,
      food: 4,
      nonFood: 2,
      overall: 3,
      foodCount: 2,
      nonFoodCount: 2,
      ratios: { Apple: 2, Bread: 8, Wood: 4, Book: 1 },
    },
  ]);
});
```

- [x] **Step 2: Run world projection test to verify red**

Run:

```bash
pnpm --filter @aivilization/world test -- projection.test.ts
```

Expected: FAIL because `marketPriceIndices` and `MarketPriceIndexRecorded` do not exist.

- [x] **Step 3: Implement world event and projection state**

Update:

- `packages/sim-core/src/event.ts`: add `MarketPriceIndexRecorded` to `CoreEventType`.
- `packages/world/src/events.ts`: add `MarketPriceIndexRecordedPayload` and wire it into `WorldEventPayloadByType`.
- `packages/world/src/projection.ts`: add `WorldMarketPriceIndexState`, `marketPriceIndices` to `WorldProjection`, optional `marketPriceIndices` input to `createWorldProjection()`, clone helpers, and an `applyWorldEvent` case that copies ratios and sets `recordedAt` from `event.occurredAt`.

- [x] **Step 4: Verify focused world tests**

Run:

```bash
pnpm --filter @aivilization/world test -- projection.test.ts
pnpm --filter @aivilization/world typecheck
```

Expected: PASS.

### Task 2: Worker Market Metric Aggregator

**Files:**

- Create: `apps/worker/src/marketMetrics.ts`
- Create: `apps/worker/src/marketMetrics.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: this plan file

- [x] **Step 1: Write failing worker aggregator test**

Create `apps/worker/src/marketMetrics.test.ts` with coverage that:

- creates a baseline projection with AMM pools for `Apple`, `Bread`, `Wood`, and `Book`;
- creates a current projection with spot prices producing ratios 2, 8, 4, and 1;
- calls `recordMarketPriceIndexToEventStream()`;
- expects one `MarketPriceIndexRecorded` event appended at sequence 1;
- expects projection state to contain the same index;
- calls the same function again with the same append idempotency key and `expectedVersion: 0`, then expects idempotent replay without duplicate events.

Expected core assertion:

```ts
expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
  [1, 'MarketPriceIndexRecorded'],
]);
expect(result.projection.marketPriceIndices[0]).toMatchObject({
  baselineAt: 0,
  recordedAt: 100,
  food: 4,
  nonFood: 2,
  overall: 3,
  foodCount: 2,
  nonFoodCount: 2,
});
expect(result.projection.marketPriceIndices[0]?.ratios).toEqual({
  Apple: 2,
  Bread: 8,
  Wood: 4,
  Book: 1,
});
```

- [x] **Step 2: Run worker aggregator test to verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- marketMetrics.test.ts
```

Expected: FAIL because `marketMetrics.ts` does not exist.

- [x] **Step 3: Implement worker market metric aggregation**

Implement `apps/worker/src/marketMetrics.ts`:

- `createMarketPriceSnapshotsFromProjections({ baselineProjection, currentProjection })`
  - iterates current projection market pools by commodity name;
  - requires each current commodity to exist in the baseline projection;
  - computes baseline/current spot prices using `getSpotPrice`;
  - throws `market price index requires at least one comparable AMM pool` if no snapshots exist.
- `recordMarketPriceIndexToEventStream(input)`
  - computes snapshots and `calculatePriceIndices`;
  - creates a deterministic `MarketPriceIndexRecorded` event with sequence `expectedVersion + 1`;
  - appends it with caller-provided idempotency key;
  - applies appended events with `applyWorldEvent`;
  - returns `{ events, projection, appendResult }`.

Export the module from `apps/worker/src/index.ts`.

- [x] **Step 4: Verify focused worker tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- marketMetrics.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

### Task 3: Full Verification And Commit

**Files:**

- Review all changed files.
- Modify: this plan file.

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
git add docs/superpowers/plans/2026-06-24-market-price-index-projection-slice.md packages/sim-core/src/event.ts packages/world/src/events.ts packages/world/src/projection.ts packages/world/src/projection.test.ts apps/worker/src/marketMetrics.ts apps/worker/src/marketMetrics.test.ts apps/worker/src/index.ts
git commit -m "feat: persist market price indices"
```
