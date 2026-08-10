import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  appendDeflatedJsonLinesFrame,
  scanDeflatedJsonLinesFrames,
} from './deflatedJsonLinesFrames';
import { FixedBloomFilter } from './fixedBloomFilter';
import type {
  AppendToEventStreamRequest,
  AppendToEventStreamResult,
  EventStore,
  EventStreamName,
  EventStreamReadOptions,
  IdempotentEventStreamAppend,
} from './eventStore';
import type { EventEnvelope } from './event';

type StoredLegacyIdempotencyRecord<TEvent extends EventEnvelope> = {
  readonly idempotencyKey: string;
  readonly streamName: EventStreamName;
  readonly expectedVersion?: number;
  readonly eventFingerprint: string;
  readonly appendedEvents: readonly TEvent[];
  readonly streamVersion: number;
};

export const FILE_EVENT_IDEMPOTENCY_RECORD_SCHEMA_VERSION = 'file-event-idempotency-v2';
export const FILE_EVENT_IDEMPOTENCY_LEGACY_PATH = 'idempotency.jsonl';
export const FILE_EVENT_IDEMPOTENCY_COMPACT_PATH = 'idempotency.deflate';
export const FILE_EVENT_PENDING_APPEND_PATH = 'append-transaction.pending.json';

type StoredCompactIdempotencyRecord = {
  readonly schemaVersion: typeof FILE_EVENT_IDEMPOTENCY_RECORD_SCHEMA_VERSION;
  readonly idempotencyKey: string;
  readonly streamName: EventStreamName;
  readonly expectedVersion?: number;
  readonly eventFingerprintSha256: string;
  readonly firstSequence: number;
  readonly eventCount: number;
  readonly streamVersion: number;
  readonly recordSha256: string;
};

type StoredIdempotencyRecord<TEvent extends EventEnvelope> =
  | StoredLegacyIdempotencyRecord<TEvent>
  | StoredCompactIdempotencyRecord;

export const FILE_EVENT_STORE_RUNTIME_INDEX_POLICY_VERSION = 'file-event-store-runtime-index-v4';
export const FILE_EVENT_STORE_RECENT_EVENT_LIMIT = 1_024;
export const FILE_EVENT_STORE_SPARSE_CHECKPOINT_INTERVAL = 1_024;
export const FILE_EVENT_STORE_MAX_SPARSE_CHECKPOINT_COUNT = 4_096;
export const FILE_EVENT_STORE_RECENT_IDEMPOTENCY_LIMIT = 1_024;
export const FILE_EVENT_STORE_IDEMPOTENCY_BLOOM_BIT_COUNT = 1 << 24;
export const FILE_EVENT_STORE_IDEMPOTENCY_COMPACTION_INCREMENT_BYTES = 4 * 1024 * 1024;
export const FILE_EVENT_STORE_IDEMPOTENCY_COMPACTION_FRAME_RECORD_LIMIT = 1_024;
const FILE_EVENT_STORE_IDEMPOTENCY_BLOOM_HASH_COUNT = 7;
export const FILE_EVENT_STREAM_COMPACT_SUFFIX = '.deflate';

export type FileEventStreamWriterFormat = 'compact-deflate-frames-v1' | 'legacy-jsonl-v1';

export type FileEventStoreRuntimeIndexPolicyManifest = {
  readonly policyVersion: typeof FILE_EVENT_STORE_RUNTIME_INDEX_POLICY_VERSION;
  readonly eventStreamRule: 'legacy-jsonl-plus-compact-deflate-frames-with-bounded-runtime-index';
  readonly recentEventLimit: number;
  readonly sparseCheckpointInterval: number;
  readonly maxSparseCheckpointCount: number;
  readonly idempotencyRule: 'bounded-recent-records-plus-fixed-bloom-with-exact-cold-scan';
  readonly recentIdempotencyLimit: number;
  readonly idempotencyBloomBitCount: number;
  readonly idempotencyBloomHashCount: number;
  readonly coldReadRule: 'union-read-legacy-jsonl-and-compact-frames-from-nearest-checkpoint';
  readonly eventStreamWriterFormat: 'uint32be-length-prefixed-deflate-raw-jsonl-batch-v1';
  readonly idempotencyPayloadRule: 'sha256-request-plus-event-sequence-reference';
  readonly idempotencyWriterFormat: 'uint32be-length-prefixed-deflate-raw-json-v1';
  readonly idempotencyCompactionRule: 'single-writer-atomic-streaming-repack-into-batched-jsonl-frames';
  readonly appendAtomicityRule: 'single-writer-write-ahead-pending-append-with-startup-roll-forward';
  readonly pendingAppendPath: typeof FILE_EVENT_PENDING_APPEND_PATH;
  readonly legacyIdempotencyReadPath: typeof FILE_EVENT_IDEMPOTENCY_LEGACY_PATH;
  readonly compactIdempotencyWritePath: typeof FILE_EVENT_IDEMPOTENCY_COMPACT_PATH;
  readonly diskLayout: 'layout-v4-write-ahead-append-plus-v3-compact-readers';
};

export function createFileEventStoreRuntimeIndexPolicyManifest(): FileEventStoreRuntimeIndexPolicyManifest {
  return {
    policyVersion: FILE_EVENT_STORE_RUNTIME_INDEX_POLICY_VERSION,
    eventStreamRule: 'legacy-jsonl-plus-compact-deflate-frames-with-bounded-runtime-index',
    recentEventLimit: FILE_EVENT_STORE_RECENT_EVENT_LIMIT,
    sparseCheckpointInterval: FILE_EVENT_STORE_SPARSE_CHECKPOINT_INTERVAL,
    maxSparseCheckpointCount: FILE_EVENT_STORE_MAX_SPARSE_CHECKPOINT_COUNT,
    idempotencyRule: 'bounded-recent-records-plus-fixed-bloom-with-exact-cold-scan',
    recentIdempotencyLimit: FILE_EVENT_STORE_RECENT_IDEMPOTENCY_LIMIT,
    idempotencyBloomBitCount: FILE_EVENT_STORE_IDEMPOTENCY_BLOOM_BIT_COUNT,
    idempotencyBloomHashCount: FILE_EVENT_STORE_IDEMPOTENCY_BLOOM_HASH_COUNT,
    coldReadRule: 'union-read-legacy-jsonl-and-compact-frames-from-nearest-checkpoint',
    eventStreamWriterFormat: 'uint32be-length-prefixed-deflate-raw-jsonl-batch-v1',
    idempotencyPayloadRule: 'sha256-request-plus-event-sequence-reference',
    idempotencyWriterFormat: 'uint32be-length-prefixed-deflate-raw-json-v1',
    idempotencyCompactionRule: 'single-writer-atomic-streaming-repack-into-batched-jsonl-frames',
    appendAtomicityRule: 'single-writer-write-ahead-pending-append-with-startup-roll-forward',
    pendingAppendPath: FILE_EVENT_PENDING_APPEND_PATH,
    legacyIdempotencyReadPath: FILE_EVENT_IDEMPOTENCY_LEGACY_PATH,
    compactIdempotencyWritePath: FILE_EVENT_IDEMPOTENCY_COMPACT_PATH,
    diskLayout: 'layout-v4-write-ahead-append-plus-v3-compact-readers',
  };
}

export type FileEventStoreIdempotencyMigrationResult = {
  readonly schemaVersion: 'file-event-idempotency-migration-v1';
  readonly rootDir: string;
  readonly status: 'migrated' | 'already-v2' | 'empty';
  readonly recordCount: number;
  readonly legacyByteLength: number;
  readonly compactByteLength: number;
};

export const FILE_EVENT_STORE_EXACT_STRING_REDACTION_POLICY_VERSION =
  'file-event-store-exact-string-redaction-v1';

export type FileEventStoreExactStringRedactionResult = {
  readonly policyVersion: typeof FILE_EVENT_STORE_EXACT_STRING_REDACTION_POLICY_VERSION;
  readonly rootDir: string;
  readonly streamFileCount: number;
  readonly streamRecordCount: number;
  readonly replacementCount: number;
  readonly legacyIdempotencyRecordCount: number;
  readonly compactIdempotencyRecordCount: number;
};

/**
 * Rewrites exact string values in an offline file event store while preserving
 * sequence numbers and rebuilding every integrity-bound idempotency record.
 * The caller must operate on a disposable copy of a stopped runtime root.
 */
