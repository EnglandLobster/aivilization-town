import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants,
  deflateRawSync,
  gunzipSync,
  inflateRawSync,
} from 'node:zlib';
import { FixedBloomFilter } from '@aivilization/sim-core';
import {
  createAgentCycleTrace,
  type AgentCycleActionRepairTrace,
  type AgentCycleActionSequenceGenerationTrace,
  type AgentCycleContextualPrioritizationTrace,
  type AgentCycleGlobalSynthesisTrace,
  type AgentCycleSocialDialogueGenerationTrace,
  type AgentCycleSocialSignalExtractionTrace,
  type AgentCycleActionProposalTrace,
  type AgentCycleActionResourceEstimateTrace,
  type AgentCycleActionSynthesisContextTrace,
  type AgentCycleActionSynthesisTrace,
  type AgentCycleReplanMaterializationTrace,
  type AgentCycleReplanningDecisionTrace,
  type AgentCycleSimulatorEventTrace,
  type AgentCycleSimulatorTraceEvent,
  type AgentCycleTrace,
  type AgentCycleSelectionTraceEvidence,
  type AgentCycleSubtaskCandidateTrace,
  type AgentCycleSubtaskReplanningDecisionTrace,
  type ReplanningTraceDecision,
  type SimulatorTraceResult,
} from './agentCycleTrace';
import { cloneWorldDecisionContextTrace } from './worldDecisionContextTrace';

export type AgentCycleTraceQuery = {
  readonly simulationId: string;
  readonly agentId?: string;
  readonly fromCycleStartedAt?: number;
  readonly toCycleStartedAt?: number;
  readonly limit?: number;
};

export type AgentCycleTraceRepository = {
  readonly record: (trace: AgentCycleTrace) => Promise<void>;
  readonly recordMany: (traces: readonly AgentCycleTrace[]) => Promise<void>;
  readonly get: (traceId: string) => Promise<AgentCycleTrace | undefined>;
  readonly query: (query: AgentCycleTraceQuery) => Promise<AgentCycleTrace[]>;
};

export const AGENT_CYCLE_TRACE_STORAGE_POLICY_VERSION = 'agent-cycle-trace-storage-v5';
export const AGENT_CYCLE_TRACE_RECENT_BATCH_LIMIT = 1_024;
export const AGENT_CYCLE_TRACE_DEDUPLICATION_BLOOM_BIT_COUNT = 1 << 24;
const AGENT_CYCLE_TRACE_DEDUPLICATION_BLOOM_HASH_COUNT = 7;

export type AgentCycleTraceStoragePolicyManifest = {
  readonly policyVersion: typeof AGENT_CYCLE_TRACE_STORAGE_POLICY_VERSION;
  readonly payload: 'lossless-full-agent-cycle-traces';
  readonly writerFormat: 'legacy-gzip-prefix-plus-length-prefixed-brotli-jsonl-batches';
  readonly repositoryBatchBoundary: 'one-brotli-frame-per-record-many-call';
  readonly canonicalWorkerBatchBoundary: 'available-agent-traces-per-simulation-tick';
  readonly compressionQuality: 6;
  readonly sampling: 'none';
  readonly legacyReadPath: 'agent-cycle-traces.jsonl';
  readonly compressedWritePath: 'agent-cycle-traces.jsonl.gz';
  readonly mixedCodecCompatibility: 'v1-v4-gzip-index-rows-plus-v5-brotli-index-rows';
  readonly legacyBatchIndexPath: 'agent-cycle-trace-batches.jsonl';
  readonly compactBatchIndexPath: 'agent-cycle-trace-batches.deflate';
  readonly compactBatchIndexFormat: 'uint32be-length-prefixed-deflate-raw-json-v1';
  readonly indexCompatibilityRule: 'union-read-legacy-jsonl-and-compact-deflate-with-covered-range-deduplication';
  readonly recentBatchLimit: number;
  readonly deduplicationBloomBitCount: number;
  readonly deduplicationBloomHashCount: number;
  readonly runtimeIndexRule: 'bounded-recent-batches-plus-fixed-bloom-with-exact-cold-scan';
  readonly queryRule: 'serve-provably-complete-latest-window-else-filter-complete-index';
  readonly incompleteIndexRecovery: 'hash-and-index-complete-gzip-or-framed-brotli-tail-or-fail-closed';
  readonly rollbackBoundary: 'pre-v2-runtime-starts-but-cannot-query-post-upgrade-compressed-traces';
};

export function createAgentCycleTraceStoragePolicyManifest(): AgentCycleTraceStoragePolicyManifest {
  return {
    policyVersion: AGENT_CYCLE_TRACE_STORAGE_POLICY_VERSION,
    payload: 'lossless-full-agent-cycle-traces',
    writerFormat: 'legacy-gzip-prefix-plus-length-prefixed-brotli-jsonl-batches',
    repositoryBatchBoundary: 'one-brotli-frame-per-record-many-call',
    canonicalWorkerBatchBoundary: 'available-agent-traces-per-simulation-tick',
    compressionQuality: 6,
    sampling: 'none',
    legacyReadPath: 'agent-cycle-traces.jsonl',
    compressedWritePath: 'agent-cycle-traces.jsonl.gz',
    mixedCodecCompatibility: 'v1-v4-gzip-index-rows-plus-v5-brotli-index-rows',
    legacyBatchIndexPath: 'agent-cycle-trace-batches.jsonl',
    compactBatchIndexPath: 'agent-cycle-trace-batches.deflate',
    compactBatchIndexFormat: 'uint32be-length-prefixed-deflate-raw-json-v1',
    indexCompatibilityRule:
      'union-read-legacy-jsonl-and-compact-deflate-with-covered-range-deduplication',
    recentBatchLimit: AGENT_CYCLE_TRACE_RECENT_BATCH_LIMIT,
    deduplicationBloomBitCount: AGENT_CYCLE_TRACE_DEDUPLICATION_BLOOM_BIT_COUNT,
    deduplicationBloomHashCount: AGENT_CYCLE_TRACE_DEDUPLICATION_BLOOM_HASH_COUNT,
    runtimeIndexRule: 'bounded-recent-batches-plus-fixed-bloom-with-exact-cold-scan',
    queryRule: 'serve-provably-complete-latest-window-else-filter-complete-index',
    incompleteIndexRecovery: 'hash-and-index-complete-gzip-or-framed-brotli-tail-or-fail-closed',
    rollbackBoundary: 'pre-v2-runtime-starts-but-cannot-query-post-upgrade-compressed-traces',
  };
}

/** Offline integrity-aware residual scan for participant-data deletion. */
export function agentCycleTraceCompressedStorageContainsUtf8(input: {
  readonly rootDir: string;
  readonly target: string;
}): boolean {
  assertNonEmpty(input.rootDir, 'rootDir');
  assertNonEmpty(input.target, 'target');
  const compressedTracesPath = join(input.rootDir, 'agent-cycle-traces.jsonl.gz');
  if (!existsSync(compressedTracesPath) || statSync(compressedTracesPath).size === 0) {
    return false;
  }
  const batches = readOrRecoverAgentCycleTraceBatchIndex({
    compressedTracesPath,
    legacyBatchIndexPath: join(input.rootDir, 'agent-cycle-trace-batches.jsonl'),
    compactBatchIndexPath: join(input.rootDir, 'agent-cycle-trace-batches.deflate'),
  });
  return batches.some((batch) =>
    serializePersistedAgentCycleTraces(
      readCompressedAgentCycleTraceBatch(compressedTracesPath, batch),
    ).includes(Buffer.from(input.target, 'utf8')),
  );
}

type PersistedAgentCycleTrace = Omit<
  AgentCycleTrace,
  'simulatorEvents' | 'subtaskReplanningDecisions'
> & {
  readonly simulatorEvents?: readonly AgentCycleSimulatorEventTrace[];
  readonly subtaskReplanningDecisions?: readonly AgentCycleSubtaskReplanningDecisionTrace[];
};

type LlmCognitiveContextTrace = {
  readonly shortTermMemoryContext?: { readonly recordCount: number };
  readonly longTermProfileContext?: { readonly entryCount: number };
  readonly observedStateSummary?: string;
};

