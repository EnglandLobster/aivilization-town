import {
  DEFLATED_JSON_LINES_FRAME_FORMAT,
  IncrementalJsonLinesProjection,
  appendDeflatedJsonLinesFrame,
  scanDeflatedJsonLinesFrames,
  type AgentId,
} from '@aivilization/sim-core';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_INTENTION_COMPLETED_OBJECTIVE_RETENTION_LIMIT,
  completeLongHorizonObjective,
  createEmptyAgentIntentionState,
  enforceAgentIntentionStateRetention,
  getCompletedObjectiveCount,
  setLongHorizonObjective,
  upsertScheduledIntentions,
  type AgentIntentionState,
  type LongHorizonObjective,
  type ScheduledIntention,
} from './intentions';
import {
  applyLongTermMemoryPatches,
  createEmptyLongTermAgentProfile,
  type LongTermAgentProfile,
  type LongTermMemoryPatch,
  type LongTermProfileEntry,
} from './profile';
import type { ShortTermMemoryRecord } from './records';
import type {
  AgentIntentionRepository,
  CompleteLongHorizonObjectiveRequest,
} from './intentionRepository';
import type { LongTermProfileRepository } from './profileRepository';
import { retrieveShortTermMemory, type ShortTermMemoryQuery } from './retrieval';
import {
  SHORT_TERM_MEMORY_MAX_SPARSE_CHECKPOINT_COUNT,
  SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT,
  SHORT_TERM_MEMORY_SPARSE_CHECKPOINT_INTERVAL,
  assertValidShortTermMemoryLedgerQuery,
  type SequencedShortTermMemoryRecord,
  type ShortTermMemoryLedgerQuery,
  type ShortTermMemoryLedgerWindow,
  type ShortTermMemoryRepository,
} from './repository';

export type FileShortTermMemoryStorageDiagnostics = {
  readonly committedBytes: number;
  readonly legacyByteLength: number;
  readonly compactByteLength: number;
  readonly recordCount: number;
  readonly legacyRecordCount: number;
  readonly compactRecordCount: number;
  readonly compactFrameCount: number;
  readonly writerFormat: FileShortTermMemoryWriterFormat;
  readonly indexedAgentCount: number;
  readonly recentRecordCount: number;
  readonly recentBufferLimitPerAgent: number;
  readonly sparseCheckpointCount: number;
  readonly sparseCheckpointInterval: number;
  readonly maxSparseCheckpointCount: number;
  readonly earliestRetainedCheckpointAppendSequence?: number;
  readonly latestRetainedCheckpointAppendSequence?: number;
};

export const FILE_SHORT_TERM_MEMORY_STORAGE_POLICY_VERSION = 'file-short-term-memory-storage-v2';
export const FILE_SHORT_TERM_MEMORY_COMPACT_PATH = 'short-term-memory.deflate';

export type FileShortTermMemoryWriterFormat = 'compact-deflate-frames-v1' | 'legacy-jsonl-v1';

export type FileShortTermMemoryStoragePolicyManifest = {
  readonly policyVersion: typeof FILE_SHORT_TERM_MEMORY_STORAGE_POLICY_VERSION;
  readonly writerFormat: typeof DEFLATED_JSON_LINES_FRAME_FORMAT;
  readonly compatibilityRule: 'ordered-union-read-of-legacy-jsonl-prefix-and-compact-frame-tail';
  readonly appendRule: 'legacy-jsonl-must-not-grow-after-first-compact-frame';
  readonly hotIndexRule: 'bounded-recent-records-per-agent-plus-bounded-sparse-checkpoints';
  readonly coldReadRule: 'exact-ledger-scan-from-nearest-retained-cross-format-checkpoint';
  readonly corruptionRule: 'fail-closed-on-incomplete-or-invalid-jsonl-or-deflate-frame';
};

export function createFileShortTermMemoryStoragePolicyManifest(): FileShortTermMemoryStoragePolicyManifest {
  return {
    policyVersion: FILE_SHORT_TERM_MEMORY_STORAGE_POLICY_VERSION,
    writerFormat: DEFLATED_JSON_LINES_FRAME_FORMAT,
    compatibilityRule: 'ordered-union-read-of-legacy-jsonl-prefix-and-compact-frame-tail',
    appendRule: 'legacy-jsonl-must-not-grow-after-first-compact-frame',
    hotIndexRule: 'bounded-recent-records-per-agent-plus-bounded-sparse-checkpoints',
    coldReadRule: 'exact-ledger-scan-from-nearest-retained-cross-format-checkpoint',
    corruptionRule: 'fail-closed-on-incomplete-or-invalid-jsonl-or-deflate-frame',
  };
}

export class FileShortTermMemoryRepository implements ShortTermMemoryRepository {
  private readonly recordsPath: string;
  private readonly compactRecordsPath: string;
  private readonly writerFormat: FileShortTermMemoryWriterFormat;
  private readonly recentBufferLimitPerAgent: number;
  private readonly sparseCheckpointInterval: number;
  private readonly maxSparseCheckpointCount: number;
  private committedLegacyBytes = 0;
  private committedCompactBytes = 0;
  private recordCount = 0;
  private legacyRecordCount = 0;
  private compactRecordCount = 0;
  private compactFrameCount = 0;
  private legacySignature: JsonLinesFileSignature | undefined;
  private compactSignature: JsonLinesFileSignature | undefined;
  private sparseCheckpoints: ShortTermMemorySparseCheckpoint[] = [];
  private readonly recordCountByAgentId = new Map<AgentId, number>();
  private readonly recentEntriesByAgentId = new Map<AgentId, SequencedShortTermMemoryRecord[]>();

