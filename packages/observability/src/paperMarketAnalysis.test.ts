import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FilePaperMarketAnalysisArtifactRepository,
  PAPER_TABLE_1_COMMODITIES,
  createPaperMarketAnalysisArtifact,
  createPaperMarketAnalysisPolicyManifest,
  createPaperMatureMarketDatasetArtifact,
  type MarketOhlcBar,
  type MarketTradeObservation,
  type PaperMarketAnalysisArtifactInput,
  type PaperMatureMarketDatasetArtifact,
} from './index';

const roots: string[] = [];
const simulationId = 'sim-paper-market-analysis';
const intervalMs = 300_000;
const analysisStartedAt = 3_000_000;
const figureCommodityIds = ['Pure Silicon', 'Transistor', 'Book'] as const;
const allCommodityIds = [...PAPER_TABLE_1_COMMODITIES, ...figureCommodityIds];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('paper market analysis artifact', () => {
  test('binds mature dataset provenance to stability diagnostics, Table 1, and Figures 4-8', () => {
    const input = createInput();
    const artifact = createPaperMarketAnalysisArtifact(input);

    expect(artifact.analysisId).toMatch(/^paper-market-analysis:sha256:[a-f0-9]{64}$/u);
    expect(artifact).toMatchObject({
      schemaVersion: 'paper-market-analysis-v2',
      dataset: {
        datasetId: input.dataset.datasetId,
        transactionsSha256: input.dataset.selection.transactionFile.sha256,
        selectedTradeCount: input.dataset.selection.tradeCount,
      },
      method: {
        intervalMs,
        representativePrice: 'last-traded-close',
        returnRule: 'consecutive-ohlc-close-log-return',
        momentRule: 'population-central-moments',
        ljungBoxLagCount: 10,
        minimumReturnCount: 100,
        paperTimeCompressionRatio: 7,
        realWorldWindow: {
          status: 'provided',
          startedAtIso: '2025-09-09T00:00:00.000Z',
          endedAtIso: '2025-09-15T00:00:00.000Z',
        },
      },
      table1: {
        paperTable: 'Table 1',
        paperSourceInconsistency: {
          status: 'disclosed',
          comparisonRule: 'retain-table-bound-and-disclose-prose-conflict',
        },
      },
      evidenceClassification: {
        mechanism: 'verified-by-artifact-contract',
        sourceDatasetPolicy: 'noncanonical-contract',
        empiricalEvaluationEligibility: 'not-eligible-noncanonical-dataset-policy',
        syntheticInputsMayEstablishPaperReproduction: false,
      },
    });
    expect(artifact.table1.rows.map((row) => row.commodityId)).toEqual(
      PAPER_TABLE_1_COMMODITIES,
    );
    expect(artifact.table1.rows.every((row) => row.returnObservationCount === 100)).toBe(true);
    expect(artifact.table1.rows[0]?.paperReference).toMatchObject({
      commodityId: 'Wood',
      excessKurtosis: 9.644,
      skewness: -1.659,
      absoluteReturnAutocorrelationLagOne: 0.45,
      pValueReported: '<1e-6',
    });
    expect(artifact.marketStability.fishCaseStudy).toMatchObject({
      hasNonZeroReturnVariation: true,
      paperReference: {
        minimumClosePrice: 304.398,
        maximumClosePrice: 304.808,
        logPriceRangeReported: 0.001,
        maximumDrawdownReported: 0.000715,
      },
    });
    expect(artifact.figures.figures.map((figure) => figure.paperFigure)).toEqual([
      'Figure 4',
      'Figure 5',
      'Figure 6',
      'Figure 7',
      'Figure 8',
    ]);
    expect(artifact.table1.csv).toContain('paper_p_value_reported');
    expect(artifact.table1.csv).toContain('Copper Ingot');
  });

  test('persists immutable JSON, CSV, and SVG evidence and detects file tampering', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'paper-market-analysis-'));
    roots.push(rootDir);
    const artifact = createPaperMarketAnalysisArtifact(createInput());
    const repository = new FilePaperMarketAnalysisArtifactRepository({ rootDir });

    await expect(repository.save(artifact)).resolves.toEqual(artifact);
    await expect(repository.save(artifact)).resolves.toEqual(artifact);
    const restarted = new FilePaperMarketAnalysisArtifactRepository({ rootDir });
    await expect(restarted.get(artifact.analysisId)).resolves.toEqual(artifact);

    const artifactDir = join(
      rootDir,
      'paper-market-analysis-artifacts',
      encodeURIComponent(artifact.analysisId),
    );
    const tablePath = join(artifactDir, 'table-1-market-statistics.csv');
    writeFileSync(tablePath, `${readFileSync(tablePath, 'utf8')}tampered`, 'utf8');
    await expect(restarted.get(artifact.analysisId)).rejects.toThrow('CSV is inconsistent');
  });

  test('rejects incomplete representative assets and mismatched mature-run provenance', () => {
    const input = createInput();
    expect(() =>
      createPaperMarketAnalysisArtifact({
        ...input,
        bars: input.bars.filter((bar) => bar.commodityId !== 'Copper Ingot'),
      }),
    ).toThrow('requires at least 101 Copper Ingot OHLC bars');

    expect(() =>
      createPaperMarketAnalysisArtifact({
        ...input,
        run: { ...input.run, runManifestId: 'different-manifest' },
      }),
    ).toThrow('run manifest must match source dataset');
  });

  test('publishes exact representative assets, reference rows, methods, and evidence boundary', () => {
    const policy = createPaperMarketAnalysisPolicyManifest();
    expect(policy).toMatchObject({
      policyVersion: 'paper-market-analysis-v2',
      sourceDatasetPolicy: 'paper-mature-market-dataset-v2',
      representativeCommodities: PAPER_TABLE_1_COMMODITIES,
      intervalMs,
      momentRule: 'population-central-moments',
      ljungBoxLagCount: 10,
      minimumReturnCount: 100,
      paperHeavyTailFloor: 6,
      volatilitySignificanceLevel: 0.01,
      evidenceRule: 'synthetic-contract-output-is-not-empirical-reproduction',
    });
    expect(policy.paperTableOneReferenceRows).toHaveLength(10);
    expect(policy.paperSourceInconsistency).toContain('Copper Ingot');
  });
});

