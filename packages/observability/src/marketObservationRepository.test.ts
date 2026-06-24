import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileMarketObservationRepository,
  InMemoryMarketObservationRepository,
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

  test('records OHLC bars idempotently and queries by commodity interval', async () => {
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
      ['bar-2', 12],
    ]);
  });

  test('persists trade observations and OHLC bars in JSONL files', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-market-observations-'));
    tempDirs.push(rootDir);
    const repository = new FileMarketObservationRepository({ rootDir });

    await repository.recordTrades([createTrade({ observationId: 'trade-file', price: 14 })]);
    await repository.recordOhlcBars([createOhlcBar({ barId: 'bar-file', closePrice: 14 })]);

    const reopened = new FileMarketObservationRepository({ rootDir });

    await expect(reopened.queryTrades({ simulationId: 'sim-market' })).resolves.toMatchObject([
      { observationId: 'trade-file', price: 14 },
    ]);
    await expect(reopened.queryOhlcBars({ simulationId: 'sim-market' })).resolves.toMatchObject([
      { barId: 'bar-file', closePrice: 14 },
    ]);
  });
});

function createTrade(
  overrides: Partial<MarketTradeObservation> & Pick<MarketTradeObservation, 'observationId'>,
): MarketTradeObservation {
  return {
    observationId: overrides.observationId,
    simulationId: overrides.simulationId ?? 'sim-market',
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