  constructor(input: {
    readonly rootDir: string;
    readonly recentBufferLimitPerAgent?: number;
    readonly sparseCheckpointInterval?: number;
    readonly maxSparseCheckpointCount?: number;
    readonly writerFormat?: FileShortTermMemoryWriterFormat;
  }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.recentBufferLimitPerAgent =
      input.recentBufferLimitPerAgent ?? SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT;
    this.sparseCheckpointInterval =
      input.sparseCheckpointInterval ?? SHORT_TERM_MEMORY_SPARSE_CHECKPOINT_INTERVAL;
    this.maxSparseCheckpointCount =
      input.maxSparseCheckpointCount ?? SHORT_TERM_MEMORY_MAX_SPARSE_CHECKPOINT_COUNT;
    this.writerFormat = input.writerFormat ?? 'compact-deflate-frames-v1';
    assertPositiveSafeInteger(this.recentBufferLimitPerAgent, 'recentBufferLimitPerAgent');
    assertPositiveSafeInteger(this.sparseCheckpointInterval, 'sparseCheckpointInterval');
    assertPositiveSafeInteger(this.maxSparseCheckpointCount, 'maxSparseCheckpointCount');
    this.recordsPath = join(input.rootDir, 'short-term-memory.jsonl');
    this.compactRecordsPath = join(input.rootDir, FILE_SHORT_TERM_MEMORY_COMPACT_PATH);
    ensureFile(this.recordsPath, input.rootDir);
    ensureFile(this.compactRecordsPath, input.rootDir);
  }

  append(record: ShortTermMemoryRecord): Promise<void> {
    return this.appendMany([record]);
  }

  appendMany(records: readonly ShortTermMemoryRecord[]): Promise<void> {
    if (records.length === 0) {
      return Promise.resolve();
    }
    this.refreshAgentIndex();
    if (
      statSync(this.recordsPath).size !== this.committedLegacyBytes ||
      statSync(this.compactRecordsPath).size !== this.committedCompactBytes
    ) {
      throw new Error('short-term memory storage has an incomplete trailing record');
    }
    if (this.writerFormat === 'legacy-jsonl-v1') {
      if (this.compactRecordCount > 0) {
        throw new Error('legacy short-term memory writer cannot append after compact frames');
      }
      appendJsonLines(this.recordsPath, records);
    } else {
      for (let offset = 0; offset < records.length; offset += this.sparseCheckpointInterval) {
        appendDeflatedJsonLinesFrame(
          this.compactRecordsPath,
          records.slice(offset, offset + this.sparseCheckpointInterval),
        );
      }
    }
    this.refreshAgentIndex();
    return Promise.resolve();
  }

  retrieve(query: ShortTermMemoryQuery): Promise<ShortTermMemoryRecord[]> {
    return Promise.resolve(retrieveShortTermMemory(this.recordsForAgent(query.agentId), query));
  }

  retrieveMany(queries: readonly ShortTermMemoryQuery[]): Promise<ShortTermMemoryRecord[][]> {
    this.refreshAgentIndex();
    return Promise.resolve(
      queries.map((query) =>
        retrieveShortTermMemory(
          (this.recentEntriesByAgentId.get(query.agentId) ?? []).map((entry) => entry.record),
          query,
        ),
      ),
    );
  }

  retrieveLedgerMany(
    queries: readonly ShortTermMemoryLedgerQuery[],
  ): Promise<ShortTermMemoryLedgerWindow[]> {
    this.refreshAgentIndex();
    for (const query of queries) {
      assertValidShortTermMemoryLedgerQuery(query);
    }
    if (queries.length === 0) {
      return Promise.resolve([]);
    }
    const states: ShortTermMemoryLedgerQueryState[] = queries.map((query) => {
      const recentEntries = this.resolveRecentLedgerEntries(query);
      return {
        query,
        entries: recentEntries ?? [],
        complete: recentEntries !== undefined,
      };
    });
    const incompleteStates = states.filter((state) => !state.complete);
    if (incompleteStates.length === 0) {
      return Promise.resolve(states.map((state) => ({ entries: state.entries })));
    }
    const statesByAgentId = new Map<AgentId, ShortTermMemoryLedgerQueryState[]>();
    for (const state of incompleteStates) {
      const agentStates = statesByAgentId.get(state.query.agentId) ?? [];
      agentStates.push(state);
      statesByAgentId.set(state.query.agentId, agentStates);
    }
    let remainingStateCount = incompleteStates.length;
    const minimumRequiredAppendSequence = Math.min(
      ...incompleteStates.map((state) =>
        state.query.appendedAfterSequence === undefined ? 1 : state.query.appendedAfterSequence + 1,
      ),
    );
    const scanStart = this.resolveSparseScanStart(minimumRequiredAppendSequence);
    let appendSequence = scanStart.appendSequence - 1;
    const projectRecord = (record: ShortTermMemoryRecord): boolean => {
      appendSequence += 1;
      for (const state of statesByAgentId.get(record.agentId) ?? []) {
        if (
          state.entries.length >= state.query.limit ||
          (state.query.appendedAfterSequence !== undefined &&
            appendSequence <= state.query.appendedAfterSequence) ||
          (state.query.occurredAtOrAfter !== undefined &&
            record.occurredAt < state.query.occurredAtOrAfter)
        ) {
          continue;
        }
        state.entries.push({ appendSequence, record });
        if (state.entries.length === state.query.limit) {
          state.complete = true;
          remainingStateCount -= 1;
        }
      }
      return remainingStateCount > 0;
    };
    if (scanStart.source === 'legacy') {
      scanJsonLines<ShortTermMemoryRecord>({
        path: this.recordsPath,
        fromByte: scanStart.byteOffset,
        toByte: this.committedLegacyBytes,
        onRecord: projectRecord,
      });
      if (remainingStateCount > 0 && this.compactRecordCount > 0) {
        this.scanCompactRecords(0, projectRecord);
      }
    } else {
      this.scanCompactRecords(scanStart.byteOffset, projectRecord);
    }
    return Promise.resolve(states.map((state) => ({ entries: state.entries })));
  }

