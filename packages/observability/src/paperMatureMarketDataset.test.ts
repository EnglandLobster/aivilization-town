import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FilePaperMatureMarketDatasetRepository,
  createPaperMatureMarketDatasetArtifact,
  createPaperMatureMarketDatasetPolicyManifest,
  type MarketTradeObservation,
  type PaperMatureMarketDatasetArtifactInput,
  type PaperMatureMarketDatasetSourceInput,
} from './index';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('paper mature market dataset', () => {
  test('selects the earliest stable window and deterministically merges the subsequent partition block', () => {
    const input = createInput();
    const bundle = createPaperMatureMarketDatasetArtifact({
      ...input,
      sources: [...input.sources]
        .reverse()
        .map((source) => ({ ...source, trades: [...source.trades].reverse() })),
    });

    expect(bundle.artifact.datasetId).toMatch(
      /^paper-mature-market-dataset:sha256:[a-f0-9]{64}$/u,
    );
    expect(bundle.artifact.selection.transactionFile.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(bundle.artifact).toMatchObject({
      schemaVersion: 'paper-mature-market-dataset-v2',
      source: {
        tradeCount: 17,
        partitionCount: 2,
        participantIdentityCoverage: 1,
      },
      maturity: {
        stableWindowStartedAt: 0,
        stableWindowEndedAt: 300,
        stableWindowDayIndexes: [0, 1, 2],
        dailyCurrencyVolumeCoefficientOfVariation: 0,
        dailyParticipantCountCoefficientOfVariation: 0,
      },
      selection: {
        sourceStartIndex: 12,
        sourceEndIndexExclusive: 17,
        tradeCount: 5,
        firstObservedAt: 310,
        lastObservedAt: 330,
        transactionFile: {
          filename: 'transactions.jsonl',
          mimeType: 'application/x-ndjson',
        },
      },
    });
    expect(bundle.artifact.maturity.evaluatedDailyMetrics).toEqual([
      {
        dayIndex: 0,
        startedAt: 0,
        endedAt: 100,
        tradeCount: 4,
        currencyVolume: 40,
        participantCount: 2,
      },
      {
        dayIndex: 1,
        startedAt: 100,
        endedAt: 200,
        tradeCount: 4,
        currencyVolume: 40,
        participantCount: 2,
      },
      {
        dayIndex: 2,
        startedAt: 200,
        endedAt: 300,
        tradeCount: 4,
        currencyVolume: 40,
        participantCount: 2,
      },
      {
        dayIndex: 3,
        startedAt: 300,
        endedAt: 400,
        tradeCount: 5,
        currencyVolume: 50,
        participantCount: 2,
      },
      {
        dayIndex: 4,
        startedAt: 400,
        endedAt: 500,
        tradeCount: 0,
        currencyVolume: 0,
        participantCount: 0,
      },
    ]);
    expect(bundle.trades.map((trade) => trade.observationId)).toEqual([
      'world-east-trade-7',
      'world-main-trade-7',
      'world-east-trade-8',
      'world-main-trade-8',
      'world-east-trade-9',
    ]);
    expect(bundle.trades.map((trade) => [trade.sourcePartitionKey, trade.sourceSequence])).toEqual([
      ['world-east', 7],
      ['world-main', 7],
      ['world-east', 8],
      ['world-main', 8],
      ['world-east', 9],
    ]);
    expect(bundle.artifact.source.partitions).toMatchObject([
      {
        partitionKey: 'world-east',
        tradeCount: 9,
        ledgerFile: { byteLength: 900, sha256: `sha256:${'a'.repeat(64)}` },
      },
      {
        partitionKey: 'world-main',
        tradeCount: 8,
        ledgerFile: { byteLength: 800, sha256: `sha256:${'b'.repeat(64)}` },
      },
    ]);
  });

  test('persists content-addressed JSONL and detects transaction tampering after restart', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'paper-mature-market-dataset-'));
    tempDirs.push(rootDir);
    const bundle = createPaperMatureMarketDatasetArtifact(createInput());
    const repository = new FilePaperMatureMarketDatasetRepository({ rootDir });

    await expect(repository.save(bundle)).resolves.toEqual(bundle);
    await expect(repository.save(bundle)).resolves.toEqual(bundle);
    const restarted = new FilePaperMatureMarketDatasetRepository({ rootDir });
    await expect(restarted.get(bundle.artifact.datasetId)).resolves.toEqual(bundle);

    const artifactDir = join(
      rootDir,
      'paper-mature-market-datasets',
      encodeURIComponent(bundle.artifact.datasetId),
    );
    const transactionsPath = join(artifactDir, 'transactions.jsonl');
    writeFileSync(
      transactionsPath,
      readFileSync(transactionsPath, 'utf8').replace('"price":10', '"price":11'),
      'utf8',
    );
    await expect(restarted.get(bundle.artifact.datasetId)).rejects.toThrow(
      'transaction hash does not match manifest',
    );
  });

  test('fails closed when old observations lack participant provenance', () => {
    const input = createInput();
    const sources = input.sources.map((source, sourceIndex) => ({
      ...source,
      trades: source.trades.map((trade, tradeIndex) =>
        sourceIndex === 0 && tradeIndex === 0 ? withoutAgentId(trade) : trade,
      ),
    }));

    expect(() => createPaperMatureMarketDatasetArtifact({ ...input, sources })).toThrow(
      'missing participant agentId required for maturity detection',
    );
  });

  test('requires the exact manifest partition set and globally unique source identities', () => {
    const input = createInput();
    expect(() =>
      createPaperMatureMarketDatasetArtifact({
        ...input,
        sources: input.sources.slice(0, 1),
      }),
    ).toThrow('must exactly match run manifest partitions');

    expect(() =>
      createPaperMatureMarketDatasetArtifact({
        ...input,
        sources: [...input.sources, createSource('world-west', [10], 'c')],
      }),
    ).toThrow('must exactly match run manifest partitions');

    const duplicatedIdentitySources = input.sources.map((source, sourceIndex) => ({
      ...source,
      trades: source.trades.map((trade, tradeIndex) =>
        sourceIndex === 1 && tradeIndex === 0
          ? { ...trade, observationId: input.sources[0]!.trades[0]!.observationId }
          : trade,
      ),
    }));
    expect(() =>
      createPaperMatureMarketDatasetArtifact({
        ...input,
        sources: duplicatedIdentitySources,
      }),
    ).toThrow('duplicate cross-partition trade observationId');

    const duplicatedSequenceSources = input.sources.map((source, sourceIndex) => ({
      ...source,
      trades: source.trades.map((trade, tradeIndex) =>
        sourceIndex === 0 && tradeIndex === 1
          ? { ...trade, sourceSequence: source.trades[0]!.sourceSequence }
          : trade,
      ),
    }));
    expect(() =>
      createPaperMatureMarketDatasetArtifact({
        ...input,
        sources: duplicatedSequenceSources,
      }),
    ).toThrow('duplicate trade sourceSequence 1 in partition world-east');
  });

  test('rejects insufficient source volume, unstable days, and insufficient subsequent trades', () => {
    const input = createInput();
    expect(() =>
      createPaperMatureMarketDatasetArtifact({
        ...input,
        policy: { ...input.policy, minimumSourceTradeCountExclusive: 17 },
      }),
    ).toThrow('requires more than 17 source trades');

    const unstableSources = input.sources.map((source) => ({
      ...source,
      trades: source.trades.map((trade) =>
        trade.observedAt < 100
          ? { ...trade, currencyQuantity: trade.currencyQuantity * 10 }
          : trade,
      ),
    }));
    expect(() =>
      createPaperMatureMarketDatasetArtifact({ ...input, sources: unstableSources }),
    ).toThrow('did not find a stable complete-day window');

    const insufficientSubsequentSources = input.sources.map((source) => ({
      ...source,
      trades: source.trades.filter((trade) => trade.observedAt < 320),
    }));
    expect(() =>
      createPaperMatureMarketDatasetArtifact({
        ...input,
        sources: insufficientSubsequentSources,
        policy: { ...input.policy, minimumSourceTradeCountExclusive: 11 },
      }),
    ).toThrow('requires 5 trades subsequent to the stable window; received 2');
  });

  test('publishes paper constraints separately from repository-defined stability semantics', () => {
    expect(createPaperMatureMarketDatasetPolicyManifest()).toMatchObject({
      policyVersion: 'paper-mature-market-dataset-v2',
      minimumSourceTradeCountExclusive: 600_000,
      selectedTradeCount: 400_000,
      paperConstraints: {
        sourceTradeCount: 'strictly-greater-than-600000',
        maturitySignals: ['daily-trading-volume', 'participant-count'],
      },
      repositoryDecisions: {
        stabilityWindowDays: 7,
        maximumDailyCurrencyVolumeCoefficientOfVariation: 0.1,
        maximumDailyParticipantCountCoefficientOfVariation: 0.1,
        sourceCompleteness: 'exact partition set from the resolved run manifest',
      },
    });
  });
});

