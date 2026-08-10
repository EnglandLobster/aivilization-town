import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  FILE_EVENT_IDEMPOTENCY_LEGACY_PATH,
  FileProjectionCheckpointStore,
  FileProjectionSnapshotStore,
  assertSourceWorkspaceFingerprint,
  migrateFileEventStoreIdempotencyV1ToV2,
  type FileEventStoreIdempotencyMigrationResult,
  type ProjectionCheckpoint,
  type SnapshotReference,
} from '@aivilization/sim-core';
import type { LocalRuntimeTownSourceRevision } from './localRuntimeTownCli';
import {
  LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_FILENAME,
  inspectLocalRuntimeTownDataCompatibility,
  registerMigratedLocalRuntimeTownDataCompatibility,
} from './localRuntimeTownDataCompatibility';

export const LOCAL_RUNTIME_TOWN_DATA_MIGRATION_SCHEMA_VERSION =
  'local-runtime-data-migration-v1-to-v2';

type LegacyV1Marker = {
  readonly schemaVersion: 'local-runtime-data-compatibility-v1';
  readonly dataLayoutVersion: 1;
  readonly origin: 'initialized-empty-v1' | 'adopted-unversioned-v1';
  readonly registeredAt: number;
  readonly registeredBySourceRevision: LocalRuntimeTownSourceRevision;
};

export type LocalRuntimeTownDataMigrationArtifactPayload = {
  readonly schemaVersion: typeof LOCAL_RUNTIME_TOWN_DATA_MIGRATION_SCHEMA_VERSION;
  readonly status: 'pass';
  readonly startedAt: number;
  readonly completedAt: number;
  readonly sourceRootDir: string;
  readonly targetRootDir: string;
  readonly sourceRevision: LocalRuntimeTownSourceRevision;
  readonly sourceMarker: LegacyV1Marker;
  readonly sourceTreeSha256Before: string;
  readonly sourceTreeSha256After: string;
  readonly sourceUnchanged: true;
  readonly eventStores: readonly FileEventStoreIdempotencyMigrationResult[];
  readonly projectionSnapshotReferences: {
    readonly checkpointFileCount: number;
    readonly checkpointRecordCount: number;
    readonly snapshotFileCount: number;
    readonly relocatedReferenceCount: number;
  };
  readonly totals: {
    readonly eventStoreCount: number;
    readonly recordCount: number;
    readonly legacyByteLength: number;
    readonly compactByteLength: number;
  };
  readonly safety: {
    readonly mode: 'offline-copy-on-write';
    readonly sourceWriterConfirmedStopped: true;
    readonly targetPublishedByAtomicRename: true;
    readonly rollback: 'restore-untouched-v1-source-copy';
  };
};

export type LocalRuntimeTownDataMigrationArtifact = LocalRuntimeTownDataMigrationArtifactPayload & {
  readonly artifactId: string;
  readonly artifactPath: string;
};