export function redactFileEventStoreExactString(input: {
  readonly rootDir: string;
  readonly target: string;
  readonly replacement: string;
}): FileEventStoreExactStringRedactionResult {
  assertNonEmpty(input.rootDir, 'rootDir');
  assertNonEmpty(input.target, 'target');
  assertNonEmpty(input.replacement, 'replacement');
  if (input.target === input.replacement) {
    throw new Error('event-store redaction replacement must differ from target');
  }
  const streamsDir = join(input.rootDir, 'streams');
  const legacyPath = join(input.rootDir, FILE_EVENT_IDEMPOTENCY_LEGACY_PATH);
  const compactPath = join(input.rootDir, FILE_EVENT_IDEMPOTENCY_COMPACT_PATH);
  if (!existsSync(streamsDir) || !existsSync(legacyPath) || !existsSync(compactPath)) {
    throw new Error(`event-store redaction requires a complete file event store: ${input.rootDir}`);
  }

  let streamRecordCount = 0;
  let replacementCount = 0;
  const streamBasenames = [
    ...new Set(
      readdirSync(streamsDir).flatMap((name) =>
        name.endsWith('.jsonl')
          ? [name.slice(0, -'.jsonl'.length)]
          : name.endsWith(FILE_EVENT_STREAM_COMPACT_SUFFIX)
            ? [name.slice(0, -FILE_EVENT_STREAM_COMPACT_SUFFIX.length)]
            : [],
      ),
    ),
  ].sort();
  for (const basename of streamBasenames) {
    const legacyStreamPath = join(streamsDir, `${basename}.jsonl`);
    if (existsSync(legacyStreamPath)) {
      const rewritten = rewriteJsonLinesExactString({
        path: legacyStreamPath,
        target: input.target,
        replacement: input.replacement,
      });
      streamRecordCount += rewritten.recordCount;
      replacementCount += rewritten.replacementCount;
    }
    const compactStreamPath = join(streamsDir, `${basename}${FILE_EVENT_STREAM_COMPACT_SUFFIX}`);
    if (existsSync(compactStreamPath)) {
      const rewritten = rewriteCompactEventFramesExactString({
        path: compactStreamPath,
        target: input.target,
        replacement: input.replacement,
      });
      streamRecordCount += rewritten.recordCount;
      replacementCount += rewritten.replacementCount;
    }
  }

  let legacyIdempotencyRecordCount = 0;
  if (statSync(legacyPath).size > 0) {
    const rewritten = rewriteJsonLinesExactString({
      path: legacyPath,
      target: input.target,
      replacement: input.replacement,
      finalize: (value) => {
        const record = value as StoredLegacyIdempotencyRecord<EventEnvelope>;
        assertValidStoredIdempotencyRecord(record, legacyPath);
        return {
          ...record,
          eventFingerprint: fingerprintEvents(record.appendedEvents),
        };
      },
    });
    legacyIdempotencyRecordCount = rewritten.recordCount;
    replacementCount += rewritten.replacementCount;
  }

  const compactTemporaryPath = `${compactPath}.redacting`;
  if (existsSync(compactTemporaryPath)) {
    throw new Error(`event-store redaction staging file already exists: ${compactTemporaryPath}`);
  }
  writeFileSync(compactTemporaryPath, '', { flag: 'wx' });
  const streamFiles = new Map<EventStreamName, IndexedEventStreamFile<EventEnvelope>>();
  let compactIdempotencyRecordCount = 0;
  try {
    const compactSize = statSync(compactPath).size;
    const scan = scanCompactIdempotencyRecords({
      path: compactPath,
      fromByte: 0,
      toByte: compactSize,
      onRecord: (record) => {
        assertValidStoredIdempotencyRecord(record, compactPath);
        const redactedIdentity = redactExactStringValue(record, input.target, input.replacement);
        replacementCount += redactedIdentity.replacementCount;
        const redactedRecord = redactedIdentity.value as StoredCompactIdempotencyRecord;
        if (redactedRecord.streamName !== record.streamName) {
          throw new Error('event-store redaction cannot rename an event stream');
        }
        const events = migrationStreamFile({
          streamName: redactedRecord.streamName,
          streamsDir,
          streamFiles,
        }).read({
          afterSequence: redactedRecord.firstSequence - 1,
          limit: redactedRecord.eventCount,
        });
        if (
          events.length !== redactedRecord.eventCount ||
          events[0]?.sequence !== redactedRecord.firstSequence ||
          events.at(-1)?.sequence !== redactedRecord.streamVersion
        ) {
          throw new Error(
            `redacted event stream does not satisfy idempotency range: ${redactedRecord.idempotencyKey}`,
          );
        }
        appendCompactIdempotencyRecord(
          compactTemporaryPath,
          createCompactIdempotencyRecord({
            schemaVersion: FILE_EVENT_IDEMPOTENCY_RECORD_SCHEMA_VERSION,
            idempotencyKey: redactedRecord.idempotencyKey,
            streamName: redactedRecord.streamName,
            ...(redactedRecord.expectedVersion === undefined
              ? {}
              : { expectedVersion: redactedRecord.expectedVersion }),
            eventFingerprintSha256: fingerprintEventsSha256(events),
            firstSequence: redactedRecord.firstSequence,
            eventCount: redactedRecord.eventCount,
            streamVersion: redactedRecord.streamVersion,
          }),
        );
        compactIdempotencyRecordCount += 1;
      },
    });
    if (scan.consumedBytes !== compactSize) {
      throw new Error(
        `compact event idempotency file has an incomplete trailing frame: ${compactPath}`,
      );
    }
    const validatedCount = validateCompactIdempotencyFile({
      compactPath: compactTemporaryPath,
      streamsDir,
    });
    if (validatedCount !== compactIdempotencyRecordCount) {
      throw new Error('redacted event idempotency validation count mismatch');
    }
    renameSync(compactTemporaryPath, compactPath);
  } catch (error) {
    if (existsSync(compactTemporaryPath)) {
      unlinkSync(compactTemporaryPath);
    }
    throw error;
  }

  return {
    policyVersion: FILE_EVENT_STORE_EXACT_STRING_REDACTION_POLICY_VERSION,
    rootDir: input.rootDir,
    streamFileCount: streamBasenames.length,
    streamRecordCount,
    replacementCount,
    legacyIdempotencyRecordCount,
    compactIdempotencyRecordCount,
  };
}

export function migrateFileEventStoreIdempotencyV1ToV2(input: {
  readonly rootDir: string;
}): FileEventStoreIdempotencyMigrationResult {
  assertNonEmpty(input.rootDir, 'rootDir');
  const legacyPath = join(input.rootDir, FILE_EVENT_IDEMPOTENCY_LEGACY_PATH);
  const compactPath = join(input.rootDir, FILE_EVENT_IDEMPOTENCY_COMPACT_PATH);
  const streamsDir = join(input.rootDir, 'streams');
  if (!existsSync(legacyPath)) {
    throw new Error(`legacy event idempotency file is missing: ${legacyPath}`);
  }
  mkdirSync(streamsDir, { recursive: true });
  if (!existsSync(compactPath)) {
    writeFileSync(compactPath, '');
  }
  const legacyByteLength = statSync(legacyPath).size;
  const compactByteLength = statSync(compactPath).size;
  if (legacyByteLength === 0) {
    const recordCount = validateCompactIdempotencyFile({ compactPath, streamsDir });
    return {
      schemaVersion: 'file-event-idempotency-migration-v1',
      rootDir: input.rootDir,
      status: compactByteLength === 0 ? 'empty' : 'already-v2',
      recordCount,
      legacyByteLength,
      compactByteLength,
    };
  }
  if (compactByteLength !== 0) {
    throw new Error(
      `event idempotency migration requires an empty compact target when legacy rows exist: ${compactPath}`,
    );
  }

  const temporaryPath = `${compactPath}.migrating`;
  if (existsSync(temporaryPath)) {
    throw new Error(`event idempotency migration staging file already exists: ${temporaryPath}`);
  }
  writeFileSync(temporaryPath, '', { flag: 'wx' });
  let recordCount = 0;
  const seenKeys = new Set<string>();
  const streamFiles = new Map<EventStreamName, IndexedEventStreamFile<EventEnvelope>>();
  try {
    const scan = scanJsonLines<StoredLegacyIdempotencyRecord<EventEnvelope>>({
      path: legacyPath,
      fromByte: 0,
      toByte: legacyByteLength,
      onRecord: (record) => {
        assertValidStoredIdempotencyRecord(record, legacyPath);
        if (seenKeys.has(record.idempotencyKey)) {
          throw new Error(`duplicate legacy event idempotency key: ${record.idempotencyKey}`);
        }
        seenKeys.add(record.idempotencyKey);
        const compactRecord = compactRecordFromLegacy({ record, streamsDir, streamFiles });
        appendCompactIdempotencyRecord(temporaryPath, compactRecord);
        recordCount += 1;
      },
    });
    if (scan.consumedBytes !== legacyByteLength) {
      throw new Error(
        `legacy event idempotency JSONL has an incomplete trailing row: ${legacyPath}`,
      );
    }
    const validatedCount = validateCompactIdempotencyFile({
      compactPath: temporaryPath,
      streamsDir,
    });
    if (validatedCount !== recordCount) {
      throw new Error('compact event idempotency migration validation count mismatch');
    }
    renameSync(temporaryPath, compactPath);
    writeFileSync(legacyPath, '');
    return {
      schemaVersion: 'file-event-idempotency-migration-v1',
      rootDir: input.rootDir,
      status: 'migrated',
      recordCount,
      legacyByteLength,
      compactByteLength: statSync(compactPath).size,
    };
  } catch (error) {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
    throw error;
  }
}

