import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createPaperMatureMarketDatasetArtifact,
  preparePaperMatureMarketDatasetStreaming,
  savePreparedPaperMatureMarketDataset,
  type MarketTradeObservation,
  type PaperMatureMarketDatasetArtifactInput,
  type PaperMatureMarketDatasetSourceInput,
} from './index';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('streaming paper mature market dataset', () => {
  test('is artifact-equivalent to the in-memory v2 algorithm and persists without a trade array', async () => {
    const input = createInput();
    const expected = createPaperMatureMarketDatasetArtifact(input);
    const rootDir = createTempDir();
    const openCounts = new Map<string, number>();
    const prepared = await preparePaperMatureMarketDatasetStreaming({
      run: input.run,
      sources: input.sources.map((source) => ({
        partitionKey: source.partitionKey,
        ledgerFile: source.ledgerFile,
        openTrades: () => {
          openCounts.set(source.partitionKey, (openCounts.get(source.partitionKey) ?? 0) + 1);
          return toAsync(source.trades);
        },
      })),
      stagingDir: join(rootDir, 'staging'),
      policy: input.policy,
    });

    expect(prepared.artifact).toEqual(expected.artifact);
    expect(openCounts).toEqual(
      new Map([
        ['world-east', 2],
        ['world-main', 2],
      ]),
    );
    const selected = readFileSync(prepared.transactionsPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);
    expect(selected).toEqual(expected.trades);

    await expect(
      savePreparedPaperMatureMarketDataset({
        rootDir: join(rootDir, 'artifacts'),
        prepared,
      }),
    ).resolves.toEqual(expected.artifact);
    const artifactDir = join(
      rootDir,
      'artifacts',
      'paper-mature-market-datasets',
      encodeURIComponent(expected.artifact.datasetId),
    );
    expect(readFileSync(join(artifactDir, 'artifact.json'), 'utf8')).toBe(
      `${JSON.stringify(expected.artifact, null, 2)}\n`,
    );
    expect(readFileSync(join(artifactDir, 'transactions.jsonl'), 'utf8'))
      .toBe(expected.trades.map((trade) => JSON.stringify(trade)).join('\n') + '\n');
  });

  test('checks the immutable source snapshot between both passes and after selection', async () => {
    const input = createInput();
    const rootDir = createTempDir();
    let snapshotChecks = 0;
    await expect(
      preparePaperMatureMarketDatasetStreaming({
        run: input.run,
        sources: input.sources.map((source) => ({
          partitionKey: source.partitionKey,
          ledgerFile: source.ledgerFile,
          openTrades: () => toAsync(source.trades),
        })),
        stagingDir: rootDir,
        policy: input.policy,
        assertSourceSnapshot: () => {
          snapshotChecks += 1;
          if (snapshotChecks === 2) throw new Error('source changed');
        },
      }),
    ).rejects.toThrow('source changed');
    expect(snapshotChecks).toBe(2);
  });

  test('rejects duplicate global identities using the bounded disk index', async () => {
    const input = createInput();
    const duplicated = input.sources.map((source, index) => ({
      ...source,
      trades:
        index === 0
          ? source.trades
          : source.trades.map((trade, tradeIndex) =>
              tradeIndex === 0
                ? { ...trade, observationId: input.sources[0]!.trades[0]!.observationId }
                : trade,
            ),
    }));
    await expect(
      preparePaperMatureMarketDatasetStreaming({
        run: input.run,
        sources: duplicated.map((source) => ({
          partitionKey: source.partitionKey,
          ledgerFile: source.ledgerFile,
          openTrades: () => toAsync(source.trades),
        })),
        stagingDir: createTempDir(),
        policy: input.policy,
      }),
    ).rejects.toThrow('duplicate cross-partition trade observationId');
  });
});

async function* toAsync<T>(values: readonly T[]): AsyncGenerator<T> {
  for (const value of values) yield await Promise.resolve(value);
}

function createInput(): PaperMatureMarketDatasetArtifactInput {
  return {
    run: {
      runManifestId: 'resolved-run-manifest:sha256:test',
      simulationId: 'sim-paper-market',
      partitionKeys: ['world-east', 'world-main'],
      sourceRevision: { commit: '0123456789abcdef', dirty: false },
      seed: 'paper-market-seed',
      generatedAt: 500,
      collectionWindowStartedAt: 0,
      collectionWindowEndedAt: 500,
    },
    sources: [
      createSource('world-east', [10, 20, 110, 120, 210, 220, 310, 320, 330], 'a'),
      createSource('world-main', [10, 20, 110, 120, 210, 220, 310, 320], 'b'),
    ],
    policy: {
      minimumSourceTradeCountExclusive: 11,
      selectedTradeCount: 5,
      dayDurationMs: 100,
      stabilityWindowDayCount: 3,
      maximumDailyCurrencyVolumeCoefficientOfVariation: 0,
      maximumDailyParticipantCountCoefficientOfVariation: 0,
    },
  };
}

function createSource(
  partitionKey: string,
  times: readonly number[],
  hashDigit: string,
): PaperMatureMarketDatasetSourceInput {
  return {
    partitionKey,
    ledgerFile: {
      filename: 'market-trade-observations.jsonl',
      byteLength: times.length * 100,
      sha256: `sha256:${hashDigit.repeat(64)}`,
    },
    trades: times.map((observedAt, index): MarketTradeObservation => ({
      observationId: `${partitionKey}-trade-${index + 1}`,
      simulationId: 'sim-paper-market',
      agentId: index % 2 === 0 ? 'agent-a' : 'agent-b',
      commodityId: partitionKey === 'world-east' ? 'Fish' : 'Apple',
      sourceEventId: `${partitionKey}-event-${index + 1}`,
      sourceSequence: index + 1,
      side: index % 2 === 0 ? 'sell' : 'buy',
      observedAt,
      price: 10,
      commodityQuantity: 1,
      currencyQuantity: 10,
    })),
  };
}

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'paper-market-streaming-'));
  tempDirs.push(dir);
  return dir;
}
