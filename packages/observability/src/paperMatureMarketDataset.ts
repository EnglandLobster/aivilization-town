import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneSourceRevision, type SourceRevision } from '@aivilization/sim-core';
import type { MarketTradeObservation } from './marketObservationRepository';

export const PAPER_MATURE_MARKET_DATASET_SCHEMA_VERSION = 'paper-mature-market-dataset-v2';
export const PAPER_MATURE_MARKET_DATASET_MINIMUM_SOURCE_TRADE_COUNT_EXCLUSIVE = 600_000;
export const PAPER_MATURE_MARKET_DATASET_SELECTED_TRADE_COUNT = 400_000;
export const PAPER_MATURE_MARKET_DATASET_DAY_DURATION_MS = 24 * 60 * 60 * 1_000;
export const PAPER_MATURE_MARKET_DATASET_STABILITY_WINDOW_DAY_COUNT = 7;
export const PAPER_MATURE_MARKET_DATASET_MAXIMUM_VOLUME_CV = 0.1;
export const PAPER_MATURE_MARKET_DATASET_MAXIMUM_PARTICIPANT_CV = 0.1;

const TRANSACTION_FILENAME = 'transactions.jsonl';
const MANIFEST_FILENAME = 'artifact.json';
const DATASET_ID_PREFIX = 'paper-mature-market-dataset:sha256:';
export const PAPER_MATURE_MARKET_SOURCE_LEDGER_FILENAME =
  'market-trade-observations.jsonl';

export type PaperMatureMarketSourceLedgerFile = {
  readonly filename: typeof PAPER_MATURE_MARKET_SOURCE_LEDGER_FILENAME;
  readonly byteLength: number;
  readonly sha256: string;
};

export type PaperMatureMarketDatasetTrade = MarketTradeObservation & {
  readonly sourcePartitionKey: string;
};

export type PaperMatureMarketDatasetSourceInput = {
  readonly partitionKey: string;
  readonly ledgerFile: PaperMatureMarketSourceLedgerFile;
  readonly trades: readonly MarketTradeObservation[];
};

export type PaperMatureMarketDatasetPolicy = {
  readonly policyVersion: typeof PAPER_MATURE_MARKET_DATASET_SCHEMA_VERSION;
  readonly minimumSourceTradeCountExclusive: number;
  readonly selectedTradeCount: number;
  readonly dayDurationMs: number;
  readonly dayOriginAt: number;
  readonly stabilityWindowDayCount: number;
  readonly maximumDailyCurrencyVolumeCoefficientOfVariation: number;
  readonly maximumDailyParticipantCountCoefficientOfVariation: number;
  readonly standardDeviationRule: 'population';
  readonly dailyTradingVolumeRule: 'sum-currency-quantity-across-trades';
  readonly participantCountRule: 'distinct-trading-agent-id';
  readonly stableWindowSelectionRule: 'earliest-complete-consecutive-window';
  readonly selectedBlockRule: 'first-n-subsequent-trades-in-deterministic-cross-partition-order';
  readonly sourceCompletenessRule: 'exact-run-manifest-partition-set';
  readonly crossPartitionOrderRule: 'observed-at-then-source-sequence-then-partition-key-then-observation-id';
  readonly sourceIdentityRule: 'global-observation-and-event-ids-plus-partition-local-sequence';
  readonly participantIdentityRule: 'required-fail-closed';
  readonly timeBasis: 'simulated-time';
};

export type PaperMatureMarketDatasetDailyMetric = {
  readonly dayIndex: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly tradeCount: number;
  readonly currencyVolume: number;
  readonly participantCount: number;
};

export type PaperMatureMarketDatasetArtifact = {
  readonly schemaVersion: typeof PAPER_MATURE_MARKET_DATASET_SCHEMA_VERSION;
  readonly datasetId: string;
  readonly run: {
    readonly runManifestId: string;
    readonly simulationId: string;
    readonly partitionKeys: readonly string[];
    readonly sourceRevision: SourceRevision;
    readonly seed: string;
    readonly generatedAt: number;
    readonly collectionWindowStartedAt: number;
    readonly collectionWindowEndedAt: number;
  };
  readonly policy: PaperMatureMarketDatasetPolicy;
  readonly source: {
    readonly partitionCount: number;
    readonly partitions: readonly {
      readonly partitionKey: string;
      readonly tradeCount: number;
      readonly firstObservationId: string | null;
      readonly lastObservationId: string | null;
      readonly firstObservedAt: number | null;
      readonly lastObservedAt: number | null;
      readonly firstSourceSequence: number | null;
      readonly lastSourceSequence: number | null;
      readonly collectionTransactionsSha256: string;
      readonly ledgerFile: PaperMatureMarketSourceLedgerFile;
    }[];
    readonly tradeCount: number;
    readonly firstObservationId: string;
    readonly lastObservationId: string;
    readonly firstObservedAt: number;
    readonly lastObservedAt: number;
    readonly firstSourceSequence: number;
    readonly lastSourceSequence: number;
    readonly firstSourcePartitionKey: string;
    readonly lastSourcePartitionKey: string;
    readonly participantIdentityCoverage: 1;
    readonly transactionsSha256: string;
  };
  readonly maturity: {
    readonly evaluatedDailyMetrics: readonly PaperMatureMarketDatasetDailyMetric[];
    readonly stableWindowStartedAt: number;
    readonly stableWindowEndedAt: number;
    readonly stableWindowDayIndexes: readonly number[];
    readonly dailyCurrencyVolumeCoefficientOfVariation: number;
    readonly dailyParticipantCountCoefficientOfVariation: number;
  };
  readonly selection: {
    readonly sourceStartIndex: number;
    readonly sourceEndIndexExclusive: number;
    readonly tradeCount: number;
    readonly firstObservationId: string;
    readonly lastObservationId: string;
    readonly firstObservedAt: number;
    readonly lastObservedAt: number;
    readonly firstSourceSequence: number;
    readonly lastSourceSequence: number;
    readonly firstSourcePartitionKey: string;
    readonly lastSourcePartitionKey: string;
    readonly transactionFile: {
      readonly filename: typeof TRANSACTION_FILENAME;
      readonly mimeType: 'application/x-ndjson';
      readonly sha256: string;
    };
  };
};

