import type {
  MarketObservationRepository,
  MarketOhlcBar,
  MarketTradeObservation,
} from '@aivilization/observability';
import type { WorldEvent } from '@aivilization/world';
import {
  createOhlcPriceBarsFromTradePriceObservations,
  createTradePriceObservationsFromWorldEvents,
  type WorkerExperimentValidationPriceBinning,
  type WorkerOhlcPriceBar,
  type WorkerTradePriceObservation,
} from './experimentValidationRunner';

export type RecordWorkerMarketObservationsInput = {
  readonly simulationId: string;
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
  if (!input.events.some((event) => event.type === 'TradeExecuted')) {
    return {
      tradeObservationCount: 0,
      ohlcBarCount: 0,
    };
  }

  const tradePriceObservations = createTradePriceObservationsFromWorldEvents({
    simulationId: input.simulationId,
    events: input.events,
  });
  const tradeObservations = tradePriceObservations.map((observation) =>
    createMarketTradeObservation(input.simulationId, observation),
  );

  await input.repository.recordTrades(tradeObservations);

  const ohlcBars =
    input.priceBinning === undefined
      ? []
      : createOhlcPriceBarsFromTradePriceObservations({
          observations: tradePriceObservations,
          intervalMs: input.priceBinning.intervalMs,
          ...(input.priceBinning.originAt === undefined
            ? {}
            : { originAt: input.priceBinning.originAt }),
        }).map((bar) => createMarketOhlcBar(input.simulationId, input.priceBinning!, bar));

  await input.repository.recordOhlcBars(ohlcBars);

  return {
    tradeObservationCount: tradeObservations.length,
    ohlcBarCount: ohlcBars.length,
  };
}

function createMarketTradeObservation(
  simulationId: string,
  observation: WorkerTradePriceObservation,
): MarketTradeObservation {
  return {
    observationId: `${simulationId}:trade:${observation.sourceSequence}:${observation.sourceEventId}`,
    simulationId,
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
