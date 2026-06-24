import { createAmmPool } from '@aivilization/economy';
import {
  InMemoryEventStore,
  asSimulationId,
  createSimulationPartition,
} from '@aivilization/sim-core';
import { createWorldProjection, type WorldEvent } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { recordMarketPriceIndexToEventStream } from './index';

const simulationId = asSimulationId('sim-market-metrics');
const partition = createSimulationPartition({ simulationId, partitionKey: 'world-main' });

describe('worker market metrics', () => {
  test('records price indices from current AMM pools against a baseline projection idempotently', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const baselineProjection = createWorldProjection({
      agents: [],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
        createAmmPool({ commodity: 'Bread', commodityReserve: 100, currencyReserve: 1000 }),
        createAmmPool({ commodity: 'Wood', commodityReserve: 100, currencyReserve: 1000 }),
        createAmmPool({ commodity: 'Book', commodityReserve: 100, currencyReserve: 1000 }),
      ],
    });
    const currentProjection = createWorldProjection({
      agents: [],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 2000 }),
        createAmmPool({ commodity: 'Bread', commodityReserve: 100, currencyReserve: 8000 }),
        createAmmPool({ commodity: 'Wood', commodityReserve: 100, currencyReserve: 4000 }),
        createAmmPool({ commodity: 'Book', commodityReserve: 100, currencyReserve: 1000 }),
      ],
    });

    const input = {
      simulationId,
      baselineProjection,
      currentProjection,
      baselineAt: 0,
      issuedAt: 100,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'market-index:tick-1',
    };
    const result = recordMarketPriceIndexToEventStream(input);
    const replay = recordMarketPriceIndexToEventStream(input);

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
    expect(result.appendResult).toMatchObject({
      streamVersion: 1,
      idempotentReplay: false,
    });
    expect(replay.appendResult.idempotentReplay).toBe(true);
    expect(eventStore.readStream(partition.eventStreamName)).toHaveLength(1);
  });
});