export type PaperMatureMarketDatasetBundle = {
  readonly artifact: PaperMatureMarketDatasetArtifact;
  readonly trades: readonly PaperMatureMarketDatasetTrade[];
};

export type PaperMatureMarketDatasetArtifactInput = {
  readonly run: PaperMatureMarketDatasetArtifact['run'];
  readonly sources: readonly PaperMatureMarketDatasetSourceInput[];
  readonly policy?: Partial<
    Omit<
      PaperMatureMarketDatasetPolicy,
      | 'policyVersion'
      | 'standardDeviationRule'
      | 'dailyTradingVolumeRule'
      | 'participantCountRule'
      | 'stableWindowSelectionRule'
      | 'selectedBlockRule'
      | 'sourceCompletenessRule'
      | 'crossPartitionOrderRule'
      | 'sourceIdentityRule'
      | 'participantIdentityRule'
      | 'timeBasis'
    >
  >;
};

export function createPaperMatureMarketDatasetPolicy(
  overrides: PaperMatureMarketDatasetArtifactInput['policy'] = {},
): PaperMatureMarketDatasetPolicy {
  const policy: PaperMatureMarketDatasetPolicy = {
    policyVersion: PAPER_MATURE_MARKET_DATASET_SCHEMA_VERSION,
    minimumSourceTradeCountExclusive:
      overrides.minimumSourceTradeCountExclusive ??
      PAPER_MATURE_MARKET_DATASET_MINIMUM_SOURCE_TRADE_COUNT_EXCLUSIVE,
    selectedTradeCount:
      overrides.selectedTradeCount ?? PAPER_MATURE_MARKET_DATASET_SELECTED_TRADE_COUNT,
    dayDurationMs: overrides.dayDurationMs ?? PAPER_MATURE_MARKET_DATASET_DAY_DURATION_MS,
    dayOriginAt: overrides.dayOriginAt ?? 0,
    stabilityWindowDayCount:
      overrides.stabilityWindowDayCount ?? PAPER_MATURE_MARKET_DATASET_STABILITY_WINDOW_DAY_COUNT,
    maximumDailyCurrencyVolumeCoefficientOfVariation:
      overrides.maximumDailyCurrencyVolumeCoefficientOfVariation ??
      PAPER_MATURE_MARKET_DATASET_MAXIMUM_VOLUME_CV,
    maximumDailyParticipantCountCoefficientOfVariation:
      overrides.maximumDailyParticipantCountCoefficientOfVariation ??
      PAPER_MATURE_MARKET_DATASET_MAXIMUM_PARTICIPANT_CV,
    standardDeviationRule: 'population',
    dailyTradingVolumeRule: 'sum-currency-quantity-across-trades',
    participantCountRule: 'distinct-trading-agent-id',
    stableWindowSelectionRule: 'earliest-complete-consecutive-window',
    selectedBlockRule: 'first-n-subsequent-trades-in-deterministic-cross-partition-order',
    sourceCompletenessRule: 'exact-run-manifest-partition-set',
    crossPartitionOrderRule:
      'observed-at-then-source-sequence-then-partition-key-then-observation-id',
    sourceIdentityRule:
      'global-observation-and-event-ids-plus-partition-local-sequence',
    participantIdentityRule: 'required-fail-closed',
    timeBasis: 'simulated-time',
  };
  assertValidPolicy(policy);
  return policy;
}

export function createPaperMatureMarketDatasetPolicyManifest() {
  return {
    ...createPaperMatureMarketDatasetPolicy(),
    paperConstraints: {
      sourceTradeCount: 'strictly-greater-than-600000',
      selectedTradeCount: 400_000,
      maturitySignals: ['daily-trading-volume', 'participant-count'],
      selectedPhase: 'subsequent-continuous-block',
    },
    repositoryDecisions: {
      stabilityWindowDays: PAPER_MATURE_MARKET_DATASET_STABILITY_WINDOW_DAY_COUNT,
      dailyTradingVolume: 'sum of currencyQuantity across all trades in one simulated day',
      coefficientOfVariation: 'population-standard-deviation-divided-by-mean',
      maximumDailyCurrencyVolumeCoefficientOfVariation:
        PAPER_MATURE_MARKET_DATASET_MAXIMUM_VOLUME_CV,
      maximumDailyParticipantCountCoefficientOfVariation:
        PAPER_MATURE_MARKET_DATASET_MAXIMUM_PARTICIPANT_CV,
      timeBasis:
        'simulated time from market observations stamped with the post-advance world clock',
      sourceWindowRule: 'only fully observed day buckets are eligible',
      sourceCompleteness: 'exact partition set from the resolved run manifest',
      crossPartitionOrder:
        'observedAt, then partition-local sourceSequence, then partitionKey, then observationId',
      simultaneousCrossPartitionTradeOrder:
        'deterministic repository tie-break because the paper and sharded runtime expose no global event sequence',
    },
  } as const;
}

