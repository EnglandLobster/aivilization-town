import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileMarketObservationRepository,
  InMemoryMarketObservationRepository,
  MARKET_OBSERVATION_RECENT_TRADE_ID_LIMIT,
  MARKET_OBSERVATION_TRADE_BLOOM_BIT_COUNT,
  createMarketObservationStoragePolicyManifest,
  type MarketOhlcBar,
  type MarketTradeObservation,
} from './index';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('market observation repositories', () => {
  test('records trade observations idempotently and queries chronological cloned rows', async () => {
    const repository = new InMemoryMarketObservationRepository();

    await repository.recordTrades([
      createTrade({ observationId: 'trade-2', commodityId: 'Apple', observedAt: 20, price: 12 }),
      createTrade({ observationId: 'trade-1', commodityId: 'Apple', observedAt: 10, price: 10 }),
      createTrade({ observationId: 'trade-3', commodityId: 'Fish', observedAt: 15, price: 8 }),
      createTrade({ observationId: 'trade-2', commodityId: 'Apple', observedAt: 20, price: 999 }),
    ]);

    const appleTrades = await repository.queryTrades({
      simulationId: 'sim-market',
      commodityId: 'Apple',
      fromObservedAt: 0,
      toObservedAt: 30,
    });

    expect(appleTrades.map((trade) => [trade.observationId, trade.price])).toEqual([
      ['trade-1', 10],
      ['trade-2', 12],
    ]);

    (appleTrades[0] as { price: number }).price = 999;
    await expect(
      repository.queryTrades({ simulationId: 'sim-market', commodityId: 'Apple', limit: 1 }),
    ).resolves.toMatchObject([{ observationId: 'trade-1', price: 10 }]);
  });

  test('upserts evolving OHLC bars and queries the latest revision by commodity interval', async () => {
    const repository = new InMemoryMarketObservationRepository();

    await repository.recordOhlcBars([
      createOhlcBar({ barId: 'bar-2', intervalStartedAt: 60, closePrice: 12 }),
      createOhlcBar({ barId: 'bar-1', intervalStartedAt: 0, closePrice: 10 }),
      createOhlcBar({
        barId: 'bar-fish',
        commodityId: 'Fish',
        intervalStartedAt: 0,
        closePrice: 8,
      }),
      createOhlcBar({ barId: 'bar-2', intervalStartedAt: 60, closePrice: 999 }),
    ]);

    const bars = await repository.queryOhlcBars({
      simulationId: 'sim-market',
      commodityId: 'Apple',
      fromIntervalStartedAt: 0,
      toIntervalStartedAt: 60,
    });

    expect(bars.map((bar) => [bar.barId, bar.closePrice])).toEqual([
      ['bar-1', 10],
      ['bar-2', 999],
    ]);
  });

  test('persists trade observations and OHLC bars in JSONL files', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-market-observations-'));
    tempDirs.push(rootDir);
    const repository = new FileMarketObservationRepository({ rootDir });

    await repository.recordTrades([createTrade({ observationId: 'trade-file', price: 14 })]);
    await repository.recordOhlcBars([createOhlcBar({ barId: 'bar-file', closePrice: 14 })]);
    await repository.recordOhlcBars([
      createOhlcBar({ barId: 'bar-file', closePrice: 16, tradeCount: 2 }),
    ]);

    const reopened = new FileMarketObservationRepository({ rootDir });

    await expect(reopened.queryTrades({ simulationId: 'sim-market' })).resolves.toMatchObject([
      { observationId: 'trade-file', price: 14 },
    ]);
    await expect(reopened.queryOhlcBars({ simulationId: 'sim-market' })).resolves.toMatchObject([
      { barId: 'bar-file', closePrice: 16, tradeCount: 2 },
    ]);
  });

  test('preserves global chronology and keeps legacy participant-less JSONL readable', async () => {
    const memory = new InMemoryMarketObservationRepository();
    await memory.recordTrades([
      createTrade({
        observationId: 'apple-later',
        commodityId: 'Apple',
        sourceSequence: 2,
        observedAt: 20,
      }),
      createTrade({
        observationId: 'fish-earlier',
        commodityId: 'Fish',
        sourceSequence: 1,
        observedAt: 10,
      }),
    ]);
    await expect(memory.queryTrades({ simulationId: 'sim-market' })).resolves.toMatchObject([
      { observationId: 'fish-earlier' },
      { observationId: 'apple-later' },
    ]);

    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-market-observations-legacy-'));
    tempDirs.push(rootDir);
    new FileMarketObservationRepository({ rootDir });
    writeFileSync(
      join(rootDir, 'market-trade-observations.jsonl'),
      `${JSON.stringify({
        observationId: 'legacy-trade',
        simulationId: 'sim-market',
        commodityId: 'Apple',
        sourceEventId: 'legacy-event',
        sourceSequence: 1,
        side: 'buy',
        observedAt: 10,
        price: 10,
        commodityQuantity: 1,
        currencyQuantity: 10,
      })}\n`,
      'utf8',
    );
    const legacy = new FileMarketObservationRepository({ rootDir });
    await expect(legacy.queryTrades({ simulationId: 'sim-market' })).resolves.toEqual([
      {
        observationId: 'legacy-trade',
        simulationId: 'sim-market',
        commodityId: 'Apple',
        sourceEventId: 'legacy-event',
        sourceSequence: 1,
        side: 'buy',
        observedAt: 10,
        price: 10,
        commodityQuantity: 1,
        currencyQuantity: 10,
      },
    ]);
  });

  test('uses a bounded trade index while preserving cold idempotency and cross-instance appends', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-market-observations-indexed-'));
    tempDirs.push(rootDir);
    const first = new FileMarketObservationRepository({ rootDir });
    const initialCount = MARKET_OBSERVATION_RECENT_TRADE_ID_LIMIT + 8;
    await first.recordTrades(
      Array.from({ length: initialCount }, (_, index) =>
        createTrade({
          observationId: `indexed-trade-${index}`,
          sourceSequence: index + 1,
          observedAt: index,
        }),
      ),
    );

    const reopened = new FileMarketObservationRepository({ rootDir });
    expect(reopened.getStorageDiagnostics()).toMatchObject({
      tradeRecordCount: initialCount,
      recentTradeIdCount: MARKET_OBSERVATION_RECENT_TRADE_ID_LIMIT,
      recentTradeIdLimit: MARKET_OBSERVATION_RECENT_TRADE_ID_LIMIT,
      tradeBloomBitCount: MARKET_OBSERVATION_TRADE_BLOOM_BIT_COUNT,
    });

    await reopened.recordTrades([
      createTrade({ observationId: 'indexed-trade-0', sourceSequence: 1, observedAt: 0 }),
    ]);
    expect(reopened.getStorageDiagnostics().tradeRecordCount).toBe(initialCount);

    await first.recordTrades([
      createTrade({
        observationId: 'external-append',
        sourceSequence: initialCount + 1,
        observedAt: initialCount,
      }),
    ]);
    await expect(
      reopened.queryTrades({
        simulationId: 'sim-market',
        fromObservedAt: initialCount,
      }),
    ).resolves.toMatchObject([{ observationId: 'external-append' }]);
    expect(reopened.getStorageDiagnostics().tradeRecordCount).toBe(initialCount + 1);
  });

  test('maintains the latest OHLC projection incrementally and fails closed on a partial row', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-market-observations-partial-'));
    tempDirs.push(rootDir);
    const repository = new FileMarketObservationRepository({ rootDir });
    await repository.recordOhlcBars([
      createOhlcBar({ barId: 'bar-incremental', closePrice: 10 }),
      createOhlcBar({ barId: 'bar-incremental', closePrice: 12, tradeCount: 2 }),
      createOhlcBar({ barId: 'bar-incremental', closePrice: 12, tradeCount: 2 }),
    ]);
    expect(repository.getStorageDiagnostics()).toMatchObject({
      latestOhlcBarCount: 1,
      ohlcRevisionCount: 2,
    });
    await expect(repository.queryOhlcBars({ simulationId: 'sim-market' })).resolves.toMatchObject([
      { barId: 'bar-incremental', closePrice: 12, tradeCount: 2 },
    ]);

    appendFileSync(join(rootDir, 'market-trade-observations.jsonl'), '{"observationId":');
    expect(() => repository.getStorageDiagnostics()).toThrow('incomplete trailing row');
  });

  test('fails closed when an external writer duplicates an authoritative trade ID', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-market-observations-duplicate-'));
    tempDirs.push(rootDir);
    const repository = new FileMarketObservationRepository({ rootDir });
    const trade = createTrade({ observationId: 'externally-duplicated-trade' });
    await repository.recordTrades([trade]);

    appendFileSync(
      join(rootDir, 'market-trade-observations.jsonl'),
      `${JSON.stringify(trade)}\n`,
    );

    expect(() => repository.getStorageDiagnostics()).toThrow(
      'duplicate observationId externally-duplicated-trade',
    );
    expect(() =>
      new FileMarketObservationRepository({ rootDir }).getStorageDiagnostics(),
    ).toThrow('duplicate observationId externally-duplicated-trade');
  });

  test('publishes storage limits as repository decisions rather than paper constants', () => {
    expect(createMarketObservationStoragePolicyManifest()).toMatchObject({
      policyVersion: 'market-observation-storage-v3',
      tradeLedger: 'complete-append-only-jsonl',
      tradeIdempotencyRule: 'bounded-recent-ids-plus-fixed-bloom-with-exact-cold-scan',
      duplicateLedgerRowRule: 'fail-closed',
      timeIndexRule: 'bounded-sparse-chunks-with-exact-range-or-full-cold-scan',
      ohlcRule: 'append-only-revisions-with-incremental-latest-by-id-projection',
      source: 'repository-design-not-paper-constant',
    });
  });
});

