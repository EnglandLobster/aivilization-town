import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FilePaperMarketAnalysisArtifactRepository,
  PAPER_TABLE_1_COMMODITIES,
  createPaperMatureMarketDatasetArtifact,
  type MarketTradeObservation,
} from '@aivilization/observability';
import { runWorkerPaperMarketAnalysis } from './index';

const roots: string[] = [];
const simulationId = 'sim-worker-paper-market-analysis';
const intervalMs = 300_000;
const selectedStartedAt = 3_000_000;
const commodityIds = [
  ...PAPER_TABLE_1_COMMODITIES,
  'Pure Silicon',
  'Transistor',
  'Book',
] as const;

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('worker paper market analysis', () => {
  test('derives five-minute bars, Table 1, and Figures 4-8 from one verified mature dataset', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'worker-paper-market-analysis-'));
    roots.push(rootDir);
    const dataset = createDataset();
    const repository = new FilePaperMarketAnalysisArtifactRepository({ rootDir });

    const artifact = await runWorkerPaperMarketAnalysis({
      analysisRunId: 'worker-paper-market-analysis-1',
      generatedAt: 1_700_000_000,
      dataset,
      artifactRepository: repository,
      realWorldWindow: {
        startedAtIso: '2025-09-09T00:00:00Z',
        endedAtIso: '2025-09-15T00:00:00Z',
      },
    });

    expect(artifact.dataset.datasetId).toBe(dataset.artifact.datasetId);
    expect(artifact.sourceBars.count).toBe(commodityIds.length * 101);
    expect(artifact.table1.rows).toHaveLength(10);
    expect(artifact.table1.rows.every((row) => row.returnObservationCount === 100)).toBe(true);
    expect(artifact.figures.figures).toHaveLength(5);
    await expect(repository.get(artifact.analysisId)).resolves.toEqual(artifact);
  });

  test('rejects a mutated transaction block before deriving downstream evidence', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'worker-paper-market-analysis-tamper-'));
    roots.push(rootDir);
    const dataset = createDataset();
    const mutated = {
      artifact: dataset.artifact,
      trades: dataset.trades.map((trade, index) =>
        index === 0 ? { ...trade, price: trade.price + 1 } : trade,
      ),
    };

    await expect(
      runWorkerPaperMarketAnalysis({
        analysisRunId: 'worker-paper-market-analysis-tampered',
        generatedAt: 1_700_000_000,
        dataset: mutated,
        artifactRepository: new FilePaperMarketAnalysisArtifactRepository({ rootDir }),
      }),
    ).rejects.toThrow('transaction hash does not match manifest');
  });
});

function createDataset() {
  const stableTrades = [
    createTrade(1, 100, 'Fish', 10),
    createTrade(2, 200, 'Apple', 10),
    createTrade(3, 1_000_100, 'Fish', 10),
    createTrade(4, 1_000_200, 'Apple', 10),
    createTrade(5, 2_000_100, 'Fish', 10),
    createTrade(6, 2_000_200, 'Apple', 10),
  ];
  const selectedTrades: MarketTradeObservation[] = [];
  for (let intervalIndex = 0; intervalIndex < 101; intervalIndex += 1) {
    for (const [commodityIndex, commodityId] of commodityIds.entries()) {
      const sequence = stableTrades.length + selectedTrades.length + 1;
      const basePrice = 50 + commodityIndex * 20;
      const price =
        basePrice *
        Math.exp(
          intervalIndex * 0.0002 +
            Math.sin(intervalIndex * 0.37 + commodityIndex) * 0.008,
        );
      selectedTrades.push(
        createTrade(
          sequence,
          selectedStartedAt + intervalIndex * intervalMs + commodityIndex + 1,
          commodityId,
          price,
        ),
      );
    }
  }
  return createPaperMatureMarketDatasetArtifact({
    run: {
      runManifestId: 'resolved-run-manifest:sha256:worker-paper-market-analysis',
      simulationId,
      partitionKeys: ['world-main'],
      sourceRevision: { commit: '0123456789abcdef', dirty: true },
      seed: 'worker-paper-market-analysis-seed',
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
  });
}

function createTrade(
  sequence: number,
  observedAt: number,
  commodityId: string,
  price: number,
): MarketTradeObservation {
  return {
    observationId: `trade-${sequence}`,
    simulationId,
    agentId: sequence % 2 === 0 ? 'agent-b' : 'agent-a',
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
