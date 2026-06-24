# Worker Tick Market Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let worker simulation ticks append macro market price-index events after agent actions so dynamic wage and market policies can observe current economic state.

**Architecture:** Keep price-index calculation in `apps/worker/src/marketMetrics.ts` and keep world projections event-sourced. Add an explicit `marketMetrics` tick option that supplies the baseline projection and baseline timestamp; `runWorkerSimulationTick` records `MarketPriceIndexRecorded` after all agent cycles and before checkpointing, using the current stream version and deterministic tick-scoped idempotency keys.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/economy`, `@aivilization/sim-core`, `@aivilization/world`.

---

## Scope

This slice wires the existing market price-index recorder into the worker tick lifecycle. It covers optional tick-level metric recording, event sequence continuity, projection updates, returned tick events, and checkpoint compatibility.

It does not add a scheduler cadence policy, API controls, dashboards, or long-window market reports.

## File Structure

- Modify `apps/worker/src/tickRunner.ts`: add tick `marketMetrics` input, append the market-index event after agent cycles, update final projection and stream version, and include metric events in `WorkerTickResult.events`.
- Modify `apps/worker/src/tickRunner.test.ts`: add an integration test that trades during the tick and records the resulting price index.
- Create `docs/superpowers/plans/2026-06-24-worker-tick-market-metrics-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Tick Metric Test

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 1: Write failing test**

Add a test that:

```ts
const baselineProjection = createMarketProjection();
const result = await runWorkerSimulationTick({
  tickId: 'tick-market-index',
  simulationId,
  issuedAt: 100,
  projection: baselineProjection,
  policies,
  eventStore,
  streamName: partition.eventStreamName,
  expectedVersion: 0,
  agents: [createTradeTickAgent()],
  marketMetrics: { baselineProjection, baselineAt: 0 },
  ...repositories,
});

expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
  [1, 'SimulationTimeAdvanced'],
  [2, 'TradeExecuted'],
  [3, 'ShortTermMemoryRecorded'],
  [4, 'MarketPriceIndexRecorded'],
]);
expect(result.projection.marketPriceIndices[0]?.overall).toBeCloseTo(1.2345679012);
expect(result.streamVersion).toBe(4);
```

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
```

Expected: FAIL because `runWorkerSimulationTick` does not accept or process `marketMetrics`.

### Task 2: Tick Market Metrics Implementation

**Files:**

- Modify: `apps/worker/src/tickRunner.ts`

- [x] **Step 1: Add input and result flow**

Add:

```ts
export type WorkerTickMarketMetricsInput = {
  readonly baselineProjection: WorldProjection;
  readonly baselineAt: number;
  readonly appendIdempotencyKey?: string;
};
```

Add `marketMetrics?: WorkerTickMarketMetricsInput` to `WorkerTickBaseInput`.

- [x] **Step 2: Append market metric after agent cycles**

After all agent cycles finish and before checkpointing, call `recordMarketPriceIndexToEventStream` with:

```ts
baselineProjection: input.marketMetrics.baselineProjection,
currentProjection: projection,
simulationId: input.simulationId,
baselineAt: input.marketMetrics.baselineAt,
issuedAt: input.issuedAt,
eventStore: input.eventStore,
streamName: input.streamName,
expectedVersion,
appendIdempotencyKey:
  input.marketMetrics.appendIdempotencyKey ?? `${input.tickId}:append:market-price-index`,
```

Update `projection`, `expectedVersion`, and include the appended metric events in `WorkerTickResult.events`.

- [x] **Step 3: Run focused test**

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
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
git add docs/superpowers/plans/2026-06-24-worker-tick-market-metrics-slice.md apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts
git commit -m "feat: record market metrics during worker ticks"
```

## Self-Review

- Spec coverage: The plan connects AMM price movements to macro price-index events in the worker lifecycle, supporting dynamic wages and market-aware agents.
- Boundary review: Economy owns formulas, world owns event/projection semantics, worker owns tick scheduling and event-stream appends.
- Placeholder scan: No deferred implementation markers remain.