export class InMemoryAgentCycleTraceRepository implements AgentCycleTraceRepository {
  private readonly tracesById = new Map<string, AgentCycleTrace>();

  record(trace: AgentCycleTrace): Promise<void> {
    return this.recordMany([trace]);
  }

  recordMany(traces: readonly AgentCycleTrace[]): Promise<void> {
    for (const trace of traces) {
      if (!this.tracesById.has(trace.traceId)) {
        this.tracesById.set(trace.traceId, cloneTrace(trace));
      }
    }
    return Promise.resolve();
  }

  get(traceId: string): Promise<AgentCycleTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const trace = this.tracesById.get(traceId);
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(query: AgentCycleTraceQuery): Promise<AgentCycleTrace[]> {
    return Promise.resolve().then(() => queryTraces([...this.tracesById.values()], query));
  }
}

export type FileAgentCycleTraceStorageDiagnostics = {
  readonly indexedBatchCount: number;
  readonly recentBatchCount: number;
  readonly recentTraceIdCount: number;
  readonly recentBatchLimit: number;
  readonly deduplicationBloomBitCount: number;
  readonly deduplicationBloomByteLength: number;
  readonly maximumEvictedCycleStartedAt?: number;
};

export class FileAgentCycleTraceRepository implements AgentCycleTraceRepository {
  private readonly legacyTracesPath: string;
  private readonly compressedTracesPath: string;
  private readonly legacyBatchIndexPath: string;
  private readonly compactBatchIndexPath: string;
  private readonly recentBatchLimit: number;
  private readonly deduplicationBloomBitCount: number;
  private indexedTraceIdBloom?: FixedBloomFilter;
  private indexedLegacyTraces?: readonly PersistedAgentCycleTrace[];
  private indexedBatchCount = 0;
  private indexedRecentBatches?: PersistedAgentCycleTraceBatchIndex[];
  private indexedRecentBatchByTraceId?: Map<string, PersistedAgentCycleTraceBatchIndex>;
  private maximumEvictedCycleStartedAt: number | undefined;
  private indexedStoreSignature?: AgentCycleTraceStoreSignature;

  constructor(input: {
    readonly rootDir: string;
    readonly recentBatchLimit?: number;
    readonly deduplicationBloomBitCount?: number;
  }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.recentBatchLimit = input.recentBatchLimit ?? AGENT_CYCLE_TRACE_RECENT_BATCH_LIMIT;
    this.deduplicationBloomBitCount =
      input.deduplicationBloomBitCount ?? AGENT_CYCLE_TRACE_DEDUPLICATION_BLOOM_BIT_COUNT;
    assertPositiveSafeInteger(this.recentBatchLimit, 'recentBatchLimit');
    assertPositiveSafeInteger(this.deduplicationBloomBitCount, 'deduplicationBloomBitCount');
    this.legacyTracesPath = join(input.rootDir, 'agent-cycle-traces.jsonl');
    this.compressedTracesPath = join(input.rootDir, 'agent-cycle-traces.jsonl.gz');
    this.legacyBatchIndexPath = join(input.rootDir, 'agent-cycle-trace-batches.jsonl');
    this.compactBatchIndexPath = join(input.rootDir, 'agent-cycle-trace-batches.deflate');
    ensureFile(this.legacyTracesPath, input.rootDir);
    ensureFile(this.legacyBatchIndexPath, input.rootDir);
    ensureFile(this.compactBatchIndexPath, input.rootDir);
  }

  record(trace: AgentCycleTrace): Promise<void> {
    return this.recordMany([trace]);
  }

  recordMany(traces: readonly AgentCycleTrace[]): Promise<void> {
    return Promise.resolve().then(() => {
      if (traces.length === 0) {
        return;
      }
      this.refreshTraceIdIndex();
      const batchTraceIds = new Set<string>();
      const newTraces = traces
        .map((trace) => cloneTrace(trace))
        .filter((trace) => {
          if (batchTraceIds.has(trace.traceId) || this.hasIndexedTraceId(trace.traceId)) {
            return false;
          }
          batchTraceIds.add(trace.traceId);
          return true;
        });
      if (newTraces.length === 0) {
        return;
      }
      const batch = appendCompressedAgentCycleTraceBatch({
        compressedTracesPath: this.compressedTracesPath,
        compactBatchIndexPath: this.compactBatchIndexPath,
        traces: newTraces,
      });
      for (const traceId of batchTraceIds) {
        this.indexedTraceIdBloom!.add(traceId);
      }
      this.indexedBatchCount += 1;
      this.retainRecentBatch(batch);
      this.indexedStoreSignature = createAgentCycleTraceStoreSignature({
        legacyTracesPath: this.legacyTracesPath,
        compressedTracesPath: this.compressedTracesPath,
        legacyBatchIndexPath: this.legacyBatchIndexPath,
        compactBatchIndexPath: this.compactBatchIndexPath,
      });
    });
  }

