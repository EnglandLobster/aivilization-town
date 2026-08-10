import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileEventStore,
  FILE_EVENT_PENDING_APPEND_PATH,
  createEventEnvelope,
  createSimulationPartition,
  migrateFileEventStoreIdempotencyV1ToV2,
  redactFileEventStoreExactString,
  type EventEnvelope,
} from './index';

const partition = createSimulationPartition({
  simulationId: 'sim-1',
  partitionKey: 'world-main',
});

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-file-event-store-'));
  tmpRoots.push(root);
  return root;
}

function timeAdvancedEvent(input: {
  readonly id: string;
  readonly sequence: number;
  readonly now: number;
}): EventEnvelope<'SimulationTimeAdvanced', { readonly now: number }> {
  return createEventEnvelope({
    id: input.id,
    simulationId: 'sim-1',
    partitionKey: partition.partitionKey,
    commandId: `cmd-${input.sequence}`,
    type: 'SimulationTimeAdvanced',
    payload: { now: input.now },
    occurredAt: input.now,
    sequence: input.sequence,
  });
}

describe('FileEventStore', () => {
  test('rolls forward an event append interrupted between stream and idempotency writes', () => {
    const rootDir = createRootDir();
    const store = new FileEventStore({
      rootDir,
      eventStreamWriterFormat: 'legacy-jsonl-v1',
    });
    store.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    });
    const interruptedRequest = {
      streamName: partition.eventStreamName,
      expectedVersion: 1,
      idempotencyKey: 'append-2',
      events: [timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 })],
    } as const;
    writeFileSync(
      join(rootDir, FILE_EVENT_PENDING_APPEND_PATH),
      `${JSON.stringify({
        schemaVersion: 'file-event-pending-append-v1',
        ...interruptedRequest,
      })}\n`,
    );
    appendFileSync(
      join(rootDir, 'streams', `${encodeURIComponent(partition.eventStreamName)}.jsonl`),
      `${JSON.stringify(interruptedRequest.events[0])}\n`,
    );

    const recovered = new FileEventStore({ rootDir });

    expect(recovered.getStreamVersion(partition.eventStreamName)).toBe(2);
    expect(recovered.appendToStream(interruptedRequest)).toMatchObject({
      streamVersion: 2,
      idempotentReplay: true,
      appendedEvents: [{ id: 'evt-2', sequence: 2 }],
    });
    expect(existsSync(join(rootDir, FILE_EVENT_PENDING_APPEND_PATH))).toBe(false);
  });

  test('persists appended events and stream versions across store instances', () => {
    const rootDir = createRootDir();
    const firstStore = new FileEventStore({ rootDir });
    firstStore.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    });

    const secondStore = new FileEventStore({ rootDir });
    const secondAppend = secondStore.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 1,
      idempotencyKey: 'append-2',
      events: [timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 })],
    });

    expect(secondAppend.streamVersion).toBe(2);
    expect(secondStore.getStreamVersion(partition.eventStreamName)).toBe(2);
    expect(secondStore.readStream(partition.eventStreamName).map((event) => event.id)).toEqual([
      'evt-1',
      'evt-2',
    ]);
  });

  test('union-reads a legacy JSONL prefix and compact event-frame tail', () => {
    const rootDir = createRootDir();
    const legacyStore = new FileEventStore({
      rootDir,
      eventStreamWriterFormat: 'legacy-jsonl-v1',
    });
    legacyStore.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'legacy-prefix',
      events: [
        timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 }),
        timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 }),
      ],
    });

    const upgraded = new FileEventStore({ rootDir });
    upgraded.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 2,
      idempotencyKey: 'compact-tail',
      events: [timeAdvancedEvent({ id: 'evt-3', sequence: 3, now: 3000 })],
    });

    expect(upgraded.readStream(partition.eventStreamName).map((event) => event.id)).toEqual([
      'evt-1',
      'evt-2',
      'evt-3',
    ]);
    expect(
      upgraded.getRuntimeIndexDiagnostics(partition.eventStreamName).eventStream,
    ).toMatchObject({
      legacyRecordCount: 2,
      compactRecordCount: 1,
      compactFrameCount: 1,
      writerFormat: 'compact-deflate-frames-v1',
    });
  });

  test('compresses event batches and fails closed on an incomplete compact frame', () => {
    const rootDir = createRootDir();
    const store = new FileEventStore({ rootDir });
    const events = Array.from({ length: 100 }, (_, index) =>
      timeAdvancedEvent({
        id: `evt-${index + 1}`,
        sequence: index + 1,
        now: (index + 1) * 1000,
      }),
    );
    store.appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'compressed-batch',
      events,
    });
    const diagnostics = store.getRuntimeIndexDiagnostics(partition.eventStreamName).eventStream;
    expect(diagnostics.compactByteLength).toBeLessThan(
      Buffer.byteLength(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`),
    );

    const compactPath = join(
      rootDir,
      'streams',
      `${encodeURIComponent(partition.eventStreamName)}.deflate`,
    );
    writeFileSync(compactPath, Buffer.from([0, 0, 0]));
    expect(() =>
      new FileEventStore({ rootDir }).getStreamVersion(partition.eventStreamName),
    ).toThrow('incomplete frame header');
  });

  test('replays persisted idempotency records after restart without duplicating events', () => {
    const rootDir = createRootDir();
    const request = {
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    } as const;

    new FileEventStore({ rootDir }).appendToStream(request);
    const restartedStore = new FileEventStore({ rootDir });
    const replay = restartedStore.appendToStream(request);

    expect(replay).toEqual({
      appendedEvents: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
      streamVersion: 1,
      idempotentReplay: true,
    });
    expect(restartedStore.readStream(partition.eventStreamName)).toHaveLength(1);
    expect(readFileSync(join(rootDir, 'idempotency.jsonl'), 'utf8')).toBe('');
    expect(statSync(join(rootDir, 'idempotency.deflate')).size).toBeGreaterThan(0);
  });

  test('atomically repacks idempotency records into compact batches without losing exact replay', () => {
    const compactedRoot = createRootDir();
    const unbatchedRoot = createRootDir();
    const compacted = new FileEventStore({
      rootDir: compactedRoot,
      idempotencyCompactionIncrementBytes: 1,
    });
    const unbatched = new FileEventStore({
      rootDir: unbatchedRoot,
      idempotencyCompactionIncrementBytes: Number.MAX_SAFE_INTEGER,
    });
    const requests = Array.from({ length: 12 }, (_, index) => ({
      streamName: partition.eventStreamName,
      expectedVersion: index,
      idempotencyKey: `compact-idempotency-${index + 1}`,
      events: [
        timeAdvancedEvent({
          id: `compact-event-${index + 1}`,
          sequence: index + 1,
          now: (index + 1) * 1000,
        }),
      ],
    }));
    for (const request of requests) {
      compacted.appendToStream(request);
      unbatched.appendToStream(request);
    }

    expect(statSync(join(compactedRoot, 'idempotency.deflate')).size).toBeLessThan(
      statSync(join(unbatchedRoot, 'idempotency.deflate')).size,
    );
    const restarted = new FileEventStore({ rootDir: compactedRoot });
    expect(restarted.appendToStream(requests[0]!)).toMatchObject({ idempotentReplay: true });
    expect(restarted.appendToStream(requests.at(-1)!)).toMatchObject({
      idempotentReplay: true,
      streamVersion: 12,
    });
    expect(
      restarted.getRuntimeIndexDiagnostics(partition.eventStreamName).idempotency,
    ).toMatchObject({ recordCount: 12, compactRecordCount: 12 });
  });

  test('redacts offline event identity and rebuilds compact idempotency integrity', () => {
    const rootDir = createRootDir();
    const originalEvent = createEventEnvelope({
      id: 'evt-participant-registration',
      simulationId: 'sim-1',
      partitionKey: partition.partitionKey,
      commandId: 'cmd-participant-registration',
      type: 'AgentRegistered',
      payload: {
        agentId: 'agent-1',
        creatorId: 'participant-7',
        humanAttribution: {
          principalSubjectId: 'participant-7',
          principalRoles: ['participant'],
        },
      },
      occurredAt: 1_000,
      sequence: 1,
    });
    new FileEventStore({ rootDir }).appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'register-agent-1',
      events: [originalEvent],
    });

    const result = redactFileEventStoreExactString({
      rootDir,
      target: 'participant-7',
      replacement: 'deleted-participant:1',
    });

    expect(result).toMatchObject({
      policyVersion: 'file-event-store-exact-string-redaction-v1',
      streamFileCount: 1,
      streamRecordCount: 1,
      replacementCount: 2,
      compactIdempotencyRecordCount: 1,
    });
    const redactedEvent = createEventEnvelope({
      ...originalEvent,
      payload: {
        ...originalEvent.payload,
        creatorId: 'deleted-participant:1',
        humanAttribution: {
          ...originalEvent.payload.humanAttribution,
          principalSubjectId: 'deleted-participant:1',
        },
      },
    });
    const restarted = new FileEventStore({ rootDir });
    expect(
      restarted.appendToStream({
        streamName: partition.eventStreamName,
        expectedVersion: 0,
        idempotencyKey: 'register-agent-1',
        events: [redactedEvent],
      }),
    ).toMatchObject({ idempotentReplay: true, streamVersion: 1 });
    expect(JSON.stringify(restarted.readStream(partition.eventStreamName))).not.toContain(
      'participant-7',
    );
  });

  test('migrates legacy inline idempotency to compact event references idempotently', () => {
    const rootDir = createRootDir();
    const request = {
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'legacy-append-1',
      events: [timeAdvancedEvent({ id: 'evt-legacy-1', sequence: 1, now: 1000 })],
    } as const;
    new FileEventStore({ rootDir }).appendToStream(request);
    writeFileSync(join(rootDir, 'idempotency.deflate'), '');
    const legacyRecord = {
      idempotencyKey: request.idempotencyKey,
      streamName: request.streamName,
      expectedVersion: request.expectedVersion,
      eventFingerprint: JSON.stringify(request.events),
      appendedEvents: request.events,
      streamVersion: 1,
    };
    const legacySerialized = `${JSON.stringify(legacyRecord)}\n`;
    writeFileSync(join(rootDir, 'idempotency.jsonl'), legacySerialized, 'utf8');

    const migrated = migrateFileEventStoreIdempotencyV1ToV2({ rootDir });
    expect(migrated).toMatchObject({
      schemaVersion: 'file-event-idempotency-migration-v1',
      status: 'migrated',
      recordCount: 1,
      legacyByteLength: Buffer.byteLength(legacySerialized),
    });
    expect(readFileSync(join(rootDir, 'idempotency.jsonl'), 'utf8')).toBe('');
    expect(migrated.compactByteLength).toBeLessThan(Buffer.byteLength(legacySerialized));
    expect(new FileEventStore({ rootDir }).appendToStream(request)).toMatchObject({
      idempotentReplay: true,
      streamVersion: 1,
      appendedEvents: [{ id: 'evt-legacy-1' }],
    });

    expect(migrateFileEventStoreIdempotencyV1ToV2({ rootDir })).toEqual({
      ...migrated,
      status: 'already-v2',
      legacyByteLength: 0,
    });
  });

  test('rejects migration when legacy idempotency disagrees with the authoritative stream', () => {
    const rootDir = createRootDir();
    const request = {
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'legacy-mismatch',
      events: [timeAdvancedEvent({ id: 'evt-authoritative', sequence: 1, now: 1000 })],
    } as const;
    new FileEventStore({ rootDir }).appendToStream(request);
    writeFileSync(join(rootDir, 'idempotency.deflate'), '');
    const mismatchedEvents = [timeAdvancedEvent({ id: 'evt-forged', sequence: 1, now: 1000 })];
    const legacySerialized = `${JSON.stringify({
      idempotencyKey: request.idempotencyKey,
      streamName: request.streamName,
      expectedVersion: 0,
      eventFingerprint: JSON.stringify(mismatchedEvents),
      appendedEvents: mismatchedEvents,
      streamVersion: 1,
    })}\n`;
    writeFileSync(join(rootDir, 'idempotency.jsonl'), legacySerialized, 'utf8');

    expect(() => migrateFileEventStoreIdempotencyV1ToV2({ rootDir })).toThrow(
      'does not match authoritative stream',
    );
    expect(readFileSync(join(rootDir, 'idempotency.jsonl'), 'utf8')).toBe(legacySerialized);
    expect(readFileSync(join(rootDir, 'idempotency.deflate')).byteLength).toBe(0);
  });

  test('rejects persisted idempotency key reuse for a different event batch', () => {
    const rootDir = createRootDir();
    new FileEventStore({ rootDir }).appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    });

    const restartedStore = new FileEventStore({ rootDir });
    expect(() =>
      restartedStore.appendToStream({
        streamName: partition.eventStreamName,
        expectedVersion: 1,
        idempotencyKey: 'append-1',
        events: [timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 })],
      }),
    ).toThrow('idempotency key append-1 was already used for a different append request');
  });

  test('rejects an incomplete legacy idempotency row before appending new events', () => {
    const rootDir = createRootDir();
    const store = new FileEventStore({ rootDir });
    writeFileSync(join(rootDir, 'idempotency.jsonl'), '{"idempotencyKey":"partial"', 'utf8');

    expect(() =>
      store.appendToStream({
        streamName: partition.eventStreamName,
        expectedVersion: 0,
        idempotencyKey: 'append-after-partial',
        events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
      }),
    ).toThrow('incomplete legacy event idempotency JSONL record');
    expect(store.readStream(partition.eventStreamName)).toEqual([]);
  });

  test('preserves read windows after restart', () => {
    const rootDir = createRootDir();
    new FileEventStore({ rootDir }).appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [
        timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 }),
        timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 }),
        timeAdvancedEvent({ id: 'evt-3', sequence: 3, now: 3000 }),
      ],
    });

    const restartedStore = new FileEventStore({ rootDir });
    expect(
      restartedStore
        .readStream(partition.eventStreamName, { afterSequence: 1, limit: 1 })
        .map((event) => event.id),
    ).toEqual(['evt-2']);
  });

  test('bounds runtime projections while preserving cold event reads and idempotent replay', () => {
    const rootDir = createRootDir();
    const store = new FileEventStore({
      rootDir,
      recentEventLimit: 2,
      sparseCheckpointInterval: 2,
      maxSparseCheckpointCount: 2,
      recentIdempotencyLimit: 2,
      idempotencyBloomBitCount: 8,
    });
    const requests = Array.from({ length: 6 }, (_, index) => ({
      streamName: partition.eventStreamName,
      expectedVersion: index,
      idempotencyKey: `append-${index + 1}`,
      events: [
        timeAdvancedEvent({
          id: `evt-${index + 1}`,
          sequence: index + 1,
          now: (index + 1) * 1000,
        }),
      ],
    }));
    for (const request of requests) {
      store.appendToStream(request);
    }

    const diagnostics = store.getRuntimeIndexDiagnostics(partition.eventStreamName);
    expect(diagnostics).toMatchObject({
      eventStream: {
        recordCount: 6,
        recentEventCount: 2,
        recentEventLimit: 2,
        sparseCheckpointCount: 2,
        sparseCheckpointInterval: 2,
        maxSparseCheckpointCount: 2,
      },
      idempotency: {
        recordCount: 6,
        legacyRecordCount: 0,
        compactRecordCount: 6,
        recentRecordCount: 2,
        recentRecordLimit: 2,
        bloomBitCount: 8,
        bloomByteLength: 1,
      },
    });
    expect(diagnostics.idempotency.compactByteLength).toBeGreaterThan(0);
    expect(
      store
        .readStream(partition.eventStreamName, { afterSequence: 0, limit: 3 })
        .map((event) => event.id),
    ).toEqual(['evt-1', 'evt-2', 'evt-3']);
    expect(
      store.readStream(partition.eventStreamName, { afterSequence: 2 }).map((event) => event.id),
    ).toEqual(['evt-3', 'evt-4', 'evt-5', 'evt-6']);
    expect(store.appendToStream(requests[0]!)).toMatchObject({
      streamVersion: 1,
      idempotentReplay: true,
      appendedEvents: [{ id: 'evt-1', sequence: 1 }],
    });
    expect(store.getStreamVersion(partition.eventStreamName)).toBe(6);

    const restarted = new FileEventStore({
      rootDir,
      recentEventLimit: 2,
      sparseCheckpointInterval: 2,
      maxSparseCheckpointCount: 2,
      recentIdempotencyLimit: 2,
      idempotencyBloomBitCount: 8,
    });
    expect(restarted.getRuntimeIndexDiagnostics(partition.eventStreamName)).toMatchObject({
      eventStream: { recordCount: 6, recentEventCount: 2, sparseCheckpointCount: 2 },
      idempotency: { recordCount: 6, recentRecordCount: 2 },
    });
    expect(restarted.readStream(partition.eventStreamName).map((event) => event.id)).toEqual([
      'evt-1',
      'evt-2',
      'evt-3',
      'evt-4',
      'evt-5',
      'evt-6',
    ]);
  });

  test('rejects stale expected versions and event sequence gaps using persisted streams', () => {
    const rootDir = createRootDir();
    new FileEventStore({ rootDir }).appendToStream({
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-1',
      events: [timeAdvancedEvent({ id: 'evt-1', sequence: 1, now: 1000 })],
    });
    const restartedStore = new FileEventStore({ rootDir });

    expect(() =>
      restartedStore.appendToStream({
        streamName: partition.eventStreamName,
        expectedVersion: 0,
        idempotencyKey: 'append-stale',
        events: [timeAdvancedEvent({ id: 'evt-2', sequence: 2, now: 2000 })],
      }),
    ).toThrow('expected stream version 0 but current version is 1');
    expect(() =>
      restartedStore.appendToStream({
        streamName: partition.eventStreamName,
        expectedVersion: 1,
        idempotencyKey: 'append-gap',
        events: [timeAdvancedEvent({ id: 'evt-3', sequence: 3, now: 3000 })],
      }),
    ).toThrow('event sequence 3 must equal next stream sequence 2');
  });
});
