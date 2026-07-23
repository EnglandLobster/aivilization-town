import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  FileEventStore,
  FileProjectionCheckpointStore,
  FileProjectionSnapshotStore,
  createEventEnvelope,
  createSimulationPartition,
  type EventEnvelope,
} from '@aivilization/sim-core';
import { afterEach, describe, expect, test } from 'vitest';
import { inspectLocalRuntimeTownDataCompatibility } from './localRuntimeTownDataCompatibility';
import { migrateLocalRuntimeTownDataV1ToV2 } from './localRuntimeTownDataMigration';
import { resolveLocalRuntimeTownDataMigrationCliConfig } from './localRuntimeTownDataMigrationCli';

const roots: string[] = [];
const sourceRevision = {
  commit: '0123456789abcdef0123456789abcdef01234567',
  dirty: false,
} as const;
const partition = createSimulationPartition({ simulationId: 'sim-1', partitionKey: 'world-main' });

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town data migration v1 to v2', () => {
  test('requires explicit stopped-source confirmation and resolves separate roots', () => {
    expect(() =>
      resolveLocalRuntimeTownDataMigrationCliConfig({
        argv: ['--source-root-dir', 'source', '--target-root-dir', 'target'],
        cwd: '/tmp/migration-cli',
        sourceRevision,
      }),
    ).toThrow('--confirm-source-stopped is required');
    expect(
      resolveLocalRuntimeTownDataMigrationCliConfig({
        argv: [
          '--source-root-dir',
          'source',
          '--target-root-dir=target',
          '--confirm-source-stopped',
        ],
        cwd: '/tmp/migration-cli',
        sourceRevision,
      }),
    ).toEqual({
      sourceRootDir: '/tmp/migration-cli/source',
      targetRootDir: '/tmp/migration-cli/target',
      sourceRevision,
      sourceWriterConfirmedStopped: true,
    });
  });

  test('publishes an immutable copy, preserves source, and is idempotent on the same target', () => {
    const parent = createRoot('runtime-data-migration-parent-');
    const sourceRootDir = join(parent, 'source-v1');
    const targetRootDir = join(parent, 'target-v2');
    const fixture = createLegacyRuntimeRoot(sourceRootDir);
    const sourceMarkerBefore = readFileSync(
      join(sourceRootDir, 'runtime-data-compatibility.json'),
      'utf8',
    );
    const sourceIdempotencyBefore = readFileSync(fixture.legacyPath, 'utf8');
    const clockValues = [100, 200];

    const artifact = migrateLocalRuntimeTownDataV1ToV2({
      sourceRootDir,
      targetRootDir,
      sourceRevision,
      sourceWriterConfirmedStopped: true,
      clock: { now: () => clockValues.shift() ?? 200 },
    });

    expect(artifact).toMatchObject({
      schemaVersion: 'local-runtime-data-migration-v1-to-v2',
      status: 'pass',
      sourceUnchanged: true,
      sourceMarker: {
        registeredAt: 1,
        registeredBySourceRevision: sourceRevision,
      },
      projectionSnapshotReferences: {
        checkpointFileCount: 1,
        checkpointRecordCount: 1,
        snapshotFileCount: 1,
        relocatedReferenceCount: 2,
      },
      totals: { eventStoreCount: 1, recordCount: 2 },
      safety: { mode: 'offline-copy-on-write', targetPublishedByAtomicRename: true },
    });
    expect(artifact.eventStores).toEqual([
      expect.objectContaining({ rootDir: fixture.eventRoot.replace(sourceRootDir, targetRootDir) }),
    ]);
    expect(existsSync(artifact.artifactPath)).toBe(true);
    expect(readFileSync(join(sourceRootDir, 'runtime-data-compatibility.json'), 'utf8')).toBe(
      sourceMarkerBefore,
    );
    expect(readFileSync(fixture.legacyPath, 'utf8')).toBe(sourceIdempotencyBefore);
    expect(
      inspectLocalRuntimeTownDataCompatibility({ rootDir: targetRootDir }).marker,
    ).toMatchObject({
      dataLayoutVersion: 2,
      origin: 'migrated-v1-copy',
      migrationArtifactId: artifact.artifactId,
    });
    const migratedEventRoot = fixture.eventRoot.replace(sourceRootDir, targetRootDir);
    expect(readFileSync(join(migratedEventRoot, 'idempotency.jsonl'), 'utf8')).toBe('');
    expect(readFileSync(join(migratedEventRoot, 'idempotency.deflate')).byteLength).toBeGreaterThan(
      0,
    );
    expect(
      new FileEventStore({ rootDir: migratedEventRoot }).appendToStream(fixture.requests[0]!),
    ).toMatchObject({
      idempotentReplay: true,
      appendedEvents: [{ id: 'event-1' }],
    });
    const migratedCheckpointRoot = fixture.checkpointRoot.replace(sourceRootDir, targetRootDir);
    const migratedSnapshotRoot = fixture.snapshotRoot.replace(sourceRootDir, targetRootDir);
    const migratedCheckpoint = new FileProjectionCheckpointStore({
      rootDir: migratedCheckpointRoot,
    }).getLatestCheckpoint(partition);
    if (migratedCheckpoint?.snapshot === undefined) {
      throw new Error('migrated checkpoint snapshot is missing');
    }
    expect(migratedCheckpoint.snapshot.uri).toContain(targetRootDir);
    expect(
      new FileProjectionSnapshotStore<{ readonly value: string }>({
        rootDir: migratedSnapshotRoot,
      }).loadSnapshot(migratedCheckpoint.snapshot),
    ).toEqual({ value: 'checkpoint-projection' });

    expect(
      migrateLocalRuntimeTownDataV1ToV2({
        sourceRootDir,
        targetRootDir,
        sourceRevision,
        sourceWriterConfirmedStopped: true,
      }),
    ).toEqual(artifact);
  });

  test('rejects a source mutation and never publishes the staging target', () => {
    const parent = createRoot('runtime-data-migration-mutation-');
    const sourceRootDir = join(parent, 'source-v1');
    const targetRootDir = join(parent, 'target-v2');
    createLegacyRuntimeRoot(sourceRootDir);
    let callCount = 0;

    expect(() =>
      migrateLocalRuntimeTownDataV1ToV2({
        sourceRootDir,
        targetRootDir,
        sourceRevision,
        sourceWriterConfirmedStopped: true,
        clock: {
          now: () => {
            callCount += 1;
            if (callCount === 2) {
              writeFileSync(join(sourceRootDir, 'writer-raced.txt'), 'changed', 'utf8');
            }
            return callCount * 100;
          },
        },
      }),
    ).toThrow('source runtime root changed during migration');
    expect(existsSync(targetRootDir)).toBe(false);
    expect(existsSync(join(sourceRootDir, 'writer-raced.txt'))).toBe(true);
  });

  test('rejects a projection snapshot reference that escapes the source root', () => {
    const parent = createRoot('runtime-data-migration-escape-');
    const sourceRootDir = join(parent, 'source-v1');
    const targetRootDir = join(parent, 'target-v2');
    const fixture = createLegacyRuntimeRoot(sourceRootDir);
    const checkpointPath = join(fixture.checkpointRoot, 'projection-checkpoints.jsonl');
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as {
      readonly snapshot: Readonly<Record<string, unknown>>;
    };
    writeFileSync(
      checkpointPath,
      `${JSON.stringify({
        ...checkpoint,
        snapshot: {
          ...checkpoint.snapshot,
          uri: pathToFileURL(join(parent, 'outside-source.json')).href,
        },
      })}\n`,
      'utf8',
    );

    expect(() =>
      migrateLocalRuntimeTownDataV1ToV2({
        sourceRootDir,
        targetRootDir,
        sourceRevision,
        sourceWriterConfirmedStopped: true,
      }),
    ).toThrow('projection snapshot reference escapes the migration source root');
    expect(existsSync(targetRootDir)).toBe(false);
  });
});