export type FileEventStoreRuntimeIndexDiagnostics = {
  readonly eventStream: IndexedEventStreamDiagnostics;
  readonly idempotency: FileEventIdempotencyDiagnostics;
};

export class FileEventStore<
  TEvent extends EventEnvelope = EventEnvelope,
> implements EventStore<TEvent> {
  private readonly rootDir: string;
  private readonly streamsDir: string;
  private readonly legacyIdempotencyPath: string;
  private readonly compactIdempotencyPath: string;
  private readonly pendingAppendPath: string;
  private readonly pendingAppendStagingPath: string;
  private readonly recentEventLimit: number;
  private readonly sparseCheckpointInterval: number;
  private readonly maxSparseCheckpointCount: number;
  private readonly eventStreamWriterFormat: FileEventStreamWriterFormat;
  private readonly idempotencyFile: FileEventIdempotencyIndex<TEvent>;
  private readonly streamFiles = new Map<EventStreamName, IndexedEventStreamFile<TEvent>>();

  constructor(input: {
    readonly rootDir: string;
    readonly recentEventLimit?: number;
    readonly sparseCheckpointInterval?: number;
    readonly maxSparseCheckpointCount?: number;
    readonly recentIdempotencyLimit?: number;
    readonly idempotencyBloomBitCount?: number;
    readonly idempotencyCompactionIncrementBytes?: number;
    readonly eventStreamWriterFormat?: FileEventStreamWriterFormat;
  }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.recentEventLimit = input.recentEventLimit ?? FILE_EVENT_STORE_RECENT_EVENT_LIMIT;
    this.sparseCheckpointInterval =
      input.sparseCheckpointInterval ?? FILE_EVENT_STORE_SPARSE_CHECKPOINT_INTERVAL;
    this.maxSparseCheckpointCount =
      input.maxSparseCheckpointCount ?? FILE_EVENT_STORE_MAX_SPARSE_CHECKPOINT_COUNT;
    this.eventStreamWriterFormat = input.eventStreamWriterFormat ?? 'compact-deflate-frames-v1';
    assertPositiveSafeInteger(this.recentEventLimit, 'recentEventLimit');
    assertPositiveSafeInteger(this.sparseCheckpointInterval, 'sparseCheckpointInterval');
    assertPositiveSafeInteger(this.maxSparseCheckpointCount, 'maxSparseCheckpointCount');
    this.rootDir = input.rootDir;
    this.streamsDir = join(input.rootDir, 'streams');
    this.legacyIdempotencyPath = join(input.rootDir, FILE_EVENT_IDEMPOTENCY_LEGACY_PATH);
    this.compactIdempotencyPath = join(input.rootDir, FILE_EVENT_IDEMPOTENCY_COMPACT_PATH);
    this.pendingAppendPath = join(input.rootDir, FILE_EVENT_PENDING_APPEND_PATH);
    this.pendingAppendStagingPath = `${this.pendingAppendPath}.staging`;
    this.ensureStorage();
    this.idempotencyFile = new FileEventIdempotencyIndex({
      legacyPath: this.legacyIdempotencyPath,
      compactPath: this.compactIdempotencyPath,
      recentLimit: input.recentIdempotencyLimit ?? FILE_EVENT_STORE_RECENT_IDEMPOTENCY_LIMIT,
      bloomBitCount: input.idempotencyBloomBitCount ?? FILE_EVENT_STORE_IDEMPOTENCY_BLOOM_BIT_COUNT,
      compactionIncrementBytes:
        input.idempotencyCompactionIncrementBytes ??
        FILE_EVENT_STORE_IDEMPOTENCY_COMPACTION_INCREMENT_BYTES,
    });
    this.recoverPendingAppend();
  }

  appendToStream(request: AppendToEventStreamRequest<TEvent>): AppendToEventStreamResult<TEvent> {
    assertNonEmpty(request.streamName, 'streamName');
    assertNonEmptyBatch(request.events);

    const idempotentReplay = this.replayIdempotentAppendIfPresent(request);
    if (idempotentReplay !== undefined) {
      return idempotentReplay;
    }

    const streamFile = this.streamFile(request.streamName);
    const currentVersion = streamFile.getVersion();
    if (request.expectedVersion !== undefined && request.expectedVersion !== currentVersion) {
      throw new Error(
        `expected stream version ${request.expectedVersion} but current version is ${currentVersion}`,
      );
    }

    request.events.forEach((event, index) => {
      const expectedSequence = currentVersion + index + 1;
      if (event.sequence !== expectedSequence) {
        throw new Error(
          `event sequence ${event.sequence} must equal next stream sequence ${expectedSequence}`,
        );
      }
    });

    if (request.idempotencyKey !== undefined) {
      this.writePendingAppend({ ...request, idempotencyKey: request.idempotencyKey });
    }

    streamFile.append(request.events);
    const streamVersion = currentVersion + request.events.length;
    const result = {
      appendedEvents: request.events,
      streamVersion,
      idempotentReplay: false,
    };

    if (request.idempotencyKey !== undefined) {
      this.appendIdempotencyRecord(
        { ...request, idempotencyKey: request.idempotencyKey },
        streamVersion,
      );
      this.clearPendingAppend();
    }

    return result;
  }

  readStream(streamName: EventStreamName, options: EventStreamReadOptions = {}): readonly TEvent[] {
    assertNonEmpty(streamName, 'streamName');
    validateReadOptions(options);

    return this.streamFile(streamName).read(options);
  }

  getStreamVersion(streamName: EventStreamName): number {
    assertNonEmpty(streamName, 'streamName');
    return this.streamFile(streamName).getVersion();
  }

  getIdempotentAppend(idempotencyKey: string): IdempotentEventStreamAppend<TEvent> | undefined {
    assertNonEmpty(idempotencyKey, 'idempotencyKey');
    const record = this.getIdempotencyRecord(idempotencyKey);
    if (record === undefined) return undefined;
    return {
      idempotencyKey,
      streamName: record.streamName,
      ...(record.expectedVersion === undefined ? {} : { expectedVersion: record.expectedVersion }),
      appendedEvents: isCompactIdempotencyRecord(record)
        ? this.resolveCompactIdempotencyEvents(record)
        : record.appendedEvents,
      streamVersion: record.streamVersion,
    };
  }

  getRuntimeIndexDiagnostics(streamName: EventStreamName): FileEventStoreRuntimeIndexDiagnostics {
    assertNonEmpty(streamName, 'streamName');
    return {
      eventStream: this.streamFile(streamName).getDiagnostics(),
      idempotency: this.idempotencyFile.getDiagnostics(),
    };
  }

  private replayIdempotentAppendIfPresent(
    request: AppendToEventStreamRequest<TEvent>,
  ): AppendToEventStreamResult<TEvent> | undefined {
    if (request.idempotencyKey === undefined) {
      return undefined;
    }

    const existing = this.getIdempotencyRecord(request.idempotencyKey);
    if (existing === undefined) {
      return undefined;
    }

    const isSameRequest =
      existing.streamName === request.streamName &&
      existing.expectedVersion === request.expectedVersion &&
      (isCompactIdempotencyRecord(existing)
        ? existing.eventFingerprintSha256 === fingerprintEventsSha256(request.events)
        : existing.eventFingerprint === fingerprintEvents(request.events));

    if (!isSameRequest) {
      throw new Error(
        `idempotency key ${request.idempotencyKey} was already used for a different append request`,
      );
    }

    const appendedEvents = isCompactIdempotencyRecord(existing)
      ? this.resolveCompactIdempotencyEvents(existing)
      : existing.appendedEvents;
    return {
      appendedEvents,
      streamVersion: existing.streamVersion,
      idempotentReplay: true,
    };
  }

  private appendIdempotencyRecord(
    request: AppendToEventStreamRequest<TEvent> & { readonly idempotencyKey: string },
    streamVersion: number,
  ): void {
    this.idempotencyFile.append({
      schemaVersion: FILE_EVENT_IDEMPOTENCY_RECORD_SCHEMA_VERSION,
      idempotencyKey: request.idempotencyKey,
      streamName: request.streamName,
      ...(request.expectedVersion === undefined
        ? {}
        : { expectedVersion: request.expectedVersion }),
      eventFingerprintSha256: fingerprintEventsSha256(request.events),
      firstSequence: request.events[0]!.sequence,
      eventCount: request.events.length,
      streamVersion,
    });
  }

  private writePendingAppend(
    request: AppendToEventStreamRequest<TEvent> & { readonly idempotencyKey: string },
  ): void {
    if (existsSync(this.pendingAppendPath)) {
      throw new Error(`event store already has a pending append: ${this.pendingAppendPath}`);
    }
    if (existsSync(this.pendingAppendStagingPath)) {
      unlinkSync(this.pendingAppendStagingPath);
    }
    writeFileSync(
      this.pendingAppendStagingPath,
      `${JSON.stringify({
        schemaVersion: 'file-event-pending-append-v1',
        streamName: request.streamName,
        ...(request.expectedVersion === undefined
          ? {}
          : { expectedVersion: request.expectedVersion }),
        idempotencyKey: request.idempotencyKey,
        events: request.events,
      })}\n`,
      { flag: 'wx' },
    );
    renameSync(this.pendingAppendStagingPath, this.pendingAppendPath);
  }

  private recoverPendingAppend(): void {
    if (existsSync(this.pendingAppendStagingPath)) {
      unlinkSync(this.pendingAppendStagingPath);
    }
    if (!existsSync(this.pendingAppendPath)) return;
    const request = parsePendingAppend<TEvent>(
      JSON.parse(readFileSync(this.pendingAppendPath, 'utf8')),
      this.pendingAppendPath,
    );
    const replay = this.replayIdempotentAppendIfPresent(request);
    if (replay !== undefined) {
      this.clearPendingAppend();
      return;
    }

    const streamFile = this.streamFile(request.streamName);
    const firstSequence = request.events[0]!.sequence;
    const baseVersion = firstSequence - 1;
    if (request.expectedVersion !== undefined && request.expectedVersion !== baseVersion) {
      throw new Error(`pending append expectedVersion is inconsistent: ${request.idempotencyKey}`);
    }
    const streamVersion = baseVersion + request.events.length;
    const currentVersion = streamFile.getVersion();
    if (currentVersion === baseVersion) {
      streamFile.append(request.events);
    } else if (currentVersion >= streamVersion) {
      const storedEvents = streamFile.read({
        afterSequence: baseVersion,
        limit: request.events.length,
      });
      if (
        storedEvents.length !== request.events.length ||
        fingerprintEventsSha256(storedEvents) !== fingerprintEventsSha256(request.events)
      ) {
        throw new Error(
          `pending append does not match durable event stream: ${request.idempotencyKey}`,
        );
      }
    } else {
      throw new Error(
        `pending append has a partial durable event range: ${request.idempotencyKey}`,
      );
    }
    this.appendIdempotencyRecord(request, streamVersion);
    this.clearPendingAppend();
  }

  private clearPendingAppend(): void {
    if (existsSync(this.pendingAppendPath)) unlinkSync(this.pendingAppendPath);
  }

  private getIdempotencyRecord(
    idempotencyKey: string,
  ): StoredIdempotencyRecord<TEvent> | undefined {
    return this.idempotencyFile.get(idempotencyKey);
  }

  private resolveCompactIdempotencyEvents(
    record: StoredCompactIdempotencyRecord,
  ): readonly TEvent[] {
    const events = this.streamFile(record.streamName).read({
      afterSequence: record.firstSequence - 1,
      limit: record.eventCount,
    });
    if (
      events.length !== record.eventCount ||
      events[0]?.sequence !== record.firstSequence ||
      events.at(-1)?.sequence !== record.streamVersion ||
      fingerprintEventsSha256(events) !== record.eventFingerprintSha256
    ) {
      throw new Error(
        `compact event idempotency record does not match authoritative stream: ${record.idempotencyKey}`,
      );
    }
    return events;
  }

  private streamFile(streamName: EventStreamName): IndexedEventStreamFile<TEvent> {
    const existing = this.streamFiles.get(streamName);
    if (existing !== undefined) {
      return existing;
    }
    const path = this.streamPath(streamName);
    if (!existsSync(path)) {
      writeFileSync(path, '');
    }
    const compactPath = this.compactStreamPath(streamName);
    if (!existsSync(compactPath)) {
      writeFileSync(compactPath, '');
    }
    const created = new IndexedEventStreamFile<TEvent>({
      path,
      compactPath,
      writerFormat: this.eventStreamWriterFormat,
      recentLimit: this.recentEventLimit,
      sparseCheckpointInterval: this.sparseCheckpointInterval,
      maxSparseCheckpointCount: this.maxSparseCheckpointCount,
    });
    this.streamFiles.set(streamName, created);
    return created;
  }

  private streamPath(streamName: EventStreamName): string {
    return join(this.streamsDir, `${encodeURIComponent(streamName)}.jsonl`);
  }

  private compactStreamPath(streamName: EventStreamName): string {
    return join(
      this.streamsDir,
      `${encodeURIComponent(streamName)}${FILE_EVENT_STREAM_COMPACT_SUFFIX}`,
    );
  }

  private ensureStorage(): void {
    mkdirSync(this.rootDir, { recursive: true });
    mkdirSync(this.streamsDir, { recursive: true });
    if (!existsSync(this.legacyIdempotencyPath)) {
      writeFileSync(this.legacyIdempotencyPath, '');
    }
    if (!existsSync(this.compactIdempotencyPath)) {
      writeFileSync(this.compactIdempotencyPath, '');
    }
  }
}

