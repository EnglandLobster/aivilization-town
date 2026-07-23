import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertSourceWorkspaceFingerprint } from '@aivilization/sim-core';
import type { LocalRuntimeTownSourceRevision } from './localRuntimeTownCli';

export const LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_POLICY_VERSION =
  'local-runtime-data-compatibility-v2';
export const LOCAL_RUNTIME_TOWN_DATA_LAYOUT_VERSION = 2;
export const LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_FILENAME = 'runtime-data-compatibility.json';

export type LocalRuntimeTownDataCompatibilityPolicy = {
  readonly policyVersion: typeof LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_POLICY_VERSION;
  readonly currentDataLayoutVersion: typeof LOCAL_RUNTIME_TOWN_DATA_LAYOUT_VERSION;
  readonly readableDataLayoutVersions: readonly [typeof LOCAL_RUNTIME_TOWN_DATA_LAYOUT_VERSION];
  readonly writableDataLayoutVersions: readonly [typeof LOCAL_RUNTIME_TOWN_DATA_LAYOUT_VERSION];
  readonly unversionedDataAdoption: 'empty-root-only-existing-data-requires-v1-copy-migration';
  readonly migrationMode: 'offline-copy-on-write-v1-to-v2';
  readonly idempotencyMigration: 'inline-events-to-hashed-event-sequence-references';
  readonly rollbackMode: 'restore-untouched-v1-source-copy';
  readonly unknownFutureVersion: 'reject-startup';
};

export type LocalRuntimeTownDataCompatibilityMarker = {
  readonly schemaVersion: typeof LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_POLICY_VERSION;
  readonly dataLayoutVersion: typeof LOCAL_RUNTIME_TOWN_DATA_LAYOUT_VERSION;
  readonly origin: 'initialized-empty-v2' | 'migrated-v1-copy';
  readonly registeredAt: number;
  readonly registeredBySourceRevision: LocalRuntimeTownSourceRevision;
  readonly migrationArtifactId?: string;
};

export type LocalRuntimeTownDataCompatibilityInspection = {
  readonly policy: LocalRuntimeTownDataCompatibilityPolicy;
  readonly marker?: LocalRuntimeTownDataCompatibilityMarker;
  readonly hadUnversionedData: false;
};

export function createLocalRuntimeTownDataCompatibilityPolicy(): LocalRuntimeTownDataCompatibilityPolicy {
  return {
    policyVersion: LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_POLICY_VERSION,
    currentDataLayoutVersion: LOCAL_RUNTIME_TOWN_DATA_LAYOUT_VERSION,
    readableDataLayoutVersions: [LOCAL_RUNTIME_TOWN_DATA_LAYOUT_VERSION],
    writableDataLayoutVersions: [LOCAL_RUNTIME_TOWN_DATA_LAYOUT_VERSION],
    unversionedDataAdoption: 'empty-root-only-existing-data-requires-v1-copy-migration',
    migrationMode: 'offline-copy-on-write-v1-to-v2',
    idempotencyMigration: 'inline-events-to-hashed-event-sequence-references',
    rollbackMode: 'restore-untouched-v1-source-copy',
    unknownFutureVersion: 'reject-startup',
  };
}

export function inspectLocalRuntimeTownDataCompatibility(input: {
  readonly rootDir: string;
}): LocalRuntimeTownDataCompatibilityInspection {
  assertNonEmpty(input.rootDir, 'rootDir');
  mkdirSync(input.rootDir, { recursive: true });
  const markerPath = join(input.rootDir, LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_FILENAME);
  if (!existsSync(markerPath)) {
    if (readdirSync(input.rootDir).length > 0) {
      throw new Error(
        `unversioned runtime data requires an offline v1-to-v2 migration against a copied root: ${input.rootDir}`,
      );
    }
    return {
      policy: createLocalRuntimeTownDataCompatibilityPolicy(),
      hadUnversionedData: false,
    };
  }
  return {
    policy: createLocalRuntimeTownDataCompatibilityPolicy(),
    marker: parseMarker(readFileSync(markerPath, 'utf8'), markerPath),
    hadUnversionedData: false,
  };
}

export function registerLocalRuntimeTownDataCompatibility(input: {
  readonly rootDir: string;
  readonly sourceRevision: LocalRuntimeTownSourceRevision;
  readonly registeredAt: number;
  readonly hadUnversionedData: boolean;
}): LocalRuntimeTownDataCompatibilityMarker {
  if (input.hadUnversionedData) {
    throw new Error('layout v2 cannot adopt unversioned existing data in place');
  }
  return writeMarker({
    rootDir: input.rootDir,
    marker: {
      schemaVersion: LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_POLICY_VERSION,
      dataLayoutVersion: LOCAL_RUNTIME_TOWN_DATA_LAYOUT_VERSION,
      origin: 'initialized-empty-v2',
      registeredAt: input.registeredAt,
      registeredBySourceRevision: { ...input.sourceRevision },
    },
    allowExisting: true,
  });
}