  get(traceId: string): Promise<AgentCycleTrace | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      this.refreshTraceIdIndex();
      const legacyTrace = this.indexedLegacyTraces!.find(
        (candidate) => candidate.traceId === traceId,
      );
      if (legacyTrace !== undefined) {
        return cloneTrace(legacyTrace);
      }
      const batch =
        this.indexedRecentBatchByTraceId!.get(traceId) ??
        (this.indexedTraceIdBloom!.mightContain(traceId)
          ? findAgentCycleTraceBatchByTraceId(
              [this.legacyBatchIndexPath, this.compactBatchIndexPath],
              traceId,
            )
          : undefined);
      const trace =
        batch === undefined
          ? undefined
          : readCompressedAgentCycleTraceBatch(this.compressedTracesPath, batch).find(
              (candidate) => candidate.traceId === traceId,
            );
      return trace === undefined ? undefined : cloneTrace(trace);
    });
  }

  query(query: AgentCycleTraceQuery): Promise<AgentCycleTrace[]> {
    return Promise.resolve().then(() => {
      assertValidQuery(query);
      this.refreshTraceIdIndex();
      const recentResult = this.queryBatches({
        query,
        batches: this.indexedRecentBatches!,
      });
      if (this.recentResultIsComplete(recentResult, query)) {
        return queryTraces(recentResult, query);
      }
      const allBatches = readOrRecoverAgentCycleTraceBatchIndex({
        compressedTracesPath: this.compressedTracesPath,
        legacyBatchIndexPath: this.legacyBatchIndexPath,
        compactBatchIndexPath: this.compactBatchIndexPath,
      });
      return queryTraces(this.queryBatches({ query, batches: allBatches }), query);
    });
  }

  getStorageDiagnostics(): FileAgentCycleTraceStorageDiagnostics {
    this.refreshTraceIdIndex();
    return {
      indexedBatchCount: this.indexedBatchCount,
      recentBatchCount: this.indexedRecentBatches!.length,
      recentTraceIdCount: this.indexedRecentBatchByTraceId!.size,
      recentBatchLimit: this.recentBatchLimit,
      deduplicationBloomBitCount: this.indexedTraceIdBloom!.bitCount,
      deduplicationBloomByteLength: this.indexedTraceIdBloom!.byteLength,
      ...(this.maximumEvictedCycleStartedAt === undefined
        ? {}
        : { maximumEvictedCycleStartedAt: this.maximumEvictedCycleStartedAt }),
    };
  }

  private queryBatches(input: {
    readonly query: AgentCycleTraceQuery;
    readonly batches: readonly PersistedAgentCycleTraceBatchIndex[];
  }): PersistedAgentCycleTrace[] {
    const traces = [...this.indexedLegacyTraces!];
    const seenTraceIds = new Set(traces.map((trace) => trace.traceId));
    const batches = input.batches
      .filter((batch) => batchMayMatchQuery(batch, input.query))
      .sort(compareBatchLatestFirst);
    for (const [index, batch] of batches.entries()) {
      for (const trace of readCompressedAgentCycleTraceBatch(this.compressedTracesPath, batch)) {
        if (!seenTraceIds.has(trace.traceId)) {
          seenTraceIds.add(trace.traceId);
          traces.push(trace);
        }
      }
      if (
        canStopReadingBatches({
          traces,
          query: input.query,
          nextBatch: batches[index + 1],
        })
      ) {
        break;
      }
    }
    return traces;
  }

  private recentResultIsComplete(
    traces: readonly PersistedAgentCycleTrace[],
    query: AgentCycleTraceQuery,
  ): boolean {
    if (this.indexedBatchCount <= this.indexedRecentBatches!.length) {
      return true;
    }
    if (query.limit === undefined) {
      return false;
    }
    const selected = filterAndSortTraces(traces, query).slice(0, query.limit);
    if (selected.length < query.limit) {
      return false;
    }
    const oldestSelected = selected.at(-1)?.cycleStartedAt;
    return (
      oldestSelected !== undefined &&
      this.maximumEvictedCycleStartedAt !== undefined &&
      oldestSelected > this.maximumEvictedCycleStartedAt
    );
  }

  private hasIndexedTraceId(traceId: string): boolean {
    if (!this.indexedTraceIdBloom!.mightContain(traceId)) {
      return false;
    }
    return (
      this.indexedLegacyTraces!.some((trace) => trace.traceId === traceId) ||
      this.indexedRecentBatchByTraceId!.has(traceId) ||
      findAgentCycleTraceBatchByTraceId(
        [this.legacyBatchIndexPath, this.compactBatchIndexPath],
        traceId,
      ) !== undefined
    );
  }

  private refreshTraceIdIndex(): void {
    const storeSignature = createAgentCycleTraceStoreSignature({
      legacyTracesPath: this.legacyTracesPath,
      compressedTracesPath: this.compressedTracesPath,
      legacyBatchIndexPath: this.legacyBatchIndexPath,
      compactBatchIndexPath: this.compactBatchIndexPath,
    });
    if (
      this.indexedTraceIdBloom !== undefined &&
      sameAgentCycleTraceStoreSignature(this.indexedStoreSignature, storeSignature)
    ) {
      return;
    }
    const legacyTraces = readJsonLines<PersistedAgentCycleTrace>(this.legacyTracesPath);
    const batches = readOrRecoverAgentCycleTraceBatchIndex({
      compressedTracesPath: this.compressedTracesPath,
      legacyBatchIndexPath: this.legacyBatchIndexPath,
      compactBatchIndexPath: this.compactBatchIndexPath,
    });
    this.indexedTraceIdBloom = new FixedBloomFilter({
      bitCount: this.deduplicationBloomBitCount,
      hashCount: AGENT_CYCLE_TRACE_DEDUPLICATION_BLOOM_HASH_COUNT,
    });
    this.indexedLegacyTraces = legacyTraces;
    this.indexedBatchCount = batches.length;
    this.indexedRecentBatches = [];
    this.indexedRecentBatchByTraceId = new Map();
    this.maximumEvictedCycleStartedAt = undefined;
    for (const trace of legacyTraces) {
      this.indexedTraceIdBloom.add(trace.traceId);
    }
    for (const batch of batches) {
      for (const traceId of batch.traceIds) {
        this.indexedTraceIdBloom.add(traceId);
      }
      this.retainRecentBatch(batch);
    }
    this.indexedStoreSignature = createAgentCycleTraceStoreSignature({
      legacyTracesPath: this.legacyTracesPath,
      compressedTracesPath: this.compressedTracesPath,
      legacyBatchIndexPath: this.legacyBatchIndexPath,
      compactBatchIndexPath: this.compactBatchIndexPath,
    });
  }

  private retainRecentBatch(batch: PersistedAgentCycleTraceBatchIndex): void {
    this.indexedRecentBatches!.push(batch);
    for (const traceId of batch.traceIds) {
      this.indexedRecentBatchByTraceId!.set(traceId, batch);
    }
    while (this.indexedRecentBatches!.length > this.recentBatchLimit) {
      const evicted = this.indexedRecentBatches!.shift()!;
      this.maximumEvictedCycleStartedAt = Math.max(
        this.maximumEvictedCycleStartedAt ?? Number.NEGATIVE_INFINITY,
        evicted.maximumCycleStartedAt,
      );
      for (const traceId of evicted.traceIds) {
        if (this.indexedRecentBatchByTraceId!.get(traceId) === evicted) {
          this.indexedRecentBatchByTraceId!.delete(traceId);
        }
      }
    }
  }
}

const AGENT_CYCLE_TRACE_BATCH_INDEX_LEGACY_SCHEMA_VERSION = 'agent-cycle-trace-batch-index-v1';
const AGENT_CYCLE_TRACE_BATCH_INDEX_SCHEMA_VERSION = 'agent-cycle-trace-batch-index-v2';
const AGENT_CYCLE_TRACE_BROTLI_CODEC = 'brotli-quality-6-length-prefixed-v1';

type PersistedAgentCycleTraceBatchIndexCommon = {
  readonly batchId: string;
  readonly compressedOffset: number;
  readonly compressedByteLength: number;
  readonly uncompressedByteLength: number;
  readonly payloadSha256: string;
  readonly indexSha256: string;
  readonly traceCount: number;
  readonly traceIds: readonly string[];
  readonly simulationIds: readonly string[];
  readonly agentIds: readonly string[];
  readonly minimumCycleStartedAt: number;
  readonly maximumCycleStartedAt: number;
};

type PersistedAgentCycleTraceBatchIndex = PersistedAgentCycleTraceBatchIndexCommon &
  (
    | {
        readonly schemaVersion: typeof AGENT_CYCLE_TRACE_BATCH_INDEX_LEGACY_SCHEMA_VERSION;
      }
    | {
        readonly schemaVersion: typeof AGENT_CYCLE_TRACE_BATCH_INDEX_SCHEMA_VERSION;
        readonly compression: typeof AGENT_CYCLE_TRACE_BROTLI_CODEC;
      }
  );

type UnsignedPersistedAgentCycleTraceBatchIndex = Omit<
  PersistedAgentCycleTraceBatchIndexCommon,
  'indexSha256'
> &
  (
    | {
        readonly schemaVersion: typeof AGENT_CYCLE_TRACE_BATCH_INDEX_LEGACY_SCHEMA_VERSION;
      }
    | {
        readonly schemaVersion: typeof AGENT_CYCLE_TRACE_BATCH_INDEX_SCHEMA_VERSION;
        readonly compression: typeof AGENT_CYCLE_TRACE_BROTLI_CODEC;
      }
  );

type AgentCycleTraceFileSignature = {
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedAtMs: number;
  readonly changedAtMs: number;
};

type AgentCycleTraceStoreSignature = {
  readonly legacy: AgentCycleTraceFileSignature | undefined;
  readonly compressed: AgentCycleTraceFileSignature | undefined;
  readonly legacyBatchIndex: AgentCycleTraceFileSignature | undefined;
  readonly compactBatchIndex: AgentCycleTraceFileSignature | undefined;
};

function findAgentCycleTraceBatchByTraceId(
  paths: readonly [legacyBatchIndexPath: string, compactBatchIndexPath: string],
  traceId: string,
): PersistedAgentCycleTraceBatchIndex | undefined {
  let match: PersistedAgentCycleTraceBatchIndex | undefined;
  const onBatch = (batch: PersistedAgentCycleTraceBatchIndex): boolean => {
    if (batch.traceIds.includes(traceId)) {
      match = batch;
      return false;
    }
    return true;
  };
  scanLegacyAgentCycleTraceBatchIndex(paths[0], onBatch);
  if (match === undefined) {
    scanCompactAgentCycleTraceBatchIndex(paths[1], onBatch);
  }
  return match;
}

function scanLegacyAgentCycleTraceBatchIndex(
  path: string,
  onBatch: (batch: PersistedAgentCycleTraceBatchIndex) => boolean,
): void {
  if (!existsSync(path) || statSync(path).size === 0) {
    return;
  }
  const file = openSync(path, 'r');
  const chunkSize = 64 * 1024;
  let position = 0;
  let pending = Buffer.alloc(0);
  try {
    while (true) {
      const chunk = Buffer.allocUnsafe(chunkSize);
      const bytesRead = readSync(file, chunk, 0, chunk.byteLength, position);
      if (bytesRead === 0) {
        break;
      }
      position += bytesRead;
      const combined =
        pending.length === 0
          ? chunk.subarray(0, bytesRead)
          : Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
      let lineStart = 0;
      for (
        let newline = combined.indexOf(0x0a);
        newline >= 0;
        newline = combined.indexOf(0x0a, lineStart)
      ) {
        const line = combined.subarray(lineStart, newline);
        lineStart = newline + 1;
        if (
          line.length > 0 &&
          !onBatch(JSON.parse(line.toString('utf8')) as PersistedAgentCycleTraceBatchIndex)
        ) {
          return;
        }
      }
      pending = combined.subarray(lineStart);
    }
    if (pending.length > 0) {
      throw new Error(`compressed agent cycle trace index has an incomplete trailing row: ${path}`);
    }
  } catch (error) {
    throw new Error(`compressed agent cycle trace index contains invalid JSONL: ${path}`, {
      cause: error,
    });
  } finally {
    closeSync(file);
  }
}