export type IndexedEventStreamDiagnostics = {
  readonly recordCount: number;
  readonly legacyRecordCount: number;
  readonly compactRecordCount: number;
  readonly compactFrameCount: number;
  readonly legacyByteLength: number;
  readonly compactByteLength: number;
  readonly writerFormat: FileEventStreamWriterFormat;
  readonly recentEventCount: number;
  readonly recentEventLimit: number;
  readonly sparseCheckpointCount: number;
  readonly sparseCheckpointInterval: number;
  readonly maxSparseCheckpointCount: number;
};

class IndexedEventStreamFile<TEvent extends EventEnvelope> {
  private readonly path: string;
  private readonly compactPath: string;
  private readonly writerFormat: FileEventStreamWriterFormat;
  private readonly recentLimit: number;
  private readonly sparseCheckpointInterval: number;
  private readonly maxSparseCheckpointCount: number;
  private committedBytes = 0;
  private committedCompactBytes = 0;
  private recordCount = 0;
  private legacyRecordCount = 0;
  private compactRecordCount = 0;
  private compactFrameCount = 0;
  private signature: JsonLinesFileSignature | undefined;
  private compactSignature: JsonLinesFileSignature | undefined;
  private readonly recentEvents: TEvent[] = [];
  private legacySparseCheckpoints: SequencedByteCheckpoint[] = [];
  private compactSparseCheckpoints: SequencedByteCheckpoint[] = [];

  constructor(input: {
    readonly path: string;
    readonly compactPath: string;
    readonly writerFormat: FileEventStreamWriterFormat;
    readonly recentLimit: number;
    readonly sparseCheckpointInterval: number;
    readonly maxSparseCheckpointCount: number;
  }) {
    this.path = input.path;
    this.compactPath = input.compactPath;
    this.writerFormat = input.writerFormat;
    this.recentLimit = input.recentLimit;
    this.sparseCheckpointInterval = input.sparseCheckpointInterval;
    this.maxSparseCheckpointCount = input.maxSparseCheckpointCount;
  }

  append(events: readonly TEvent[]): void {
    if (events.length === 0) {
      return;
    }
    this.refresh();
    if (
      statSync(this.path).size !== this.committedBytes ||
      statSync(this.compactPath).size !== this.committedCompactBytes
    ) {
      throw new Error(`event stream JSONL has an incomplete trailing row: ${this.path}`);
    }
    if (this.writerFormat === 'legacy-jsonl-v1') {
      if (this.compactRecordCount > 0) {
        throw new Error('legacy event stream writer cannot append after compact event frames');
      }
      appendJsonLines(this.path, events);
    } else {
      appendCompactEventBatch(this.compactPath, events);
    }
    this.refresh();
  }

  getVersion(): number {
    this.refresh();
    return this.recordCount;
  }

  read(options: EventStreamReadOptions): readonly TEvent[] {
    this.refresh();
    const afterSequence = options.afterSequence ?? 0;
    const earliestRecentSequence = this.recentEvents[0]?.sequence;
    if (earliestRecentSequence !== undefined && afterSequence >= earliestRecentSequence - 1) {
      const events = this.recentEvents.filter((event) => event.sequence > afterSequence);
      return options.limit === undefined ? events : events.slice(0, options.limit);
    }
    if (this.recordCount === 0) {
      return [];
    }
    const events: TEvent[] = [];
    if (afterSequence < this.legacyRecordCount) {
      const checkpoint = this.resolveScanStart(this.legacySparseCheckpoints, afterSequence + 1);
      let expectedSequence = checkpoint.sequence - 1;
      scanJsonLines<TEvent>({
        path: this.path,
        fromByte: checkpoint.byteOffset,
        toByte: this.committedBytes,
        onRecord: (event) => {
          expectedSequence += 1;
          assertStoredEventSequence(event, expectedSequence);
          if (event.sequence > afterSequence) {
            events.push(event);
          }
          return options.limit === undefined || events.length < options.limit;
        },
      });
    }
    if (options.limit !== undefined && events.length >= options.limit) {
      return events.slice(0, options.limit);
    }
    if (this.compactRecordCount > 0) {
      const requiredSequence = Math.max(afterSequence + 1, this.legacyRecordCount + 1);
      const checkpoint = this.resolveScanStart(this.compactSparseCheckpoints, requiredSequence);
      let expectedSequence = checkpoint.sequence - 1;
      scanCompactEventBatches<TEvent>({
        path: this.compactPath,
        fromByte: checkpoint.byteOffset,
        toByte: this.committedCompactBytes,
        onBatch: (batch) => {
          for (const event of batch) {
            expectedSequence += 1;
            assertStoredEventSequence(event, expectedSequence);
            if (event.sequence > afterSequence) {
              events.push(event);
              if (options.limit !== undefined && events.length >= options.limit) {
                return false;
              }
            }
          }
          return true;
        },
      });
    }
    return events;
  }