export function registerMigratedLocalRuntimeTownDataCompatibility(input: {
  readonly rootDir: string;
  readonly sourceRevision: LocalRuntimeTownSourceRevision;
  readonly registeredAt: number;
  readonly migrationArtifactId: string;
}): LocalRuntimeTownDataCompatibilityMarker {
  assertNonEmpty(input.migrationArtifactId, 'migrationArtifactId');
  return writeMarker({
    rootDir: input.rootDir,
    marker: {
      schemaVersion: LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_POLICY_VERSION,
      dataLayoutVersion: LOCAL_RUNTIME_TOWN_DATA_LAYOUT_VERSION,
      origin: 'migrated-v1-copy',
      registeredAt: input.registeredAt,
      registeredBySourceRevision: { ...input.sourceRevision },
      migrationArtifactId: input.migrationArtifactId,
    },
    allowExisting: false,
  });
}

function writeMarker(input: {
  readonly rootDir: string;
  readonly marker: LocalRuntimeTownDataCompatibilityMarker;
  readonly allowExisting: boolean;
}): LocalRuntimeTownDataCompatibilityMarker {
  assertNonEmpty(input.rootDir, 'rootDir');
  assertTimestamp(input.marker.registeredAt, 'registeredAt');
  assertSourceRevision(input.marker.registeredBySourceRevision);
  mkdirSync(input.rootDir, { recursive: true });
  const markerPath = join(input.rootDir, LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_FILENAME);
  if (existsSync(markerPath)) {
    if (input.allowExisting) {
      return parseMarker(readFileSync(markerPath, 'utf8'), markerPath);
    }
    throw new Error(`migrated compatibility marker already exists: ${markerPath}`);
  }
  writeFileSync(markerPath, `${JSON.stringify(input.marker, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return input.marker;
}

function parseMarker(
  serialized: string,
  markerPath: string,
): LocalRuntimeTownDataCompatibilityMarker {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`runtime data compatibility marker is invalid JSON: ${markerPath}`, {
      cause: error,
    });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`runtime data compatibility marker must be an object: ${markerPath}`);
  }
  const marker = value as Readonly<Record<string, unknown>>;
  if (
    marker.schemaVersion !== LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_POLICY_VERSION ||
    marker.dataLayoutVersion !== LOCAL_RUNTIME_TOWN_DATA_LAYOUT_VERSION
  ) {
    throw incompatibleMarkerError(markerPath, marker.schemaVersion, marker.dataLayoutVersion);
  }
  if (marker.origin !== 'initialized-empty-v2' && marker.origin !== 'migrated-v1-copy') {
    throw new Error(`runtime data compatibility marker has invalid origin: ${markerPath}`);
  }
  if (
    marker.origin === 'migrated-v1-copy' &&
    (typeof marker.migrationArtifactId !== 'string' || marker.migrationArtifactId.length === 0)
  ) {
    throw new Error(`migrated runtime data marker is missing its artifact ID: ${markerPath}`);
  }
  if (marker.origin === 'initialized-empty-v2' && marker.migrationArtifactId !== undefined) {
    throw new Error(`fresh runtime data marker must not contain migration provenance: ${markerPath}`);
  }
  assertTimestamp(marker.registeredAt, 'marker.registeredAt');
  assertSourceRevision(marker.registeredBySourceRevision);
  return {
    schemaVersion: LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_POLICY_VERSION,
    dataLayoutVersion: LOCAL_RUNTIME_TOWN_DATA_LAYOUT_VERSION,
    origin: marker.origin,
    registeredAt: marker.registeredAt,
    registeredBySourceRevision: { ...marker.registeredBySourceRevision },
    ...(marker.migrationArtifactId === undefined
      ? {}
      : { migrationArtifactId: marker.migrationArtifactId as string }),
  };
}

function incompatibleMarkerError(
  markerPath: string,
  schemaVersion: unknown,
  dataLayoutVersion: unknown,
): Error {
  return new Error(
    `runtime data layout is incompatible at ${markerPath}: schema=${String(schemaVersion)}, layout=${String(dataLayoutVersion)}; refuse startup and run the offline v1-to-v2 migration against a copied root`,
  );
}

function assertSourceRevision(value: unknown): asserts value is LocalRuntimeTownSourceRevision {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('source revision must be an object');
  }
  const sourceRevision = value as Readonly<Record<string, unknown>>;
  if (
    typeof sourceRevision.commit !== 'string' ||
    !/^[a-f0-9]{40}([a-f0-9]{24})?$/u.test(sourceRevision.commit) ||
    typeof sourceRevision.dirty !== 'boolean'
  ) {
    throw new Error('source revision must contain a hexadecimal commit and dirty boolean');
  }
  if (sourceRevision.workspaceFingerprint !== undefined) {
    assertSourceWorkspaceFingerprint(
      sourceRevision.workspaceFingerprint,
      'source revision workspaceFingerprint',
    );
  }
}

function assertTimestamp(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must be non-empty`);
  }
}