  getStorageDiagnostics(): FileShortTermMemoryStorageDiagnostics {
    this.refreshAgentIndex();
    const recentRecordCount = [...this.recentEntriesByAgentId.values()].reduce(
      (total, entries) => total + entries.length,
      0,
    );
    return {
      committedBytes: this.committedLegacyBytes + this.committedCompactBytes,
      legacyByteLength: this.committedLegacyBytes,
      compactByteLength: this.committedCompactBytes,
      recordCount: this.recordCount,
      legacyRecordCount: this.legacyRecordCount,
      compactRecordCount: this.compactRecordCount,
      compactFrameCount: this.compactFrameCount,
      writerFormat: this.writerFormat,
      indexedAgentCount: this.recordCountByAgentId.size,
      recentRecordCount,
      recentBufferLimitPerAgent: this.recentBufferLimitPerAgent,
      sparseCheckpointCount: this.sparseCheckpoints.length,
      sparseCheckpointInterval: this.sparseCheckpointInterval,
      maxSparseCheckpointCount: this.maxSparseCheckpointCount,
      ...(this.sparseCheckpoints[0] === undefined
        ? {}
        : {
            earliestRetainedCheckpointAppendSequence: this.sparseCheckpoints[0].appendSequence,
          }),
      ...(this.sparseCheckpoints.at(-1) === undefined
        ? {}
        : {
            latestRetainedCheckpointAppendSequence: this.sparseCheckpoints.at(-1)!.appendSequence,
          }),
    };
  }

  private recordsForAgent(agentId: AgentId): readonly ShortTermMemoryRecord[] {
    this.refreshAgentIndex();
    return (this.recentEntriesByAgentId.get(agentId) ?? []).map((entry) => entry.record);
  }

  private refreshAgentIndex(): void {
    const nextLegacySignature = readJsonLinesFileSignature(this.recordsPath);
    const nextCompactSignature = readJsonLinesFileSignature(this.compactRecordsPath);
    if (
      sameJsonLinesFileSignature(this.legacySignature, nextLegacySignature) &&
      sameJsonLinesFileSignature(this.compactSignature, nextCompactSignature) &&
      this.committedLegacyBytes === nextLegacySignature.size &&
      this.committedCompactBytes === nextCompactSignature.size
    ) {
      return;
    }
    const rebuild =
      requiresJsonLinesProjectionRebuild(
        this.legacySignature,
        nextLegacySignature,
        this.committedLegacyBytes,
      ) ||
      requiresJsonLinesProjectionRebuild(
        this.compactSignature,
        nextCompactSignature,
        this.committedCompactBytes,
      );
    if (rebuild) {
      this.resetAgentIndex();
    }
    if (this.committedCompactBytes > 0 && nextLegacySignature.size > this.committedLegacyBytes) {
      throw new Error(
        `legacy short-term memory JSONL must not grow after compact frames: ${this.recordsPath}`,
      );
    }
    try {
      const scan = scanJsonLines<ShortTermMemoryRecord>({
        path: this.recordsPath,
        fromByte: this.committedLegacyBytes,
        toByte: nextLegacySignature.size,
        onRecord: (record, byteOffset) => this.indexLegacyRecord(record, byteOffset),
      });
      this.committedLegacyBytes += scan.consumedBytes;
      const compactScan = scanDeflatedJsonLinesFrames<ShortTermMemoryRecord>({
        path: this.compactRecordsPath,
        fromByte: this.committedCompactBytes,
        toByte: nextCompactSignature.size,
        onFrame: (records, byteOffset) => this.indexCompactFrame(records, byteOffset),
      });
      this.committedCompactBytes += compactScan.consumedBytes;
      this.legacySignature = nextLegacySignature;
      this.compactSignature = nextCompactSignature;
    } catch (error) {
      // A failed incremental parse may already have projected earlier rows from the same scan.
      // Drop the projection so a repaired file is always rebuilt from one coherent prefix.
      this.resetAgentIndex();
      this.legacySignature = undefined;
      this.compactSignature = undefined;
      throw error;
    }
  }

  private resetAgentIndex(): void {
    this.committedLegacyBytes = 0;
    this.committedCompactBytes = 0;
    this.recordCount = 0;
    this.legacyRecordCount = 0;
    this.compactRecordCount = 0;
    this.compactFrameCount = 0;
    this.sparseCheckpoints = [];
    this.recordCountByAgentId.clear();
    this.recentEntriesByAgentId.clear();
  }