function createInput(): PaperMatureMarketDatasetArtifactInput {
  const eastTimes = [10, 20, 110, 120, 210, 220, 310, 320, 330];
  const mainTimes = [10, 20, 110, 120, 210, 220, 310, 320];
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
      createSource('world-east', eastTimes, 'a'),
      createSource('world-main', mainTimes, 'b'),
    ],
    policy: {
      minimumSourceTradeCountExclusive: 11,
      selectedTradeCount: 5,
      dayDurationMs: 100,
      stabilityWindowDayCount: 3,
      maximumDailyCurrencyVolumeCoefficientOfVariation: 0.05,
      maximumDailyParticipantCountCoefficientOfVariation: 0.05,
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
    trades: times.map((observedAt, index) =>
      createTrade({
        partitionKey,
        sequence: index + 1,
        observedAt,
        agentId: index % 2 === 0 ? 'agent-a' : 'agent-b',
        commodityId: partitionKey === 'world-east' ? 'Fish' : 'Apple',
      }),
    ),
  };
}

function createTrade(input: {
  readonly partitionKey: string;
  readonly sequence: number;
  readonly observedAt: number;
  readonly agentId: string;
  readonly commodityId: string;
}): MarketTradeObservation {
  return {
    observationId: `${input.partitionKey}-trade-${input.sequence}`,
    simulationId: 'sim-paper-market',
    agentId: input.agentId,
    commodityId: input.commodityId,
    sourceEventId: `${input.partitionKey}-event-${input.sequence}`,
    sourceSequence: input.sequence,
    side: input.sequence % 2 === 0 ? 'sell' : 'buy',
    observedAt: input.observedAt,
    price: 10,
    commodityQuantity: 1,
    currencyQuantity: 10,
  };
}

function withoutAgentId(trade: MarketTradeObservation): MarketTradeObservation {
  return Object.fromEntries(
    Object.entries(trade).filter(([key]) => key !== 'agentId'),
  ) as MarketTradeObservation;
}