export function createPaperMatureMarketDatasetArtifact(
  input: PaperMatureMarketDatasetArtifactInput,
): PaperMatureMarketDatasetBundle {
  assertValidRun(input.run);
  const policy = createPaperMatureMarketDatasetPolicy(input.policy);
  const normalizedSource = normalizeSourceCollection(input.sources, input.run);
  const sourceTrades = normalizedSource.trades;
  if (sourceTrades.length <= policy.minimumSourceTradeCountExclusive) {
    throw new Error(
      `paper mature market dataset requires more than ${policy.minimumSourceTradeCountExclusive} source trades; received ${sourceTrades.length}`,
    );
  }

  const dailyMetrics = createCompleteDailyMetrics(sourceTrades, input.run, policy);
  const stableWindow = findStableWindow(dailyMetrics, policy);
  const sourceStartIndex = sourceTrades.findIndex(
    (trade) => trade.observedAt >= stableWindow.endedAt,
  );
  const availableTradeCount = sourceStartIndex === -1 ? 0 : sourceTrades.length - sourceStartIndex;
  if (sourceStartIndex === -1 || availableTradeCount < policy.selectedTradeCount) {
    throw new Error(
      `paper mature market dataset requires ${policy.selectedTradeCount} trades subsequent to the stable window; received ${availableTradeCount}`,
    );
  }
  const selectedTrades = sourceTrades.slice(
    sourceStartIndex,
    sourceStartIndex + policy.selectedTradeCount,
  );
  const firstSourceTrade = requireFirst(sourceTrades, 'source trades');
  const lastSourceTrade = requireLast(sourceTrades, 'source trades');
  const firstSelectedTrade = requireFirst(selectedTrades, 'selected trades');
  const lastSelectedTrade = requireLast(selectedTrades, 'selected trades');
  const selectedTransactionsSha256 = hashTradeLines(selectedTrades);

  const artifactWithoutId: Omit<PaperMatureMarketDatasetArtifact, 'datasetId'> = {
    schemaVersion: PAPER_MATURE_MARKET_DATASET_SCHEMA_VERSION,
    run: cloneRun(input.run),
    policy,
    source: {
      partitionCount: normalizedSource.partitions.length,
      partitions: normalizedSource.partitions.map((partition) =>
        createSourcePartitionArtifact(partition),
      ),
      tradeCount: sourceTrades.length,
      firstObservationId: firstSourceTrade.observationId,
      lastObservationId: lastSourceTrade.observationId,
      firstObservedAt: firstSourceTrade.observedAt,
      lastObservedAt: lastSourceTrade.observedAt,
      firstSourceSequence: firstSourceTrade.sourceSequence,
      lastSourceSequence: lastSourceTrade.sourceSequence,
      firstSourcePartitionKey: firstSourceTrade.sourcePartitionKey,
      lastSourcePartitionKey: lastSourceTrade.sourcePartitionKey,
      participantIdentityCoverage: 1,
      transactionsSha256: hashTradeLines(sourceTrades),
    },
    maturity: {
      evaluatedDailyMetrics: dailyMetrics.map(cloneDailyMetric),
      stableWindowStartedAt: stableWindow.startedAt,
      stableWindowEndedAt: stableWindow.endedAt,
      stableWindowDayIndexes: stableWindow.metrics.map((metric) => metric.dayIndex),
      dailyCurrencyVolumeCoefficientOfVariation: stableWindow.currencyVolumeCv,
      dailyParticipantCountCoefficientOfVariation: stableWindow.participantCountCv,
    },
    selection: {
      sourceStartIndex,
      sourceEndIndexExclusive: sourceStartIndex + selectedTrades.length,
      tradeCount: selectedTrades.length,
      firstObservationId: firstSelectedTrade.observationId,
      lastObservationId: lastSelectedTrade.observationId,
      firstObservedAt: firstSelectedTrade.observedAt,
      lastObservedAt: lastSelectedTrade.observedAt,
      firstSourceSequence: firstSelectedTrade.sourceSequence,
      lastSourceSequence: lastSelectedTrade.sourceSequence,
      firstSourcePartitionKey: firstSelectedTrade.sourcePartitionKey,
      lastSourcePartitionKey: lastSelectedTrade.sourcePartitionKey,
      transactionFile: {
        filename: TRANSACTION_FILENAME,
        mimeType: 'application/x-ndjson',
        sha256: selectedTransactionsSha256,
      },
    },
  };
  const artifact: PaperMatureMarketDatasetArtifact = {
    ...artifactWithoutId,
    datasetId: createDatasetId(artifactWithoutId),
  };
  assertValidBundle({ artifact, trades: selectedTrades });
  return cloneBundle({ artifact, trades: selectedTrades });
}

export function validatePaperMatureMarketDatasetBundle(
  bundle: PaperMatureMarketDatasetBundle,
): PaperMatureMarketDatasetBundle {
  assertValidBundle(bundle);
  return cloneBundle(bundle);
}

