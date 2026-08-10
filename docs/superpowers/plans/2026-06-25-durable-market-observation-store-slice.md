# Durable Market Observation Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable backend data plane for trade observations and OHLC bars so paper-style market diagnostics, APIs, dashboards, and future Godot clients can query reviewed market history without rescanning world events.

**Architecture:** `packages/observability` owns storage-neutral market observation contracts plus in-memory/file repositories. `apps/worker` owns the adapter that extracts observations from `TradeExecuted` world events and writes normalized trade/OHLC rows. Simulation domain packages remain unaware of persistence concerns.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, JSONL file repositories.

---

## Scope

This slice adds:

- durable trade-observation and OHLC-bar repository interfaces
- in-memory and JSONL file repository implementations
- idempotent record semantics keyed by observation/bar id
- query filters by simulation id, commodity id, time window, and limit
- worker adapter to record market observations from `TradeExecuted` events

It does not add HTTP API routes, dashboard views, scheduled backfill jobs, or database migrations.

## File Structure

- Create `packages/observability/src/marketObservationRepository.ts`: repository contracts and implementations.
- Create `packages/observability/src/marketObservationRepository.test.ts`: idempotency, query, clone, and file persistence tests.
- Modify `packages/observability/src/index.ts`: export market observation repository contracts.
- Modify `apps/worker/src/experimentValidationRunner.ts`: preserve event id, side, and microstructure metadata in extracted trade observations.
- Create `apps/worker/src/marketObservationRecording.ts`: worker adapter that records trade observations and optional OHLC bars.
- Create `apps/worker/src/marketObservationRecording.test.ts`: adapter tests over real `TradeExecuted` events.
- Modify `apps/worker/src/index.ts`: export the recording adapter.
- Create this plan file.

## Tasks

### Task 1: Observability Repository Tests

**Files:**

- Create: `packages/observability/src/marketObservationRepository.test.ts`

- [x] **Step 1: Write failing repository tests**

Add tests that:

- record three trade observations, including a duplicate id
- query only one commodity in a time window
- assert returned rows are chronological and cloned
- record OHLC bars and query them by commodity/time
- reopen a file-backed repository and read persisted rows

- [x] **Step 2: Run RED**

Run: `pnpm --filter @aivilization/observability test -- marketObservationRepository.test.ts`

Expected: FAIL because `marketObservationRepository.ts` does not exist.

### Task 2: Observability Repository Implementation

**Files:**

- Create: `packages/observability/src/marketObservationRepository.ts`
- Modify: `packages/observability/src/index.ts`

- [x] **Step 1: Implement repository contracts**

Define:

```ts
export type MarketTradeObservation = {
  readonly observationId: string;
  readonly simulationId: string;
  readonly commodityId: string;
  readonly sourceEventId: string;
  readonly sourceSequence: number;
  readonly side: 'buy' | 'sell';
  readonly observedAt: number;
  readonly price: number;
  readonly commodityQuantity: number;
  readonly currencyQuantity: number;
  readonly effectivePrice?: number;
  readonly spotPriceBefore?: number;
  readonly spotPriceAfter?: number;
  readonly slippageRatio?: number;
  readonly invariantBefore?: number;
  readonly invariantAfter?: number;
};
```

and `MarketOhlcBar`, query types, and `MarketObservationRepository`.

- [x] **Step 2: Implement memory and file repositories**

Use idempotent record semantics and JSONL files:

- `market-trade-observations.jsonl`
- `market-ohlc-bars.jsonl`

- [x] **Step 3: Run GREEN**

Run: `pnpm --filter @aivilization/observability test -- marketObservationRepository.test.ts`

Expected: PASS.

### Task 3: Worker Recording Adapter

**Files:**

- Modify: `apps/worker/src/experimentValidationRunner.ts`
- Create: `apps/worker/src/marketObservationRecording.ts`
- Create: `apps/worker/src/marketObservationRecording.test.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Write failing worker tests**

Add tests proving:

- trade observations are recorded with source event id, side, effective price, spot movement, and slippage
- optional OHLC binning records bars with deterministic ids
- running the same recording twice is idempotent

- [x] **Step 2: Run RED**

Run: `pnpm --filter @aivilization/worker test -- marketObservationRecording.test.ts`

Expected: FAIL because the adapter does not exist.

- [x] **Step 3: Implement adapter**

Expose:

```ts
export async function recordWorkerMarketObservations(input: {
  readonly simulationId: string;
  readonly events: readonly WorldEvent[];
  readonly repository: MarketObservationRepository;
  readonly priceBinning?: WorkerExperimentValidationPriceBinning;
}): Promise<{ readonly tradeObservationCount: number; readonly ohlcBarCount: number }>;
```

- [x] **Step 4: Run GREEN**

Run: `pnpm --filter @aivilization/worker test -- marketObservationRecording.test.ts`

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run verification**

Run:

```bash
pnpm --filter @aivilization/observability test -- marketObservationRepository.test.ts
pnpm --filter @aivilization/worker test -- marketObservationRecording.test.ts
pnpm --filter @aivilization/worker test -- experimentValidationRunner.test.ts
pnpm typecheck
pnpm lint
pnpm test
git diff --check
```

- [x] **Step 2: Commit**

Commit with:

```bash
git commit -m "feat: persist market observations"
```

- [x] **Step 3: Report overview**

Summarize completed work, verification, branch status, remaining gaps, and an updated tree diagram.

## Self-Review

- Spec coverage: This directly advances the paper requirement for high-frequency transaction analysis and OHLC-backed market validation.
- Boundary review: observability owns durable data contracts; worker owns event extraction; economy/world stay pure.
- Extension review: APIs, Godot sync, dashboards, and scheduled backfills can consume the repository without changing simulation rules.