function createTrade(
  overrides: Partial<MarketTradeObservation> & Pick<MarketTradeObservation, 'observationId'>,
): MarketTradeObservation {
  return {
    observationId: overrides.observationId,
    simulationId: overrides.simulationId ?? 'sim-market',
    agentId: overrides.agentId ?? 'agent-a',
    commodityId: overrides.commodityId ?? 'Apple',
    sourceEventId: overrides.sourceEventId ?? `${overrides.observationId}:event`,
    sourceSequence: overrides.sourceSequence ?? 1,
    side: overrides.side ?? 'buy',
    observedAt: overrides.observedAt ?? 10,
    price: overrides.price ?? 10,
    commodityQuantity: overrides.commodityQuantity ?? 1,
    currencyQuantity: overrides.currencyQuantity ?? overrides.price ?? 10,
    effectivePrice: overrides.effectivePrice ?? overrides.price ?? 10,
    spotPriceBefore: overrides.spotPriceBefore ?? 9,
    spotPriceAfter: overrides.spotPriceAfter ?? 11,
    slippageRatio: overrides.slippageRatio ?? 0.1,
    invariantBefore: overrides.invariantBefore ?? 100_000,
    invariantAfter: overrides.invariantAfter ?? 100_000,
  };
}

function createOhlcBar(
  overrides: Partial<MarketOhlcBar> & Pick<MarketOhlcBar, 'barId'>,
): MarketOhlcBar {
  const intervalStartedAt = overrides.intervalStartedAt ?? 0;
  return {
    barId: overrides.barId,
    simulationId: overrides.simulationId ?? 'sim-market',
    commodityId: overrides.commodityId ?? 'Apple',
    intervalStartedAt,
    intervalEndedAt: overrides.intervalEndedAt ?? intervalStartedAt + 60,
    openPrice: overrides.openPrice ?? overrides.closePrice ?? 10,
    highPrice: overrides.highPrice ?? overrides.closePrice ?? 10,
    lowPrice: overrides.lowPrice ?? overrides.closePrice ?? 10,
    closePrice: overrides.closePrice ?? 10,
    tradeCount: overrides.tradeCount ?? 1,
    commodityVolume: overrides.commodityVolume ?? 1,
    currencyVolume: overrides.currencyVolume ?? overrides.closePrice ?? 10,
  };
}