export function migrateLocalRuntimeTownDataV1ToV2(input: {
  readonly sourceRootDir: string;
  readonly targetRootDir: string;
  readonly sourceRevision: LocalRuntimeTownSourceRevision;
  readonly sourceWriterConfirmedStopped: true;
  readonly clock?: { readonly now: () => number };
}): LocalRuntimeTownDataMigrationArtifact {
  const sourceRootDir = resolve(input.sourceRootDir);
  const targetRootDir = resolve(input.targetRootDir);
  assertSeparateRoots(sourceRootDir, targetRootDir);
  assertSourceRevision(input.sourceRevision);
  const clock = input.clock ?? { now: () => Date.now() };
  const startedAt = clock.now();
  assertTimestamp(startedAt, 'startedAt');
  const sourceMarker = readLegacyV1Marker(sourceRootDir);
  const sourceTreeSha256Before = hashRuntimeTree(sourceRootDir);

  if (existsSync(targetRootDir)) {
    return readAndValidateExistingMigration({
      sourceRootDir,
      targetRootDir,
      sourceTreeSha256: sourceTreeSha256Before,
    });
  }

  mkdirSync(dirname(targetRootDir), { recursive: true });
  const stagingRootDir = mkdtempSync(
    join(dirname(targetRootDir), `.${basename(targetRootDir)}.migrating-`),
  );
  try {
    cpSync(sourceRootDir, stagingRootDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
    const copiedTreeSha256 = hashRuntimeTree(stagingRootDir);
    if (copiedTreeSha256 !== sourceTreeSha256Before) {
      throw new Error('copied v1 runtime root does not match the source tree hash');
    }

    const projectionSnapshotReferences = relocateProjectionSnapshotReferences({
      rootDir: stagingRootDir,
      fromRootDir: sourceRootDir,
      toRootDir: stagingRootDir,
    });
    validateProjectionSnapshotHydration(stagingRootDir);

    const stagedEventStores = findEventStoreRoots(stagingRootDir).map((rootDir) =>
      migrateFileEventStoreIdempotencyV1ToV2({ rootDir }),
    );
    const eventStores = stagedEventStores.map((result) => ({
      ...result,
      rootDir: join(targetRootDir, relative(stagingRootDir, result.rootDir)),
    }));
    const completedAt = Math.max(startedAt, clock.now());
    const sourceTreeSha256After = hashRuntimeTree(sourceRootDir);
    if (sourceTreeSha256After !== sourceTreeSha256Before) {
      throw new Error(
        'source runtime root changed during migration; discard the target and retry offline',
      );
    }
    const payload: LocalRuntimeTownDataMigrationArtifactPayload = {
      schemaVersion: LOCAL_RUNTIME_TOWN_DATA_MIGRATION_SCHEMA_VERSION,
      status: 'pass',
      startedAt,
      completedAt,
      sourceRootDir,
      targetRootDir,
      sourceRevision: { ...input.sourceRevision },
      sourceMarker,
      sourceTreeSha256Before,
      sourceTreeSha256After,
      sourceUnchanged: true,
      eventStores,
      projectionSnapshotReferences,
      totals: sumMigrationResults(eventStores),
      safety: {
        mode: 'offline-copy-on-write',
        sourceWriterConfirmedStopped: true,
        targetPublishedByAtomicRename: true,
        rollback: 'restore-untouched-v1-source-copy',
      },
    };
    const artifactId = migrationArtifactId(payload);
    unlinkSync(join(stagingRootDir, LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_FILENAME));
    registerMigratedLocalRuntimeTownDataCompatibility({
      rootDir: stagingRootDir,
      sourceRevision: input.sourceRevision,
      registeredAt: completedAt,
      migrationArtifactId: artifactId,
    });
    persistMigrationArtifact(stagingRootDir, artifactId, payload);
    relocateProjectionSnapshotReferences({
      rootDir: stagingRootDir,
      fromRootDir: stagingRootDir,
      toRootDir: targetRootDir,
    });
    renameSync(stagingRootDir, targetRootDir);
    try {
      validateMigratedRoot(targetRootDir, eventStores.length);
    } catch (error) {
      renameSync(targetRootDir, stagingRootDir);
      throw error;
    }
    return {
      ...payload,
      artifactId,
      artifactPath: migrationArtifactPath(targetRootDir, artifactId),
    };
  } catch (error) {
    if (existsSync(stagingRootDir)) {
      rmSync(stagingRootDir, { recursive: true, force: true });
    }
    throw error;
  }
}

function readAndValidateExistingMigration(input: {
  readonly sourceRootDir: string;
  readonly targetRootDir: string;
  readonly sourceTreeSha256: string;
}): LocalRuntimeTownDataMigrationArtifact {
  const inspection = inspectLocalRuntimeTownDataCompatibility({ rootDir: input.targetRootDir });
  const artifactId = inspection.marker?.migrationArtifactId;
  if (inspection.marker?.origin !== 'migrated-v1-copy' || artifactId === undefined) {
    throw new Error(
      `migration target already exists and is not a verified v2 copy: ${input.targetRootDir}`,
    );
  }
  const artifactPath = migrationArtifactPath(input.targetRootDir, artifactId);
  if (!existsSync(artifactPath)) {
    throw new Error(`migration target is missing its registered artifact: ${artifactPath}`);
  }
  const artifact = JSON.parse(
    readFileSync(artifactPath, 'utf8'),
  ) as LocalRuntimeTownDataMigrationArtifactPayload & {
    readonly artifactId?: string;
  };
  const { artifactId: persistedId, ...payload } = artifact;
  if (
    persistedId !== artifactId ||
    migrationArtifactId(payload) !== artifactId ||
    payload.sourceRootDir !== input.sourceRootDir ||
    payload.targetRootDir !== input.targetRootDir ||
    payload.sourceTreeSha256Before !== input.sourceTreeSha256 ||
    payload.sourceTreeSha256After !== input.sourceTreeSha256
  ) {
    throw new Error(`existing migration artifact failed provenance validation: ${artifactPath}`);
  }
  validateMigratedRoot(input.targetRootDir, payload.totals.eventStoreCount);
  return { ...payload, artifactId, artifactPath };
}

function validateMigratedRoot(rootDir: string, expectedEventStoreCount: number): void {
  const inspection = inspectLocalRuntimeTownDataCompatibility({ rootDir });
  if (inspection.marker?.origin !== 'migrated-v1-copy') {
    throw new Error('migrated runtime root did not register a layout-v2 marker');
  }
  const eventStores = findEventStoreRoots(rootDir);
  if (eventStores.length !== expectedEventStoreCount) {
    throw new Error('migrated runtime root event-store count changed during verification');
  }
  for (const eventStoreRoot of eventStores) {
    const result = migrateFileEventStoreIdempotencyV1ToV2({ rootDir: eventStoreRoot });
    if (result.status === 'migrated') {
      throw new Error(`migrated event store was not idempotent on verification: ${eventStoreRoot}`);
    }
  }
  validateProjectionSnapshotHydration(rootDir);
}

function relocateProjectionSnapshotReferences(input: {
  readonly rootDir: string;
  readonly fromRootDir: string;
  readonly toRootDir: string;
}): LocalRuntimeTownDataMigrationArtifactPayload['projectionSnapshotReferences'] {
  const checkpointPaths = findFilesNamed(input.rootDir, 'projection-checkpoints.jsonl');
  const snapshotPaths = findFilesNamed(
    input.rootDir,
    undefined,
    (path) =>
      path.includes(`${sep}snapshots${sep}projection-snapshots${sep}`) && path.endsWith('.json'),
  );
  let checkpointRecordCount = 0;
  let relocatedReferenceCount = 0;
  for (const checkpointPath of checkpointPaths) {
    const serialized = readFileSync(checkpointPath, 'utf8');
    const trailingNewline = serialized.endsWith('\n');
    const lines = serialized.split('\n').filter((line) => line.length > 0);
    const relocated = lines.map((line) => {
      const checkpoint = JSON.parse(line) as ProjectionCheckpoint;
      assertProjectionCheckpointReference(checkpoint, checkpointPath);
      checkpointRecordCount += 1;
      relocatedReferenceCount += 1;
      return JSON.stringify({
        ...checkpoint,
        snapshot: {
          ...checkpoint.snapshot,
          uri: relocateFileUri(
            checkpoint.snapshot.uri,
            input.fromRootDir,
            input.toRootDir,
            checkpointPath,
          ),
        },
      });
    });
    replaceFileAtomically(
      checkpointPath,
      `${relocated.join('\n')}${trailingNewline && relocated.length > 0 ? '\n' : ''}`,
    );
  }
  for (const snapshotPath of snapshotPaths) {
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
      readonly reference?: ProjectionCheckpoint['snapshot'];
      readonly projection?: unknown;
    };
    if (snapshot.reference === undefined || !('projection' in snapshot)) {
      throw new Error(`projection snapshot file is malformed: ${snapshotPath}`);
    }
    assertSnapshotReference(snapshot.reference, snapshotPath);
    relocatedReferenceCount += 1;
    replaceFileAtomically(
      snapshotPath,
      `${JSON.stringify(
        {
          ...snapshot,
          reference: {
            ...snapshot.reference,
            uri: relocateFileUri(
              snapshot.reference.uri,
              input.fromRootDir,
              input.toRootDir,
              snapshotPath,
            ),
          },
        },
        null,
        2,
      )}\n`,
    );
  }
  return {
    checkpointFileCount: checkpointPaths.length,
    checkpointRecordCount,
    snapshotFileCount: snapshotPaths.length,
    relocatedReferenceCount,
  };
}

