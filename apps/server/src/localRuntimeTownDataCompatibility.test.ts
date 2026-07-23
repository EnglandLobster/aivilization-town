import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_FILENAME,
  createLocalRuntimeTownDataCompatibilityPolicy,
  inspectLocalRuntimeTownDataCompatibility,
  registerLocalRuntimeTownDataCompatibility,
} from './localRuntimeTownDataCompatibility';

const roots: string[] = [];
const sourceRevision = {
  commit: '0123456789abcdef0123456789abcdef01234567',
  dirty: false,
} as const;

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town data compatibility', () => {
  test('registers a fresh root and reopens the same supported layout idempotently', () => {
    const rootDir = createRoot();
    const inspection = inspectLocalRuntimeTownDataCompatibility({ rootDir });

    expect(inspection).toEqual({
      policy: createLocalRuntimeTownDataCompatibilityPolicy(),
      hadUnversionedData: false,
    });
    const marker = registerLocalRuntimeTownDataCompatibility({
      rootDir,
      sourceRevision,
      registeredAt: 100,
      hadUnversionedData: inspection.hadUnversionedData,
    });

    expect(marker).toMatchObject({
      schemaVersion: 'local-runtime-data-compatibility-v2',
      dataLayoutVersion: 2,
      origin: 'initialized-empty-v2',
    });
    expect(inspectLocalRuntimeTownDataCompatibility({ rootDir }).marker).toEqual(marker);
    expect(
      registerLocalRuntimeTownDataCompatibility({
        rootDir,
        sourceRevision: { ...sourceRevision, dirty: true },
        registeredAt: 200,
        hadUnversionedData: false,
      }),
    ).toEqual(marker);
  });

  test('rejects in-place adoption of unversioned existing data', () => {
    const rootDir = createRoot();
    mkdirSync(join(rootDir, 'operations'));
    writeFileSync(join(rootDir, 'operations', 'known-v1.jsonl'), '{}\n', 'utf8');
    expect(() => inspectLocalRuntimeTownDataCompatibility({ rootDir })).toThrow(
      'requires an offline v1-to-v2 migration against a copied root',
    );
  });

  test('fails closed before startup for unknown future layouts and corrupt markers', () => {
    const rootDir = createRoot();
    const markerPath = join(rootDir, LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_FILENAME);
    writeFileSync(
      markerPath,
      JSON.stringify({
        schemaVersion: 'local-runtime-data-compatibility-v3',
        dataLayoutVersion: 3,
      }),
      'utf8',
    );
    expect(() => inspectLocalRuntimeTownDataCompatibility({ rootDir })).toThrow(
      'refuse startup and run the offline v1-to-v2 migration against a copied root',
    );

    writeFileSync(markerPath, '{', 'utf8');
    expect(() => inspectLocalRuntimeTownDataCompatibility({ rootDir })).toThrow('invalid JSON');
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'runtime-data-compatibility-'));
  roots.push(root);
  return root;
}