  getDiagnostics(): IndexedEventStreamDiagnostics {
    this.refresh();
    return {
      recordCount: this.recordCount,
      legacyRecordCount: this.legacyRecordCount,
      compactRecordCount: this.compactRecordCount,
      compactFrameCount: this.compactFrameCount,
      legacyByteLength: this.committedBytes,
      compactByteLength: this.committedCompactBytes,
      writerFormat: this.writerFormat,
      recentEventCount: this.recentEvents.length,
      recentEventLimit: this.recentLimit,
      sparseCheckpointCount:
        this.legacySparseCheckpoints.length + this.compactSparseCheckpoints.length,
      sparseCheckpointInterval: this.sparseCheckpointInterval,
      maxSparseCheckpointCount: this.maxSparseCheckpointCount,
    };
  }

  private refresh(): void {
    const nextSignature = readJsonLinesFileSignature(this.path);
    const nextCompactSignature = readJsonLinesFileSignature(this.compactPath);
    if (
      sameJsonLinesFileSignature(this.signature, nextSignature) &&
      sameJsonLinesFileSignature(this.compactSignature, nextCompactSignature) &&
      this.committedBytes === nextSignature.size &&
      this.committedCompactBytes === nextCompactSignature.size
    ) {
      return;
    }
    if (
      requiresJsonLinesProjectionRebuild(this.signature, nextSignature, this.committedBytes) ||
      requiresJsonLinesProjectionRebuild(
        this.compactSignature,
        nextCompactSignature,
        this.committedCompactBytes,
      )
    ) {
      this.reset();
    }
    if (this.committedCompactBytes > 0 && nextSignature.size > this.committedBytes) {
      throw new Error(`legacy event stream JSONL must not grow after compact frames: ${this.path}`);
    }
    try {
      const scan = scanJsonLines<TEvent>({
        path: this.path,
        fromByte: this.committedBytes,
        toByte: nextSignature.size,
        onRecord: (event, byteOffset) => this.indexLegacyEvent(event, byteOffset),
      });
      this.committedBytes += scan.consumedBytes;
      const compactScan = scanCompactEventBatches<TEvent>({
        path: this.compactPath,
        fromByte: this.committedCompactBytes,
        toByte: nextCompactSignature.size,
        onBatch: (events, byteOffset) => this.indexCompactBatch(events, byteOffset),
      });
      this.committedCompactBytes += compactScan.consumedBytes;
      this.signature = nextSignature;
      this.compactSignature = nextCompactSignature;
    } catch (error) {
      this.reset();
      this.signature = undefined;
      this.compactSignature = undefined;
      throw error;
    }
  }

  private indexLegacyEvent(event: TEvent, byteOffset: number): void {
    const expectedSequence = this.recordCount + 1;
    assertStoredEventSequence(event, expectedSequence);
    this.recordCount = expectedSequence;
    this.legacyRecordCount += 1;
    if ((expectedSequence - 1) % this.sparseCheckpointInterval === 0) {
      this.legacySparseCheckpoints.push({ sequence: expectedSequence, byteOffset });
      if (this.legacySparseCheckpoints.length > this.maxSparseCheckpointCount) {
        this.legacySparseCheckpoints.splice(
          0,
          this.legacySparseCheckpoints.length - this.maxSparseCheckpointCount,
        );
      }
    }
    this.retainRecentEvent(event);
  }

  private indexCompactBatch(events: readonly TEvent[], byteOffset: number): void {
    if (events.length === 0) {
      throw new Error(`compact event stream contains an empty frame: ${this.compactPath}`);
    }
    const firstSequence = this.recordCount + 1;
    if (
      this.compactSparseCheckpoints.length === 0 ||
      firstSequence - this.compactSparseCheckpoints.at(-1)!.sequence >=
        this.sparseCheckpointInterval
    ) {
      this.compactSparseCheckpoints.push({ sequence: firstSequence, byteOffset });
      if (this.compactSparseCheckpoints.length > this.maxSparseCheckpointCount) {
        this.compactSparseCheckpoints.splice(
          0,
          this.compactSparseCheckpoints.length - this.maxSparseCheckpointCount,
        );
      }
    }
    for (const event of events) {
      const expectedSequence = this.recordCount + 1;
      assertStoredEventSequence(event, expectedSequence);
      this.recordCount = expectedSequence;
      this.compactRecordCount += 1;
      this.retainRecentEvent(event);
    }
    this.compactFrameCount += 1;
  }

  private retainRecentEvent(event: TEvent): void {
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.recentLimit) {
      this.recentEvents.splice(0, this.recentEvents.length - this.recentLimit);
    }
  }

  private resolveScanStart(
    checkpoints: readonly SequencedByteCheckpoint[],
    requiredSequence: number,
  ): SequencedByteCheckpoint {
    for (let index = checkpoints.length - 1; index >= 0; index -= 1) {
      const checkpoint = checkpoints[index];
      if (checkpoint !== undefined && checkpoint.sequence <= requiredSequence) {
        return checkpoint;
      }
    }
    return { sequence: 1, byteOffset: 0 };
  }

  private reset(): void {
    this.committedBytes = 0;
    this.committedCompactBytes = 0;
    this.recordCount = 0;
    this.legacyRecordCount = 0;
    this.compactRecordCount = 0;
    this.compactFrameCount = 0;
    this.recentEvents.splice(0);
    this.legacySparseCheckpoints = [];
    this.compactSparseCheckpoints = [];
  }
}

function assertStoredEventSequence(event: EventEnvelope, expectedSequence: number): void {
  if (event.sequence !== expectedSequence) {
    throw new Error(
      `event sequence ${event.sequence} must equal stored sequence ${expectedSequence}`,
    );
  }
}

export type FileEventIdempotencyDiagnostics = {
  readonly recordCount: number;
  readonly legacyRecordCount: number;
  readonly compactRecordCount: number;
  readonly compactByteLength: number;
  readonly recentRecordCount: number;
  readonly recentRecordLimit: number;
  readonly bloomBitCount: number;
  readonly bloomByteLength: number;
};

class FileEventIdempotencyIndex<TEvent extends EventEnvelope> {
  private readonly legacyPath: string;
  private readonly compactPath: string;
  private readonly recentLimit: number;
  private readonly bloomBitCount: number;
  private readonly compactionIncrementBytes: number;
  private bloom: FixedBloomFilter;
  private committedLegacyBytes = 0;
  private committedCompactBytes = 0;
  private recordCount = 0;
  private legacyRecordCount = 0;
  private compactRecordCount = 0;
  private legacySignature: JsonLinesFileSignature | undefined;
  private compactSignature: JsonLinesFileSignature | undefined;
  private nextCompactionByteLength: number;
  private readonly recentRecords: StoredIdempotencyRecord<TEvent>[] = [];
  private readonly recentRecordByKey = new Map<string, StoredIdempotencyRecord<TEvent>>();

  constructor(input: {
    readonly legacyPath: string;
    readonly compactPath: string;
    readonly recentLimit: number;
    readonly bloomBitCount: number;
    readonly compactionIncrementBytes: number;
  }) {
    assertPositiveSafeInteger(input.recentLimit, 'recentIdempotencyLimit');
    assertPositiveSafeInteger(input.bloomBitCount, 'idempotencyBloomBitCount');
    assertPositiveSafeInteger(
      input.compactionIncrementBytes,
      'idempotencyCompactionIncrementBytes',
    );
    this.legacyPath = input.legacyPath;
    this.compactPath = input.compactPath;
    this.recentLimit = input.recentLimit;
    this.bloomBitCount = input.bloomBitCount;
    this.compactionIncrementBytes = input.compactionIncrementBytes;
    this.nextCompactionByteLength = input.compactionIncrementBytes;
    this.bloom = this.createBloom();
  }

  append(record: Omit<StoredCompactIdempotencyRecord, 'recordSha256'>): void {
    this.refresh();
    if (this.get(record.idempotencyKey) !== undefined) {
      throw new Error(`duplicate event idempotency key: ${record.idempotencyKey}`);
    }
    if (statSync(this.compactPath).size !== this.committedCompactBytes) {
      throw new Error(
        `compact event idempotency index has an incomplete trailing frame: ${this.compactPath}`,
      );
    }
    appendCompactIdempotencyRecord(this.compactPath, createCompactIdempotencyRecord(record));
    this.refresh();
    this.compactSingleWriterIfNeeded();
  }

