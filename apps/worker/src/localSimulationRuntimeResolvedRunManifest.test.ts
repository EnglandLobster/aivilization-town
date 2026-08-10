import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileLocalSimulationRuntimeResolvedRunManifestRepository,
  LOCAL_SIMULATION_RUNTIME_RESOLVED_RUN_MANIFEST_SCHEMA_VERSION,
  createLocalSimulationRuntimeJsonObject,
  createLocalSimulationRuntimeResolvedRunManifest,
  type LocalSimulationRuntimeResolvedRunManifestPayload,
} from './index';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('resolved local runtime run manifests', () => {
  test('content-addresses canonical JSON independently of object key order', () => {
    const left = createLocalSimulationRuntimeResolvedRunManifest(createPayload());
    const right = createLocalSimulationRuntimeResolvedRunManifest({
      ...createPayload(),
      composition: { version: 'v1', id: 'town' },
    });

    expect(left).toEqual(right);
    expect(left.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(left.runManifestId).toBe(`resolved-run-manifest:${left.contentHash}`);
  });

  test('persists one immutable manifest and reloads it after repository restart', async () => {
    const rootDir = createRootDir();
    const manifest = createLocalSimulationRuntimeResolvedRunManifest(createPayload());
    const first = new FileLocalSimulationRuntimeResolvedRunManifestRepository({ rootDir });

    await expect(first.save(manifest)).resolves.toEqual(manifest);
    await expect(first.save(manifest)).resolves.toEqual(manifest);
    const restarted = new FileLocalSimulationRuntimeResolvedRunManifestRepository({ rootDir });
    await expect(restarted.get(manifest.runManifestId)).resolves.toEqual(manifest);
    await expect(restarted.save({ ...manifest, contentHash: 'sha256:invalid' })).rejects.toThrow(
      'contentHash does not match resolved manifest payload',
    );
  });

  test('rejects non-JSON configuration before hashing can hide it', () => {
    expect(() =>
      createLocalSimulationRuntimeJsonObject({ valid: true, invalid: undefined }, 'configuration'),
    ).toThrow('configuration.invalid must contain JSON values only');
    expect(() =>
      createLocalSimulationRuntimeJsonObject({ invalid: () => undefined }, 'configuration'),
    ).toThrow('configuration.invalid must contain JSON values only');
  });

  test('rejects a structurally corrupted persisted manifest with an actionable error', async () => {
    const rootDir = createRootDir();
    const manifest = createLocalSimulationRuntimeResolvedRunManifest(createPayload());
    const repository = new FileLocalSimulationRuntimeResolvedRunManifestRepository({ rootDir });
    const hash = manifest.contentHash.slice('sha256:'.length);
    writeFileSync(join(rootDir, 'resolved-run-manifests', `${hash}.json`), 'null\n', 'utf8');

    await expect(repository.get(manifest.runManifestId)).rejects.toThrow(
      'resolved run manifest must be a plain JSON object',
    );
  });
});

function createPayload(): LocalSimulationRuntimeResolvedRunManifestPayload {
  return {
    schemaVersion: LOCAL_SIMULATION_RUNTIME_RESOLVED_RUN_MANIFEST_SCHEMA_VERSION,
    composition: { id: 'town', version: 'v1' },
    sourceRevision: {
      commit: '0123456789abcdef0123456789abcdef01234567',
      dirty: false,
    },
    seed: 'seed-1',
    scenario: { profileId: 'smoke-25' },
    policies: { schemaVersion: 'policy-v1' },
    cognition: { mode: 'deterministic' },
    memory: { policyId: 'memory-v1' },
    observations: { enabled: true },
    validation: { mode: 'artifact-backed' },
    runtime: { cycleCount: 1 },
  };
}

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-resolved-run-manifest-'));
  roots.push(root);
  return root;
}
