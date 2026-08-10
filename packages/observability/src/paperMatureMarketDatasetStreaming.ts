import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import type { MarketTradeObservation } from './marketObservationRepository';
import {
  PAPER_MATURE_MARKET_DATASET_SCHEMA_VERSION,
  createPaperMatureMarketDatasetPolicy,
  type PaperMatureMarketDatasetArtifact,
  type PaperMatureMarketDatasetArtifactInput,
  type PaperMatureMarketDatasetDailyMetric,
  type PaperMatureMarketDatasetPolicy,
  type PaperMatureMarketDatasetTrade,
  type PaperMatureMarketSourceLedgerFile,
} from './paperMatureMarketDataset';

const TRANSACTION_FILENAME = 'transactions.jsonl';
const MANIFEST_FILENAME = 'artifact.json';
const DATASET_ID_PREFIX = 'paper-mature-market-dataset:sha256:';
const IDENTITY_BUCKET_COUNT = 256;
const IDENTITY_BUFFER_RECORD_LIMIT = 4_096;

export type PaperMatureMarketDatasetStreamSource = {
  readonly partitionKey: string;
  readonly ledgerFile: PaperMatureMarketSourceLedgerFile;
  /** Must return a fresh append-ordered stream for each call. */
  readonly openTrades: () => AsyncIterable<MarketTradeObservation>;
};

export type PaperMatureMarketDatasetStreamingInput = {
  readonly run: PaperMatureMarketDatasetArtifactInput['run'];
  readonly sources: readonly PaperMatureMarketDatasetStreamSource[];
  readonly stagingDir: string;
  readonly policy?: PaperMatureMarketDatasetArtifactInput['policy'];
  /** Called between passes and after selection to fail closed on source drift. */
  readonly assertSourceSnapshot?: () => void | Promise<void>;
};

export type PreparedPaperMatureMarketDataset = {
  readonly artifact: PaperMatureMarketDatasetArtifact;
  readonly transactionsPath: string;
};

type PartitionSummary = PaperMatureMarketDatasetArtifact['source']['partitions'][number];

type StreamCursor = {
  readonly source: PaperMatureMarketDatasetStreamSource;
  readonly iterator: AsyncIterator<MarketTradeObservation>;
  readonly transactionsHash: ReturnType<typeof createHash>;
  head: PaperMatureMarketDatasetTrade | undefined;
  previousSourceSequence?: number;
  previousObservedAt?: number;
  tradeCount: number;
  first?: PaperMatureMarketDatasetTrade;
  last?: PaperMatureMarketDatasetTrade;
};

type MergedScan = {
  readonly partitions: readonly PartitionSummary[];
  readonly tradeCount: number;
  readonly first: PaperMatureMarketDatasetTrade;
  readonly last: PaperMatureMarketDatasetTrade;
  readonly transactionsSha256: string;
  readonly dailyMetrics: readonly PaperMatureMarketDatasetDailyMetric[];
};

/**
 * Creates the v2 mature-market artifact with bounded source-row memory.
 *
 * Pass one performs a deterministic K-way merge, exact disk-bucketed identity
 * validation, source hashing, and daily maturity aggregation. Pass two reopens
 * the immutable sources and writes only the selected block to a staged JSONL
 * file. At most one trade per partition plus one identity bucket is resident.
 */
