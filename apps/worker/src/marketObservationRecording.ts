import {
  createMarketObservationStoragePolicyManifest,
  type MarketObservationRepository,
  type MarketOhlcBar,
  type MarketTradeObservation,
} from '@aivilization/observability';
import type { WorldEvent } from '@aivilization/world';
import {
  createOhlcPriceBarsFromTradePriceObservations,
  createTradePriceObservationsFromWorldEvents,
  type WorkerExperimentValidationPriceBinning,
  type WorkerOhlcPriceBar,
  type WorkerTradePriceObservation,
} from './experimentValidationRunner';

export const PAPER_MARKET_DATA_PIPELINE_POLICY_VERSION = 'paper-market-data-pipeline-v2';
export const PAPER_MARKET_OHLC_INTERVAL_MS = 5 * 60 * 1_000;
export const PAPER_MARKET_OHLC_ORIGIN_AT = 0;

export function createPaperMarketObservationRecordingConfig() {
  return {
    enabled: true,
    priceBinning: {
      intervalMs: PAPER_MARKET_OHLC_INTERVAL_MS,
      originAt: PAPER_MARKET_OHLC_ORIGIN_AT,
    },
  } as const;
}

export function createPaperMarketDataPipelineManifest() {
  return {
    policyVersion: PAPER_MARKET_DATA_PIPELINE_POLICY_VERSION,
    transactionSource: 'TradeExecuted effective price',
    timeBasis: 'post-advance-world-clock',
    sourceEventOperationalTime: 'TradeExecuted.occurredAt-retained-but-not-used-for-price-binning',
    intervalMs: PAPER_MARKET_OHLC_INTERVAL_MS,
    intervalMinutes: 5,
    originAt: PAPER_MARKET_OHLC_ORIGIN_AT,
    representativePrice: 'last-traded-close',
    aggregation: 'open-high-low-close-trade-count-commodity-volume-currency-volume',
    persistenceRule: 'append-only-trades-with-latest-revision-per-ohlc-bar-id',
    storage: createMarketObservationStoragePolicyManifest(),
  } as const;
}

export type RecordWorkerMarketObservationsInput = {
  readonly simulationId: string;
  readonly simulatedAt: number;
  readonly events: readonly WorldEvent[];
  readonly repository: MarketObservationRepository;
  readonly priceBinning?: WorkerExperimentValidationPriceBinning;
};

export type RecordWorkerMarketObservationsResult = {
  readonly tradeObservationCount: number;
  readonly ohlcBarCount: number;
};

export async function recordWorkerMarketObservations(
  input: RecordWorkerMarketObservationsInput,
): Promise<RecordWorkerMarketObservationsResult> {
  assertFiniteSimulatedAt(input.simulatedAt);
  if (!input.events.some((event) => event.type === 'TradeExecuted')) {
    return {
      tradeObservationCount: 0,
      ohlcBarCount: 0,
    };
  }

  const tradePriceObservations = createTradePriceObservationsFromWorldEvents({
    simulationId: input.simulationId,
    events: input.events,
  }).map((observation) => ({ ...observation, observedAt: input.simulatedAt }));
  const tradeObservations = tradePriceObservations.map((observation) =>
    createMarketTradeObservation(input.simulationId, observation),
  );

  await input.repository.recordTrades(tradeObservations);

  const ohlcBars =
    input.priceBinning === undefined
      ? []
      : await rebuildAffectedOhlcBars({
          simulationId: input.simulationId,
          repository: input.repository,
          priceBinning: input.priceBinning,
          newObservations: tradePriceObservations,
        });

  await input.repository.recordOhlcBars(ohlcBars);

  return {
    tradeObservationCount: tradeObservations.length,
    ohlcBarCount: ohlcBars.length,
  };
}

function assertFiniteSimulatedAt(simulatedAt: number): void {
  if (!Number.isFinite(simulatedAt) || simulatedAt < 0) {
    throw new Error('market observation simulatedAt must be non-negative and finite');
  }
}

