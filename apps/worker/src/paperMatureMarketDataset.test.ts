import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FilePaperMatureMarketDatasetRepository,
  InMemoryMarketObservationRepository,
  type MarketTradeObservation,
} from '@aivilization/observability';
import { runWorkerPaperMatureMarketDatasetExtraction } from './index';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('worker paper mature market dataset extraction', () => {
  test('snapshots every partition, verifies quiescence, and persists the merged block', async () => {
    const east = new InMemoryMarketObservationRepository();
    const main = new InMemoryMarketObservationRepository();
    await east.recordTrades(
      createTrades('world-east', [10, 20, 110, 120, 210, 220, 310, 320, 330]),
    );
    await main.recordTrades(
      createTrades('world-main', [10, 20, 110, 120, 210, 220, 310, 320]),
    );
    const rootDir = mkdtempSync(join(tmpdir(), 'worker-paper-market-dataset-'));
    tempDirs.push(rootDir);
    const artifacts = new FilePaperMatureMarketDatasetRepository({ rootDir });

    const result = await runWorkerPaperMatureMarketDatasetExtraction({
      run: {
        runManifestId: 'resolved-run-manifest:sha256:test',
        simulationId: 'sim-paper-market',
        partitionKeys: ['world-east', 'world-main'],
        sourceRevision: { commit: '0123456789abcdef', dirty: true },
        seed: 'paper-market-seed',
        generatedAt: 500,
        collectionWindowStartedAt: 0,
        collectionWindowEndedAt: 500,
      },
      sources: [
        createSource('world-main', main, 'b'),
        createSource('world-east', east, 'a'),
      ],
      artifactRepository: artifacts,
      policy: {
        minimumSourceTradeCountExclusive: 11,
        selectedTradeCount: 5,
        dayDurationMs: 100,
        stabilityWindowDayCount: 3,
        maximumDailyCurrencyVolumeCoefficientOfVariation: 0,
        maximumDailyParticipantCountCoefficientOfVariation: 0,
      },
    });

    expect(result.artifact.selection).toMatchObject({
      tradeCount: 5,
      firstObservedAt: 310,
      lastObservedAt: 330,
    });
    expect(result.artifact.source.partitions.map((source) => source.partitionKey)).toEqual([
      'world-east',
      'world-main',
    ]);
    await expect(artifacts.get(result.artifact.datasetId)).resolves.toEqual(result);
  });

  test('fails closed when any source ledger changes during the global snapshot', async () => {
    const source = new InMemoryMarketObservationRepository();
    let readCount = 0;
    await expect(
      runWorkerPaperMatureMarketDatasetExtraction({
        run: {
          runManifestId: 'resolved-run-manifest:sha256:test',
          simulationId: 'sim-paper-market',
          partitionKeys: ['world-main'],
          sourceRevision: { commit: '0123456789abcdef', dirty: true },
          seed: 'paper-market-seed',
          generatedAt: 500,
          collectionWindowStartedAt: 0,
          collectionWindowEndedAt: 500,
        },
        sources: [
          {
            partitionKey: 'world-main',
            marketObservationRepository: source,
            readLedgerFileProvenance: () => ({
              filename: 'market-trade-observations.jsonl',
              byteLength: 1,
              sha256: `sha256:${(readCount++ === 0 ? 'a' : 'b').repeat(64)}`,
            }),
          },
        ],
        artifactRepository: new FilePaperMatureMarketDatasetRepository({
          rootDir: createTempDir(),
        }),
      }),
    ).rejects.toThrow('source world-main changed during extraction');
  });
});

function createTrades(partitionKey: string, times: readonly number[]): MarketTradeObservation[] {
  return times.map((observedAt, index) => ({
    observationId: `${partitionKey}-trade-${index + 1}`,
    simulationId: 'sim-paper-market',
    agentId: index % 2 === 0 ? 'agent-a' : 'agent-b',
    commodityId: index % 2 === 0 ? 'Fish' : 'Apple',
    sourceEventId: `${partitionKey}-event-${index + 1}`,
    sourceSequence: index + 1,
    side: index % 2 === 0 ? 'buy' : 'sell',
    observedAt,
    price: 10,
    commodityQuantity: 1,
    currencyQuantity: 10,
  }));
}

function createSource(
  partitionKey: string,
  repository: InMemoryMarketObservationRepository,
  hashDigit: string,
) {
  return {
    partitionKey,
    marketObservationRepository: repository,
    readLedgerFileProvenance: () => ({
      filename: 'market-trade-observations.jsonl' as const,
      byteLength: 1,
      sha256: `sha256:${hashDigit.repeat(64)}`,
    }),
  };
}

function createTempDir(): string {
  const rootDir = mkdtempSync(join(tmpdir(), 'worker-paper-market-dataset-'));
  tempDirs.push(rootDir);
  return rootDir;
}
