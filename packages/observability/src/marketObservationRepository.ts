import {
  appendFileSync,
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { FixedBloomFilter } from '@aivilization/sim-core';

export type MarketTradeObservation = {
  readonly observationId: string;
  readonly simulationId: string;
  /**
   * The agent that submitted the executed trade. Older v1 JSONL rows may not
   * contain this field; evidence pipelines that depend on participant counts
   * must fail closed when it is absent.
   */
  readonly agentId?: string;
  readonly commodityId: string;
  readonly sourceEventId: string;
  readonly sourceSequence: number;
  readonly side: 'buy' | 'sell';
  readonly observedAt: number;
  readonly price: number;
  readonly commodityQuantity: number;
  readonly currencyQuantity: number;
  readonly effectivePrice?: number;
  readonly spotPriceBefore?: number;
  readonly spotPriceAfter?: number;
  readonly slippageRatio?: number;
  readonly invariantBefore?: number;
  readonly invariantAfter?: number;
};

export type MarketOhlcBar = {
  readonly barId: string;
  readonly simulationId: string;
  readonly commodityId: string;
  readonly intervalStartedAt: number;
  readonly intervalEndedAt: number;
  readonly openPrice: number;
  readonly highPrice: number;
  readonly lowPrice: number;
  readonly closePrice: number;
  readonly tradeCount: number;
  readonly commodityVolume: number;
  readonly currencyVolume: number;
};

export type MarketTradeObservationQuery = {
  readonly simulationId: string;
  readonly commodityId?: string;
  readonly fromObservedAt?: number;
  readonly toObservedAt?: number;
  readonly limit?: number;
};

export type MarketOhlcBarQuery = {
  readonly simulationId: string;
  readonly commodityId?: string;
  readonly fromIntervalStartedAt?: number;
  readonly toIntervalStartedAt?: number;
  readonly limit?: number;
};

export type MarketObservationRepository = {
  readonly recordTrades: (observations: readonly MarketTradeObservation[]) => Promise<void>;
  readonly recordOhlcBars: (bars: readonly MarketOhlcBar[]) => Promise<void>;
  readonly queryTrades: (query: MarketTradeObservationQuery) => Promise<MarketTradeObservation[]>;
  readonly queryOhlcBars: (query: MarketOhlcBarQuery) => Promise<MarketOhlcBar[]>;
};

export type MarketTradeObservationFileStreamQuery = {
  readonly path: string;
  readonly simulationId: string;
  readonly fromObservedAt: number;
  readonly toObservedAtExclusive: number;
};

/**
 * Streams one immutable market ledger in append order without constructing a
 * repository projection or retaining matching rows. Paper evidence callers
 * deliberately use an exclusive upper boundary so adjacent collection epochs
 * cannot claim the same trade.
 */
export async function* streamMarketTradeObservationsFile(
  query: MarketTradeObservationFileStreamQuery,
): AsyncGenerator<MarketTradeObservation> {
  assertNonEmpty(query.path, 'path');
  assertNonEmpty(query.simulationId, 'simulationId');
  assertFinite(query.fromObservedAt, 'fromObservedAt');
  assertFinite(query.toObservedAtExclusive, 'toObservedAtExclusive');
  if (query.toObservedAtExclusive <= query.fromObservedAt) {
    throw new Error('toObservedAtExclusive must be greater than fromObservedAt');
  }
  assertCompleteJsonLinesFile(query.path);
  const input = createReadStream(query.path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (line.length === 0) {
        continue;
      }
      let observation: MarketTradeObservation;
      try {
        observation = JSON.parse(line) as MarketTradeObservation;
      } catch (error) {
        throw new Error(
          `invalid market trade JSONL at ${query.path}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      assertValidTradeObservation(observation);
      if (
        observation.simulationId === query.simulationId &&
        observation.observedAt >= query.fromObservedAt &&
        observation.observedAt < query.toObservedAtExclusive
      ) {
        yield cloneTradeObservation(observation);
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

export const MARKET_OBSERVATION_STORAGE_POLICY_VERSION = 'market-observation-storage-v3';
export const MARKET_OBSERVATION_RECENT_TRADE_ID_LIMIT = 4_096;
export const MARKET_OBSERVATION_TRADE_BLOOM_BIT_COUNT = 1 << 24;
export const MARKET_OBSERVATION_TRADE_CHUNK_RECORD_COUNT = 1_024;
export const MARKET_OBSERVATION_MAX_TRADE_CHUNK_COUNT = 4_096;
const MARKET_OBSERVATION_TRADE_BLOOM_HASH_COUNT = 7;

export type MarketObservationStoragePolicyManifest = {
  readonly policyVersion: typeof MARKET_OBSERVATION_STORAGE_POLICY_VERSION;
  readonly tradeLedger: 'complete-append-only-jsonl';
  readonly tradeIdempotencyRule: 'bounded-recent-ids-plus-fixed-bloom-with-exact-cold-scan';
  readonly duplicateLedgerRowRule: 'fail-closed';
  readonly recentTradeIdLimit: number;
  readonly tradeBloomBitCount: number;
  readonly tradeBloomHashCount: number;
  readonly timeIndexRule: 'bounded-sparse-chunks-with-exact-range-or-full-cold-scan';
  readonly tradeChunkRecordCount: number;
  readonly maxTradeChunkCount: number;
  readonly ohlcRule: 'append-only-revisions-with-incremental-latest-by-id-projection';
  readonly replacementRule: 'rebuild-indexes-on-replacement-truncation-or-in-place-rewrite';
  readonly incompleteRowRule: 'fail-closed';
  readonly source: 'repository-design-not-paper-constant';
};

export function createMarketObservationStoragePolicyManifest(): MarketObservationStoragePolicyManifest {
  return {
    policyVersion: MARKET_OBSERVATION_STORAGE_POLICY_VERSION,
    tradeLedger: 'complete-append-only-jsonl',
    tradeIdempotencyRule: 'bounded-recent-ids-plus-fixed-bloom-with-exact-cold-scan',
    duplicateLedgerRowRule: 'fail-closed',
    recentTradeIdLimit: MARKET_OBSERVATION_RECENT_TRADE_ID_LIMIT,
    tradeBloomBitCount: MARKET_OBSERVATION_TRADE_BLOOM_BIT_COUNT,
    tradeBloomHashCount: MARKET_OBSERVATION_TRADE_BLOOM_HASH_COUNT,
    timeIndexRule: 'bounded-sparse-chunks-with-exact-range-or-full-cold-scan',
    tradeChunkRecordCount: MARKET_OBSERVATION_TRADE_CHUNK_RECORD_COUNT,
    maxTradeChunkCount: MARKET_OBSERVATION_MAX_TRADE_CHUNK_COUNT,
    ohlcRule: 'append-only-revisions-with-incremental-latest-by-id-projection',
    replacementRule: 'rebuild-indexes-on-replacement-truncation-or-in-place-rewrite',
    incompleteRowRule: 'fail-closed',
    source: 'repository-design-not-paper-constant',
  };
}

export type FileMarketObservationStorageDiagnostics = {
  readonly tradeRecordCount: number;
  readonly tradeCommittedBytes: number;
  readonly recentTradeIdCount: number;
  readonly recentTradeIdLimit: number;
  readonly tradeBloomBitCount: number;
  readonly tradeBloomByteLength: number;
  readonly retainedTradeChunkCount: number;
  readonly tradeChunkRecordCount: number;
  readonly maxTradeChunkCount: number;
  readonly evictedTradeChunkCount: number;
  readonly latestOhlcBarCount: number;
  readonly ohlcRevisionCount: number;
  readonly ohlcCommittedBytes: number;
};

export class InMemoryMarketObservationRepository implements MarketObservationRepository {
  private readonly tradesById = new Map<string, MarketTradeObservation>();
  private readonly ohlcBarsById = new Map<string, MarketOhlcBar>();

  recordTrades(observations: readonly MarketTradeObservation[]): Promise<void> {
    return Promise.resolve().then(() => {
      for (const observation of observations) {
        const clone = cloneTradeObservation(observation);
        if (!this.tradesById.has(clone.observationId)) {
          this.tradesById.set(clone.observationId, clone);
        }
      }
    });
  }

  recordOhlcBars(bars: readonly MarketOhlcBar[]): Promise<void> {
    return Promise.resolve().then(() => {
      for (const bar of bars) {
        const clone = cloneOhlcBar(bar);
        this.ohlcBarsById.set(clone.barId, clone);
      }
    });
  }

  queryTrades(query: MarketTradeObservationQuery): Promise<MarketTradeObservation[]> {
    return Promise.resolve().then(() => queryTrades([...this.tradesById.values()], query));
  }

  queryOhlcBars(query: MarketOhlcBarQuery): Promise<MarketOhlcBar[]> {
    return Promise.resolve().then(() => queryOhlcBars([...this.ohlcBarsById.values()], query));
  }
}

export class FileMarketObservationRepository implements MarketObservationRepository {
  private readonly tradesPath: string;
  private readonly ohlcBarsPath: string;
  private tradeBloom = createTradeBloom();
  private tradeSignature: MarketObservationFileSignature | undefined;
  private tradeCommittedBytes = 0;
  private tradeRecordCount = 0;
  private readonly recentTradeIds: string[] = [];
  private readonly recentTradeIdSet = new Set<string>();
  private readonly retainedTradeChunks: MarketTradeChunk[] = [];
  private evictedTradeChunkCount = 0;
  private evictedTradeMinimumObservedAt: number | undefined;
  private evictedTradeMaximumObservedAt: number | undefined;
  private ohlcSignature: MarketObservationFileSignature | undefined;
  private ohlcCommittedBytes = 0;
  private ohlcRevisionCount = 0;
  private readonly latestOhlcBarsById = new Map<string, MarketOhlcBar>();

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.tradesPath = join(input.rootDir, 'market-trade-observations.jsonl');
    this.ohlcBarsPath = join(input.rootDir, 'market-ohlc-bars.jsonl');
    ensureFile(this.tradesPath, input.rootDir);
    ensureFile(this.ohlcBarsPath, input.rootDir);
  }

  recordTrades(observations: readonly MarketTradeObservation[]): Promise<void> {
    return Promise.resolve().then(() => {
      this.refreshTradeIndex();
      const newObservations: MarketTradeObservation[] = [];
      const newObservationIds = new Set<string>();
      for (const observation of observations) {
        const clone = cloneTradeObservation(observation);
        if (
          newObservationIds.has(clone.observationId) ||
          this.hasTradeObservationId(clone.observationId)
        ) {
          continue;
        }
        newObservationIds.add(clone.observationId);
        newObservations.push(clone);
      }
      appendJsonLines(this.tradesPath, newObservations);
      this.refreshTradeIndex();
    });
  }

  recordOhlcBars(bars: readonly MarketOhlcBar[]): Promise<void> {
    return Promise.resolve().then(() => {
      this.refreshOhlcIndex();
      const changedBars: MarketOhlcBar[] = [];
      const pendingLatestById = new Map<string, MarketOhlcBar>();
      for (const bar of bars) {
        const clone = cloneOhlcBar(bar);
        const existing =
          pendingLatestById.get(clone.barId) ?? this.latestOhlcBarsById.get(clone.barId);
        if (existing === undefined || !areOhlcBarsEqual(existing, clone)) {
          changedBars.push(clone);
        }
        pendingLatestById.set(clone.barId, clone);
      }
      appendJsonLines(this.ohlcBarsPath, changedBars);
      this.refreshOhlcIndex();
    });
  }

  queryTrades(query: MarketTradeObservationQuery): Promise<MarketTradeObservation[]> {
    return Promise.resolve().then(() => {
      assertValidTradeQuery(query);
      this.refreshTradeIndex();
      const observations: MarketTradeObservation[] = [];
      for (const range of this.resolveTradeScanRanges(query)) {
        scanMarketJsonLines<MarketTradeObservation>({
          path: this.tradesPath,
          fromByte: range.fromByte,
          toByte: range.toByte,
          onRecord: (observation) => {
            assertValidTradeObservation(observation);
            if (tradeMatchesQuery(observation, query)) {
              observations.push(observation);
            }
          },
        });
      }
      return finalizeTradeQuery(observations, query.limit);
    });
  }

  queryOhlcBars(query: MarketOhlcBarQuery): Promise<MarketOhlcBar[]> {
    return Promise.resolve().then(() => {
      this.refreshOhlcIndex();
      return queryOhlcBars([...this.latestOhlcBarsById.values()], query);
    });
  }

  getStorageDiagnostics(): FileMarketObservationStorageDiagnostics {
    this.refreshTradeIndex();
    this.refreshOhlcIndex();
    return {
      tradeRecordCount: this.tradeRecordCount,
      tradeCommittedBytes: this.tradeCommittedBytes,
      recentTradeIdCount: this.recentTradeIds.length,
      recentTradeIdLimit: MARKET_OBSERVATION_RECENT_TRADE_ID_LIMIT,
      tradeBloomBitCount: this.tradeBloom.bitCount,
      tradeBloomByteLength: this.tradeBloom.byteLength,
      retainedTradeChunkCount: this.retainedTradeChunks.length,
      tradeChunkRecordCount: MARKET_OBSERVATION_TRADE_CHUNK_RECORD_COUNT,
      maxTradeChunkCount: MARKET_OBSERVATION_MAX_TRADE_CHUNK_COUNT,
      evictedTradeChunkCount: this.evictedTradeChunkCount,
      latestOhlcBarCount: this.latestOhlcBarsById.size,
      ohlcRevisionCount: this.ohlcRevisionCount,
      ohlcCommittedBytes: this.ohlcCommittedBytes,
    };
  }

  private hasTradeObservationId(observationId: string): boolean {
    if (this.recentTradeIdSet.has(observationId)) {
      return true;
    }
    if (!this.tradeBloom.mightContain(observationId)) {
      return false;
    }
    let found = false;
    scanMarketJsonLines<MarketTradeObservation>({
      path: this.tradesPath,
      fromByte: 0,
      toByte: this.tradeCommittedBytes,
      onRecord: (observation) => {
        assertValidTradeObservation(observation);
        if (observation.observationId === observationId) {
          found = true;
          return false;
        }
      },
    });
    return found;
  }

  private refreshTradeIndex(): void {
    const nextSignature = readMarketObservationFileSignature(this.tradesPath);
    if (
      sameMarketObservationFileSignature(this.tradeSignature, nextSignature) &&
      this.tradeCommittedBytes === nextSignature.size
    ) {
      return;
    }
    if (
      requiresMarketObservationIndexRebuild(
        this.tradeSignature,
        nextSignature,
        this.tradeCommittedBytes,
      )
    ) {
      this.resetTradeIndex();
    }
    const scan = scanMarketJsonLines<MarketTradeObservation>({
      path: this.tradesPath,
      fromByte: this.tradeCommittedBytes,
      toByte: nextSignature.size,
      onRecord: (observation, byteOffset, byteLength) => {
        const clone = cloneTradeObservation(observation);
        this.indexTradeObservation(clone, byteOffset, byteLength);
      },
    });
    this.tradeCommittedBytes += scan.consumedBytes;
    this.tradeSignature = nextSignature;
    if (this.tradeCommittedBytes !== nextSignature.size) {
      throw new Error(`market trade JSONL has an incomplete trailing row: ${this.tradesPath}`);
    }
  }

  private indexTradeObservation(
    observation: MarketTradeObservation,
    byteOffset: number,
    byteLength: number,
  ): void {
    if (
      this.tradeBloom.mightContain(observation.observationId) &&
      this.hasTradeObservationIdBefore(observation.observationId, byteOffset)
    ) {
      throw new Error(
        `market trade JSONL contains duplicate observationId ${observation.observationId}: ${this.tradesPath}`,
      );
    }
    this.tradeRecordCount += 1;
    this.tradeBloom.add(observation.observationId);
    this.retainRecentTradeId(observation.observationId);
    const lastChunk = this.retainedTradeChunks.at(-1);
    if (
      lastChunk !== undefined &&
      lastChunk.recordCount < MARKET_OBSERVATION_TRADE_CHUNK_RECORD_COUNT &&
      lastChunk.toByte === byteOffset
    ) {
      lastChunk.toByte = byteOffset + byteLength + 1;
      lastChunk.recordCount += 1;
      lastChunk.minimumObservedAt = Math.min(lastChunk.minimumObservedAt, observation.observedAt);
      lastChunk.maximumObservedAt = Math.max(lastChunk.maximumObservedAt, observation.observedAt);
      return;
    }
    this.retainedTradeChunks.push({
      fromByte: byteOffset,
      toByte: byteOffset + byteLength + 1,
      recordCount: 1,
      minimumObservedAt: observation.observedAt,
      maximumObservedAt: observation.observedAt,
    });
    while (this.retainedTradeChunks.length > MARKET_OBSERVATION_MAX_TRADE_CHUNK_COUNT) {
      const evicted = this.retainedTradeChunks.shift()!;
      this.evictedTradeChunkCount += 1;
      this.evictedTradeMinimumObservedAt = Math.min(
        this.evictedTradeMinimumObservedAt ?? Number.POSITIVE_INFINITY,
        evicted.minimumObservedAt,
      );
      this.evictedTradeMaximumObservedAt = Math.max(
        this.evictedTradeMaximumObservedAt ?? Number.NEGATIVE_INFINITY,
        evicted.maximumObservedAt,
      );
    }
  }

  private retainRecentTradeId(observationId: string): void {
    this.recentTradeIds.push(observationId);
    this.recentTradeIdSet.add(observationId);
    while (this.recentTradeIds.length > MARKET_OBSERVATION_RECENT_TRADE_ID_LIMIT) {
      const evicted = this.recentTradeIds.shift()!;
      this.recentTradeIdSet.delete(evicted);
    }
  }

  private hasTradeObservationIdBefore(observationId: string, toByte: number): boolean {
    let found = false;
    scanMarketJsonLines<MarketTradeObservation>({
      path: this.tradesPath,
      fromByte: 0,
      toByte,
      onRecord: (observation) => {
        assertValidTradeObservation(observation);
        if (observation.observationId === observationId) {
          found = true;
          return false;
        }
      },
    });
    return found;
  }

  private resolveTradeScanRanges(query: MarketTradeObservationQuery): MarketByteRange[] {
    if (!this.canUseRetainedTradeChunks(query)) {
      return this.tradeCommittedBytes === 0
        ? []
        : [{ fromByte: 0, toByte: this.tradeCommittedBytes }];
    }
    const chunks = this.retainedTradeChunks.filter(
      (chunk) =>
        (query.fromObservedAt === undefined || chunk.maximumObservedAt >= query.fromObservedAt) &&
        (query.toObservedAt === undefined || chunk.minimumObservedAt <= query.toObservedAt),
    );
    return mergeMarketByteRanges(
      chunks.map((chunk) => ({ fromByte: chunk.fromByte, toByte: chunk.toByte })),
    );
  }

  private canUseRetainedTradeChunks(query: MarketTradeObservationQuery): boolean {
    if (this.evictedTradeChunkCount === 0) {
      return true;
    }
    return (
      (query.fromObservedAt !== undefined &&
        this.evictedTradeMaximumObservedAt !== undefined &&
        query.fromObservedAt > this.evictedTradeMaximumObservedAt) ||
      (query.toObservedAt !== undefined &&
        this.evictedTradeMinimumObservedAt !== undefined &&
        query.toObservedAt < this.evictedTradeMinimumObservedAt)
    );
  }

  private resetTradeIndex(): void {
    this.tradeBloom = createTradeBloom();
    this.tradeCommittedBytes = 0;
    this.tradeRecordCount = 0;
    this.recentTradeIds.splice(0);
    this.recentTradeIdSet.clear();
    this.retainedTradeChunks.splice(0);
    this.evictedTradeChunkCount = 0;
    this.evictedTradeMinimumObservedAt = undefined;
    this.evictedTradeMaximumObservedAt = undefined;
    this.tradeSignature = undefined;
  }

  private refreshOhlcIndex(): void {
    const nextSignature = readMarketObservationFileSignature(this.ohlcBarsPath);
    if (
      sameMarketObservationFileSignature(this.ohlcSignature, nextSignature) &&
      this.ohlcCommittedBytes === nextSignature.size
    ) {
      return;
    }
    if (
      requiresMarketObservationIndexRebuild(
        this.ohlcSignature,
        nextSignature,
        this.ohlcCommittedBytes,
      )
    ) {
      this.ohlcCommittedBytes = 0;
      this.ohlcRevisionCount = 0;
      this.latestOhlcBarsById.clear();
      this.ohlcSignature = undefined;
    }
    const scan = scanMarketJsonLines<MarketOhlcBar>({
      path: this.ohlcBarsPath,
      fromByte: this.ohlcCommittedBytes,
      toByte: nextSignature.size,
      onRecord: (bar) => {
        const clone = cloneOhlcBar(bar);
        this.latestOhlcBarsById.set(clone.barId, clone);
        this.ohlcRevisionCount += 1;
      },
    });
    this.ohlcCommittedBytes += scan.consumedBytes;
    this.ohlcSignature = nextSignature;
    if (this.ohlcCommittedBytes !== nextSignature.size) {
      throw new Error(`market OHLC JSONL has an incomplete trailing row: ${this.ohlcBarsPath}`);
    }
  }
}

function queryTrades(
  observations: readonly MarketTradeObservation[],
  query: MarketTradeObservationQuery,
): MarketTradeObservation[] {
  assertValidTradeQuery(query);
  return finalizeTradeQuery(
    observations.filter((observation) => tradeMatchesQuery(observation, query)),
    query.limit,
  );
}

function tradeMatchesQuery(
  observation: MarketTradeObservation,
  query: MarketTradeObservationQuery,
): boolean {
  return (
    observation.simulationId === query.simulationId &&
    (query.commodityId === undefined || observation.commodityId === query.commodityId) &&
    (query.fromObservedAt === undefined || observation.observedAt >= query.fromObservedAt) &&
    (query.toObservedAt === undefined || observation.observedAt <= query.toObservedAt)
  );
}

function finalizeTradeQuery(
  observations: readonly MarketTradeObservation[],
  limit: number | undefined,
): MarketTradeObservation[] {
  const sorted = [...observations].sort(compareTradeObservations);
  const selected = limit === undefined ? sorted : sorted.slice(0, limit);
  return selected.map((observation) => cloneTradeObservation(observation));
}

function queryOhlcBars(bars: readonly MarketOhlcBar[], query: MarketOhlcBarQuery): MarketOhlcBar[] {
  assertValidOhlcQuery(query);
  return bars
    .filter((bar) => bar.simulationId === query.simulationId)
    .filter((bar) => query.commodityId === undefined || bar.commodityId === query.commodityId)
    .filter(
      (bar) =>
        query.fromIntervalStartedAt === undefined ||
        bar.intervalStartedAt >= query.fromIntervalStartedAt,
    )
    .filter(
      (bar) =>
        query.toIntervalStartedAt === undefined ||
        bar.intervalStartedAt <= query.toIntervalStartedAt,
    )
    .sort(compareOhlcBars)
    .slice(0, query.limit)
    .map((bar) => cloneOhlcBar(bar));
}

function areOhlcBarsEqual(left: MarketOhlcBar, right: MarketOhlcBar): boolean {
  return (
    left.barId === right.barId &&
    left.simulationId === right.simulationId &&
    left.commodityId === right.commodityId &&
    left.intervalStartedAt === right.intervalStartedAt &&
    left.intervalEndedAt === right.intervalEndedAt &&
    left.openPrice === right.openPrice &&
    left.highPrice === right.highPrice &&
    left.lowPrice === right.lowPrice &&
    left.closePrice === right.closePrice &&
    left.tradeCount === right.tradeCount &&
    left.commodityVolume === right.commodityVolume &&
    left.currencyVolume === right.currencyVolume
  );
}

function cloneTradeObservation(observation: MarketTradeObservation): MarketTradeObservation {
  assertValidTradeObservation(observation);
  return {
    observationId: observation.observationId,
    simulationId: observation.simulationId,
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

function cloneOhlcBar(bar: MarketOhlcBar): MarketOhlcBar {
  assertValidOhlcBar(bar);
  return {
    barId: bar.barId,
    simulationId: bar.simulationId,
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

function compareTradeObservations(
  left: MarketTradeObservation,
  right: MarketTradeObservation,
): number {
  if (left.sourceSequence !== right.sourceSequence) {
    return left.sourceSequence - right.sourceSequence;
  }
  if (left.observedAt !== right.observedAt) {
    return left.observedAt - right.observedAt;
  }
  if (left.commodityId !== right.commodityId) {
    return left.commodityId.localeCompare(right.commodityId);
  }
  return left.observationId.localeCompare(right.observationId);
}

function compareOhlcBars(left: MarketOhlcBar, right: MarketOhlcBar): number {
  if (left.commodityId !== right.commodityId) {
    return left.commodityId.localeCompare(right.commodityId);
  }
  if (left.intervalStartedAt !== right.intervalStartedAt) {
    return left.intervalStartedAt - right.intervalStartedAt;
  }
  return left.barId.localeCompare(right.barId);
}

function assertValidTradeObservation(observation: MarketTradeObservation): void {
  assertNonEmpty(observation.observationId, 'observationId');
  assertNonEmpty(observation.simulationId, 'simulationId');
  if (observation.agentId !== undefined) {
    assertNonEmpty(observation.agentId, 'agentId');
  }
  assertNonEmpty(observation.commodityId, 'commodityId');
  assertNonEmpty(observation.sourceEventId, 'sourceEventId');
  assertNonNegativeInteger(observation.sourceSequence, 'sourceSequence');
  if (observation.side !== 'buy' && observation.side !== 'sell') {
    throw new Error('side must be buy or sell');
  }
  assertFinite(observation.observedAt, 'observedAt');
  assertPositiveFinite(observation.price, 'price');
  assertPositiveFinite(observation.commodityQuantity, 'commodityQuantity');
  assertPositiveFinite(observation.currencyQuantity, 'currencyQuantity');
  assertOptionalFinite(observation.effectivePrice, 'effectivePrice');
  assertOptionalFinite(observation.spotPriceBefore, 'spotPriceBefore');
  assertOptionalFinite(observation.spotPriceAfter, 'spotPriceAfter');
  assertOptionalFinite(observation.slippageRatio, 'slippageRatio');
  assertOptionalFinite(observation.invariantBefore, 'invariantBefore');
  assertOptionalFinite(observation.invariantAfter, 'invariantAfter');
}

function assertValidOhlcBar(bar: MarketOhlcBar): void {
  assertNonEmpty(bar.barId, 'barId');
  assertNonEmpty(bar.simulationId, 'simulationId');
  assertNonEmpty(bar.commodityId, 'commodityId');
  assertFinite(bar.intervalStartedAt, 'intervalStartedAt');
  assertFinite(bar.intervalEndedAt, 'intervalEndedAt');
  if (bar.intervalEndedAt <= bar.intervalStartedAt) {
    throw new Error('intervalEndedAt must be greater than intervalStartedAt');
  }
  assertPositiveFinite(bar.openPrice, 'openPrice');
  assertPositiveFinite(bar.highPrice, 'highPrice');
  assertPositiveFinite(bar.lowPrice, 'lowPrice');
  assertPositiveFinite(bar.closePrice, 'closePrice');
  assertPositiveInteger(bar.tradeCount, 'tradeCount');
  assertPositiveFinite(bar.commodityVolume, 'commodityVolume');
  assertPositiveFinite(bar.currencyVolume, 'currencyVolume');
}

function assertValidTradeQuery(query: MarketTradeObservationQuery): void {
  assertNonEmpty(query.simulationId, 'simulationId');
  if (query.commodityId !== undefined) {
    assertNonEmpty(query.commodityId, 'commodityId');
  }
  assertOptionalFinite(query.fromObservedAt, 'fromObservedAt');
  assertOptionalFinite(query.toObservedAt, 'toObservedAt');
  assertOptionalPositiveInteger(query.limit, 'limit');
}

function assertValidOhlcQuery(query: MarketOhlcBarQuery): void {
  assertNonEmpty(query.simulationId, 'simulationId');
  if (query.commodityId !== undefined) {
    assertNonEmpty(query.commodityId, 'commodityId');
  }
  assertOptionalFinite(query.fromIntervalStartedAt, 'fromIntervalStartedAt');
  assertOptionalFinite(query.toIntervalStartedAt, 'toIntervalStartedAt');
  assertOptionalPositiveInteger(query.limit, 'limit');
}

function ensureFile(filePath: string, rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '');
  }
}

function appendJsonLines(path: string, values: readonly unknown[]): void {
  if (values.length === 0) {
    return;
  }
  appendFileSync(path, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
}

type MarketObservationFileSignature = {
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedAtMs: number;
  readonly changedAtMs: number;
};

type MarketTradeChunk = {
  readonly fromByte: number;
  toByte: number;
  recordCount: number;
  minimumObservedAt: number;
  maximumObservedAt: number;
};

type MarketByteRange = {
  readonly fromByte: number;
  readonly toByte: number;
};

function createTradeBloom(): FixedBloomFilter {
  return new FixedBloomFilter({
    bitCount: MARKET_OBSERVATION_TRADE_BLOOM_BIT_COUNT,
    hashCount: MARKET_OBSERVATION_TRADE_BLOOM_HASH_COUNT,
  });
}

function readMarketObservationFileSignature(path: string): MarketObservationFileSignature {
  const stats = statSync(path);
  return {
    device: stats.dev,
    inode: stats.ino,
    size: stats.size,
    modifiedAtMs: stats.mtimeMs,
    changedAtMs: stats.ctimeMs,
  };
}

function sameMarketObservationFileSignature(
  left: MarketObservationFileSignature | undefined,
  right: MarketObservationFileSignature,
): boolean {
  return (
    left !== undefined &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedAtMs === right.modifiedAtMs &&
    left.changedAtMs === right.changedAtMs
  );
}

function requiresMarketObservationIndexRebuild(
  previous: MarketObservationFileSignature | undefined,
  next: MarketObservationFileSignature,
  committedBytes: number,
): boolean {
  if (previous === undefined) {
    return true;
  }
  if (
    previous.device !== next.device ||
    previous.inode !== next.inode ||
    next.size < committedBytes
  ) {
    return true;
  }
  return (
    next.size === previous.size &&
    (previous.modifiedAtMs !== next.modifiedAtMs || previous.changedAtMs !== next.changedAtMs)
  );
}

function scanMarketJsonLines<TValue>(input: {
  readonly path: string;
  readonly fromByte: number;
  readonly toByte: number;
  readonly onRecord: (value: TValue, byteOffset: number, byteLength: number) => boolean | void;
}): { readonly consumedBytes: number } {
  if (input.toByte <= input.fromByte) {
    return { consumedBytes: 0 };
  }
  const descriptor = openSync(input.path, 'r');
  const chunkSize = 64 * 1_024;
  let position = input.fromByte;
  let pending = Buffer.alloc(0);
  let pendingOffset = input.fromByte;
  try {
    while (position < input.toByte) {
      const buffer = Buffer.allocUnsafe(Math.min(chunkSize, input.toByte - position));
      const bytesRead = readSync(descriptor, buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) {
        break;
      }
      const chunk = buffer.subarray(0, bytesRead);
      const combined = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      const combinedOffset = pendingOffset;
      let lineStart = 0;
      for (
        let newlineIndex = combined.indexOf(0x0a);
        newlineIndex >= 0;
        newlineIndex = combined.indexOf(0x0a, lineStart)
      ) {
        const line = combined.subarray(lineStart, newlineIndex);
        if (line.length > 0) {
          const shouldContinue = input.onRecord(
            JSON.parse(line.toString('utf8')) as TValue,
            combinedOffset + lineStart,
            line.length,
          );
          if (shouldContinue === false) {
            return { consumedBytes: combinedOffset + newlineIndex + 1 - input.fromByte };
          }
        }
        lineStart = newlineIndex + 1;
      }
      pending = combined.subarray(lineStart);
      pendingOffset = combinedOffset + lineStart;
      position += bytesRead;
    }
    return { consumedBytes: pendingOffset - input.fromByte };
  } finally {
    closeSync(descriptor);
  }
}

function mergeMarketByteRanges(ranges: readonly MarketByteRange[]): MarketByteRange[] {
  const merged: MarketByteRange[] = [];
  for (const range of [...ranges].sort((left, right) => left.fromByte - right.fromByte)) {
    const previous = merged.at(-1);
    if (previous !== undefined && range.fromByte <= previous.toByte) {
      merged[merged.length - 1] = {
        fromByte: previous.fromByte,
        toByte: Math.max(previous.toByte, range.toByte),
      };
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
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

function assertOptionalFinite(value: number | undefined, name: string): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
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

function assertOptionalPositiveInteger(value: number | undefined, name: string): void {
  if (value !== undefined) {
    assertPositiveInteger(value, name);
  }
}

function assertCompleteJsonLinesFile(path: string): void {
  const stats = statSync(path);
  if (stats.size === 0) {
    return;
  }
  const descriptor = openSync(path, 'r');
  try {
    const lastByte = Buffer.allocUnsafe(1);
    if (readSync(descriptor, lastByte, 0, 1, stats.size - 1) !== 1 || lastByte[0] !== 0x0a) {
      throw new Error(`market trade JSONL has an incomplete trailing row: ${path}`);
    }
  } finally {
    closeSync(descriptor);
  }
}