  get(idempotencyKey: string): StoredIdempotencyRecord<TEvent> | undefined {
    this.refresh();
    const recent = this.recentRecordByKey.get(idempotencyKey);
    if (recent !== undefined || !this.bloom.mightContain(idempotencyKey)) {
      return recent;
    }
    return findIdempotencyRecord<TEvent>({
      legacyPath: this.legacyPath,
      legacyToByte: this.committedLegacyBytes,
      compactPath: this.compactPath,
      compactToByte: this.committedCompactBytes,
      idempotencyKey,
    });
  }

  getDiagnostics(): FileEventIdempotencyDiagnostics {
    this.refresh();
    return {
      recordCount: this.recordCount,
      legacyRecordCount: this.legacyRecordCount,
      compactRecordCount: this.compactRecordCount,
      compactByteLength: this.committedCompactBytes,
      recentRecordCount: this.recentRecords.length,
      recentRecordLimit: this.recentLimit,
      bloomBitCount: this.bloom.bitCount,
      bloomByteLength: this.bloom.byteLength,
    };
  }

  private refresh(): void {
    const nextLegacySignature = readJsonLinesFileSignature(this.legacyPath);
    const nextCompactSignature = readJsonLinesFileSignature(this.compactPath);
    if (
      sameJsonLinesFileSignature(this.legacySignature, nextLegacySignature) &&
      sameJsonLinesFileSignature(this.compactSignature, nextCompactSignature) &&
      this.committedLegacyBytes === nextLegacySignature.size &&
      this.committedCompactBytes === nextCompactSignature.size
    ) {
      return;
    }
    if (
      requiresJsonLinesProjectionRebuild(
        this.legacySignature,
        nextLegacySignature,
        this.committedLegacyBytes,
      ) ||
      requiresJsonLinesProjectionRebuild(
        this.compactSignature,
        nextCompactSignature,
        this.committedCompactBytes,
      )
    ) {
      this.reset();
    }
    if (this.committedCompactBytes > 0 && nextLegacySignature.size > this.committedLegacyBytes) {
      throw new Error(
        `legacy event idempotency JSONL must not grow after compact v2 records: ${this.legacyPath}`,
      );
    }
    try {
      const legacyScan = scanJsonLines<StoredLegacyIdempotencyRecord<TEvent>>({
        path: this.legacyPath,
        fromByte: this.committedLegacyBytes,
        toByte: nextLegacySignature.size,
        onRecord: (record, byteOffset) => this.indexRecord(record, 'legacy', byteOffset),
      });
      if (this.committedLegacyBytes + legacyScan.consumedBytes !== nextLegacySignature.size) {
        throw new Error(`incomplete legacy event idempotency JSONL record: ${this.legacyPath}`);
      }
      this.committedLegacyBytes += legacyScan.consumedBytes;
      const compactScan = scanCompactIdempotencyRecords({
        path: this.compactPath,
        fromByte: this.committedCompactBytes,
        toByte: nextCompactSignature.size,
        onRecord: (record, byteOffset) => this.indexRecord(record, 'compact', byteOffset),
      });
      this.committedCompactBytes += compactScan.consumedBytes;
      this.legacySignature = nextLegacySignature;
      this.compactSignature = nextCompactSignature;
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  private indexRecord(
    record: StoredIdempotencyRecord<TEvent>,
    source: 'legacy' | 'compact',
    byteOffset: number,
  ): void {
    assertValidStoredIdempotencyRecord(
      record,
      source === 'legacy' ? this.legacyPath : this.compactPath,
    );
    if (
      this.recentRecordByKey.has(record.idempotencyKey) ||
      (this.bloom.mightContain(record.idempotencyKey) &&
        findIdempotencyRecord<TEvent>({
          legacyPath: this.legacyPath,
          legacyToByte: source === 'legacy' ? byteOffset : this.committedLegacyBytes,
          compactPath: this.compactPath,
          compactToByte: source === 'compact' ? byteOffset : this.committedCompactBytes,
          idempotencyKey: record.idempotencyKey,
        }) !== undefined)
    ) {
      throw new Error(`duplicate event idempotency key: ${record.idempotencyKey}`);
    }
    this.bloom.add(record.idempotencyKey);
    this.recordCount += 1;
    if (source === 'legacy') {
      this.legacyRecordCount += 1;
    } else {
      this.compactRecordCount += 1;
    }
    this.recentRecords.push(record);
    this.recentRecordByKey.set(record.idempotencyKey, record);
    while (this.recentRecords.length > this.recentLimit) {
      const evicted = this.recentRecords.shift()!;
      if (this.recentRecordByKey.get(evicted.idempotencyKey) === evicted) {
        this.recentRecordByKey.delete(evicted.idempotencyKey);
      }
    }
  }

  private reset(): void {
    this.committedLegacyBytes = 0;
    this.committedCompactBytes = 0;
    this.recordCount = 0;
    this.legacyRecordCount = 0;
    this.compactRecordCount = 0;
    this.bloom = this.createBloom();
    this.legacySignature = undefined;
    this.compactSignature = undefined;
    this.recentRecords.splice(0);
    this.recentRecordByKey.clear();
  }

  private compactSingleWriterIfNeeded(): void {
    if (this.committedCompactBytes < this.nextCompactionByteLength) {
      return;
    }
    const temporaryPath = `${this.compactPath}.compacting`;
    if (existsSync(temporaryPath)) {
      throw new Error(`event idempotency compaction staging file already exists: ${temporaryPath}`);
    }
    writeFileSync(temporaryPath, '', { flag: 'wx' });
    let batch: StoredCompactIdempotencyRecord[] = [];
    let sourceRecordCount = 0;
    try {
      const flush = () => {
        if (batch.length === 0) {
          return;
        }
        appendDeflatedJsonLinesFrame(temporaryPath, batch);
        batch = [];
      };
      const scan = scanCompactIdempotencyRecords({
        path: this.compactPath,
        fromByte: 0,
        toByte: this.committedCompactBytes,
        onRecord: (record) => {
          assertValidStoredIdempotencyRecord(record, this.compactPath);
          batch.push(record);
          sourceRecordCount += 1;
          if (batch.length === FILE_EVENT_STORE_IDEMPOTENCY_COMPACTION_FRAME_RECORD_LIMIT) {
            flush();
          }
        },
      });
      flush();
      if (scan.consumedBytes !== this.committedCompactBytes) {
        throw new Error('event idempotency compaction did not consume the complete source');
      }
      let compactedRecordCount = 0;
      const compactedSize = statSync(temporaryPath).size;
      const validation = scanCompactIdempotencyRecords({
        path: temporaryPath,
        fromByte: 0,
        toByte: compactedSize,
        onRecord: (record) => {
          assertValidStoredIdempotencyRecord(record, temporaryPath);
          compactedRecordCount += 1;
        },
      });
      if (
        validation.consumedBytes !== compactedSize ||
        compactedRecordCount !== sourceRecordCount
      ) {
        throw new Error('event idempotency compaction validation count mismatch');
      }
      renameSync(temporaryPath, this.compactPath);
      this.refresh();
      this.nextCompactionByteLength = this.committedCompactBytes + this.compactionIncrementBytes;
    } catch (error) {
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath);
      }
      throw error;
    }
  }

  private createBloom(): FixedBloomFilter {
    return new FixedBloomFilter({
      bitCount: this.bloomBitCount,
      hashCount: FILE_EVENT_STORE_IDEMPOTENCY_BLOOM_HASH_COUNT,
    });
  }
}

type JsonLinesFileSignature = {
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedAtMs: number;
  readonly changedAtMs: number;
};

type SequencedByteCheckpoint = { readonly sequence: number; readonly byteOffset: number };

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
  previous: JsonLinesFileSignature | undefined,
  next: JsonLinesFileSignature,
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

function findIdempotencyRecord<TEvent extends EventEnvelope>(input: {
  readonly legacyPath: string;
  readonly legacyToByte: number;
  readonly compactPath: string;
  readonly compactToByte: number;
  readonly idempotencyKey: string;
}): StoredIdempotencyRecord<TEvent> | undefined {
  let match: StoredIdempotencyRecord<TEvent> | undefined;
  scanJsonLines<StoredLegacyIdempotencyRecord<TEvent>>({
    path: input.legacyPath,
    fromByte: 0,
    toByte: input.legacyToByte,
    onRecord: (record) => {
      if (record.idempotencyKey === input.idempotencyKey) {
        match = record;
        return false;
      }
      return true;
    },
  });
  if (match === undefined) {
    scanCompactIdempotencyRecords({
      path: input.compactPath,
      fromByte: 0,
      toByte: input.compactToByte,
      onRecord: (record) => {
        if (record.idempotencyKey === input.idempotencyKey) {
          match = record;
          return false;
        }
        return true;
      },
    });
  }
  return match;
}

