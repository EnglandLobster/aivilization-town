import {
  calculatePriceIndices,
  getSpotPrice,
  type AmmPool,
  type CommodityPriceSnapshot,
} from '@aivilization/economy';
import {
  applyWorldEvent,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import {
  createEventEnvelope,
  type AppendToEventStreamResult,
  type EventStore,
  type EventStreamName,
  type SimulationId,
  type SimulationTimestamp,
} from '@aivilization/sim-core';

/**
 * A read-only pool override lets the price index be derived from the unified
 * authority pools while the MarketPriceIndexRecorded event is still appended to
 * and applied against the partition stream. Without an override the index reads
 * the projection's own pools, preserving legacy single-partition behavior.
 */
export type MarketPriceIndexPoolOverride = {
  readonly marketPools: Readonly<Record<string, AmmPool>>;
};

export type MarketPriceIndexSnapshotInput = {
  readonly baselineProjection: WorldProjection;
  readonly currentProjection: WorldProjection;
  readonly baselineMarketOverride?: MarketPriceIndexPoolOverride;
  readonly currentMarketOverride?: MarketPriceIndexPoolOverride;
};

export type RecordMarketPriceIndexInput = MarketPriceIndexSnapshotInput & {
  readonly simulationId: SimulationId;
  readonly baselineAt: SimulationTimestamp;
  readonly issuedAt: SimulationTimestamp;
  readonly eventStore: EventStore<WorldEvent>;
  readonly streamName: EventStreamName;
  readonly appendIdempotencyKey: string;
  readonly expectedVersion?: number;
};

export type RecordMarketPriceIndexResult = {
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
  readonly appendResult: AppendToEventStreamResult<WorldEvent>;
};

export function createMarketPriceSnapshotsFromProjections(
  input: MarketPriceIndexSnapshotInput,
): CommodityPriceSnapshot[] {
  const currentPools = input.currentMarketOverride?.marketPools ?? input.currentProjection.marketPools;
  const baselinePools =
    input.baselineMarketOverride?.marketPools ?? input.baselineProjection.marketPools;
  const sortedCurrentPools = Object.values(currentPools).sort((left, right) =>
    left.commodity.localeCompare(right.commodity),
  );
  // When regional markets are in use, several pools may share a commodity (one
  // per region). The price index is a single town-wide series, so each commodity
  // is represented by exactly one snapshot. We prefer the default (untagged)
  // region pool when present, otherwise the first pool for that commodity. This
  // keeps the legacy index shape replayable and avoids a duplicate-commodity
  // index; per-region price indices are a future extension.
  const seenCommodities = new Set<string>();
  const dedupedCurrentPools = sortedCurrentPools.filter((pool) => {
    if (seenCommodities.has(pool.commodity)) {
      return false;
    }
    seenCommodities.add(pool.commodity);
    return true;
  });
  const snapshots = dedupedCurrentPools.map((currentPool) => {
    // Baseline lookup first tries the bare commodity key (legacy), then falls
    // back to matching by regionId so a region-tagged current pool finds its
    // region-tagged baseline.
    let baselinePool = baselinePools[currentPool.commodity];
    if (baselinePool === undefined && currentPool.regionId !== undefined) {
      baselinePool = Object.values(baselinePools).find(
        (candidate) =>
          candidate.commodity === currentPool.commodity &&
          candidate.regionId === currentPool.regionId,
      );
    }
    if (baselinePool === undefined) {
      throw new Error(`missing baseline AMM pool for ${currentPool.commodity}`);
    }

    return {
      commodity: currentPool.commodity,
      baselinePrice: getSpotPrice(baselinePool),
      currentPrice: getSpotPrice(currentPool),
    };
  });

  if (snapshots.length === 0) {
    throw new Error('market price index requires at least one comparable AMM pool');
  }

  return snapshots;
}

export function recordMarketPriceIndexToEventStream(
  input: RecordMarketPriceIndexInput,
): RecordMarketPriceIndexResult {
  const expectedVersion = input.expectedVersion ?? input.eventStore.getStreamVersion(input.streamName);
  const snapshots = createMarketPriceSnapshotsFromProjections(input);
  const priceIndex = calculatePriceIndices(snapshots);
  const event = createEventEnvelope({
    id: `${input.appendIdempotencyKey}:event:market-price-index`,
    simulationId: input.simulationId,
    type: 'MarketPriceIndexRecorded',
    payload: {
      baselineAt: input.baselineAt,
      food: priceIndex.food,
      nonFood: priceIndex.nonFood,
      overall: priceIndex.overall,
      foodCount: priceIndex.foodCount,
      nonFoodCount: priceIndex.nonFoodCount,
      ratios: priceIndex.ratios,
    },
    occurredAt: input.issuedAt,
    sequence: expectedVersion + 1,
  });
  const appendResult = input.eventStore.appendToStream({
    streamName: input.streamName,
    expectedVersion,
    idempotencyKey: input.appendIdempotencyKey,
    events: [event],
  });
  const projection = appendResult.appendedEvents.reduce(applyWorldEvent, input.currentProjection);

  return {
    events: appendResult.appendedEvents,
    projection,
    appendResult,
  };
}