export class FilePaperMatureMarketDatasetRepository {
  private readonly rootDir: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = join(input.rootDir, 'paper-mature-market-datasets');
    mkdirSync(this.rootDir, { recursive: true });
  }

  save(bundle: PaperMatureMarketDatasetBundle): Promise<PaperMatureMarketDatasetBundle> {
    return Promise.resolve().then(() => {
      assertValidBundle(bundle);
      const cloned = cloneBundle(bundle);
      const artifactDir = this.resolveArtifactDir(cloned.artifact.datasetId);
      const manifestPath = join(artifactDir, MANIFEST_FILENAME);
      const transactionsPath = join(artifactDir, TRANSACTION_FILENAME);
      const manifest = `${JSON.stringify(cloned.artifact, null, 2)}\n`;
      const transactions = serializeTradeLines(cloned.trades);
      if (existsSync(manifestPath)) {
        if (
          readFileSync(manifestPath, 'utf8') !== manifest ||
          !existsSync(transactionsPath) ||
          readFileSync(transactionsPath, 'utf8') !== transactions
        ) {
          throw new Error(`paper mature market dataset ${cloned.artifact.datasetId} is immutable`);
        }
        return cloned;
      }
      mkdirSync(artifactDir, { recursive: true });
      writeAtomically(transactionsPath, transactions);
      writeAtomically(manifestPath, manifest);
      return cloned;
    });
  }

  get(datasetId: string): Promise<PaperMatureMarketDatasetBundle | undefined> {
    return Promise.resolve().then(() => {
      assertDatasetId(datasetId);
      const artifactDir = this.resolveArtifactDir(datasetId);
      const manifestPath = join(artifactDir, MANIFEST_FILENAME);
      if (!existsSync(manifestPath)) {
        return undefined;
      }
      const transactionsPath = join(artifactDir, TRANSACTION_FILENAME);
      if (!existsSync(transactionsPath)) {
        throw new Error(`paper mature market dataset ${datasetId} is missing transactions`);
      }
      const artifact = JSON.parse(
        readFileSync(manifestPath, 'utf8'),
      ) as PaperMatureMarketDatasetArtifact;
      const trades = parseTradeLines(readFileSync(transactionsPath, 'utf8'));
      const bundle = { artifact, trades };
      assertValidBundle(bundle);
      if (artifact.datasetId !== datasetId) {
        throw new Error(`paper mature market dataset path does not match ${artifact.datasetId}`);
      }
      return cloneBundle(bundle);
    });
  }

  private resolveArtifactDir(datasetId: string): string {
    return join(this.rootDir, encodeURIComponent(datasetId));
  }
}

type NormalizedPaperMatureMarketDatasetSource = {
  readonly partitionKey: string;
  readonly ledgerFile: PaperMatureMarketSourceLedgerFile;
  readonly trades: readonly PaperMatureMarketDatasetTrade[];
};

function normalizeSourceCollection(
  sources: readonly PaperMatureMarketDatasetSourceInput[],
  run: PaperMatureMarketDatasetArtifact['run'],
): {
  readonly partitions: readonly NormalizedPaperMatureMarketDatasetSource[];
  readonly trades: readonly PaperMatureMarketDatasetTrade[];
} {
  const sourcesByPartition = new Map<string, PaperMatureMarketDatasetSourceInput>();
  for (const source of sources) {
    assertNonEmpty(source.partitionKey, 'source.partitionKey');
    if (sourcesByPartition.has(source.partitionKey)) {
      throw new Error(`duplicate paper market source partition ${source.partitionKey}`);
    }
    sourcesByPartition.set(source.partitionKey, source);
  }
  const sourcePartitionKeys = [...sourcesByPartition.keys()].sort();
  if (!sameStrings(sourcePartitionKeys, run.partitionKeys)) {
    throw new Error(
      `paper market source partitions must exactly match run manifest partitions; expected ${run.partitionKeys.join(',')}, received ${sourcePartitionKeys.join(',')}`,
    );
  }

  const partitions = run.partitionKeys.map((partitionKey) => {
    const source = sourcesByPartition.get(partitionKey)!;
    assertValidSourceLedgerFile(source.ledgerFile, `source ${partitionKey} ledgerFile`);
    const trades = source.trades
      .map((trade) => ({
        ...cloneAndValidateTrade(trade),
        sourcePartitionKey: partitionKey,
      }))
      .sort(comparePartitionTrades);
    assertValidPartitionTrades(trades, partitionKey, run);
    return {
      partitionKey,
      ledgerFile: cloneSourceLedgerFile(source.ledgerFile),
      trades,
    };
  });

  const normalized = partitions.flatMap((partition) => partition.trades).sort(compareTrades);
  const observationIds = new Set<string>();
  const sourceEventIds = new Set<string>();
  for (const trade of normalized) {
    if (observationIds.has(trade.observationId)) {
      throw new Error(`duplicate cross-partition trade observationId ${trade.observationId}`);
    }
    if (sourceEventIds.has(trade.sourceEventId)) {
      throw new Error(`duplicate cross-partition trade sourceEventId ${trade.sourceEventId}`);
    }
    observationIds.add(trade.observationId);
    sourceEventIds.add(trade.sourceEventId);
  }
  return { partitions, trades: normalized };
}

function assertValidPartitionTrades(
  trades: readonly PaperMatureMarketDatasetTrade[],
  partitionKey: string,
  run: PaperMatureMarketDatasetArtifact['run'],
): void {
  const sourceSequences = new Set<number>();
  for (const [index, trade] of trades.entries()) {
    if (trade.simulationId !== run.simulationId) {
      throw new Error(`trade ${trade.observationId} simulationId must match ${run.simulationId}`);
    }
    if (
      trade.observedAt < run.collectionWindowStartedAt ||
      trade.observedAt >= run.collectionWindowEndedAt
    ) {
      throw new Error(`trade ${trade.observationId} falls outside the collection window`);
    }
    if (trade.agentId === undefined) {
      throw new Error(
        `trade ${trade.observationId} is missing participant agentId required for maturity detection`,
      );
    }
    if (sourceSequences.has(trade.sourceSequence)) {
      throw new Error(
        `duplicate trade sourceSequence ${trade.sourceSequence} in partition ${partitionKey}`,
      );
    }
    const previous = trades[index - 1];
    if (previous !== undefined && trade.observedAt < previous.observedAt) {
      throw new Error(
        `trade ${trade.observationId} observedAt moves backward in partition ${partitionKey} event order`,
      );
    }
    sourceSequences.add(trade.sourceSequence);
  }
}