function scanCompactAgentCycleTraceBatchIndex(
  path: string,
  onBatch: (batch: PersistedAgentCycleTraceBatchIndex) => boolean,
): void {
  if (!existsSync(path) || statSync(path).size === 0) {
    return;
  }
  const file = openSync(path, 'r');
  const fileSize = statSync(path).size;
  let position = 0;
  try {
    while (position < fileSize) {
      if (fileSize - position < 4) {
        throw new Error(`compact agent cycle trace index has an incomplete frame header: ${path}`);
      }
      const header = Buffer.allocUnsafe(4);
      readExact(file, header, position, path);
      position += header.byteLength;
      const compressedByteLength = header.readUInt32BE(0);
      if (compressedByteLength === 0 || compressedByteLength > fileSize - position) {
        throw new Error(`compact agent cycle trace index has an incomplete frame payload: ${path}`);
      }
      const compressed = Buffer.allocUnsafe(compressedByteLength);
      readExact(file, compressed, position, path);
      position += compressed.byteLength;
      let batch: PersistedAgentCycleTraceBatchIndex;
      try {
        batch = JSON.parse(
          inflateRawSync(compressed).toString('utf8'),
        ) as PersistedAgentCycleTraceBatchIndex;
      } catch (error) {
        throw new Error(`compact agent cycle trace index contains an invalid frame: ${path}`, {
          cause: error,
        });
      }
      if (!onBatch(batch)) {
        return;
      }
    }
  } finally {
    closeSync(file);
  }
}

function createAgentCycleTraceStoreSignature(input: {
  readonly legacyTracesPath: string;
  readonly compressedTracesPath: string;
  readonly legacyBatchIndexPath: string;
  readonly compactBatchIndexPath: string;
}): AgentCycleTraceStoreSignature {
  return {
    legacy: createAgentCycleTraceFileSignature(input.legacyTracesPath),
    compressed: createAgentCycleTraceFileSignature(input.compressedTracesPath),
    legacyBatchIndex: createAgentCycleTraceFileSignature(input.legacyBatchIndexPath),
    compactBatchIndex: createAgentCycleTraceFileSignature(input.compactBatchIndexPath),
  };
}

function createAgentCycleTraceFileSignature(
  path: string,
): AgentCycleTraceFileSignature | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  const stats = statSync(path);
  return {
    device: stats.dev,
    inode: stats.ino,
    size: stats.size,
    modifiedAtMs: stats.mtimeMs,
    changedAtMs: stats.ctimeMs,
  };
}

function sameAgentCycleTraceStoreSignature(
  left: AgentCycleTraceStoreSignature | undefined,
  right: AgentCycleTraceStoreSignature,
): boolean {
  return (
    sameAgentCycleTraceFileSignature(left?.legacy, right.legacy) &&
    sameAgentCycleTraceFileSignature(left?.compressed, right.compressed) &&
    sameAgentCycleTraceFileSignature(left?.legacyBatchIndex, right.legacyBatchIndex) &&
    sameAgentCycleTraceFileSignature(left?.compactBatchIndex, right.compactBatchIndex)
  );
}

function sameAgentCycleTraceFileSignature(
  left: AgentCycleTraceFileSignature | undefined,
  right: AgentCycleTraceFileSignature | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedAtMs === right.modifiedAtMs &&
    left.changedAtMs === right.changedAtMs
  );
}

function readExact(file: number, buffer: Buffer, position: number, path: string): void {
  let bytesRead = 0;
  while (bytesRead < buffer.byteLength) {
    const count = readSync(
      file,
      buffer,
      bytesRead,
      buffer.byteLength - bytesRead,
      position + bytesRead,
    );
    if (count === 0) {
      throw new Error(`compact agent cycle trace index is truncated: ${path}`);
    }
    bytesRead += count;
  }
}

function appendCompressedAgentCycleTraceBatch(input: {
  readonly compressedTracesPath: string;
  readonly compactBatchIndexPath: string;
  readonly traces: readonly PersistedAgentCycleTrace[];
}): PersistedAgentCycleTraceBatchIndex {
  const payload = serializePersistedAgentCycleTraces(input.traces);
  const compressed = brotliCompressSync(payload, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]:
        createAgentCycleTraceStoragePolicyManifest().compressionQuality,
    },
  });
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(compressed.byteLength, 0);
  const batch = createAgentCycleTraceBatchIndex({
    traces: input.traces,
    compressedOffset: existsSync(input.compressedTracesPath)
      ? statSync(input.compressedTracesPath).size
      : 0,
    compressedByteLength: header.byteLength + compressed.byteLength,
    payload,
  });
  appendFileSync(input.compressedTracesPath, Buffer.concat([header, compressed]));
  appendCompactAgentCycleTraceBatchIndex(input.compactBatchIndexPath, batch);
  return batch;
}

function readOrRecoverAgentCycleTraceBatchIndex(input: {
  readonly compressedTracesPath: string;
  readonly legacyBatchIndexPath: string;
  readonly compactBatchIndexPath: string;
}): readonly PersistedAgentCycleTraceBatchIndex[] {
  const compressedByteLength = existsSync(input.compressedTracesPath)
    ? statSync(input.compressedTracesPath).size
    : 0;
  const batches = canonicalizeAgentCycleTraceBatchIndexes({
    indexes: [
      ...readLegacyAgentCycleTraceBatchIndex(input.legacyBatchIndexPath).map((batch) => ({
        batch,
        path: input.legacyBatchIndexPath,
      })),
      ...readCompactAgentCycleTraceBatchIndex(input.compactBatchIndexPath).map((batch) => ({
        batch,
        path: input.compactBatchIndexPath,
      })),
    ],
  });
  const indexedByteLength = batches.reduce(
    (maximum, batch) => Math.max(maximum, batch.compressedOffset + batch.compressedByteLength),
    0,
  );
  if (indexedByteLength > compressedByteLength) {
    throw new Error(
      `compressed agent cycle trace index exceeds its data file: ${input.compactBatchIndexPath}`,
    );
  }
  if (indexedByteLength === compressedByteLength) {
    return batches;
  }
  const recoveredBatches = recoverAgentCycleTraceTail({
    path: input.compressedTracesPath,
    compressedOffset: indexedByteLength,
    compressedByteLength: compressedByteLength - indexedByteLength,
  });
  for (const recoveredBatch of recoveredBatches) {
    appendCompactAgentCycleTraceBatchIndex(input.compactBatchIndexPath, recoveredBatch);
  }
  return [...batches, ...recoveredBatches];
}

function recoverAgentCycleTraceTail(input: {
  readonly path: string;
  readonly compressedOffset: number;
  readonly compressedByteLength: number;
}): readonly PersistedAgentCycleTraceBatchIndex[] {
  const tail = readFileSegment(input);
  if (tail[0] === 0x1f && tail[1] === 0x8b) {
    const traces = decodeCompressedAgentCycleTraceSegment({
      ...input,
      compression: 'legacy-gzip',
    });
    const payload = serializePersistedAgentCycleTraces(traces);
    return [
      createAgentCycleTraceBatchIndex({
        traces,
        compressedOffset: input.compressedOffset,
        compressedByteLength: input.compressedByteLength,
        payload,
        compression: 'legacy-gzip',
      }),
    ];
  }

  const recovered: PersistedAgentCycleTraceBatchIndex[] = [];
  let position = 0;
  while (position < tail.byteLength) {
    if (tail.byteLength - position < 4) {
      throw new Error(
        `compressed agent cycle trace Brotli tail has an incomplete header: ${input.path}`,
      );
    }
    const compressedByteLength = tail.readUInt32BE(position);
    if (compressedByteLength === 0 || compressedByteLength > tail.byteLength - position - 4) {
      throw new Error(
        `compressed agent cycle trace Brotli tail has an incomplete payload: ${input.path}`,
      );
    }
    const frameByteLength = 4 + compressedByteLength;
    let payload: Buffer;
    try {
      payload = brotliDecompressSync(tail.subarray(position + 4, position + frameByteLength));
    } catch (error) {
      throw new Error(`compressed agent cycle trace Brotli tail is corrupt: ${input.path}`, {
        cause: error,
      });
    }
    const traces = parsePersistedAgentCycleTracePayload(payload, input.path);
    recovered.push(
      createAgentCycleTraceBatchIndex({
        traces,
        compressedOffset: input.compressedOffset + position,
        compressedByteLength: frameByteLength,
        payload,
      }),
    );
    position += frameByteLength;
  }
  return recovered;
}