export async function preparePaperMatureMarketDatasetStreaming(
  input: PaperMatureMarketDatasetStreamingInput,
): Promise<PreparedPaperMatureMarketDataset> {
  assertValidRun(input.run);
  const policy = createPaperMatureMarketDatasetPolicy(input.policy);
  const sources = normalizeSources(input.sources, input.run.partitionKeys);
  mkdirSync(input.stagingDir, { recursive: true });
  const workDir = mkdtempSync(join(input.stagingDir, '.paper-market-dataset-'));
  const transactionsPath = join(
    input.stagingDir,
    `.paper-market-transactions-${process.pid}-${randomUUID()}.jsonl`,
  );
  try {
    const scan = await scanMergedSources({
      run: input.run,
      sources,
      policy,
      identityWorkDir: workDir,
    });
    if (scan.tradeCount <= policy.minimumSourceTradeCountExclusive) {
      throw new Error(
        `paper mature market dataset requires more than ${policy.minimumSourceTradeCountExclusive} source trades; received ${scan.tradeCount}`,
      );
    }
    if (scan.dailyMetrics.length < policy.stabilityWindowDayCount) {
      throw new Error(
        `paper mature market dataset requires at least ${policy.stabilityWindowDayCount} fully observed daily buckets; received ${scan.dailyMetrics.length}`,
      );
    }
    const stableWindow = findStableWindow(scan.dailyMetrics, policy);
    await input.assertSourceSnapshot?.();
    const selection = await writeSelectedBlock({
      run: input.run,
      sources,
      stableWindowEndedAt: stableWindow.endedAt,
      selectedTradeCount: policy.selectedTradeCount,
      transactionsPath,
    });
    await input.assertSourceSnapshot?.();
    const artifactWithoutId: Omit<PaperMatureMarketDatasetArtifact, 'datasetId'> = {
      schemaVersion: PAPER_MATURE_MARKET_DATASET_SCHEMA_VERSION,
      run: cloneRun(input.run),
      policy,
      source: {
        partitionCount: scan.partitions.length,
        partitions: scan.partitions,
        tradeCount: scan.tradeCount,
        firstObservationId: scan.first.observationId,
        lastObservationId: scan.last.observationId,
        firstObservedAt: scan.first.observedAt,
        lastObservedAt: scan.last.observedAt,
        firstSourceSequence: scan.first.sourceSequence,
        lastSourceSequence: scan.last.sourceSequence,
        firstSourcePartitionKey: scan.first.sourcePartitionKey,
        lastSourcePartitionKey: scan.last.sourcePartitionKey,
        participantIdentityCoverage: 1,
        transactionsSha256: scan.transactionsSha256,
      },
      maturity: {
        evaluatedDailyMetrics: scan.dailyMetrics,
        stableWindowStartedAt: stableWindow.startedAt,
        stableWindowEndedAt: stableWindow.endedAt,
        stableWindowDayIndexes: stableWindow.metrics.map((metric) => metric.dayIndex),
        dailyCurrencyVolumeCoefficientOfVariation: stableWindow.currencyVolumeCv,
        dailyParticipantCountCoefficientOfVariation: stableWindow.participantCountCv,
      },
      selection,
    };
    const artifact: PaperMatureMarketDatasetArtifact = {
      ...artifactWithoutId,
      datasetId: `${DATASET_ID_PREFIX}${sha256(stableStringify(artifactWithoutId))}`,
    };
    return { artifact, transactionsPath };
  } catch (error) {
    rmSync(transactionsPath, { force: true });
    throw error;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Writes a prepared dataset without reading the selected block into memory. */
export async function savePreparedPaperMatureMarketDataset(input: {
  readonly rootDir: string;
  readonly prepared: PreparedPaperMatureMarketDataset;
}): Promise<PaperMatureMarketDatasetArtifact> {
  assertNonEmpty(input.rootDir, 'rootDir');
  const { artifact, transactionsPath } = input.prepared;
  assertDatasetId(artifact.datasetId);
  const expectedHash = artifact.selection.transactionFile.sha256;
  const stagedHash = await hashFile(transactionsPath);
  if (stagedHash !== expectedHash) {
    throw new Error('prepared paper mature market transaction hash does not match manifest');
  }
  const root = join(input.rootDir, 'paper-mature-market-datasets');
  const artifactDir = join(root, encodeURIComponent(artifact.datasetId));
  const manifestPath = join(artifactDir, MANIFEST_FILENAME);
  const destinationPath = join(artifactDir, TRANSACTION_FILENAME);
  const manifest = `${JSON.stringify(artifact, null, 2)}\n`;
  mkdirSync(artifactDir, { recursive: true });
  if (existsSync(manifestPath)) {
    if (
      readFileSync(manifestPath, 'utf8') !== manifest ||
      !existsSync(destinationPath) ||
      (await hashFile(destinationPath)) !== expectedHash
    ) {
      throw new Error(`paper mature market dataset ${artifact.datasetId} is immutable`);
    }
    rmSync(transactionsPath, { force: true });
    return cloneArtifact(artifact);
  }
  const temporaryTransactionsPath = `${destinationPath}.${process.pid}.${randomUUID()}.tmp`;
  copyFileSync(transactionsPath, temporaryTransactionsPath);
  if ((await hashFile(temporaryTransactionsPath)) !== expectedHash) {
    rmSync(temporaryTransactionsPath, { force: true });
    throw new Error('copied paper mature market transaction hash does not match manifest');
  }
  renameSync(temporaryTransactionsPath, destinationPath);
  writeAtomically(manifestPath, manifest);
  rmSync(transactionsPath, { force: true });
  return cloneArtifact(artifact);
}

async function scanMergedSources(input: {
  readonly run: PaperMatureMarketDatasetArtifactInput['run'];
  readonly sources: readonly PaperMatureMarketDatasetStreamSource[];
  readonly policy: PaperMatureMarketDatasetPolicy;
  readonly identityWorkDir: string;
}): Promise<MergedScan> {
  const globalHash = createHash('sha256');
  const identities = new DiskBucketIdentityIndex(input.identityWorkDir);
  const firstCompleteDayIndex = Math.ceil(
    (input.run.collectionWindowStartedAt - input.policy.dayOriginAt) /
      input.policy.dayDurationMs,
  );
  const lastCompleteDayIndexExclusive = Math.floor(
    (input.run.collectionWindowEndedAt - input.policy.dayOriginAt) /
      input.policy.dayDurationMs,
  );
  const daily = Array.from(
    { length: Math.max(0, lastCompleteDayIndexExclusive - firstCompleteDayIndex) },
    (_, index) => ({
      dayIndex: firstCompleteDayIndex + index,
      tradeCount: 0,
      currencyVolume: 0,
      participants: new Set<string>(),
    }),
  );
  let tradeCount = 0;
  let first: PaperMatureMarketDatasetTrade | undefined;
  let last: PaperMatureMarketDatasetTrade | undefined;
  let cursors: StreamCursor[] = [];
  try {
    cursors = await openCursors(input.sources, input.run);
    const heap = new CursorHeap(cursors.filter((cursor) => cursor.head !== undefined));
    while (heap.size > 0) {
      const cursor = heap.pop()!;
      const trade = cursor.head!;
      first ??= trade;
      last = trade;
      tradeCount += 1;
      globalHash.update(serializeTradeLine(trade));
      identities.add('observation', trade.observationId);
      identities.add('event', trade.sourceEventId);
      const dayIndex = Math.floor(
        (trade.observedAt - input.policy.dayOriginAt) / input.policy.dayDurationMs,
      );
      const aggregate = daily[dayIndex - firstCompleteDayIndex];
      if (aggregate !== undefined && trade.agentId !== undefined) {
        aggregate.tradeCount += 1;
        aggregate.currencyVolume += trade.currencyQuantity;
        aggregate.participants.add(trade.agentId);
      }
      await advanceCursor(cursor, input.run);
      if (cursor.head !== undefined) {
        heap.push(cursor);
      }
    }
    identities.assertUnique();
  } finally {
    identities.close();
    await closeCursors(cursors);
  }
  if (first === undefined || last === undefined) {
    throw new Error('paper mature market dataset source trades must not be empty');
  }
  const partitions = cursors.map(createPartitionSummary);
  const dailyMetrics = daily.map((aggregate): PaperMatureMarketDatasetDailyMetric => ({
    dayIndex: aggregate.dayIndex,
    startedAt: input.policy.dayOriginAt + aggregate.dayIndex * input.policy.dayDurationMs,
    endedAt:
      input.policy.dayOriginAt + (aggregate.dayIndex + 1) * input.policy.dayDurationMs,
    tradeCount: aggregate.tradeCount,
    currencyVolume: aggregate.currencyVolume,
    participantCount: aggregate.participants.size,
  }));
  return {
    partitions,
    tradeCount,
    first,
    last,
    transactionsSha256: `sha256:${globalHash.digest('hex')}`,
    dailyMetrics,
  };
}

async function writeSelectedBlock(input: {
  readonly run: PaperMatureMarketDatasetArtifactInput['run'];
  readonly sources: readonly PaperMatureMarketDatasetStreamSource[];
  readonly stableWindowEndedAt: number;
  readonly selectedTradeCount: number;
  readonly transactionsPath: string;
}): Promise<PaperMatureMarketDatasetArtifact['selection']> {
  const output = createWriteStream(input.transactionsPath, { encoding: 'utf8', flags: 'wx' });
  const hash = createHash('sha256');
  let sourceIndex = 0;
  let sourceStartIndex: number | undefined;
  let selectedCount = 0;
  let first: PaperMatureMarketDatasetTrade | undefined;
  let last: PaperMatureMarketDatasetTrade | undefined;
  let cursors: StreamCursor[] = [];
  try {
    cursors = await openCursors(input.sources, input.run);
    const heap = new CursorHeap(cursors.filter((cursor) => cursor.head !== undefined));
    while (heap.size > 0 && selectedCount < input.selectedTradeCount) {
      const cursor = heap.pop()!;
      const trade = cursor.head!;
      if (trade.observedAt >= input.stableWindowEndedAt) {
        sourceStartIndex ??= sourceIndex;
        first ??= trade;
        last = trade;
        const line = serializeTradeLine(trade);
        if (!output.write(line)) {
          await once(output, 'drain');
        }
        hash.update(line);
        selectedCount += 1;
      }
      sourceIndex += 1;
      await advanceCursor(cursor, input.run);
      if (cursor.head !== undefined) {
        heap.push(cursor);
      }
    }
    if (selectedCount < input.selectedTradeCount || sourceStartIndex === undefined) {
      throw new Error(
        `paper mature market dataset requires ${input.selectedTradeCount} trades subsequent to the stable window; received ${selectedCount}`,
      );
    }
    output.end();
    await once(output, 'finish');
  } catch (error) {
    output.destroy();
    rmSync(input.transactionsPath, { force: true });
    throw error;
  } finally {
    await closeCursors(cursors);
  }
  const firstTrade = first!;
  const lastTrade = last!;
  return {
    sourceStartIndex,
    sourceEndIndexExclusive: sourceStartIndex + selectedCount,
    tradeCount: selectedCount,
    firstObservationId: firstTrade.observationId,
    lastObservationId: lastTrade.observationId,
    firstObservedAt: firstTrade.observedAt,
    lastObservedAt: lastTrade.observedAt,
    firstSourceSequence: firstTrade.sourceSequence,
    lastSourceSequence: lastTrade.sourceSequence,
    firstSourcePartitionKey: firstTrade.sourcePartitionKey,
    lastSourcePartitionKey: lastTrade.sourcePartitionKey,
    transactionFile: {
      filename: TRANSACTION_FILENAME,
      mimeType: 'application/x-ndjson',
      sha256: `sha256:${hash.digest('hex')}`,
    },
  };
}

async function openCursors(
  sources: readonly PaperMatureMarketDatasetStreamSource[],
  run: PaperMatureMarketDatasetArtifactInput['run'],
): Promise<StreamCursor[]> {
  const cursors = sources.map((source): StreamCursor => ({
    source,
    iterator: source.openTrades()[Symbol.asyncIterator](),
    transactionsHash: createHash('sha256'),
    head: undefined,
    tradeCount: 0,
  }));
  try {
    await Promise.all(cursors.map((cursor) => advanceCursor(cursor, run)));
    return cursors;
  } catch (error) {
    await closeCursors(cursors);
    throw error;
  }
}

async function advanceCursor(
  cursor: StreamCursor,
  run: PaperMatureMarketDatasetArtifactInput['run'],
): Promise<void> {
  const next = await cursor.iterator.next();
  if (next.done === true) {
    cursor.head = undefined;
    return;
  }
  const trade = canonicalDatasetTrade(next.value, cursor.source.partitionKey);
  assertValidStreamTrade(trade, cursor, run);
  cursor.tradeCount += 1;
  cursor.first ??= trade;
  cursor.last = trade;
  cursor.previousSourceSequence = trade.sourceSequence;
  cursor.previousObservedAt = trade.observedAt;
  cursor.transactionsHash.update(serializeTradeLine(trade));
  cursor.head = trade;
}

async function closeCursors(cursors: readonly StreamCursor[]): Promise<void> {
  await Promise.all(
    cursors.map(async (cursor) => {
      await cursor.iterator.return?.();
    }),
  );
}

function createPartitionSummary(cursor: StreamCursor): PartitionSummary {
  return {
    partitionKey: cursor.source.partitionKey,
    tradeCount: cursor.tradeCount,
    firstObservationId: cursor.first?.observationId ?? null,
    lastObservationId: cursor.last?.observationId ?? null,
    firstObservedAt: cursor.first?.observedAt ?? null,
    lastObservedAt: cursor.last?.observedAt ?? null,
    firstSourceSequence: cursor.first?.sourceSequence ?? null,
    lastSourceSequence: cursor.last?.sourceSequence ?? null,
    collectionTransactionsSha256: `sha256:${cursor.transactionsHash.digest('hex')}`,
    ledgerFile: { ...cursor.source.ledgerFile },
  };
}

class CursorHeap {
  private readonly values: StreamCursor[] = [];

  constructor(values: readonly StreamCursor[]) {
    values.forEach((value) => this.push(value));
  }

  get size(): number {
    return this.values.length;
  }

  push(value: StreamCursor): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareTrades(this.values[parent]!.head!, value.head!) <= 0) break;
      this.values[index] = this.values[parent]!;
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): StreamCursor | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (first === undefined || last === undefined || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child =
        right < this.values.length &&
        compareTrades(this.values[right]!.head!, this.values[left]!.head!) < 0
          ? right
          : left;
      if (compareTrades(last.head!, this.values[child]!.head!) <= 0) break;
      this.values[index] = this.values[child]!;
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

class DiskBucketIdentityIndex {
  private readonly buffers = new Map<number, string[]>();
  private bufferedRecordCount = 0;
  private closed = false;

  constructor(private readonly rootDir: string) {}

  add(kind: 'observation' | 'event', id: string): void {
    if (this.closed) throw new Error('identity index is closed');
    const value = `${kind}:${id}`;
    const bucket = stableBucket(value);
    const values = this.buffers.get(bucket) ?? [];
    values.push(value);
    this.buffers.set(bucket, values);
    this.bufferedRecordCount += 1;
    if (this.bufferedRecordCount >= IDENTITY_BUFFER_RECORD_LIMIT) this.flush();
  }

  assertUnique(): void {
    this.flush();
    for (let bucket = 0; bucket < IDENTITY_BUCKET_COUNT; bucket += 1) {
      const path = this.path(bucket);
      if (!existsSync(path)) continue;
      const seen = new Set<string>();
      for (const value of readFileSync(path, 'utf8').split('\n')) {
        if (value.length === 0) continue;
        if (seen.has(value)) {
          const separator = value.indexOf(':');
          throw new Error(
            `duplicate cross-partition trade ${value.slice(0, separator)}Id ${value.slice(separator + 1)}`,
          );
        }
        seen.add(value);
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
  }

  private flush(): void {
    for (const [bucket, values] of this.buffers) {
      appendFileSync(this.path(bucket), `${values.join('\n')}\n`, 'utf8');
    }
    this.buffers.clear();
    this.bufferedRecordCount = 0;
  }

  private path(bucket: number): string {
    return join(this.rootDir, `identity-${bucket.toString(16).padStart(2, '0')}.txt`);
  }
}

function findStableWindow(
  metrics: readonly PaperMatureMarketDatasetDailyMetric[],
  policy: PaperMatureMarketDatasetPolicy,
) {
  for (let start = 0; start <= metrics.length - policy.stabilityWindowDayCount; start += 1) {
    const candidate = metrics.slice(start, start + policy.stabilityWindowDayCount);
    if (candidate.some((metric) => metric.tradeCount === 0 || metric.participantCount === 0)) {
      continue;
    }
    const currencyVolumeCv = coefficientOfVariation(candidate.map((item) => item.currencyVolume));
    const participantCountCv = coefficientOfVariation(candidate.map((item) => item.participantCount));
    if (
      currencyVolumeCv <= policy.maximumDailyCurrencyVolumeCoefficientOfVariation &&
      participantCountCv <= policy.maximumDailyParticipantCountCoefficientOfVariation
    ) {
      return {
        metrics: candidate,
        startedAt: candidate[0]!.startedAt,
        endedAt: candidate.at(-1)!.endedAt,
        currencyVolumeCv,
        participantCountCv,
      };
    }
  }
  throw new Error(
    'paper mature market dataset did not find a stable complete-day window under the configured coefficient-of-variation thresholds',
  );
}

function normalizeSources(
  sources: readonly PaperMatureMarketDatasetStreamSource[],
  partitionKeys: readonly string[],
): PaperMatureMarketDatasetStreamSource[] {
  const byKey = new Map<string, PaperMatureMarketDatasetStreamSource>();
  for (const source of sources) {
    assertNonEmpty(source.partitionKey, 'source.partitionKey');
    if (byKey.has(source.partitionKey)) {
      throw new Error(`duplicate paper market source partition ${source.partitionKey}`);
    }
    assertLedgerFile(source.ledgerFile);
    byKey.set(source.partitionKey, source);
  }
  const actual = [...byKey.keys()].sort();
  if (!sameStrings(actual, partitionKeys)) {
    throw new Error(
      `paper market source partitions must exactly match run manifest partitions; expected ${partitionKeys.join(',')}, received ${actual.join(',')}`,
    );
  }
  return partitionKeys.map((partitionKey) => byKey.get(partitionKey)!);
}

function assertValidStreamTrade(
  trade: PaperMatureMarketDatasetTrade,
  cursor: StreamCursor,
  run: PaperMatureMarketDatasetArtifactInput['run'],
): void {
  if (trade.simulationId !== run.simulationId) {
    throw new Error(`trade ${trade.observationId} simulationId must match ${run.simulationId}`);
  }
  if (trade.observedAt < run.collectionWindowStartedAt || trade.observedAt >= run.collectionWindowEndedAt) {
    throw new Error(`trade ${trade.observationId} falls outside the collection window`);
  }
  if (trade.agentId === undefined) {
    throw new Error(
      `trade ${trade.observationId} is missing participant agentId required for maturity detection`,
    );
  }
  if (
    cursor.previousSourceSequence !== undefined &&
    trade.sourceSequence <= cursor.previousSourceSequence
  ) {
    throw new Error(
      `trade sourceSequence ${trade.sourceSequence} is not strictly increasing in partition ${cursor.source.partitionKey}`,
    );
  }
  if (cursor.previousObservedAt !== undefined && trade.observedAt < cursor.previousObservedAt) {
    throw new Error(
      `trade ${trade.observationId} observedAt moves backward in partition ${cursor.source.partitionKey} event order`,
    );
  }
}

function canonicalDatasetTrade(
  trade: MarketTradeObservation,
  sourcePartitionKey: string,
): PaperMatureMarketDatasetTrade {
  assertNonEmpty(trade.observationId, 'trade.observationId');
  assertNonEmpty(trade.simulationId, 'trade.simulationId');
  if (trade.agentId !== undefined) assertNonEmpty(trade.agentId, 'trade.agentId');
  assertNonEmpty(trade.commodityId, 'trade.commodityId');
  assertNonEmpty(trade.sourceEventId, 'trade.sourceEventId');
  assertNonNegativeInteger(trade.sourceSequence, 'trade.sourceSequence');
  if (trade.side !== 'buy' && trade.side !== 'sell') throw new Error('trade.side must be buy or sell');
  assertFinite(trade.observedAt, 'trade.observedAt');
  assertPositiveFinite(trade.price, 'trade.price');
  assertPositiveFinite(trade.commodityQuantity, 'trade.commodityQuantity');
  assertPositiveFinite(trade.currencyQuantity, 'trade.currencyQuantity');
  return {
    sourcePartitionKey,
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

function compareTrades(left: PaperMatureMarketDatasetTrade, right: PaperMatureMarketDatasetTrade): number {
  return (
    left.observedAt - right.observedAt ||
    left.sourceSequence - right.sourceSequence ||
    left.sourcePartitionKey.localeCompare(right.sourcePartitionKey) ||
    left.observationId.localeCompare(right.observationId)
  );
}

function serializeTradeLine(trade: PaperMatureMarketDatasetTrade): string {
  return `${JSON.stringify(trade)}\n`;
}

function coefficientOfVariation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 0) return Number.POSITIVE_INFINITY;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function stableBucket(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % IDENTITY_BUCKET_COUNT;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest('hex')}`;
}

function writeAtomically(path: string, content: string): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, content, 'utf8');
  renameSync(temporaryPath, path);
}

function cloneRun(run: PaperMatureMarketDatasetArtifact['run']): PaperMatureMarketDatasetArtifact['run'] {
  return JSON.parse(JSON.stringify(run)) as PaperMatureMarketDatasetArtifact['run'];
}

function cloneArtifact(artifact: PaperMatureMarketDatasetArtifact): PaperMatureMarketDatasetArtifact {
  return JSON.parse(JSON.stringify(artifact)) as PaperMatureMarketDatasetArtifact;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
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

function assertValidRun(run: PaperMatureMarketDatasetArtifact['run']): void {
  assertNonEmpty(run.runManifestId, 'run.runManifestId');
  assertNonEmpty(run.simulationId, 'run.simulationId');
  if (run.partitionKeys.length === 0 || !sameStrings(run.partitionKeys, [...new Set(run.partitionKeys)].sort())) {
    throw new Error('run.partitionKeys must be non-empty, unique, and sorted');
  }
  assertNonEmpty(run.sourceRevision.commit, 'run.sourceRevision.commit');
  assertNonEmpty(run.seed, 'run.seed');
  assertFinite(run.generatedAt, 'run.generatedAt');
  assertFinite(run.collectionWindowStartedAt, 'run.collectionWindowStartedAt');
  assertFinite(run.collectionWindowEndedAt, 'run.collectionWindowEndedAt');
  if (run.collectionWindowEndedAt <= run.collectionWindowStartedAt) {
    throw new Error('run collection window must have positive duration');
  }
}

function assertLedgerFile(file: PaperMatureMarketSourceLedgerFile): void {
  if (file.filename !== 'market-trade-observations.jsonl') throw new Error('source ledger filename is unsupported');
  assertNonNegativeInteger(file.byteLength, 'source ledger byteLength');
  if (!/^sha256:[a-f0-9]{64}$/u.test(file.sha256)) throw new Error('source ledger sha256 is invalid');
}

function assertDatasetId(value: string): void {
  if (!/^paper-mature-market-dataset:sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error('paper mature market dataset ID must be content-addressed SHA-256');
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) throw new Error(`${name} must not be empty`);
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}