function createLegacyRuntimeRoot(rootDir: string) {
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(
    join(rootDir, 'runtime-data-compatibility.json'),
    `${JSON.stringify({
      schemaVersion: 'local-runtime-data-compatibility-v1',
      dataLayoutVersion: 1,
      origin: 'initialized-empty-v1',
      registeredAt: 1,
      registeredBySourceRevision: sourceRevision,
    })}\n`,
    'utf8',
  );
  const eventRoot = join(rootDir, 'simulations', 'sim-1', 'partitions', 'world-main', 'events');
  const partitionRoot = dirname(eventRoot);
  const checkpointRoot = join(partitionRoot, 'checkpoints');
  const snapshotRoot = join(partitionRoot, 'snapshots');
  const snapshot = new FileProjectionSnapshotStore<{ readonly value: string }>({
    rootDir: snapshotRoot,
  }).saveSnapshot({
    simulationId: partition.simulationId,
    partitionKey: partition.partitionKey,
    sequence: 0,
    createdAt: 1,
    projection: { value: 'checkpoint-projection' },
  });
  new FileProjectionCheckpointStore({ rootDir: checkpointRoot }).saveCheckpoint({
    simulationId: partition.simulationId,
    partitionKey: partition.partitionKey,
    lastAppliedSequence: 0,
    snapshot,
  });
  const store = new FileEventStore({ rootDir: eventRoot });
  const requests = [1, 2].map((sequence) => ({
    streamName: partition.eventStreamName,
    expectedVersion: sequence - 1,
    idempotencyKey: `append-${sequence}`,
    events: [timeAdvancedEvent(sequence)],
  }));
  for (const request of requests) {
    store.appendToStream(request);
  }
  writeFileSync(join(eventRoot, 'idempotency.deflate'), '');
  const legacyPath = join(eventRoot, 'idempotency.jsonl');
  writeFileSync(
    legacyPath,
    requests
      .map((request) =>
        JSON.stringify({
          idempotencyKey: request.idempotencyKey,
          streamName: request.streamName,
          expectedVersion: request.expectedVersion,
          eventFingerprint: JSON.stringify(request.events),
          appendedEvents: request.events,
          streamVersion: request.expectedVersion + request.events.length,
        }),
      )
      .join('\n') + '\n',
    'utf8',
  );
  return { eventRoot, legacyPath, requests, checkpointRoot, snapshotRoot };
}

function timeAdvancedEvent(
  sequence: number,
): EventEnvelope<'SimulationTimeAdvanced', { now: number }> {
  return createEventEnvelope({
    id: `event-${sequence}`,
    simulationId: 'sim-1',
    partitionKey: partition.partitionKey,
    commandId: `command-${sequence}`,
    type: 'SimulationTimeAdvanced',
    payload: { now: sequence * 1000 },
    occurredAt: sequence * 1000,
    sequence,
  });
}

function createRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
