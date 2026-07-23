import {
  PAPER_MARKET_FIGURE_INTERVAL_MS,
  createPaperMarketAnalysisArtifact,
  validatePaperMatureMarketDatasetBundle,
  type FilePaperMarketAnalysisArtifactRepository,
  type MarketOhlcBar,
  type PaperMarketAnalysisArtifact,
  type PaperMatureMarketDatasetBundle,
} from '@aivilization/observability';
import {
  createOhlcPriceBarsFromTradePriceObservations,
  type WorkerTradePriceObservation,
} from './experimentValidationRunner';

export type RunWorkerPaperMarketAnalysisInput = {
  readonly analysisRunId: string;
  readonly generatedAt: number;
  readonly dataset: PaperMatureMarketDatasetBundle;
  readonly artifactRepository: Pick<FilePaperMarketAnalysisArtifactRepository, 'save'>;
  readonly intervalOriginAt?: number;
  readonly realWorldWindow?: {
    readonly startedAtIso: string;
    readonly endedAtIso: string;
  };
};

export async function runWorkerPaperMarketAnalysis(
  input: RunWorkerPaperMarketAnalysisInput,
): Promise<PaperMarketAnalysisArtifact> {
  const dataset = validatePaperMatureMarketDatasetBundle(input.dataset);
  const intervalOriginAt = input.intervalOriginAt ?? 0;
  const workerBars = createOhlcPriceBarsFromTradePriceObservations({
    observations: dataset.trades.map(toWorkerTradeObservation),
    intervalMs: PAPER_MARKET_FIGURE_INTERVAL_MS,
    originAt: intervalOriginAt,
  });
  const bars: MarketOhlcBar[] = workerBars.map((bar) => ({
    barId: `${dataset.artifact.datasetId}:ohlc:${PAPER_MARKET_FIGURE_INTERVAL_MS}:${intervalOriginAt}:${bar.commodityId}:${bar.intervalStartedAt}`,
    simulationId: dataset.artifact.run.simulationId,
    ...bar,
  }));
  const artifact = createPaperMarketAnalysisArtifact({
    run: {
      analysisRunId: input.analysisRunId,
      runManifestId: dataset.artifact.run.runManifestId,
      simulationId: dataset.artifact.run.simulationId,
      sourceRevision: { ...dataset.artifact.run.sourceRevision },
      seed: dataset.artifact.run.seed,
      generatedAt: input.generatedAt,
    },
    dataset: dataset.artifact,
    bars,
    intervalOriginAt,
    ...(input.realWorldWindow === undefined
      ? {}
      : { realWorldWindow: { ...input.realWorldWindow } }),
  });
  await input.artifactRepository.save(artifact);
  return artifact;
}

function toWorkerTradeObservation(
  trade: PaperMatureMarketDatasetBundle['trades'][number],
): WorkerTradePriceObservation {
  return {
    sourceEventId: trade.sourceEventId,
    ...(trade.agentId === undefined ? {} : { agentId: trade.agentId }),
    commodityId: trade.commodityId,
    observedAt: trade.observedAt,
    sourceSequence: trade.sourceSequence,
    side: trade.side,
    price: trade.price,
    commodityQuantity: trade.commodityQuantity,
    currencyQuantity: trade.currencyQuantity,
    ...(trade.effectivePrice === undefined ? {} : { effectivePrice: trade.effectivePrice }),
    ...(trade.spotPriceBefore === undefined ? {} : { spotPriceBefore: trade.spotPriceBefore }),
    ...(trade.spotPriceAfter === undefined ? {} : { spotPriceAfter: trade.spotPriceAfter }),
    ...(trade.slippageRatio === undefined ? {} : { slippageRatio: trade.slippageRatio }),
    ...(trade.invariantBefore === undefined ? {} : { invariantBefore: trade.invariantBefore }),
    ...(trade.invariantAfter === undefined ? {} : { invariantAfter: trade.invariantAfter }),
  };
}