function validateProjectionSnapshotHydration(rootDir: string): void {
  for (const checkpointPath of findFilesNamed(rootDir, 'projection-checkpoints.jsonl')) {
    const records = readFileSync(checkpointPath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ProjectionCheckpoint);
    const latest = records.at(-1);
    if (latest === undefined) {
      continue;
    }
    assertProjectionCheckpointReference(latest, checkpointPath);
    const checkpointStore = new FileProjectionCheckpointStore({ rootDir: dirname(checkpointPath) });
    const persistedLatest = checkpointStore.getLatestCheckpoint(latest);
    if (persistedLatest === undefined) {
      throw new Error(`projection checkpoint latest-record validation failed: ${checkpointPath}`);
    }
    assertProjectionCheckpointReference(persistedLatest, checkpointPath);
    if (persistedLatest.lastAppliedSequence !== latest.lastAppliedSequence) {
      throw new Error(`projection checkpoint latest-record validation failed: ${checkpointPath}`);
    }
    const partitionRootDir = dirname(dirname(checkpointPath));
    const snapshotStore = new FileProjectionSnapshotStore<unknown>({
      rootDir: join(partitionRootDir, 'snapshots'),
    });
    if (snapshotStore.loadSnapshot(persistedLatest.snapshot) === undefined) {
      throw new Error(`latest projection snapshot is missing: ${persistedLatest.snapshot.uri}`);
    }
  }
}