function createInput(): PaperMarketAnalysisArtifactInput {
  const bars = createBars();
  const dataset = createDataset(bars);
  return {
    run: {
      analysisRunId: 'paper-market-analysis-contract-1',
      runManifestId: dataset.run.runManifestId,
      simulationId,
      sourceRevision: { ...dataset.run.sourceRevision },
      seed: dataset.run.seed,
      generatedAt: 1_700_000_000,
    },
    dataset,
    bars,
    realWorldWindow: {
      startedAtIso: '2025-09-09T00:00:00Z',
      endedAtIso: '2025-09-15T00:00:00Z',
    },
  };
}

function createDataset(bars: readonly MarketOhlcBar[]): PaperMatureMarketDatasetArtifact {
  const stableTrades: MarketTradeObservation[] = [
    createTrade(1, 100, 'agent-a', 'Fish', 10),
    createTrade(2, 200, 'agent-b', 'Apple', 10),
    createTrade(3, 1_000_100, 'agent-a', 'Fish', 10),
    createTrade(4, 1_000_200, 'agent-b', 'Apple', 10),
    createTrade(5, 2_000_100, 'agent-a', 'Fish', 10),
    createTrade(6, 2_000_200, 'agent-b', 'Apple', 10),
  ];
  const selectedTrades = [...bars]
    .sort(compareBars)
    .map((bar, index) =>
      createTrade(
        stableTrades.length + index + 1,
        bar.intervalStartedAt + commodityOffset(bar.commodityId),
        index % 2 === 0 ? 'agent-a' : 'agent-b',
        bar.commodityId,
        bar.closePrice,
      ),
    )
    .sort((left, right) => left.observedAt - right.observedAt)
    .map((trade, index) => ({
      ...trade,
      observationId: `trade-${stableTrades.length + index + 1}`,
      sourceEventId: `event-${stableTrades.length + index + 1}`,
      sourceSequence: stableTrades.length + index + 1,
    }));
  return createPaperMatureMarketDatasetArtifact({
    run: {
      runManifestId: 'resolved-run-manifest:sha256:paper-market-analysis',
      simulationId,
      partitionKeys: ['world-main'],
      sourceRevision: { commit: '0123456789abcdef', dirty: true },
      seed: 'paper-market-analysis-seed',
      generatedAt: 1_700_000_000,
      collectionWindowStartedAt: 0,
      collectionWindowEndedAt: 40_000_000,
    },
    sources: [
      {
        partitionKey: 'world-main',
        ledgerFile: {
          filename: 'market-trade-observations.jsonl',
          byteLength: 1,
          sha256: `sha256:${'a'.repeat(64)}`,
        },
        trades: [...stableTrades, ...selectedTrades],
      },
    ],
    policy: {
      minimumSourceTradeCountExclusive: 5,
      selectedTradeCount: selectedTrades.length,
      dayDurationMs: 1_000_000,
      stabilityWindowDayCount: 3,
      maximumDailyCurrencyVolumeCoefficientOfVariation: 0,
      maximumDailyParticipantCountCoefficientOfVariation: 0,
    },
  }).artifact;
}

function createBars(): MarketOhlcBar[] {
  return allCommodityIds.flatMap((commodityId, commodityIndex) =>
    Array.from({ length: 101 }, (_, index) => {
      const intervalStartedAt = analysisStartedAt + index * intervalMs;
      const basePrice = 50 + commodityIndex * 20;
      const closePrice =
        basePrice *
        Math.exp(
          index * 0.0002 + Math.sin(index * 0.37 + commodityIndex) * 0.008,
        );
      const openPrice = closePrice * (1 + (index % 2 === 0 ? -0.001 : 0.001));
      return {
        barId: `${simulationId}:${commodityId}:${intervalStartedAt}`,
        simulationId,
        commodityId,
        intervalStartedAt,
        intervalEndedAt: intervalStartedAt + intervalMs,
        openPrice,
        highPrice: Math.max(openPrice, closePrice) * 1.001,
        lowPrice: Math.min(openPrice, closePrice) * 0.999,
        closePrice,
        tradeCount: 1,
        commodityVolume: 1,
        currencyVolume: closePrice,
      };
    }),
  );
}

function createTrade(
  sequence: number,
  observedAt: number,
  agentId: string,
  commodityId: string,
  price: number,
): MarketTradeObservation {
  return {
    observationId: `trade-${sequence}`,
    simulationId,
    agentId,
    commodityId,
    sourceEventId: `event-${sequence}`,
    sourceSequence: sequence,
    side: sequence % 2 === 0 ? 'sell' : 'buy',
    observedAt,
    price,
    commodityQuantity: 1,
    currencyQuantity: price,
  };
}

function commodityOffset(commodityId: string): number {
  return allCommodityIds.indexOf(commodityId as (typeof allCommodityIds)[number]) + 1;
}

function compareBars(left: MarketOhlcBar, right: MarketOhlcBar): number {
  if (left.intervalStartedAt !== right.intervalStartedAt) {
    return left.intervalStartedAt - right.intervalStartedAt;
  }
  return left.commodityId.localeCompare(right.commodityId);
}