  private indexLegacyRecord(record: ShortTermMemoryRecord, byteOffset: number): void {
    this.indexRecord(record, {
      source: 'legacy',
      byteOffset,
      allowCheckpoint: true,
    });
    this.legacyRecordCount += 1;
  }

  private indexCompactFrame(records: readonly ShortTermMemoryRecord[], byteOffset: number): void {
    const firstAppendSequence = this.recordCount + 1;
    const latestCheckpoint = this.sparseCheckpoints.at(-1);
    if (
      latestCheckpoint === undefined ||
      firstAppendSequence - latestCheckpoint.appendSequence >= this.sparseCheckpointInterval
    ) {
      this.retainSparseCheckpoint({
        appendSequence: firstAppendSequence,
        source: 'compact',
        byteOffset,
      });
    }
    for (const record of records) {
      this.indexRecord(record, {
        source: 'compact',
        byteOffset,
        allowCheckpoint: false,
      });
      this.compactRecordCount += 1;
    }
    this.compactFrameCount += 1;
  }

  private indexRecord(
    record: ShortTermMemoryRecord,
    location: {
      readonly source: ShortTermMemoryStorageSource;
      readonly byteOffset: number;
      readonly allowCheckpoint: boolean;
    },
  ): void {
    const appendSequence = ++this.recordCount;
    this.recordCountByAgentId.set(
      record.agentId,
      (this.recordCountByAgentId.get(record.agentId) ?? 0) + 1,
    );
    if (location.allowCheckpoint && (appendSequence - 1) % this.sparseCheckpointInterval === 0) {
      this.retainSparseCheckpoint({
        appendSequence,
        source: location.source,
        byteOffset: location.byteOffset,
      });
    }

    const recentEntries = this.recentEntriesByAgentId.get(record.agentId) ?? [];
    recentEntries.push({ appendSequence, record });
    if (recentEntries.length > this.recentBufferLimitPerAgent) {
      recentEntries.splice(0, recentEntries.length - this.recentBufferLimitPerAgent);
    }
    this.recentEntriesByAgentId.set(record.agentId, recentEntries);
  }

  private retainSparseCheckpoint(checkpoint: ShortTermMemorySparseCheckpoint): void {
    this.sparseCheckpoints.push(checkpoint);
    if (this.sparseCheckpoints.length > this.maxSparseCheckpointCount) {
      this.sparseCheckpoints.splice(
        0,
        this.sparseCheckpoints.length - this.maxSparseCheckpointCount,
      );
    }
  }

  private scanCompactRecords(
    fromByte: number,
    onRecord: (record: ShortTermMemoryRecord) => boolean,
  ): void {
    scanDeflatedJsonLinesFrames<ShortTermMemoryRecord>({
      path: this.compactRecordsPath,
      fromByte,
      toByte: this.committedCompactBytes,
      onFrame: (records) => {
        for (const record of records) {
          if (!onRecord(record)) {
            return false;
          }
        }
        return true;
      },
    });
  }

  private resolveSparseScanStart(
    minimumRequiredAppendSequence: number,
  ): ShortTermMemorySparseCheckpoint {
    for (let index = this.sparseCheckpoints.length - 1; index >= 0; index -= 1) {
      const checkpoint = this.sparseCheckpoints[index];
      if (checkpoint !== undefined && checkpoint.appendSequence <= minimumRequiredAppendSequence) {
        return checkpoint;
      }
    }
    return {
      appendSequence: this.legacyRecordCount > 0 ? 1 : this.legacyRecordCount + 1,
      source: this.legacyRecordCount > 0 ? 'legacy' : 'compact',
      byteOffset: 0,
    };
  }

  private resolveRecentLedgerEntries(
    query: ShortTermMemoryLedgerQuery,
  ): SequencedShortTermMemoryRecord[] | undefined {
    const recentEntries = this.recentEntriesByAgentId.get(query.agentId) ?? [];
    if (query.appendedAfterSequence !== undefined) {
      const earliestRecentAppendSequence = recentEntries[0]?.appendSequence;
      if (
        earliestRecentAppendSequence !== undefined &&
        query.appendedAfterSequence < earliestRecentAppendSequence - 1
      ) {
        return undefined;
      }
      return recentEntries
        .filter((entry) => entry.appendSequence > query.appendedAfterSequence!)
        .slice(0, query.limit);
    }
    if ((this.recordCountByAgentId.get(query.agentId) ?? 0) > recentEntries.length) {
      return undefined;
    }
    return recentEntries
      .filter(
        (entry) =>
          query.occurredAtOrAfter === undefined ||
          entry.record.occurredAt >= query.occurredAtOrAfter,
      )
      .slice(0, query.limit);
  }
}

type JsonLinesFileSignature = {
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedAtMs: number;
  readonly changedAtMs: number;
};

type ShortTermMemorySparseCheckpoint = {
  readonly appendSequence: number;
  readonly source: ShortTermMemoryStorageSource;
  readonly byteOffset: number;
};

type ShortTermMemoryStorageSource = 'legacy' | 'compact';

type ShortTermMemoryLedgerQueryState = {
  readonly query: ShortTermMemoryLedgerQuery;
  readonly entries: SequencedShortTermMemoryRecord[];
  complete: boolean;
};

function readJsonLinesFileSignature(path: string): JsonLinesFileSignature {
  const stats = statSync(path);
  return {
    device: stats.dev,
    inode: stats.ino,
    size: stats.size,
    modifiedAtMs: stats.mtimeMs,
    changedAtMs: stats.ctimeMs,
  };
}