async function rebuildAffectedOhlcBars(input: {
  readonly simulationId: string;
  readonly repository: MarketObservationRepository;
  readonly priceBinning: WorkerExperimentValidationPriceBinning;
  readonly newObservations: readonly WorkerTradePriceObservation[];
}): Promise<MarketOhlcBar[]> {
  const originAt = input.priceBinning.originAt ?? 0;
  const affectedBuckets = new Map<
    string,
    {
      readonly commodityId: string;
      readonly intervalStartedAt: number;
      readonly intervalEndedAt: number;
    }
  >();
  for (const observation of input.newObservations) {
    const intervalStartedAt =
      originAt +
      Math.floor((observation.observedAt - originAt) / input.priceBinning.intervalMs) *
        input.priceBinning.intervalMs;
    const bucket = {
      commodityId: observation.commodityId,
      intervalStartedAt,
      intervalEndedAt: intervalStartedAt + input.priceBinning.intervalMs,
    };
    affectedBuckets.set(JSON.stringify([bucket.commodityId, bucket.intervalStartedAt]), bucket);
  }

  const bars: MarketOhlcBar[] = [];
  for (const bucket of affectedBuckets.values()) {
    const persistedObservations = (
      await input.repository.queryTrades({
        simulationId: input.simulationId,
        commodityId: bucket.commodityId,
        fromObservedAt: bucket.intervalStartedAt,
        toObservedAt: bucket.intervalEndedAt,
      })
    ).filter((observation) => observation.observedAt < bucket.intervalEndedAt);
    const [bar] = createOhlcPriceBarsFromTradePriceObservations({
      observations: persistedObservations.map(toWorkerTradePriceObservation),
      intervalMs: input.priceBinning.intervalMs,
      originAt,
    });
    if (bar === undefined) {
      throw new Error(
        `persisted trade observations did not rebuild OHLC bucket ${bucket.commodityId}:${bucket.intervalStartedAt}`,
      );
    }
    bars.push(createMarketOhlcBar(input.simulationId, input.priceBinning, bar));
  }
  return bars;
}

function toWorkerTradePriceObservation(
  observation: MarketTradeObservation,
): WorkerTradePriceObservation {
  return {
    sourceEventId: observation.sourceEventId,
    ...(observation.agentId === undefined ? {} : { agentId: observation.agentId }),
    commodityId: observation.commodityId,
    observedAt: observation.observedAt,
    sourceSequence: observation.sourceSequence,
    side: observation.side,
    price: observation.price,
    commodityQuantity: observation.commodityQuantity,
    currencyQuantity: observation.currencyQuantity,
    ...(observation.effectivePrice === undefined
      ? {}
      : { effectivePrice: observation.effectivePrice }),
    ...(observation.spotPriceBefore === undefined
      ? {}
      : { spotPriceBefore: observation.spotPriceBefore }),
    ...(observation.spotPriceAfter === undefined
      ? {}
      : { spotPriceAfter: observation.spotPriceAfter }),
    ...(observation.slippageRatio === undefined
      ? {}
      : { slippageRatio: observation.slippageRatio }),
    ...(observation.invariantBefore === undefined
      ? {}
      : { invariantBefore: observation.invariantBefore }),
    ...(observation.invariantAfter === undefined
      ? {}
      : { invariantAfter: observation.invariantAfter }),
  };
}

function createMarketTradeObservation(
  simulationId: string,
  observation: WorkerTradePriceObservation,
): MarketTradeObservation {
  return {
    observationId: `${simulationId}:trade:${observation.sourceSequence}:${observation.sourceEventId}`,
    simulationId,
    ...(observation.agentId === undefined ? {} : { agentId: observation.agentId }),
    commodityId: observation.commodityId,
    sourceEventId: observation.sourceEventId,
    sourceSequence: observation.sourceSequence,
    side: observation.side,
    observedAt: observation.observedAt,
    price: observation.price,
    commodityQuantity: observation.commodityQuantity,
    currencyQuantity: observation.currencyQuantity,
    ...(observation.effectivePrice === undefined
      ? {}
      : { effectivePrice: observation.effectivePrice }),
    ...(observation.spotPriceBefore === undefined
      ? {}
      : { spotPriceBefore: observation.spotPriceBefore }),
    ...(observation.spotPriceAfter === undefined
      ? {}
      : { spotPriceAfter: observation.spotPriceAfter }),
    ...(observation.slippageRatio === undefined
      ? {}
      : { slippageRatio: observation.slippageRatio }),
    ...(observation.invariantBefore === undefined
      ? {}
      : { invariantBefore: observation.invariantBefore }),
    ...(observation.invariantAfter === undefined
      ? {}
      : { invariantAfter: observation.invariantAfter }),
  };
}

function createMarketOhlcBar(
  simulationId: string,
  priceBinning: WorkerExperimentValidationPriceBinning,
  bar: WorkerOhlcPriceBar,
): MarketOhlcBar {
  const originAt = priceBinning.originAt ?? 0;
  return {
    barId: `${simulationId}:ohlc:${priceBinning.intervalMs}:${originAt}:${bar.commodityId}:${bar.intervalStartedAt}`,
    simulationId,
    commodityId: bar.commodityId,
    intervalStartedAt: bar.intervalStartedAt,
    intervalEndedAt: bar.intervalEndedAt,
    openPrice: bar.openPrice,
    highPrice: bar.highPrice,
    lowPrice: bar.lowPrice,
    closePrice: bar.closePrice,
    tradeCount: bar.tradeCount,
    commodityVolume: bar.commodityVolume,
    currencyVolume: bar.currencyVolume,
  };
}
