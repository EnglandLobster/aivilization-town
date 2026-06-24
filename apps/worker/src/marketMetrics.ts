import {
  calculatePriceIndices,
  getSpotPrice,
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

export type MarketPriceIndexSnapshotInput = {
  readonly baselineProjection: WorldProjection;
  readonly currentProjection: WorldProjection;
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
  const currentPools = Object.values(input.currentProjection.marketPools).sort((left, right) =>
    left.commodity.localeCompare(right.commodity),
  );
  const snapshots = currentPools.map((currentPool) => {
    const baselinePool = input.baselineProjection.marketPools[currentPool.commodity];
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