function sameJsonLinesFileSignature(
  left: JsonLinesFileSignature | undefined,
  right: JsonLinesFileSignature,
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

function requiresJsonLinesProjectionRebuild(
  current: JsonLinesFileSignature | undefined,
  next: JsonLinesFileSignature,
  committedBytes: number,
): boolean {
  if (current === undefined) {
    return true;
  }
  if (
    current.device !== next.device ||
    current.inode !== next.inode ||
    next.size < committedBytes
  ) {
    return true;
  }
  return (
    next.size === current.size &&
    (current.modifiedAtMs !== next.modifiedAtMs || current.changedAtMs !== next.changedAtMs)
  );
}

function scanJsonLines<TValue>(input: {
  readonly path: string;
  readonly fromByte: number;
  readonly toByte: number;
  readonly onRecord: (record: TValue, byteOffset: number, byteLength: number) => boolean | void;
}): { readonly consumedBytes: number } {
  if (input.toByte <= input.fromByte) {
    return { consumedBytes: 0 };
  }
  const descriptor = openSync(input.path, 'r');
  const chunkSize = 64 * 1024;
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
        let index = combined.indexOf(0x0a);
        index >= 0;
        index = combined.indexOf(0x0a, lineStart)
      ) {
        const line = combined.subarray(lineStart, index);
        if (line.length > 0) {
          const shouldContinue = input.onRecord(
            JSON.parse(line.toString('utf8')) as TValue,
            combinedOffset + lineStart,
            line.length,
          );
          if (shouldContinue === false) {
            return { consumedBytes: combinedOffset + index + 1 - input.fromByte };
          }
        }
        lineStart = index + 1;
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

export const AGENT_INTENTION_LEDGER_LEGACY_OPERATION_VERSION = 'agent-intention-ledger-v2';
export const AGENT_INTENTION_LEDGER_POLICY_VERSION = 'agent-intention-ledger-v3';

export type AgentIntentionLedgerPolicyManifest = {
  readonly policyVersion: typeof AGENT_INTENTION_LEDGER_POLICY_VERSION;
  readonly writerFormat: 'typed-incremental-operation-per-jsonl-row';
  readonly legacyReadFormat: 'full-state-snapshots-and-v2-operation-rows';
  readonly replayRule: 'ordered-union-replay-of-legacy-snapshots-v2-and-v3-operations';
  readonly growthRule: 'standard-mutations-append-only-changed-payload';
  readonly hotIndexRule: 'latest-bounded-state-per-agent-without-retaining-replayed-rows';
  readonly completedObjectiveRetentionLimit: number;
  readonly completionOrdinalRule: 'durable-total-count-independent-of-retained-recent-window';
  readonly explicitSaveRule: 'append-replace-state-operation';
  readonly unknownFutureVersion: 'reject-read';
};

export function createAgentIntentionLedgerPolicyManifest(): AgentIntentionLedgerPolicyManifest {
  return {
    policyVersion: AGENT_INTENTION_LEDGER_POLICY_VERSION,
    writerFormat: 'typed-incremental-operation-per-jsonl-row',
    legacyReadFormat: 'full-state-snapshots-and-v2-operation-rows',
    replayRule: 'ordered-union-replay-of-legacy-snapshots-v2-and-v3-operations',
    growthRule: 'standard-mutations-append-only-changed-payload',
    hotIndexRule: 'latest-bounded-state-per-agent-without-retaining-replayed-rows',
    completedObjectiveRetentionLimit: AGENT_INTENTION_COMPLETED_OBJECTIVE_RETENTION_LIMIT,
    completionOrdinalRule: 'durable-total-count-independent-of-retained-recent-window',
    explicitSaveRule: 'append-replace-state-operation',
    unknownFutureVersion: 'reject-read',
  };
}

export type FileAgentIntentionStorageDiagnostics = {
  readonly committedBytes: number;
  readonly recordCount: number;
  readonly legacySnapshotRecordCount: number;
  readonly incrementalRecordCount: number;
  readonly indexedAgentCount: number;
  readonly totalCompletedObjectiveCount: number;
  readonly retainedCompletedObjectiveCount: number;
  readonly completedObjectiveRetentionLimit: number;
  readonly maximumRecordBytes: number;
};

type AgentIntentionLedgerVersion =
  | typeof AGENT_INTENTION_LEDGER_LEGACY_OPERATION_VERSION
  | typeof AGENT_INTENTION_LEDGER_POLICY_VERSION;

type AgentIntentionLedgerRecord =
  | {
      readonly schemaVersion: AgentIntentionLedgerVersion;
      readonly operation: 'replace-state';
      readonly state: AgentIntentionState;
    }
  | {
      readonly schemaVersion: AgentIntentionLedgerVersion;
      readonly operation: 'set-objective';
      readonly agentId: AgentId;
      readonly objective: LongHorizonObjective;
    }
  | {
      readonly schemaVersion: AgentIntentionLedgerVersion;
      readonly operation: 'upsert-scheduled-intentions';
      readonly agentId: AgentId;
      readonly scheduledIntentions: readonly ScheduledIntention[];
    }
  | {
      readonly schemaVersion: AgentIntentionLedgerVersion;
      readonly operation: 'complete-objective';
      readonly agentId: AgentId;
      readonly request: CompleteLongHorizonObjectiveRequest;
    };

export class FileAgentIntentionRepository implements AgentIntentionRepository {
  private readonly statesPath: string;
  private committedBytes = 0;
  private recordCount = 0;
  private legacySnapshotRecordCount = 0;
  private incrementalRecordCount = 0;
  private maximumRecordBytes = 0;
  private signature: JsonLinesFileSignature | undefined;
  private readonly latestStateByAgentId = new Map<AgentId, AgentIntentionState>();

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.statesPath = join(input.rootDir, 'agent-intentions.jsonl');
    ensureFile(this.statesPath, input.rootDir);
  }

  async getOrCreate(agentId: AgentId): Promise<AgentIntentionState> {
    const existing = this.getLatestState(agentId);
    if (existing !== undefined) {
      return cloneState(existing);
    }

    const state = createEmptyAgentIntentionState(agentId);
    await this.save(state);
    return state;
  }

  save(state: AgentIntentionState): Promise<void> {
    this.appendRecord({
      schemaVersion: AGENT_INTENTION_LEDGER_POLICY_VERSION,
      operation: 'replace-state',
      state: cloneState(state),
    });
    return Promise.resolve();
  }

  async setObjective(
    agentId: AgentId,
    objective: LongHorizonObjective,
  ): Promise<AgentIntentionState> {
    const current = await this.getOrCreate(agentId);
    const updated = setLongHorizonObjective(current, objective);
    this.appendRecord({
      schemaVersion: AGENT_INTENTION_LEDGER_POLICY_VERSION,
      operation: 'set-objective',
      agentId,
      objective: cloneObjective(objective),
    });
    return cloneState(this.requireLatestState(agentId, updated));
  }

  async upsertScheduledIntentions(
    agentId: AgentId,
    scheduledIntentions: readonly ScheduledIntention[],
  ): Promise<AgentIntentionState> {
    const current = await this.getOrCreate(agentId);
    const updated = upsertScheduledIntentions(current, scheduledIntentions);
    this.appendRecord({
      schemaVersion: AGENT_INTENTION_LEDGER_POLICY_VERSION,
      operation: 'upsert-scheduled-intentions',
      agentId,
      scheduledIntentions: scheduledIntentions.map((intention) =>
        cloneScheduledIntention(intention),
      ),
    });
    return cloneState(this.requireLatestState(agentId, updated));
  }

  async completeObjective(
    agentId: AgentId,
    input: CompleteLongHorizonObjectiveRequest,
  ): Promise<AgentIntentionState> {
    const current = await this.getOrCreate(agentId);
    const updated = completeLongHorizonObjective(current, input);
    this.appendRecord({
      schemaVersion: AGENT_INTENTION_LEDGER_POLICY_VERSION,
      operation: 'complete-objective',
      agentId,
      request: { ...input },
    });
    return cloneState(this.requireLatestState(agentId, updated));
  }

  getStorageDiagnostics(): FileAgentIntentionStorageDiagnostics {
    this.refreshLatestStateIndex();
    return {
      committedBytes: this.committedBytes,
      recordCount: this.recordCount,
      legacySnapshotRecordCount: this.legacySnapshotRecordCount,
      incrementalRecordCount: this.incrementalRecordCount,
      indexedAgentCount: this.latestStateByAgentId.size,
      totalCompletedObjectiveCount: [...this.latestStateByAgentId.values()].reduce(
        (total, state) => total + getCompletedObjectiveCount(state),
        0,
      ),
      retainedCompletedObjectiveCount: [...this.latestStateByAgentId.values()].reduce(
        (total, state) => total + state.completedObjectives.length,
        0,
      ),
      completedObjectiveRetentionLimit: AGENT_INTENTION_COMPLETED_OBJECTIVE_RETENTION_LIMIT,
      maximumRecordBytes: this.maximumRecordBytes,
    };
  }

  private getLatestState(agentId: AgentId): AgentIntentionState | undefined {
    this.refreshLatestStateIndex();
    return this.latestStateByAgentId.get(agentId);
  }

  private refreshLatestStateIndex(): void {
    const nextSignature = readJsonLinesFileSignature(this.statesPath);
    if (
      sameJsonLinesFileSignature(this.signature, nextSignature) &&
      this.committedBytes === nextSignature.size
    ) {
      return;
    }
    if (this.requiresRebuild(nextSignature)) {
      this.resetIndex();
    }
    try {
      const scan = scanJsonLines<unknown>({
        path: this.statesPath,
        fromByte: this.committedBytes,
        toByte: nextSignature.size,
        onRecord: (record, _byteOffset, byteLength) => this.projectRecord(record, byteLength),
      });
      this.committedBytes += scan.consumedBytes;
      this.signature = nextSignature;
    } catch (error) {
      this.resetIndex();
      this.signature = undefined;
      throw error;
    }
  }

  private appendRecord(record: AgentIntentionLedgerRecord): void {
    this.refreshLatestStateIndex();
    if (statSync(this.statesPath).size !== this.committedBytes) {
      throw new Error(`agent intention JSONL has an incomplete trailing row: ${this.statesPath}`);
    }
    appendJsonLines(this.statesPath, [record]);
    this.refreshLatestStateIndex();
  }

  private projectRecord(record: unknown, byteLength: number): void {
    this.recordCount += 1;
    this.maximumRecordBytes = Math.max(this.maximumRecordBytes, byteLength);
    if (isLegacyAgentIntentionState(record)) {
      this.legacySnapshotRecordCount += 1;
      this.latestStateByAgentId.set(record.agentId, cloneState(record));
      return;
    }

    const operation = parseAgentIntentionLedgerRecord(record, this.statesPath);
    this.incrementalRecordCount += 1;
    if (operation.operation === 'replace-state') {
      this.latestStateByAgentId.set(operation.state.agentId, cloneState(operation.state));
      return;
    }

    const current =
      this.latestStateByAgentId.get(operation.agentId) ??
      createEmptyAgentIntentionState(operation.agentId);
    const updated =
      operation.operation === 'set-objective'
        ? setLongHorizonObjective(current, operation.objective)
        : operation.operation === 'upsert-scheduled-intentions'
          ? upsertScheduledIntentions(current, operation.scheduledIntentions)
          : completeLongHorizonObjective(current, operation.request);
    this.latestStateByAgentId.set(operation.agentId, cloneState(updated));
  }

  private requiresRebuild(nextSignature: JsonLinesFileSignature): boolean {
    if (this.signature === undefined) {
      return true;
    }
    if (
      this.signature.device !== nextSignature.device ||
      this.signature.inode !== nextSignature.inode ||
      nextSignature.size < this.committedBytes
    ) {
      return true;
    }
    return (
      nextSignature.size === this.signature.size &&
      (this.signature.modifiedAtMs !== nextSignature.modifiedAtMs ||
        this.signature.changedAtMs !== nextSignature.changedAtMs)
    );
  }

  private resetIndex(): void {
    this.committedBytes = 0;
    this.recordCount = 0;
    this.legacySnapshotRecordCount = 0;
    this.incrementalRecordCount = 0;
    this.maximumRecordBytes = 0;
    this.latestStateByAgentId.clear();
  }

  private requireLatestState(agentId: AgentId, fallback: AgentIntentionState): AgentIntentionState {
    return this.latestStateByAgentId.get(agentId) ?? fallback;
  }
}

function isLegacyAgentIntentionState(value: unknown): value is AgentIntentionState {
  return isPlainRecord(value) && !('schemaVersion' in value) && isAgentIntentionStatePayload(value);
}

function parseAgentIntentionLedgerRecord(
  value: unknown,
  source: string,
): AgentIntentionLedgerRecord {
  if (!isPlainRecord(value)) {
    throw new Error(`agent intention ledger record must be an object: ${source}`);
  }
  if (
    value.schemaVersion !== AGENT_INTENTION_LEDGER_LEGACY_OPERATION_VERSION &&
    value.schemaVersion !== AGENT_INTENTION_LEDGER_POLICY_VERSION
  ) {
    throw new Error(
      `unsupported agent intention ledger version ${String(value.schemaVersion)}: ${source}`,
    );
  }
  if (value.operation === 'replace-state') {
    if (!isAgentIntentionStatePayload(value.state)) {
      throw new Error(`agent intention replace-state record is invalid: ${source}`);
    }
    return value as AgentIntentionLedgerRecord;
  }
  if (value.operation === 'set-objective') {
    if (typeof value.agentId !== 'string' || !isPlainRecord(value.objective)) {
      throw new Error(`agent intention set-objective record is invalid: ${source}`);
    }
    return value as AgentIntentionLedgerRecord;
  }
  if (value.operation === 'upsert-scheduled-intentions') {
    if (typeof value.agentId !== 'string' || !Array.isArray(value.scheduledIntentions)) {
      throw new Error(`agent intention schedule record is invalid: ${source}`);
    }
    return value as AgentIntentionLedgerRecord;
  }
  if (value.operation === 'complete-objective') {
    if (typeof value.agentId !== 'string' || !isPlainRecord(value.request)) {
      throw new Error(`agent intention completion record is invalid: ${source}`);
    }
    return value as AgentIntentionLedgerRecord;
  }
  throw new Error(
    `unsupported agent intention ledger operation ${String(value.operation)}: ${source}`,
  );
}

function isAgentIntentionStatePayload(value: unknown): value is AgentIntentionState {
  return (
    isPlainRecord(value) &&
    typeof value.agentId === 'string' &&
    Array.isArray(value.completedObjectives) &&
    Array.isArray(value.scheduledIntentions) &&
    typeof value.updatedAt === 'number' &&
    (value.completedObjectiveCount === undefined ||
      (typeof value.completedObjectiveCount === 'number' &&
        Number.isSafeInteger(value.completedObjectiveCount) &&
        value.completedObjectiveCount >= value.completedObjectives.length))
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class FileLongTermProfileRepository implements LongTermProfileRepository {
  private readonly profilesPath: string;
  private readonly profilesFile: IncrementalJsonLinesProjection<LongTermAgentProfile>;
  private readonly compactionMaximumBytes: number | undefined;
  private readonly latestProfileByAgentId = new Map<AgentId, LongTermAgentProfile>();
  private suppressedDuplicateSaveCount = 0;
  private compactionCount = 0;
  private compactionReclaimedBytes = 0;

  constructor(input: {
    readonly rootDir: string;
    readonly singleWriterCompactionMaximumBytes?: number;
  }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    if (input.singleWriterCompactionMaximumBytes !== undefined) {
      assertPositiveSafeInteger(
        input.singleWriterCompactionMaximumBytes,
        'singleWriterCompactionMaximumBytes',
      );
    }
    this.compactionMaximumBytes = input.singleWriterCompactionMaximumBytes;
    this.profilesPath = join(input.rootDir, 'long-term-profiles.jsonl');
    ensureFile(this.profilesPath, input.rootDir);
    this.profilesFile = new IncrementalJsonLinesProjection({
      path: this.profilesPath,
      resetProjection: () => this.latestProfileByAgentId.clear(),
      project: (profile) => this.latestProfileByAgentId.set(profile.agentId, cloneProfile(profile)),
    });
  }

  async getOrCreate(agentId: AgentId): Promise<LongTermAgentProfile> {
    const existing = this.getLatestProfile(agentId);
    if (existing !== undefined) {
      return cloneProfile(existing);
    }

    const profile = createEmptyLongTermAgentProfile(agentId);
    await this.save(profile);
    return profile;
  }

  save(profile: LongTermAgentProfile): Promise<void> {
    const cloned = cloneProfile(profile);
    this.profilesFile.refresh();
    const existing = this.latestProfileByAgentId.get(cloned.agentId);
    if (existing !== undefined && profilesEqual(existing, cloned)) {
      this.suppressedDuplicateSaveCount += 1;
      return Promise.resolve();
    }
    this.profilesFile.append([cloned]);
    this.compactIfNeeded();
    return Promise.resolve();
  }

  async applyPatches(
    agentId: AgentId,
    patches: readonly LongTermMemoryPatch[],
  ): Promise<LongTermAgentProfile> {
    const current = await this.getOrCreate(agentId);
    const updated = applyLongTermMemoryPatches(current, patches);
    await this.save(updated);
    return updated;
  }

  private getLatestProfile(agentId: AgentId): LongTermAgentProfile | undefined {
    this.profilesFile.refresh();
    return this.latestProfileByAgentId.get(agentId);
  }

  getStorageDiagnostics(): {
    readonly completeRecordCount: number;
    readonly indexedAgentCount: number;
    readonly committedBytes: number;
    readonly fileBytes: number;
    readonly hasIncompleteTrailingRow: boolean;
    readonly suppressedDuplicateSaveCount: number;
    readonly compactionCount: number;
    readonly compactionReclaimedBytes: number;
  } {
    const file = this.profilesFile.diagnostics();
    return {
      ...file,
      indexedAgentCount: this.latestProfileByAgentId.size,
      suppressedDuplicateSaveCount: this.suppressedDuplicateSaveCount,
      compactionCount: this.compactionCount,
      compactionReclaimedBytes: this.compactionReclaimedBytes,
    };
  }

  private compactIfNeeded(): void {
    if (
      this.compactionMaximumBytes === undefined ||
      this.profilesFile.diagnostics().fileBytes <= this.compactionMaximumBytes
    ) {
      return;
    }
    const replacement = [...this.latestProfileByAgentId.values()]
      .sort((left, right) => left.agentId.localeCompare(right.agentId))
      .map((profile) => cloneProfile(profile));
    const result = this.profilesFile.replaceCommittedForSingleWriter(replacement);
    this.compactionCount += 1;
    this.compactionReclaimedBytes += Math.max(0, result.previousBytes - result.currentBytes);
  }
}

function profilesEqual(left: LongTermAgentProfile, right: LongTermAgentProfile): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneState(state: AgentIntentionState): AgentIntentionState {
  return enforceAgentIntentionStateRetention(state);
}

function cloneObjective(objective: LongHorizonObjective): LongHorizonObjective {
  return {
    ...objective,
    affinityTags: [...objective.affinityTags],
    ...(objective.planningDomains === undefined
      ? {}
      : { planningDomains: [...objective.planningDomains] }),
  };
}

function cloneScheduledIntention(intention: ScheduledIntention): ScheduledIntention {
  return {
    id: intention.id,
    agentId: intention.agentId,
    ...(intention.objectiveId === undefined ? {} : { objectiveId: intention.objectiveId }),
    ...(intention.branchId === undefined ? {} : { branchId: intention.branchId }),
    ...(intention.subtaskId === undefined ? {} : { subtaskId: intention.subtaskId }),
    ...(intention.sourcePlanId === undefined ? {} : { sourcePlanId: intention.sourcePlanId }),
    description: intention.description,
    priority: intention.priority,
    startsAt: intention.startsAt,
    endsAt: intention.endsAt,
    status: intention.status,
    affinityTags: [...intention.affinityTags],
    ...(intention.provenanceRecordIds === undefined
      ? {}
      : { provenanceRecordIds: [...intention.provenanceRecordIds] }),
    createdAt: intention.createdAt,
    updatedAt: intention.updatedAt,
  };
}

function cloneProfile(profile: LongTermAgentProfile): LongTermAgentProfile {
  return {
    agentId: profile.agentId,
    beliefs: profile.beliefs.map((entry) => cloneEntry(entry)),
    habits: profile.habits.map((entry) => cloneEntry(entry)),
    mood: profile.mood.map((entry) => cloneEntry(entry)),
    values: profile.values.map((entry) => cloneEntry(entry)),
    personality: profile.personality.map((entry) => cloneEntry(entry)),
    socialRecords: profile.socialRecords.map((entry) => cloneEntry(entry)),
  };
}

function cloneEntry(entry: LongTermProfileEntry): LongTermProfileEntry {
  return {
    ...entry,
    provenanceRecordIds: [...entry.provenanceRecordIds],
  };
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
