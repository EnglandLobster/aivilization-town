import { createAmmPool } from '@aivilization/economy';
import {
  InMemoryEventStore,
  asSimulationId,
  createSimulationPartition,
} from '@aivilization/sim-core';
import { createWorldProjection, type WorldEvent } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { createMarketPriceSnapshotsFromProjections, recordMarketPriceIndexToEventStream } from './index';

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

  test('derives index values from the authority pool override without mutating the partition projection', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    // The partition's own baseline/current pools are stale: they only reflect
    // this partition's own trades (Apple currency still 1000, spot price 10).
    const baselineProjection = createWorldProjection({
      agents: [],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
    });
    const currentProjection = createWorldProjection({
      agents: [],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
    });

    const result = recordMarketPriceIndexToEventStream({
      simulationId,
      baselineProjection,
      currentProjection,
      // The unified authority baseline and current pools: the authoritative
      // global market has doubled Apple's price to 20 (2000 / 100).
      baselineMarketOverride: {
        marketPools: {
          Apple: { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 },
        },
      },
      currentMarketOverride: {
        marketPools: {
          Apple: { commodity: 'Apple', commodityReserve: 100, currencyReserve: 2000 },
        },
      },
      baselineAt: 0,
      issuedAt: 100,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'market-index-override:tick-1',
    });

    // The recorded index reflects the authoritative override (ratio 2), not the
    // stale partition pool (which would be ratio 1).
    expect(result.projection.marketPriceIndices[0]?.ratios).toEqual({ Apple: 2 });

    // Checkpoint invariant: the projection's own AMM pool is untouched by the
    // override, so the persisted snapshot still equals partition-stream replay.
    expect(result.projection.marketPools.Apple).toEqual({
      commodity: 'Apple',
      commodityReserve: 100,
      currencyReserve: 1000,
    });
  });

  test('regional pools deduplicate to one snapshot per commodity without crashing', () => {
    // Regional markets produce several pools per commodity (downtown + harbor).
    // The price index is a single town-wide series and must not crash on the
    // duplicate commodity nor produce a duplicate entry; each commodity collapses
    // to one snapshot.
    const baselineProjection = createWorldProjection({ agents: [] });
    const currentProjection = createWorldProjection({ agents: [] });
    const snapshots = createMarketPriceSnapshotsFromProjections({
      baselineProjection,
      currentProjection,
      baselineMarketOverride: {
        marketPools: {
          'downtown::Fish': {
            commodity: 'Fish',
            commodityReserve: 100,
            currencyReserve: 1_000,
            regionId: 'downtown',
          },
          'harbor::Fish': {
            commodity: 'Fish',
            commodityReserve: 100,
            currencyReserve: 400,
            regionId: 'harbor',
          },
        },
      },
      currentMarketOverride: {
        marketPools: {
          'downtown::Fish': {
            commodity: 'Fish',
            commodityReserve: 100,
            currencyReserve: 1_500,
            regionId: 'downtown',
          },
          'harbor::Fish': {
            commodity: 'Fish',
            commodityReserve: 100,
            currencyReserve: 600,
            regionId: 'harbor',
          },
        },
      },
    });

    // Exactly one Fish snapshot, not two; price reflects the first (downtown)
    // region's baseline->current movement (1000 -> 1500, ratio 1.5).
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.commodity).toBe('Fish');
    expect(snapshots[0]?.baselinePrice).toBeCloseTo(10);
    expect(snapshots[0]?.currentPrice).toBeCloseTo(15);
  });
});