function readLegacyAgentCycleTraceBatchIndex(
  path: string,
): readonly PersistedAgentCycleTraceBatchIndex[] {
  try {
    return readJsonLines<PersistedAgentCycleTraceBatchIndex>(path);
  } catch (error) {
    throw new Error(`compressed agent cycle trace index contains invalid JSONL: ${path}`, {
      cause: error,
    });
  }
}

function readCompactAgentCycleTraceBatchIndex(
  path: string,
): readonly PersistedAgentCycleTraceBatchIndex[] {
  const batches: PersistedAgentCycleTraceBatchIndex[] = [];
  scanCompactAgentCycleTraceBatchIndex(path, (batch) => {
    batches.push(batch);
    return true;
  });
  return batches;
}

function appendCompactAgentCycleTraceBatchIndex(
  path: string,
  batch: PersistedAgentCycleTraceBatchIndex,
): void {
  const compressed = deflateRawSync(Buffer.from(JSON.stringify(batch), 'utf8'), { level: 6 });
  if (compressed.byteLength > 0xffff_ffff) {
    throw new Error('compact agent cycle trace index frame exceeds uint32 length');
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(compressed.byteLength, 0);
  appendFileSync(path, Buffer.concat([header, compressed]));
}

function canonicalizeAgentCycleTraceBatchIndexes(input: {
  readonly indexes: readonly {
    readonly batch: PersistedAgentCycleTraceBatchIndex;
    readonly path: string;
  }[];
}): readonly PersistedAgentCycleTraceBatchIndex[] {
  for (const index of input.indexes) {
    assertValidAgentCycleTraceBatchIndex(index.batch, index.path);
  }
  const sorted = [...input.indexes].sort(
    (left, right) =>
      left.batch.compressedOffset - right.batch.compressedOffset ||
      right.batch.compressedByteLength - left.batch.compressedByteLength,
  );
  const batches: PersistedAgentCycleTraceBatchIndex[] = [];
  let coveredByteLength = 0;
  for (const { batch, path } of sorted) {
    const end = batch.compressedOffset + batch.compressedByteLength;
    if (batch.compressedOffset === coveredByteLength) {
      batches.push(batch);
      coveredByteLength = end;
      continue;
    }
    if (batch.compressedOffset < coveredByteLength && end <= coveredByteLength) {
      continue;
    }
    throw new Error(`compressed agent cycle trace index has a gap or partial overlap: ${path}`);
  }
  return batches;
}

function readCompressedAgentCycleTraceBatch(
  path: string,
  batch: PersistedAgentCycleTraceBatchIndex,
): readonly PersistedAgentCycleTrace[] {
  const traces = decodeCompressedAgentCycleTraceSegment({
    path,
    compressedOffset: batch.compressedOffset,
    compressedByteLength: batch.compressedByteLength,
    compression:
      batch.schemaVersion === AGENT_CYCLE_TRACE_BATCH_INDEX_SCHEMA_VERSION
        ? batch.compression
        : 'legacy-gzip',
  });
  const payload = serializePersistedAgentCycleTraces(traces);
  if (
    payload.byteLength !== batch.uncompressedByteLength ||
    sha256(payload) !== batch.payloadSha256 ||
    traces.length !== batch.traceCount ||
    !sameStrings(
      traces.map((trace) => trace.traceId),
      batch.traceIds,
    )
  ) {
    throw new Error(
      `compressed agent cycle trace batch failed integrity validation: ${batch.batchId}`,
    );
  }
  return traces;
}

function decodeCompressedAgentCycleTraceSegment(input: {
  readonly path: string;
  readonly compressedOffset: number;
  readonly compressedByteLength: number;
  readonly compression: typeof AGENT_CYCLE_TRACE_BROTLI_CODEC | 'legacy-gzip';
}): readonly PersistedAgentCycleTrace[] {
  const compressed = readFileSegment(input);
  let content: string;
  try {
    if (input.compression === 'legacy-gzip') {
      content = gunzipSync(compressed).toString('utf8').trim();
    } else {
      if (compressed.byteLength < 5) {
        throw new Error('Brotli frame is missing its header or payload');
      }
      const compressedByteLength = compressed.readUInt32BE(0);
      if (compressedByteLength !== compressed.byteLength - 4) {
        throw new Error('Brotli frame length does not match its index');
      }
      content = brotliDecompressSync(compressed.subarray(4)).toString('utf8').trim();
    }
  } catch (error) {
    throw new Error(`compressed agent cycle trace store is corrupt: ${input.path}`, {
      cause: error,
    });
  }
  if (content.length === 0) {
    throw new Error(`compressed agent cycle trace batch is empty: ${input.path}`);
  }
  return parsePersistedAgentCycleTracePayload(Buffer.from(`${content}\n`, 'utf8'), input.path);
}

function serializePersistedAgentCycleTraces(traces: readonly PersistedAgentCycleTrace[]): Buffer {
  return Buffer.from(`${traces.map((trace) => JSON.stringify(trace)).join('\n')}\n`, 'utf8');
}

function parsePersistedAgentCycleTracePayload(
  payload: Buffer,
  path: string,
): readonly PersistedAgentCycleTrace[] {
  const content = payload.toString('utf8');
  if (!content.endsWith('\n')) {
    throw new Error(`compressed agent cycle trace JSONL is missing its terminal newline: ${path}`);
  }
  const lines = content.slice(0, -1).split('\n');
  if (lines.length === 0 || lines[0] === '') {
    throw new Error(`compressed agent cycle trace batch is empty: ${path}`);
  }
  try {
    return lines.map((line) => JSON.parse(line) as PersistedAgentCycleTrace);
  } catch (error) {
    throw new Error(`compressed agent cycle trace store contains invalid JSONL: ${path}`, {
      cause: error,
    });
  }
}

function readFileSegment(input: {
  readonly path: string;
  readonly compressedOffset: number;
  readonly compressedByteLength: number;
}): Buffer {
  const buffer = Buffer.allocUnsafe(input.compressedByteLength);
  const file = openSync(input.path, 'r');
  let bytesRead = 0;
  try {
    while (bytesRead < buffer.byteLength) {
      const count = readSync(
        file,
        buffer,
        bytesRead,
        buffer.byteLength - bytesRead,
        input.compressedOffset + bytesRead,
      );
      if (count === 0) {
        throw new Error(`compressed agent cycle trace batch is truncated: ${input.path}`);
      }
      bytesRead += count;
    }
  } finally {
    closeSync(file);
  }
  return buffer;
}

function createAgentCycleTraceBatchIndex(input: {
  readonly traces: readonly PersistedAgentCycleTrace[];
  readonly compressedOffset: number;
  readonly compressedByteLength: number;
  readonly payload: Buffer;
  readonly compression?: 'legacy-gzip';
}): PersistedAgentCycleTraceBatchIndex {
  const payloadSha256 = sha256(input.payload);
  const cycleStartedAt = input.traces.map((trace) => trace.cycleStartedAt);
  const common = {
    batchId: `agent-cycle-trace-batch:sha256:${payloadSha256}`,
    compressedOffset: input.compressedOffset,
    compressedByteLength: input.compressedByteLength,
    uncompressedByteLength: input.payload.byteLength,
    payloadSha256,
    traceCount: input.traces.length,
    traceIds: input.traces.map((trace) => trace.traceId),
    simulationIds: uniqueSorted(input.traces.map((trace) => trace.simulationId)),
    agentIds: uniqueSorted(input.traces.map((trace) => trace.agentId)),
    minimumCycleStartedAt: Math.min(...cycleStartedAt),
    maximumCycleStartedAt: Math.max(...cycleStartedAt),
  };
  const unsignedIndex: UnsignedPersistedAgentCycleTraceBatchIndex =
    input.compression === 'legacy-gzip'
      ? {
          schemaVersion: AGENT_CYCLE_TRACE_BATCH_INDEX_LEGACY_SCHEMA_VERSION,
          ...common,
        }
      : {
          schemaVersion: AGENT_CYCLE_TRACE_BATCH_INDEX_SCHEMA_VERSION,
          compression: AGENT_CYCLE_TRACE_BROTLI_CODEC,
          ...common,
        };
  return {
    ...unsignedIndex,
    indexSha256: sha256(Buffer.from(JSON.stringify(unsignedIndex), 'utf8')),
  };
}

function assertValidAgentCycleTraceBatchIndex(
  batch: PersistedAgentCycleTraceBatchIndex,
  path: string,
): void {
  const { indexSha256, ...unsignedIndex } = batch;
  if (
    (batch.schemaVersion !== AGENT_CYCLE_TRACE_BATCH_INDEX_LEGACY_SCHEMA_VERSION &&
      (batch.schemaVersion !== AGENT_CYCLE_TRACE_BATCH_INDEX_SCHEMA_VERSION ||
        batch.compression !== AGENT_CYCLE_TRACE_BROTLI_CODEC)) ||
    !Number.isSafeInteger(batch.compressedOffset) ||
    batch.compressedOffset < 0 ||
    !Number.isSafeInteger(batch.compressedByteLength) ||
    batch.compressedByteLength <= 0 ||
    !Number.isSafeInteger(batch.uncompressedByteLength) ||
    batch.uncompressedByteLength <= 0 ||
    !/^[a-f0-9]{64}$/u.test(batch.payloadSha256) ||
    !/^[a-f0-9]{64}$/u.test(indexSha256) ||
    sha256(Buffer.from(JSON.stringify(unsignedIndex), 'utf8')) !== indexSha256 ||
    batch.batchId !== `agent-cycle-trace-batch:sha256:${batch.payloadSha256}` ||
    !Number.isSafeInteger(batch.traceCount) ||
    batch.traceCount <= 0 ||
    !Array.isArray(batch.traceIds) ||
    batch.traceIds.length !== batch.traceCount ||
    !batch.traceIds.every((value) => typeof value === 'string' && value.length > 0) ||
    !Array.isArray(batch.simulationIds) ||
    !batch.simulationIds.every((value) => typeof value === 'string' && value.length > 0) ||
    !Array.isArray(batch.agentIds) ||
    !batch.agentIds.every((value) => typeof value === 'string' && value.length > 0) ||
    !Number.isFinite(batch.minimumCycleStartedAt) ||
    !Number.isFinite(batch.maximumCycleStartedAt) ||
    batch.minimumCycleStartedAt > batch.maximumCycleStartedAt
  ) {
    throw new Error(`compressed agent cycle trace index is invalid: ${path}`);
  }
}

function batchMayMatchQuery(
  batch: PersistedAgentCycleTraceBatchIndex,
  query: AgentCycleTraceQuery,
): boolean {
  return (
    batch.simulationIds.includes(query.simulationId) &&
    (query.agentId === undefined || batch.agentIds.includes(query.agentId)) &&
    (query.fromCycleStartedAt === undefined ||
      batch.maximumCycleStartedAt >= query.fromCycleStartedAt) &&
    (query.toCycleStartedAt === undefined || batch.minimumCycleStartedAt <= query.toCycleStartedAt)
  );
}

function compareBatchLatestFirst(
  left: PersistedAgentCycleTraceBatchIndex,
  right: PersistedAgentCycleTraceBatchIndex,
): number {
  if (left.maximumCycleStartedAt !== right.maximumCycleStartedAt) {
    return right.maximumCycleStartedAt - left.maximumCycleStartedAt;
  }
  return right.compressedOffset - left.compressedOffset;
}

function canStopReadingBatches(input: {
  readonly traces: readonly PersistedAgentCycleTrace[];
  readonly query: AgentCycleTraceQuery;
  readonly nextBatch: PersistedAgentCycleTraceBatchIndex | undefined;
}): boolean {
  if (input.query.limit === undefined || input.traces.length < input.query.limit) {
    return false;
  }
  if (input.nextBatch === undefined) {
    return true;
  }
  const matching = filterAndSortTraces(input.traces, input.query);
  const cutoff = matching[input.query.limit - 1];
  return cutoff !== undefined && input.nextBatch.maximumCycleStartedAt < cutoff.cycleStartedAt;
}

function filterAndSortTraces(
  traces: readonly PersistedAgentCycleTrace[],
  query: AgentCycleTraceQuery,
): PersistedAgentCycleTrace[] {
  return traces
    .filter((trace) => trace.simulationId === query.simulationId)
    .filter((trace) => query.agentId === undefined || trace.agentId === query.agentId)
    .filter(
      (trace) =>
        query.fromCycleStartedAt === undefined || trace.cycleStartedAt >= query.fromCycleStartedAt,
    )
    .filter(
      (trace) =>
        query.toCycleStartedAt === undefined || trace.cycleStartedAt <= query.toCycleStartedAt,
    )
    .sort(compareTraceLatestFirst);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function queryTraces(
  traces: readonly PersistedAgentCycleTrace[],
  query: AgentCycleTraceQuery,
): AgentCycleTrace[] {
  assertValidQuery(query);
  return traces
    .filter((trace) => trace.simulationId === query.simulationId)
    .filter((trace) => query.agentId === undefined || trace.agentId === query.agentId)
    .filter(
      (trace) =>
        query.fromCycleStartedAt === undefined || trace.cycleStartedAt >= query.fromCycleStartedAt,
    )
    .filter(
      (trace) =>
        query.toCycleStartedAt === undefined || trace.cycleStartedAt <= query.toCycleStartedAt,
    )
    .sort(compareTraceLatestFirst)
    .slice(0, query.limit)
    .map((trace) => cloneTrace(trace));
}

function cloneTrace(trace: PersistedAgentCycleTrace): AgentCycleTrace {
  return createAgentCycleTrace({
    traceId: trace.traceId,
    simulationId: trace.simulationId,
    agentId: trace.agentId,
    cycleStartedAt: trace.cycleStartedAt,
    observedStateSummary: trace.observedStateSummary,
    selectedBranch: trace.selectedBranch,
    ...(trace.contextualPrioritization === undefined
      ? {}
      : {
          contextualPrioritization: cloneContextualPrioritization(trace.contextualPrioritization),
        }),
    ...(trace.actionSequenceGeneration === undefined
      ? {}
      : {
          actionSequenceGeneration: trace.actionSequenceGeneration.map((entry) =>
            cloneActionSequenceGeneration(entry),
          ),
        }),
    ...(trace.socialDialogueGeneration === undefined
      ? {}
      : {
          socialDialogueGeneration: trace.socialDialogueGeneration.map((entry) =>
            cloneSocialDialogueGeneration(entry),
          ),
        }),
    ...(trace.socialSignalExtraction === undefined
      ? {}
      : {
          socialSignalExtraction: trace.socialSignalExtraction.map((entry) =>
            cloneSocialSignalExtraction(entry),
          ),
        }),
    ...(trace.globalSynthesis === undefined
      ? {}
      : { globalSynthesis: cloneGlobalSynthesis(trace.globalSynthesis) }),
    subtaskCandidates: trace.subtaskCandidates.map((candidate) => cloneSubtaskCandidate(candidate)),
    actionSynthesis: cloneActionSynthesis(trace.actionSynthesis),
    candidateActions: [...trace.candidateActions],
    simulatorResult: cloneSimulatorResult(trace.simulatorResult),
    simulatorEvents: (trace.simulatorEvents ?? []).map((entry) => cloneSimulatorEventTrace(entry)),
    selectionEvidence: cloneSelectionEvidence(trace.selectionEvidence),
    replanningDecision: cloneReplanningDecision(trace.replanningDecision),
    ...(trace.replanningDecisionTrace === undefined
      ? {}
      : { replanningDecisionTrace: cloneReplanningDecisionTrace(trace.replanningDecisionTrace) }),
    ...(trace.replanMaterialization === undefined
      ? {}
      : { replanMaterialization: cloneReplanMaterialization(trace.replanMaterialization) }),
    subtaskReplanningDecisions: (trace.subtaskReplanningDecisions ?? []).map((decision) =>
      cloneSubtaskReplanningDecision(decision),
    ),
    ...(trace.actionRepair === undefined
      ? {}
      : { actionRepair: trace.actionRepair.map((entry) => cloneActionRepair(entry)) }),
    emittedCommandIds: [...trace.emittedCommandIds],
    memoryContextIds: [...trace.memoryContextIds],
    memoryWriteIds: [...trace.memoryWriteIds],
  });
}

function cloneActionRepair(trace: AgentCycleActionRepairTrace): AgentCycleActionRepairTrace {
  return {
    actionId: trace.actionId,
    rejectionReason: trace.rejectionReason,
    selectedSubtask: {
      branchId: trace.selectedSubtask.branchId,
      subtaskId: trace.selectedSubtask.subtaskId,
    },
    localRepair: {
      status: trace.localRepair.status,
      ...(trace.localRepair.attemptedAction === undefined
        ? {}
        : {
            attemptedAction: {
              id: trace.localRepair.attemptedAction.id,
              description: trace.localRepair.attemptedAction.description,
              commandType: trace.localRepair.attemptedAction.commandType,
            },
          }),
      ...(trace.localRepair.rejectionReason === undefined
        ? {}
        : { rejectionReason: trace.localRepair.rejectionReason }),
    },
    ...(trace.reactiveCorrection === undefined
      ? {}
      : { reactiveCorrection: cloneReactiveCorrection(trace.reactiveCorrection) }),
    outcome: trace.outcome,
  };
}

function cloneLlmCognitiveContext(trace: LlmCognitiveContextTrace): LlmCognitiveContextTrace {
  return {
    ...(trace.shortTermMemoryContext === undefined
      ? {}
      : { shortTermMemoryContext: { recordCount: trace.shortTermMemoryContext.recordCount } }),
    ...(trace.longTermProfileContext === undefined
      ? {}
      : { longTermProfileContext: { entryCount: trace.longTermProfileContext.entryCount } }),
    ...(trace.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: trace.observedStateSummary }),
  };
}

function cloneReactiveCorrection(
  trace: NonNullable<AgentCycleActionRepairTrace['reactiveCorrection']>,
): NonNullable<AgentCycleActionRepairTrace['reactiveCorrection']> {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    decision:
      trace.decision.kind === 'no-correction'
        ? {
            kind: 'no-correction',
            rationale: trace.decision.rationale,
            evidenceRecordIds: [...trace.decision.evidenceRecordIds],
          }
        : {
            kind: 'propose-action',
            rationale: trace.decision.rationale,
            evidenceRecordIds: [...trace.decision.evidenceRecordIds],
            action: {
              id: trace.decision.action.id,
              description: trace.decision.action.description,
              commandType: trace.decision.action.commandType,
            },
          },
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...cloneLlmCognitiveContext(trace),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
    ...(trace.simulatorResult === undefined
      ? {}
      : {
          simulatorResult: {
            status: trace.simulatorResult.status,
            ...(trace.simulatorResult.reason === undefined
              ? {}
              : { reason: trace.simulatorResult.reason }),
            ...(trace.simulatorResult.traceEvents === undefined
              ? {}
              : {
                  traceEvents: trace.simulatorResult.traceEvents.map((event) =>
                    cloneSimulatorTraceEvent(event),
                  ),
                }),
          },
        }),
  };
}