function createSourcePartitionArtifact(
  source: NormalizedPaperMatureMarketDatasetSource,
): PaperMatureMarketDatasetArtifact['source']['partitions'][number] {
  const first = source.trades[0];
  const last = source.trades.at(-1);
  return {
    partitionKey: source.partitionKey,
    tradeCount: source.trades.length,
    firstObservationId: first?.observationId ?? null,
    lastObservationId: last?.observationId ?? null,
    firstObservedAt: first?.observedAt ?? null,
    lastObservedAt: last?.observedAt ?? null,
    firstSourceSequence: first?.sourceSequence ?? null,
    lastSourceSequence: last?.sourceSequence ?? null,
    collectionTransactionsSha256: hashTradeLines(source.trades),
    ledgerFile: cloneSourceLedgerFile(source.ledgerFile),
  };
}

function createCompleteDailyMetrics(
  trades: readonly MarketTradeObservation[],
  run: PaperMatureMarketDatasetArtifact['run'],
  policy: PaperMatureMarketDatasetPolicy,
): PaperMatureMarketDatasetDailyMetric[] {
  const firstCompleteDayIndex = Math.ceil(
    (run.collectionWindowStartedAt - policy.dayOriginAt) / policy.dayDurationMs,
  );
  const lastCompleteDayIndexExclusive = Math.floor(
    (run.collectionWindowEndedAt - policy.dayOriginAt) / policy.dayDurationMs,
  );
  const metrics: PaperMatureMarketDatasetDailyMetric[] = [];
  let tradeIndex = 0;
  for (
    let dayIndex = firstCompleteDayIndex;
    dayIndex < lastCompleteDayIndexExclusive;
    dayIndex += 1
  ) {
    const startedAt = policy.dayOriginAt + dayIndex * policy.dayDurationMs;
    const endedAt = startedAt + policy.dayDurationMs;
    while (tradeIndex < trades.length && trades[tradeIndex]!.observedAt < startedAt) {
      tradeIndex += 1;
    }
    const participants = new Set<string>();
    let cursor = tradeIndex;
    let currencyVolume = 0;
    while (cursor < trades.length && trades[cursor]!.observedAt < endedAt) {
      const trade = trades[cursor]!;
      currencyVolume += trade.currencyQuantity;
      participants.add(requireAgentId(trade));
      cursor += 1;
    }
    metrics.push({
      dayIndex,
      startedAt,
      endedAt,
      tradeCount: cursor - tradeIndex,
      currencyVolume,
      participantCount: participants.size,
    });
    tradeIndex = cursor;
  }
  if (metrics.length < policy.stabilityWindowDayCount) {
    throw new Error(
      `paper mature market dataset requires at least ${policy.stabilityWindowDayCount} fully observed daily buckets; received ${metrics.length}`,
    );
  }
  return metrics;
}

function findStableWindow(
  metrics: readonly PaperMatureMarketDatasetDailyMetric[],
  policy: PaperMatureMarketDatasetPolicy,
): {
  readonly metrics: readonly PaperMatureMarketDatasetDailyMetric[];
  readonly startedAt: number;
  readonly endedAt: number;
  readonly currencyVolumeCv: number;
  readonly participantCountCv: number;
} {
  for (let start = 0; start <= metrics.length - policy.stabilityWindowDayCount; start += 1) {
    const candidate = metrics.slice(start, start + policy.stabilityWindowDayCount);
    if (candidate.some((metric) => metric.tradeCount === 0 || metric.participantCount === 0)) {
      continue;
    }
    const currencyVolumeCv = coefficientOfVariation(
      candidate.map((metric) => metric.currencyVolume),
    );
    const participantCountCv = coefficientOfVariation(
      candidate.map((metric) => metric.participantCount),
    );
    if (
      currencyVolumeCv <= policy.maximumDailyCurrencyVolumeCoefficientOfVariation &&
      participantCountCv <= policy.maximumDailyParticipantCountCoefficientOfVariation
    ) {
      return {
        metrics: candidate,
        startedAt: requireFirst(candidate, 'stable daily metrics').startedAt,
        endedAt: requireLast(candidate, 'stable daily metrics').endedAt,
        currencyVolumeCv,
        participantCountCv,
      };
    }
  }
  throw new Error(
    'paper mature market dataset did not find a stable complete-day window under the configured coefficient-of-variation thresholds',
  );
}