function findFilesNamed(
  rootDir: string,
  filename?: string,
  predicate?: (path: string) => boolean,
): string[] {
  const paths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`runtime migration refuses symbolic links: ${path}`);
      }
      if (entry.isDirectory()) {
        visit(path);
      } else if (
        entry.isFile() &&
        (filename === undefined || entry.name === filename) &&
        (predicate?.(path) ?? true)
      ) {
        paths.push(path);
      }
    }
  };
  visit(rootDir);
  return paths;
}

function relocateFileUri(
  uri: string,
  fromRootDir: string,
  toRootDir: string,
  sourcePath: string,
): string {
  let referencedPath: string;
  try {
    referencedPath = resolve(fileURLToPath(uri));
  } catch (error) {
    throw new Error(`projection snapshot reference is not a valid file URI: ${sourcePath}`, {
      cause: error,
    });
  }
  const normalizedFromRoot = resolve(fromRootDir);
  const relativePath = relative(normalizedFromRoot, referencedPath);
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error(
      `projection snapshot reference escapes the migration source root: ${sourcePath}`,
    );
  }
  return pathToFileURL(join(resolve(toRootDir), relativePath)).href;
}

function assertProjectionCheckpointReference(
  checkpoint: ProjectionCheckpoint,
  path: string,
): asserts checkpoint is ProjectionCheckpoint & { readonly snapshot: SnapshotReference } {
  if (
    checkpoint === null ||
    typeof checkpoint !== 'object' ||
    !Number.isSafeInteger(checkpoint.lastAppliedSequence) ||
    checkpoint.snapshot === undefined
  ) {
    throw new Error(`projection checkpoint record is malformed: ${path}`);
  }
  assertSnapshotReference(checkpoint.snapshot, path);
}

function assertSnapshotReference(reference: ProjectionCheckpoint['snapshot'], path: string): void {
  if (
    reference === null ||
    typeof reference !== 'object' ||
    typeof reference.simulationId !== 'string' ||
    typeof reference.partitionKey !== 'string' ||
    !Number.isSafeInteger(reference.sequence) ||
    typeof reference.uri !== 'string' ||
    !Number.isSafeInteger(reference.createdAt)
  ) {
    throw new Error(`projection snapshot reference is malformed: ${path}`);
  }
}

function replaceFileAtomically(path: string, contents: string): void {
  const temporaryPath = `${path}.migration-rewrite`;
  if (existsSync(temporaryPath)) {
    throw new Error(`projection reference migration staging file already exists: ${temporaryPath}`);
  }
  writeFileSync(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporaryPath, path);
}

function findEventStoreRoots(rootDir: string): string[] {
  const roots: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`runtime migration refuses symbolic links: ${path}`);
      }
      if (!entry.isDirectory()) {
        continue;
      }
      if (
        entry.name === 'events' &&
        existsSync(join(path, FILE_EVENT_IDEMPOTENCY_LEGACY_PATH)) &&
        existsSync(join(path, 'streams'))
      ) {
        roots.push(path);
      } else {
        visit(path);
      }
    }
  };
  visit(rootDir);
  return roots;
}