function cloneActionSynthesis(
  actionSynthesis: AgentCycleActionSynthesisTrace,
): AgentCycleActionSynthesisTrace {
  return {
    acceptedActions: actionSynthesis.acceptedActions.map((action) => cloneActionProposal(action)),
    rejectedActions: actionSynthesis.rejectedActions.map((rejectedAction) => ({
      action: cloneActionProposal(rejectedAction.action),
      reason: rejectedAction.reason,
    })),
  };
}

function cloneActionProposal(action: AgentCycleActionProposalTrace): AgentCycleActionProposalTrace {
  return {
    id: action.id,
    description: action.description,
    commandType: action.commandType,
    ...(action.priority === undefined ? {} : { priority: action.priority }),
    ...(action.synthesisContext === undefined
      ? {}
      : { synthesisContext: cloneSynthesisContext(action.synthesisContext) }),
    ...(action.resourceEstimate === undefined
      ? {}
      : { resourceEstimate: cloneResourceEstimate(action.resourceEstimate) }),
  };
}

function cloneSynthesisContext(
  synthesisContext: AgentCycleActionSynthesisContextTrace,
): AgentCycleActionSynthesisContextTrace {
  return {
    ...(synthesisContext.branchId === undefined ? {} : { branchId: synthesisContext.branchId }),
    ...(synthesisContext.subtaskId === undefined ? {} : { subtaskId: synthesisContext.subtaskId }),
    ...(synthesisContext.subtaskScore === undefined
      ? {}
      : { subtaskScore: synthesisContext.subtaskScore }),
    ...(synthesisContext.strategicAlignment === undefined
      ? {}
      : { strategicAlignment: synthesisContext.strategicAlignment }),
    ...(synthesisContext.branchUrgency === undefined
      ? {}
      : { branchUrgency: synthesisContext.branchUrgency }),
  };
}