function createCompactIdempotencyRecord(
  input: Omit<StoredCompactIdempotencyRecord, 'recordSha256'>,
): StoredCompactIdempotencyRecord {
  return {
    ...input,
    recordSha256: sha256(JSON.stringify(input)),
  };
}

function appendCompactIdempotencyRecord(
  path: string,
  record: StoredCompactIdempotencyRecord,
): void {
  const compressed = deflateRawSync(Buffer.from(JSON.stringify(record), 'utf8'), { level: 6 });
  if (compressed.byteLength > 0xffff_ffff) {
    throw new Error('compact event idempotency frame exceeds uint32 length');
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(compressed.byteLength, 0);
  appendFileSync(path, Buffer.concat([header, compressed]));
}

function scanCompactIdempotencyRecords(input: {
  readonly path: string;
  readonly fromByte: number;
  readonly toByte: number;
  readonly onRecord: (record: StoredCompactIdempotencyRecord, byteOffset: number) => boolean | void;
}): { readonly consumedBytes: number } {
  if (input.toByte <= input.fromByte) {
    return { consumedBytes: 0 };
  }
  const file = openSync(input.path, 'r');
  let position = input.fromByte;
  try {
    while (position < input.toByte) {
      const frameOffset = position;
      if (input.toByte - position < 4) {
        throw new Error(
          `compact event idempotency index has an incomplete frame header: ${input.path}`,
        );
      }
      const header = Buffer.allocUnsafe(4);
      readExact(file, header, position, input.path);
      position += 4;
      const compressedByteLength = header.readUInt32BE(0);
      if (compressedByteLength === 0 || compressedByteLength > input.toByte - position) {
        throw new Error(
          `compact event idempotency index has an incomplete frame payload: ${input.path}`,
        );
      }
      const compressed = Buffer.allocUnsafe(compressedByteLength);
      readExact(file, compressed, position, input.path);
      position += compressedByteLength;
      let records: readonly StoredCompactIdempotencyRecord[];
      try {
        const payload = inflateRawSync(compressed).toString('utf8');
        if (payload.endsWith('\n')) {
          const lines = payload.split('\n');
          lines.pop();
          if (lines.length === 0) {
            throw new Error('compacted idempotency frame is empty');
          }
          records = lines.map((line) => JSON.parse(line) as StoredCompactIdempotencyRecord);
        } else {
          records = [JSON.parse(payload) as StoredCompactIdempotencyRecord];
        }
      } catch (error) {
        throw new Error(
          `compact event idempotency index contains an invalid frame: ${input.path}`,
          {
            cause: error,
          },
        );
      }
      for (const record of records) {
        if (input.onRecord(record, frameOffset) === false) {
          return { consumedBytes: position - input.fromByte };
        }
      }
    }
    return { consumedBytes: position - input.fromByte };
  } finally {
    closeSync(file);
  }
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
      throw new Error(`compact event idempotency index is truncated: ${path}`);
    }
    bytesRead += count;
  }
}

function assertValidStoredIdempotencyRecord(
  record: StoredIdempotencyRecord<EventEnvelope>,
  path: string,
): void {
  if (
    typeof record.idempotencyKey !== 'string' ||
    record.idempotencyKey.length === 0 ||
    typeof record.streamName !== 'string' ||
    record.streamName.length === 0 ||
    (record.expectedVersion !== undefined &&
      (!Number.isSafeInteger(record.expectedVersion) || record.expectedVersion < 0)) ||
    !Number.isSafeInteger(record.streamVersion) ||
    record.streamVersion < 1
  ) {
    throw new Error(`event idempotency record is invalid: ${path}`);
  }
  if (isCompactIdempotencyRecord(record)) {
    const { recordSha256, ...unsigned } = record;
    if (
      record.schemaVersion !== FILE_EVENT_IDEMPOTENCY_RECORD_SCHEMA_VERSION ||
      !/^[a-f0-9]{64}$/u.test(record.eventFingerprintSha256) ||
      !Number.isSafeInteger(record.firstSequence) ||
      record.firstSequence < 1 ||
      !Number.isSafeInteger(record.eventCount) ||
      record.eventCount < 1 ||
      record.streamVersion !== record.firstSequence + record.eventCount - 1 ||
      !/^[a-f0-9]{64}$/u.test(recordSha256) ||
      sha256(JSON.stringify(unsigned)) !== recordSha256
    ) {
      throw new Error(`compact event idempotency record is invalid: ${path}`);
    }
    return;
  }
  if (typeof record.eventFingerprint !== 'string' || !Array.isArray(record.appendedEvents)) {
    throw new Error(`legacy event idempotency record is invalid: ${path}`);
  }
}

function isCompactIdempotencyRecord<TEvent extends EventEnvelope>(
  record: StoredIdempotencyRecord<TEvent>,
): record is StoredCompactIdempotencyRecord {
  return 'schemaVersion' in record;
}

function compactRecordFromLegacy(input: {
  readonly record: StoredLegacyIdempotencyRecord<EventEnvelope>;
  readonly streamsDir: string;
  readonly streamFiles: Map<EventStreamName, IndexedEventStreamFile<EventEnvelope>>;
}): StoredCompactIdempotencyRecord {
  const { record } = input;
  assertNonEmptyBatch(record.appendedEvents);
  if (
    record.eventFingerprint !== fingerprintEvents(record.appendedEvents) ||
    record.appendedEvents.some(
      (event, index) => event.sequence !== record.appendedEvents[0]!.sequence + index,
    ) ||
    record.appendedEvents.at(-1)!.sequence !== record.streamVersion ||
    (record.expectedVersion !== undefined &&
      record.expectedVersion + record.appendedEvents.length !== record.streamVersion)
  ) {
    throw new Error(`legacy event idempotency record is inconsistent: ${record.idempotencyKey}`);
  }
  const firstSequence = record.appendedEvents[0]!.sequence;
  const authoritativeEvents = migrationStreamFile({
    streamName: record.streamName,
    streamsDir: input.streamsDir,
    streamFiles: input.streamFiles,
  }).read({ afterSequence: firstSequence - 1, limit: record.appendedEvents.length });
  if (
    authoritativeEvents.length !== record.appendedEvents.length ||
    fingerprintEvents(authoritativeEvents) !== record.eventFingerprint
  ) {
    throw new Error(
      `legacy event idempotency record does not match authoritative stream: ${record.idempotencyKey}`,
    );
  }
  return createCompactIdempotencyRecord({
    schemaVersion: FILE_EVENT_IDEMPOTENCY_RECORD_SCHEMA_VERSION,
    idempotencyKey: record.idempotencyKey,
    streamName: record.streamName,
    ...(record.expectedVersion === undefined ? {} : { expectedVersion: record.expectedVersion }),
    eventFingerprintSha256: fingerprintEventsSha256(authoritativeEvents),
    firstSequence,
    eventCount: authoritativeEvents.length,
    streamVersion: record.streamVersion,
  });
}

function validateCompactIdempotencyFile(input: {
  readonly compactPath: string;
  readonly streamsDir: string;
}): number {
  const size = statSync(input.compactPath).size;
  const seenKeys = new Set<string>();
  const streamFiles = new Map<EventStreamName, IndexedEventStreamFile<EventEnvelope>>();
  let recordCount = 0;
  const scan = scanCompactIdempotencyRecords({
    path: input.compactPath,
    fromByte: 0,
    toByte: size,
    onRecord: (record) => {
      assertValidStoredIdempotencyRecord(record, input.compactPath);
      if (seenKeys.has(record.idempotencyKey)) {
        throw new Error(`duplicate compact event idempotency key: ${record.idempotencyKey}`);
      }
      seenKeys.add(record.idempotencyKey);
      const authoritativeEvents = migrationStreamFile({
        streamName: record.streamName,
        streamsDir: input.streamsDir,
        streamFiles,
      }).read({ afterSequence: record.firstSequence - 1, limit: record.eventCount });
      if (
        authoritativeEvents.length !== record.eventCount ||
        authoritativeEvents.at(-1)?.sequence !== record.streamVersion ||
        fingerprintEventsSha256(authoritativeEvents) !== record.eventFingerprintSha256
      ) {
        throw new Error(
          `compact event idempotency record does not match authoritative stream: ${record.idempotencyKey}`,
        );
      }
      recordCount += 1;
    },
  });
  if (scan.consumedBytes !== size) {
    throw new Error(
      `compact event idempotency file has an incomplete trailing frame: ${input.compactPath}`,
    );
  }
  return recordCount;
}