function coefficientOfVariation(values: readonly number[]): number {
  const mean = sum(values) / values.length;
  if (mean <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const variance = sum(values.map((value) => (value - mean) ** 2)) / values.length;
  return Math.sqrt(variance) / mean;
}

function assertValidBundle(bundle: PaperMatureMarketDatasetBundle): void {
  const artifact = bundle.artifact;
  if (artifact.schemaVersion !== PAPER_MATURE_MARKET_DATASET_SCHEMA_VERSION) {
    throw new Error('paper mature market dataset schemaVersion is unsupported');
  }
  assertValidRun(artifact.run);
  assertValidPolicy(artifact.policy);
  assertDatasetId(artifact.datasetId);
  const artifactWithoutId = Object.fromEntries(
    Object.entries(artifact).filter(([key]) => key !== 'datasetId'),
  ) as Omit<PaperMatureMarketDatasetArtifact, 'datasetId'>;
  if (createDatasetId(artifactWithoutId) !== artifact.datasetId) {
    throw new Error('paper mature market dataset ID does not match artifact content');
  }
  assertValidSourceArtifact(artifact);
  if (bundle.trades.length !== artifact.selection.tradeCount) {
    throw new Error('paper mature market dataset trade count does not match manifest');
  }
  if (artifact.selection.tradeCount !== artifact.policy.selectedTradeCount) {
    throw new Error('paper mature market dataset selection must match policy selectedTradeCount');
  }
  if (
    artifact.selection.sourceEndIndexExclusive - artifact.selection.sourceStartIndex !==
    artifact.selection.tradeCount
  ) {
    throw new Error('paper mature market dataset source indexes do not match selection count');
  }
  if (artifact.selection.transactionFile.filename !== TRANSACTION_FILENAME) {
    throw new Error('paper mature market dataset transaction filename is unsupported');
  }
  const trades = bundle.trades.map(cloneAndValidateDatasetTrade);
  if (trades.some((trade) => trade.agentId === undefined)) {
    throw new Error('paper mature market dataset transactions require participant agentId');
  }
  if (trades.some((trade) => trade.simulationId !== artifact.run.simulationId)) {
    throw new Error('paper mature market dataset transactions must match run simulationId');
  }
  for (let index = 1; index < trades.length; index += 1) {
    if (compareTrades(trades[index - 1]!, trades[index]!) > 0) {
      throw new Error(
        'paper mature market dataset transactions must use deterministic cross-partition order',
      );
    }
  }
  if (hashTradeLines(trades) !== artifact.selection.transactionFile.sha256) {
    throw new Error('paper mature market dataset transaction hash does not match manifest');
  }
  const first = requireFirst(trades, 'selected trades');
  const last = requireLast(trades, 'selected trades');
  if (
    first.observationId !== artifact.selection.firstObservationId ||
    last.observationId !== artifact.selection.lastObservationId ||
    first.observedAt !== artifact.selection.firstObservedAt ||
    last.observedAt !== artifact.selection.lastObservedAt ||
    first.sourceSequence !== artifact.selection.firstSourceSequence ||
    last.sourceSequence !== artifact.selection.lastSourceSequence ||
    first.sourcePartitionKey !== artifact.selection.firstSourcePartitionKey ||
    last.sourcePartitionKey !== artifact.selection.lastSourcePartitionKey
  ) {
    throw new Error('paper mature market dataset transaction boundaries do not match manifest');
  }
  if (first.observedAt < artifact.maturity.stableWindowEndedAt) {
    throw new Error('paper mature market dataset selection must be subsequent to stable window');
  }
  if (
    artifact.maturity.dailyCurrencyVolumeCoefficientOfVariation >
      artifact.policy.maximumDailyCurrencyVolumeCoefficientOfVariation ||
    artifact.maturity.dailyParticipantCountCoefficientOfVariation >
      artifact.policy.maximumDailyParticipantCountCoefficientOfVariation
  ) {
    throw new Error('paper mature market dataset stable window exceeds policy thresholds');
  }
}

function assertValidSourceArtifact(artifact: PaperMatureMarketDatasetArtifact): void {
  const source = artifact.source;
  if (
    source.partitionCount !== source.partitions.length ||
    source.partitionCount !== artifact.run.partitionKeys.length
  ) {
    throw new Error('paper mature market dataset source partition count is inconsistent');
  }
  const partitionKeys = source.partitions.map((partition) => partition.partitionKey);
  if (!sameStrings(partitionKeys, artifact.run.partitionKeys)) {
    throw new Error('paper mature market dataset source partitions must match run manifest order');
  }
  let tradeCount = 0;
  for (const partition of source.partitions) {
    assertNonEmpty(partition.partitionKey, 'source partitionKey');
    assertNonNegativeInteger(partition.tradeCount, 'source partition tradeCount');
    assertValidSourceLedgerFile(
      partition.ledgerFile,
      `source ${partition.partitionKey} ledgerFile`,
    );
    assertSha256(
      partition.collectionTransactionsSha256,
      `source ${partition.partitionKey} collectionTransactionsSha256`,
    );
    if (partition.tradeCount === 0) {
      if (
        partition.firstObservationId !== null ||
        partition.lastObservationId !== null ||
        partition.firstObservedAt !== null ||
        partition.lastObservedAt !== null ||
        partition.firstSourceSequence !== null ||
        partition.lastSourceSequence !== null
      ) {
        throw new Error(`empty source partition ${partition.partitionKey} must have null boundaries`);
      }
    } else {
      assertNonEmpty(partition.firstObservationId ?? '', 'source firstObservationId');
      assertNonEmpty(partition.lastObservationId ?? '', 'source lastObservationId');
      assertFinite(partition.firstObservedAt ?? Number.NaN, 'source firstObservedAt');
      assertFinite(partition.lastObservedAt ?? Number.NaN, 'source lastObservedAt');
      assertNonNegativeInteger(
        partition.firstSourceSequence ?? -1,
        'source firstSourceSequence',
      );
      assertNonNegativeInteger(
        partition.lastSourceSequence ?? -1,
        'source lastSourceSequence',
      );
    }
    tradeCount += partition.tradeCount;
  }
  if (tradeCount !== source.tradeCount) {
    throw new Error('paper mature market dataset source partition trade counts do not sum');
  }
  if (source.tradeCount <= artifact.policy.minimumSourceTradeCountExclusive) {
    throw new Error('paper mature market dataset source trade count does not satisfy policy');
  }
  assertSha256(source.transactionsSha256, 'source transactionsSha256');
  assertNonEmpty(source.firstSourcePartitionKey, 'source firstSourcePartitionKey');
  assertNonEmpty(source.lastSourcePartitionKey, 'source lastSourcePartitionKey');
  if (
    !artifact.run.partitionKeys.includes(source.firstSourcePartitionKey) ||
    !artifact.run.partitionKeys.includes(source.lastSourcePartitionKey)
  ) {
    throw new Error('paper mature market dataset source boundary partition is unknown');
  }
}

function assertValidRun(run: PaperMatureMarketDatasetArtifact['run']): void {
  assertNonEmpty(run.runManifestId, 'run.runManifestId');
  assertNonEmpty(run.simulationId, 'run.simulationId');
  if (run.partitionKeys.length === 0) {
    throw new Error('run.partitionKeys must not be empty');
  }
  const canonicalPartitionKeys = [...new Set(run.partitionKeys)].sort();
  if (!sameStrings(run.partitionKeys, canonicalPartitionKeys)) {
    throw new Error('run.partitionKeys must be unique and sorted');
  }
  run.partitionKeys.forEach((partitionKey, index) =>
    assertNonEmpty(partitionKey, `run.partitionKeys[${index}]`),
  );
  assertNonEmpty(run.sourceRevision.commit, 'run.sourceRevision.commit');
  if (typeof run.sourceRevision.dirty !== 'boolean') {
    throw new Error('run.sourceRevision.dirty must be boolean');
  }
  assertNonEmpty(run.seed, 'run.seed');
  assertFinite(run.generatedAt, 'run.generatedAt');
  assertFinite(run.collectionWindowStartedAt, 'run.collectionWindowStartedAt');
  assertFinite(run.collectionWindowEndedAt, 'run.collectionWindowEndedAt');
  if (run.collectionWindowEndedAt <= run.collectionWindowStartedAt) {
    throw new Error('run collection window must have positive duration');
  }
}

function assertValidPolicy(policy: PaperMatureMarketDatasetPolicy): void {
  if (policy.policyVersion !== PAPER_MATURE_MARKET_DATASET_SCHEMA_VERSION) {
    throw new Error('paper mature market dataset policyVersion is invalid');
  }
  assertNonNegativeInteger(
    policy.minimumSourceTradeCountExclusive,
    'minimumSourceTradeCountExclusive',
  );
  assertPositiveInteger(policy.selectedTradeCount, 'selectedTradeCount');
  assertPositiveInteger(policy.dayDurationMs, 'dayDurationMs');
  assertFinite(policy.dayOriginAt, 'dayOriginAt');
  assertPositiveInteger(policy.stabilityWindowDayCount, 'stabilityWindowDayCount');
  assertRatio(
    policy.maximumDailyCurrencyVolumeCoefficientOfVariation,
    'maximumDailyCurrencyVolumeCoefficientOfVariation',
  );
  assertRatio(
    policy.maximumDailyParticipantCountCoefficientOfVariation,
    'maximumDailyParticipantCountCoefficientOfVariation',
  );
  if (
    policy.standardDeviationRule !== 'population' ||
    policy.dailyTradingVolumeRule !== 'sum-currency-quantity-across-trades' ||
    policy.participantCountRule !== 'distinct-trading-agent-id' ||
    policy.stableWindowSelectionRule !== 'earliest-complete-consecutive-window' ||
    policy.selectedBlockRule !==
      'first-n-subsequent-trades-in-deterministic-cross-partition-order' ||
    policy.sourceCompletenessRule !== 'exact-run-manifest-partition-set' ||
    policy.crossPartitionOrderRule !==
      'observed-at-then-source-sequence-then-partition-key-then-observation-id' ||
    policy.sourceIdentityRule !==
      'global-observation-and-event-ids-plus-partition-local-sequence' ||
    policy.participantIdentityRule !== 'required-fail-closed' ||
    policy.timeBasis !== 'simulated-time'
  ) {
    throw new Error('paper mature market dataset policy contains unsupported semantics');
  }
}

function cloneAndValidateTrade(trade: MarketTradeObservation): MarketTradeObservation {
  assertNonEmpty(trade.observationId, 'trade.observationId');
  assertNonEmpty(trade.simulationId, 'trade.simulationId');
  if (trade.agentId !== undefined) {
    assertNonEmpty(trade.agentId, 'trade.agentId');
  }
  assertNonEmpty(trade.commodityId, 'trade.commodityId');
  assertNonEmpty(trade.sourceEventId, 'trade.sourceEventId');
  assertNonNegativeInteger(trade.sourceSequence, 'trade.sourceSequence');
  if (trade.side !== 'buy' && trade.side !== 'sell') {
    throw new Error('trade.side must be buy or sell');
  }
  assertFinite(trade.observedAt, 'trade.observedAt');
  assertPositiveFinite(trade.price, 'trade.price');
  assertPositiveFinite(trade.commodityQuantity, 'trade.commodityQuantity');
  assertPositiveFinite(trade.currencyQuantity, 'trade.currencyQuantity');
  for (const [name, value] of [
    ['effectivePrice', trade.effectivePrice],
    ['spotPriceBefore', trade.spotPriceBefore],
    ['spotPriceAfter', trade.spotPriceAfter],
    ['slippageRatio', trade.slippageRatio],
    ['invariantBefore', trade.invariantBefore],
    ['invariantAfter', trade.invariantAfter],
  ] as const) {
    if (value !== undefined) {
      assertFinite(value, `trade.${name}`);
    }
  }
  return canonicalTrade(trade);
}

function canonicalTrade(trade: MarketTradeObservation): MarketTradeObservation {
  return {
    observationId: trade.observationId,
    simulationId: trade.simulationId,
    ...(trade.agentId === undefined ? {} : { agentId: trade.agentId }),
    commodityId: trade.commodityId,
    sourceEventId: trade.sourceEventId,
    sourceSequence: trade.sourceSequence,
    side: trade.side,
    observedAt: trade.observedAt,
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

function cloneAndValidateDatasetTrade(
  trade: PaperMatureMarketDatasetTrade,
): PaperMatureMarketDatasetTrade {
  assertNonEmpty(trade.sourcePartitionKey, 'trade.sourcePartitionKey');
  return canonicalDatasetTrade({
    ...cloneAndValidateTrade(trade),
    sourcePartitionKey: trade.sourcePartitionKey,
  });
}

function canonicalDatasetTrade(
  trade: PaperMatureMarketDatasetTrade,
): PaperMatureMarketDatasetTrade {
  return {
    sourcePartitionKey: trade.sourcePartitionKey,
    ...canonicalTrade(trade),
  };
}

function comparePartitionTrades(
  left: PaperMatureMarketDatasetTrade,
  right: PaperMatureMarketDatasetTrade,
): number {
  if (left.sourceSequence !== right.sourceSequence) {
    return left.sourceSequence - right.sourceSequence;
  }
  if (left.observedAt !== right.observedAt) {
    return left.observedAt - right.observedAt;
  }
  return left.observationId.localeCompare(right.observationId);
}

function compareTrades(
  left: PaperMatureMarketDatasetTrade,
  right: PaperMatureMarketDatasetTrade,
): number {
  if (left.observedAt !== right.observedAt) {
    return left.observedAt - right.observedAt;
  }
  if (left.sourceSequence !== right.sourceSequence) {
    return left.sourceSequence - right.sourceSequence;
  }
  if (left.sourcePartitionKey !== right.sourcePartitionKey) {
    return left.sourcePartitionKey.localeCompare(right.sourcePartitionKey);
  }
  return left.observationId.localeCompare(right.observationId);
}

function createDatasetId(artifact: Omit<PaperMatureMarketDatasetArtifact, 'datasetId'>): string {
  return `${DATASET_ID_PREFIX}${sha256(stableStringify(artifact))}`;
}

function hashTradeLines(trades: readonly PaperMatureMarketDatasetTrade[]): string {
  return `sha256:${sha256(serializeTradeLines(trades))}`;
}

function serializeTradeLines(trades: readonly PaperMatureMarketDatasetTrade[]): string {
  if (trades.length === 0) {
    return '';
  }
  return `${trades.map((trade) => JSON.stringify(canonicalDatasetTrade(trade))).join('\n')}\n`;
}

function parseTradeLines(content: string): PaperMatureMarketDatasetTrade[] {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return [];
  }
  return trimmed
    .split('\n')
    .map((line) =>
      cloneAndValidateDatasetTrade(JSON.parse(line) as PaperMatureMarketDatasetTrade),
    );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function cloneRun(
  run: PaperMatureMarketDatasetArtifact['run'],
): PaperMatureMarketDatasetArtifact['run'] {
  return {
    runManifestId: run.runManifestId,
    simulationId: run.simulationId,
    partitionKeys: [...run.partitionKeys],
    sourceRevision: cloneSourceRevision(run.sourceRevision),
    seed: run.seed,
    generatedAt: run.generatedAt,
    collectionWindowStartedAt: run.collectionWindowStartedAt,
    collectionWindowEndedAt: run.collectionWindowEndedAt,
  };
}

function cloneSourceLedgerFile(
  file: PaperMatureMarketSourceLedgerFile,
): PaperMatureMarketSourceLedgerFile {
  return {
    filename: file.filename,
    byteLength: file.byteLength,
    sha256: file.sha256,
  };
}

function assertValidSourceLedgerFile(
  file: PaperMatureMarketSourceLedgerFile,
  name: string,
): void {
  if (file.filename !== PAPER_MATURE_MARKET_SOURCE_LEDGER_FILENAME) {
    throw new Error(`${name}.filename is unsupported`);
  }
  assertNonNegativeInteger(file.byteLength, `${name}.byteLength`);
  assertSha256(file.sha256, `${name}.sha256`);
}

function cloneDailyMetric(
  metric: PaperMatureMarketDatasetDailyMetric,
): PaperMatureMarketDatasetDailyMetric {
  return { ...metric };
}

function cloneBundle(bundle: PaperMatureMarketDatasetBundle): PaperMatureMarketDatasetBundle {
  return {
    artifact: JSON.parse(JSON.stringify(bundle.artifact)) as PaperMatureMarketDatasetArtifact,
    trades: bundle.trades.map(canonicalDatasetTrade),
  };
}

function writeAtomically(path: string, content: string): void {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, content, 'utf8');
  renameSync(temporaryPath, path);
}

function requireAgentId(trade: MarketTradeObservation): string {
  if (trade.agentId === undefined) {
    throw new Error(`trade ${trade.observationId} is missing participant agentId`);
  }
  return trade.agentId;
}

function requireFirst<TValue>(values: readonly TValue[], name: string): TValue {
  const first = values[0];
  if (first === undefined) {
    throw new Error(`${name} must not be empty`);
  }
  return first;
}

function requireLast<TValue>(values: readonly TValue[], name: string): TValue {
  const last = values.at(-1);
  if (last === undefined) {
    throw new Error(`${name} must not be empty`);
  }
  return last;
}

function assertDatasetId(datasetId: string): void {
  if (!new RegExp(`^${DATASET_ID_PREFIX}[a-f0-9]{64}$`, 'u').test(datasetId)) {
    throw new Error('paper mature market dataset ID must be content-addressed SHA-256');
  }
}

function assertSha256(value: string, name: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${name} must be a prefixed lowercase SHA-256`);
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertRatio(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between zero and one`);
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