function cloneResourceEstimate(
  resourceEstimate: AgentCycleActionResourceEstimateTrace,
): AgentCycleActionResourceEstimateTrace {
  return {
    ...(resourceEstimate.actionSeconds === undefined
      ? {}
      : { actionSeconds: resourceEstimate.actionSeconds }),
    ...(resourceEstimate.energyCost === undefined
      ? {}
      : { energyCost: resourceEstimate.energyCost }),
    ...(resourceEstimate.satietyCost === undefined
      ? {}
      : { satietyCost: resourceEstimate.satietyCost }),
    ...(resourceEstimate.currencyCost === undefined
      ? {}
      : { currencyCost: resourceEstimate.currencyCost }),
    ...(resourceEstimate.inventoryCosts === undefined
      ? {}
      : { inventoryCosts: { ...resourceEstimate.inventoryCosts } }),
  };
}

function cloneSubtaskCandidate(
  candidate: AgentCycleSubtaskCandidateTrace,
): AgentCycleSubtaskCandidateTrace {
  return {
    branchId: candidate.branchId,
    subtaskId: candidate.subtaskId,
    description: candidate.description,
    score: candidate.score,
    scoreBreakdown: {
      basePriorityScore: candidate.scoreBreakdown.basePriorityScore,
      signalInfluenceScore: candidate.scoreBreakdown.signalInfluenceScore,
      intentionInfluenceScore: candidate.scoreBreakdown.intentionInfluenceScore,
      memoryInfluenceScore: candidate.scoreBreakdown.memoryInfluenceScore,
      profileInfluenceScore: candidate.scoreBreakdown.profileInfluenceScore,
      ...(candidate.scoreBreakdown.contextualReasoningScore === undefined
        ? {}
        : { contextualReasoningScore: candidate.scoreBreakdown.contextualReasoningScore }),
    },
  };
}

