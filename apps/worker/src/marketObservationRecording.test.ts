import { createAmmPool } from '@aivilization/economy';
import { InMemoryMarketObservationRepository } from '@aivilization/observability';
import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import type { WorldEvent } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { recordWorkerMarketObservations } from './index';

const simulationId = 'sim-market-recording';

describe('worker market observation recording', () => {
  test('treats ticks without trade events as an empty recording batch', async () => {
    const repository = new InMemoryMarketObservationRepository();
    const events = [
      createEventEnvelope({
        id: 'time-advanced',
        simulationId,
        type: 'SimulationTimeAdvanced',
        payload: {
          previous: { now: 0, tickDurationMs: 1000 },
          next: { now: 1000, tickDurationMs: 1000 },
          deltaMs: 1000,
        },
        occurredAt: 1000,
        sequence: 1,
      }),
    ];

    await expect(
      recordWorkerMarketObservations({
        simulationId,
        events,
        repository,
        priceBinning: { intervalMs: 60 },
      }),
    ).resolves.toEqual({ tradeObservationCount: 0, ohlcBarCount: 0 });
    await expect(repository.queryTrades({ simulationId })).resolves.toEqual([]);
    await expect(repository.queryOhlcBars({ simulationId })).resolves.toEqual([]);
  });

  test('records trade observations and OHLC bars from TradeExecuted events idempotently', async () => {
    const repository = new InMemoryMarketObservationRepository();
    const events = [
      createTradeEvent({ id: 'trade-1', sequence: 1, occurredAt: 0, price: 100 }),
      createTradeEvent({ id: 'trade-2', sequence: 2, occurredAt: 10, price: 110 }),
    ];

    await expect(
      recordWorkerMarketObservations({
        simulationId,
        events,
        repository,
        priceBinning: { intervalMs: 60 },
      }),
    ).resolves.toEqual({ tradeObservationCount: 2, ohlcBarCount: 1 });
    await recordWorkerMarketObservations({
      simulationId,
      events,
      repository,
      priceBinning: { intervalMs: 60 },
    });

    const trades = await repository.queryTrades({ simulationId, commodityId: 'Fish' });
    expect(trades).toMatchObject([
      {
        observationId: `${simulationId}:trade:1:trade-1`,
        sourceEventId: 'trade-1',
        side: 'buy',
        price: 100,
        effectivePrice: 100,
        spotPriceBefore: 99,
        spotPriceAfter: 101,
        slippageRatio: 0.01,
      },
      {
        observationId: `${simulationId}:trade:2:trade-2`,
        sourceEventId: 'trade-2',
        side: 'buy',
        price: 110,
        effectivePrice: 110,
      },
    ]);

    const bars = await repository.queryOhlcBars({ simulationId, commodityId: 'Fish' });
    expect(bars).toEqual([
      {
        barId: `${simulationId}:ohlc:60:0:Fish:0`,
        simulationId,
        commodityId: 'Fish',
        intervalStartedAt: 0,
        intervalEndedAt: 60,
        openPrice: 100,
        highPrice: 110,
        lowPrice: 100,
        closePrice: 110,
        tradeCount: 2,
        commodityVolume: 2,
        currencyVolume: 210,
      },
    ]);
  });
});

function createTradeEvent(input: {
  readonly id: string;
  readonly sequence: number;
  readonly occurredAt: number;
  readonly price: number;
}): WorldEvent {
  return createEventEnvelope({
    id: input.id,
    simulationId,
    type: 'TradeExecuted',
    payload: {
      agentId: asAgentId('agent-a'),
      side: 'buy' as const,
      commodityName: 'Fish',
      commodityQuantity: 1,
      currencyQuantity: input.price,
      poolAfter: createAmmPool({
        commodity: 'Fish',
        commodityReserve: 10,
        currencyReserve: input.price * 10,
      }),
      moneySupplyDelta: -input.price,
      effectivePrice: input.price,
      spotPriceBefore: input.price - 1,
      spotPriceAfter: input.price + 1,
      slippageRatio: 0.01,
      invariantBefore: 100_000,
      invariantAfter: 100_000,
    },
    occurredAt: input.occurredAt,
    sequence: input.sequence,
  });
}