function migrationStreamFile(input: {
  readonly streamName: EventStreamName;
  readonly streamsDir: string;
  readonly streamFiles: Map<EventStreamName, IndexedEventStreamFile<EventEnvelope>>;
}): IndexedEventStreamFile<EventEnvelope> {
  const existing = input.streamFiles.get(input.streamName);
  if (existing !== undefined) {
    return existing;
  }
  const path = join(input.streamsDir, `${encodeURIComponent(input.streamName)}.jsonl`);
  const compactPath = join(
    input.streamsDir,
    `${encodeURIComponent(input.streamName)}${FILE_EVENT_STREAM_COMPACT_SUFFIX}`,
  );
  if (!existsSync(path)) {
    throw new Error(`event stream referenced by idempotency record is missing: ${path}`);
  }
  if (!existsSync(compactPath)) {
    writeFileSync(compactPath, '');
  }
  const created = new IndexedEventStreamFile<EventEnvelope>({
    path,
    compactPath,
    writerFormat: 'compact-deflate-frames-v1',
    recentLimit: FILE_EVENT_STORE_RECENT_EVENT_LIMIT,
    sparseCheckpointInterval: 64,
    maxSparseCheckpointCount: 1_000_000,
  });
  input.streamFiles.set(input.streamName, created);
  return created;
}

function appendCompactEventBatch<TEvent extends EventEnvelope>(
  path: string,
  events: readonly TEvent[],
): void {
  assertNonEmptyBatch(events);
  appendDeflatedJsonLinesFrame(path, events);
}

function scanCompactEventBatches<TEvent extends EventEnvelope>(input: {
  readonly path: string;
  readonly fromByte: number;
  readonly toByte: number;
  readonly onBatch: (events: readonly TEvent[], byteOffset: number) => boolean | void;
}): { readonly consumedBytes: number; readonly frameCount: number } {
  return scanDeflatedJsonLinesFrames<TEvent>({
    path: input.path,
    fromByte: input.fromByte,
    toByte: input.toByte,
    onFrame: input.onBatch,
  });
}

function scanJsonLines<TValue>(input: {
  readonly path: string;
  readonly fromByte: number;
  readonly toByte: number;
  readonly onRecord: (value: TValue, byteOffset: number) => boolean | void;
}): { readonly consumedBytes: number } {
  if (input.toByte <= input.fromByte) {
    return { consumedBytes: 0 };
  }
  const file = openSync(input.path, 'r');
  const chunkSize = 64 * 1024;
  let position = input.fromByte;
  let pending = Buffer.alloc(0);
  let pendingOffset = input.fromByte;
  try {
    while (position < input.toByte) {
      const chunk = Buffer.allocUnsafe(Math.min(chunkSize, input.toByte - position));
      const bytesRead = readSync(file, chunk, 0, chunk.byteLength, position);
      if (bytesRead === 0) {
        break;
      }
      const combined =
        pending.length === 0
          ? chunk.subarray(0, bytesRead)
          : Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
      const combinedOffset = pendingOffset;
      let lineStart = 0;
      for (
        let newline = combined.indexOf(0x0a);
        newline >= 0;
        newline = combined.indexOf(0x0a, lineStart)
      ) {
        const line = combined.subarray(lineStart, newline);
        if (line.length > 0) {
          const shouldContinue = input.onRecord(
            JSON.parse(line.toString('utf8')) as TValue,
            combinedOffset + lineStart,
          );
          if (shouldContinue === false) {
            return { consumedBytes: combinedOffset + newline + 1 - input.fromByte };
          }
        }
        lineStart = newline + 1;
      }
      pending = combined.subarray(lineStart);
      pendingOffset = combinedOffset + lineStart;
      position += bytesRead;
    }
    return { consumedBytes: pendingOffset - input.fromByte };
  } finally {
    closeSync(file);
  }
}

function appendJsonLines(path: string, values: readonly unknown[]): void {
  if (values.length === 0) {
    return;
  }
  appendFileSync(path, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
}

function rewriteJsonLinesExactString(input: {
  readonly path: string;
  readonly target: string;
  readonly replacement: string;
  readonly finalize?: (value: unknown) => unknown;
}): { readonly recordCount: number; readonly replacementCount: number } {
  const size = statSync(input.path).size;
  const temporaryPath = `${input.path}.redacting`;
  if (existsSync(temporaryPath)) {
    throw new Error(`JSONL redaction staging file already exists: ${temporaryPath}`);
  }
  writeFileSync(temporaryPath, '', { flag: 'wx' });
  let recordCount = 0;
  let replacementCount = 0;
  try {
    const scan = scanJsonLines<unknown>({
      path: input.path,
      fromByte: 0,
      toByte: size,
      onRecord: (value) => {
        const redacted = redactExactStringValue(value, input.target, input.replacement);
        appendJsonLines(temporaryPath, [
          input.finalize === undefined ? redacted.value : input.finalize(redacted.value),
        ]);
        recordCount += 1;
        replacementCount += redacted.replacementCount;
      },
    });
    if (scan.consumedBytes !== size) {
      throw new Error(`JSONL redaction encountered an incomplete trailing row: ${input.path}`);
    }
    renameSync(temporaryPath, input.path);
  } catch (error) {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
    throw error;
  }
  return { recordCount, replacementCount };
}

function rewriteCompactEventFramesExactString(input: {
  readonly path: string;
  readonly target: string;
  readonly replacement: string;
}): { readonly recordCount: number; readonly replacementCount: number } {
  const size = statSync(input.path).size;
  const temporaryPath = `${input.path}.redacting`;
  if (existsSync(temporaryPath)) {
    throw new Error(`compact event redaction staging file already exists: ${temporaryPath}`);
  }
  writeFileSync(temporaryPath, '', { flag: 'wx' });
  let recordCount = 0;
  let replacementCount = 0;
  try {
    const scan = scanCompactEventBatches<EventEnvelope>({
      path: input.path,
      fromByte: 0,
      toByte: size,
      onBatch: (events) => {
        const rewritten = events.map((event) => {
          const redacted = redactExactStringValue(event, input.target, input.replacement);
          recordCount += 1;
          replacementCount += redacted.replacementCount;
          return redacted.value as EventEnvelope;
        });
        appendCompactEventBatch(temporaryPath, rewritten);
      },
    });
    if (scan.consumedBytes !== size) {
      throw new Error(`compact event redaction encountered an incomplete frame: ${input.path}`);
    }
    renameSync(temporaryPath, input.path);
  } catch (error) {
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
    throw error;
  }
  return { recordCount, replacementCount };
}

function redactExactStringValue(
  value: unknown,
  target: string,
  replacement: string,
): { readonly value: unknown; readonly replacementCount: number } {
  if (typeof value === 'string') {
    return value === target
      ? { value: replacement, replacementCount: 1 }
      : { value, replacementCount: 0 };
  }
  if (Array.isArray(value)) {
    let replacementCount = 0;
    const redacted = value.map((entry) => {
      const result = redactExactStringValue(entry, target, replacement);
      replacementCount += result.replacementCount;
      return result.value;
    });
    return { value: redacted, replacementCount };
  }
  if (value !== null && typeof value === 'object') {
    let replacementCount = 0;
    const redacted = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        const result = redactExactStringValue(entry, target, replacement);
        replacementCount += result.replacementCount;
        return [key, result.value];
      }),
    );
    return { value: redacted, replacementCount };
  }
  return { value, replacementCount: 0 };
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

function assertNonEmptyBatch(events: readonly EventEnvelope[]): void {
  if (events.length === 0) {
    throw new Error('event batch must contain at least one event');
  }
}

function parsePendingAppend<TEvent extends EventEnvelope>(
  value: unknown,
  source: string,
): AppendToEventStreamRequest<TEvent> & { readonly idempotencyKey: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid pending event append in ${source}`);
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 'file-event-pending-append-v1' ||
    typeof record.streamName !== 'string' ||
    record.streamName.trim().length === 0 ||
    typeof record.idempotencyKey !== 'string' ||
    record.idempotencyKey.trim().length === 0 ||
    !Array.isArray(record.events) ||
    record.events.length === 0
  ) {
    throw new Error(`invalid pending event append in ${source}`);
  }
  if (
    record.expectedVersion !== undefined &&
    (!Number.isSafeInteger(record.expectedVersion) || (record.expectedVersion as number) < 0)
  ) {
    throw new Error(`invalid pending event append expectedVersion in ${source}`);
  }
  for (const event of record.events) {
    if (
      event === null ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      !Number.isSafeInteger((event as Record<string, unknown>).sequence) ||
      ((event as Record<string, unknown>).sequence as number) < 1
    ) {
      throw new Error(`invalid pending event append event in ${source}`);
    }
  }
  return {
    streamName: record.streamName,
    ...(record.expectedVersion === undefined
      ? {}
      : { expectedVersion: record.expectedVersion as number }),
    idempotencyKey: record.idempotencyKey,
    events: record.events,
  };
}

function validateReadOptions(options: EventStreamReadOptions): void {
  if (
    options.afterSequence !== undefined &&
    (!Number.isInteger(options.afterSequence) || options.afterSequence < 0)
  ) {
    throw new Error('afterSequence must be a non-negative integer');
  }

  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error('limit must be a positive integer');
  }
}

function fingerprintEvents(events: readonly EventEnvelope[]): string {
  return JSON.stringify(events);
}

function fingerprintEventsSha256(events: readonly EventEnvelope[]): string {
  return sha256(fingerprintEvents(events));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