function cloneContextualPrioritization(
  trace: AgentCycleContextualPrioritizationTrace,
): AgentCycleContextualPrioritizationTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.choices === undefined
      ? {}
      : {
          choices: trace.choices.map((choice) => ({
            branchId: choice.branchId,
            subtaskId: choice.subtaskId,
            priorityScore: choice.priorityScore,
            rationale: choice.rationale,
          })),
        }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...cloneLlmCognitiveContext(trace),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function cloneActionSequenceGeneration(
  trace: AgentCycleActionSequenceGenerationTrace,
): AgentCycleActionSequenceGenerationTrace {
  return {
    status: trace.status,
    source: trace.source,
    selectedSubtask: {
      branchId: trace.selectedSubtask.branchId,
      subtaskId: trace.selectedSubtask.subtaskId,
    },
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.actions === undefined
      ? {}
      : {
          actions: trace.actions.map((action) => ({
            id: action.id,
            commandType: action.commandType,
            rationale: action.rationale,
          })),
        }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...cloneLlmCognitiveContext(trace),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function cloneSocialDialogueGeneration(
  trace: AgentCycleSocialDialogueGenerationTrace,
): AgentCycleSocialDialogueGenerationTrace {
  return {
    status: trace.status,
    source: trace.source,
    selectedSubtask: {
      branchId: trace.selectedSubtask.branchId,
      subtaskId: trace.selectedSubtask.subtaskId,
    },
    actionId: trace.actionId,
    targetAgentId: trace.targetAgentId,
    ...(trace.topic === undefined ? {} : { topic: trace.topic }),
    ...(trace.policyVersion === undefined ? {} : { policyVersion: trace.policyVersion }),
    ...(trace.planningContext === undefined
      ? {}
      : {
          planningContext: {
            policyVersion: trace.planningContext.policyVersion,
            targetSelection: {
              selectedAgentId: trace.planningContext.targetSelection.selectedAgentId,
              candidates: trace.planningContext.targetSelection.candidates.map((candidate) => ({
                agentId: candidate.agentId,
                score: { ...candidate.score },
              })),
              tieBreak: trace.planningContext.targetSelection.tieBreak,
            },
            topicSelection: { ...trace.planningContext.topicSelection },
          },
        }),
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    turnCount: trace.turnCount,
    rationale: trace.rationale,
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...cloneLlmCognitiveContext(trace),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function cloneSocialSignalExtraction(
  trace: AgentCycleSocialSignalExtractionTrace,
): AgentCycleSocialSignalExtractionTrace {
  return {
    status: trace.status,
    source: trace.source,
    policyVersion: trace.policyVersion,
    agentId: trace.agentId,
    targetAgentId: trace.targetAgentId,
    topic: trace.topic,
    turnCount: trace.turnCount,
    extractedSignalCount: trace.extractedSignalCount,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: { ...attempt.usage },
          })),
        }),
    ...(trace.usage === undefined ? {} : { usage: { ...trace.usage } }),
  };
}

function cloneGlobalSynthesis(
  trace: AgentCycleGlobalSynthesisTrace,
): AgentCycleGlobalSynthesisTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.choices === undefined
      ? {}
      : {
          choices: trace.choices.map((choice) => ({
            actionId: choice.actionId,
            priorityScore: choice.priorityScore,
            rationale: choice.rationale,
            ...(choice.strategicAlignment === undefined
              ? {}
              : { strategicAlignment: choice.strategicAlignment }),
            ...(choice.branchUrgency === undefined ? {} : { branchUrgency: choice.branchUrgency }),
          })),
        }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...cloneLlmCognitiveContext(trace),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function cloneReplanMaterialization(
  materialization: AgentCycleReplanMaterializationTrace,
): AgentCycleReplanMaterializationTrace {
  switch (materialization.status) {
    case 'replanned':
      return {
        status: 'replanned',
        objectiveId: materialization.objectiveId,
        planId: materialization.planId,
        progressReset: materialization.progressReset,
        trigger: materialization.trigger,
        failedActionIds: [...materialization.failedActionIds],
        evidenceRecordIds: [...materialization.evidenceRecordIds],
        matchingFailureCount: materialization.matchingFailureCount,
      };
    case 'skipped':
      return {
        status: 'skipped',
        planId: materialization.planId,
        reason: materialization.reason,
        ...(materialization.objectiveId === undefined
          ? {}
          : { objectiveId: materialization.objectiveId }),
      };
  }
}

function cloneSubtaskReplanningDecision(
  decision: AgentCycleSubtaskReplanningDecisionTrace,
): AgentCycleSubtaskReplanningDecisionTrace {
  return {
    branchId: decision.branchId,
    subtaskId: decision.subtaskId,
    decision: cloneReplanningDecision(decision.decision),
  };
}

function cloneSimulatorResult(result: SimulatorTraceResult): SimulatorTraceResult {
  switch (result.status) {
    case 'accepted':
      return {
        status: 'accepted',
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      };
    case 'rejected':
      return { status: 'rejected', reason: result.reason };
    case 'repaired':
      return { status: 'repaired', reason: result.reason };
  }
}

function cloneSimulatorEventTrace(
  entry: AgentCycleSimulatorEventTrace,
): AgentCycleSimulatorEventTrace {
  return {
    actionId: entry.actionId,
    attempt: entry.attempt,
    status: entry.status,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    events: entry.events.map((event) => cloneSimulatorTraceEvent(event)),
  };
}

function cloneSimulatorTraceEvent(
  event: AgentCycleSimulatorTraceEvent,
): AgentCycleSimulatorTraceEvent {
  return {
    type: event.type,
    ...(event.sequence === undefined ? {} : { sequence: event.sequence }),
    ...(event.summary === undefined ? {} : { summary: event.summary }),
    ...(event.counterfactualStep === undefined
      ? {}
      : { counterfactualStep: event.counterfactualStep }),
    ...(event.projectionEventCountBefore === undefined
      ? {}
      : { projectionEventCountBefore: event.projectionEventCountBefore }),
    ...(event.projectionEventCountAfter === undefined
      ? {}
      : { projectionEventCountAfter: event.projectionEventCountAfter }),
  };
}

function cloneSelectionEvidence(
  evidence: AgentCycleSelectionTraceEvidence,
): AgentCycleSelectionTraceEvidence {
  return {
    selectedSubtaskId: evidence.selectedSubtaskId,
    intentionInfluenceScore: evidence.intentionInfluenceScore,
    memoryInfluenceScore: evidence.memoryInfluenceScore,
    profileInfluenceScore: evidence.profileInfluenceScore,
    memoryEvidenceRecordIds: [...evidence.memoryEvidenceRecordIds],
    profileEntryKeys: [...evidence.profileEntryKeys],
    profileEvidenceRecordIds: [...evidence.profileEvidenceRecordIds],
  };
}

function cloneReplanningDecision(decision: ReplanningTraceDecision): ReplanningTraceDecision {
  switch (decision.kind) {
    case 'none':
      return { kind: 'none' };
    case 'memory-guided-correction':
      return {
        kind: 'memory-guided-correction',
        trigger: decision.trigger,
        reason: decision.reason,
        failedActionIds: [...decision.failedActionIds],
        evidenceRecordIds: [...decision.evidenceRecordIds],
      };
    case 'full-replan':
      return {
        kind: 'full-replan',
        trigger: decision.trigger,
        reason: decision.reason,
        failedActionIds: [...decision.failedActionIds],
        evidenceRecordIds: [...decision.evidenceRecordIds],
        matchingFailureCount: decision.matchingFailureCount,
      };
  }
}

function cloneReplanningDecisionTrace(
  trace: AgentCycleReplanningDecisionTrace,
): AgentCycleReplanningDecisionTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    decision: cloneReplanningDecision(trace.decision),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...cloneLlmCognitiveContext(trace),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: cloneWorldDecisionContextTrace(trace.worldDecisionContext) }),
  };
}

function compareTraceLatestFirst(
  left: PersistedAgentCycleTrace,
  right: PersistedAgentCycleTrace,
): number {
  if (left.cycleStartedAt !== right.cycleStartedAt) {
    return right.cycleStartedAt - left.cycleStartedAt;
  }
  return right.traceId.localeCompare(left.traceId);
}

function assertValidQuery(query: AgentCycleTraceQuery): void {
  assertNonEmpty(query.simulationId, 'simulationId');
  if (query.limit !== undefined && (!Number.isFinite(query.limit) || query.limit <= 0)) {
    throw new Error('limit must be positive');
  }
  if (query.fromCycleStartedAt !== undefined && !Number.isFinite(query.fromCycleStartedAt)) {
    throw new Error('fromCycleStartedAt must be finite');
  }
  if (query.toCycleStartedAt !== undefined && !Number.isFinite(query.toCycleStartedAt)) {
    throw new Error('toCycleStartedAt must be finite');
  }
}

function ensureFile(filePath: string, rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '');
  }
}

function readJsonLines<TValue>(path: string): readonly TValue[] {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, 'utf8').trim();
  if (content.length === 0) {
    return [];
  }
  return content.split('\n').map((line) => JSON.parse(line) as TValue);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}