function readLegacyV1Marker(rootDir: string): LegacyV1Marker {
  const path = join(rootDir, LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_FILENAME);
  if (!existsSync(path)) {
    throw new Error(`v1 migration source is missing its compatibility marker: ${path}`);
  }
  const value = JSON.parse(readFileSync(path, 'utf8')) as Readonly<Record<string, unknown>>;
  if (
    value.schemaVersion !== 'local-runtime-data-compatibility-v1' ||
    value.dataLayoutVersion !== 1 ||
    (value.origin !== 'initialized-empty-v1' && value.origin !== 'adopted-unversioned-v1') ||
    typeof value.registeredAt !== 'number' ||
    !Number.isSafeInteger(value.registeredAt) ||
    value.registeredAt < 0 ||
    value.registeredBySourceRevision === null ||
    typeof value.registeredBySourceRevision !== 'object'
  ) {
    throw new Error(`migration source is not a supported layout-v1 root: ${path}`);
  }
  const registeredBySourceRevision = value.registeredBySourceRevision as Readonly<
    Record<string, unknown>
  >;
  if (
    typeof registeredBySourceRevision.commit !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(registeredBySourceRevision.commit) ||
    typeof registeredBySourceRevision.dirty !== 'boolean'
  ) {
    throw new Error(`migration source has an invalid registered source revision: ${path}`);
  }
  return {
    schemaVersion: 'local-runtime-data-compatibility-v1',
    dataLayoutVersion: 1,
    origin: value.origin,
    registeredAt: value.registeredAt,
    registeredBySourceRevision: {
      commit: registeredBySourceRevision.commit,
      dirty: registeredBySourceRevision.dirty,
    },
  };
}

function hashRuntimeTree(rootDir: string): string {
  if (!existsSync(rootDir) || !lstatSync(rootDir).isDirectory()) {
    throw new Error(`runtime root must be an existing directory: ${rootDir}`);
  }
  const hash = createHash('sha256');
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      const relativePath = relative(rootDir, path).split(sep).join('/');
      if (entry.isSymbolicLink()) {
        throw new Error(`runtime tree hash refuses symbolic links: ${path}`);
      }
      if (entry.isDirectory()) {
        hash.update(`d:${relativePath}\0`);
        visit(path);
      } else if (entry.isFile()) {
        hash.update(`f:${relativePath}\0`);
        hash.update(readFileSync(path));
        hash.update('\0');
      } else {
        throw new Error(`runtime tree hash refuses non-regular entries: ${path}`);
      }
    }
  };
  visit(rootDir);
  return hash.digest('hex');
}

function sumMigrationResults(results: readonly FileEventStoreIdempotencyMigrationResult[]) {
  return {
    eventStoreCount: results.length,
    recordCount: results.reduce((sum, result) => sum + result.recordCount, 0),
    legacyByteLength: results.reduce((sum, result) => sum + result.legacyByteLength, 0),
    compactByteLength: results.reduce((sum, result) => sum + result.compactByteLength, 0),
  };
}

function persistMigrationArtifact(
  rootDir: string,
  artifactId: string,
  payload: LocalRuntimeTownDataMigrationArtifactPayload,
): void {
  const artifactPath = migrationArtifactPath(rootDir, artifactId);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify({ ...payload, artifactId }, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

function migrationArtifactPath(rootDir: string, artifactId: string): string {
  return join(
    rootDir,
    'operations',
    'data-migrations',
    encodeURIComponent(artifactId),
    'artifact.json',
  );
}

function migrationArtifactId(payload: LocalRuntimeTownDataMigrationArtifactPayload): string {
  return `runtime-data-migration:sha256:${createHash('sha256')
    .update(stableStringify(payload))
    .digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertSeparateRoots(sourceRootDir: string, targetRootDir: string): void {
  if (
    sourceRootDir === targetRootDir ||
    targetRootDir.startsWith(`${sourceRootDir}${sep}`) ||
    sourceRootDir.startsWith(`${targetRootDir}${sep}`)
  ) {
    throw new Error('migration source and target roots must be separate, non-nested directories');
  }
}

function assertSourceRevision(value: LocalRuntimeTownSourceRevision): void {
  if (!/^[a-f0-9]{40}([a-f0-9]{24})?$/u.test(value.commit)) {
    throw new Error('source revision commit must be hexadecimal');
  }
  if (value.workspaceFingerprint !== undefined) {
    assertSourceWorkspaceFingerprint(
      value.workspaceFingerprint,
      'source revision workspaceFingerprint',
    );
  }
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}
