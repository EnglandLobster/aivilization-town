import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileLocalSimulationRuntimeResolvedRunManifestRepository,
  LOCAL_SIMULATION_RUNTIME_RESOLVED_RUN_MANIFEST_SCHEMA_VERSION,
  createLocalSimulationRuntimeResolvedRunManifest,
  createLocalWorldRuntimeStorage,
} from '@aivilization/worker';
import { createLocalRuntimeTownDaemonScenarioProfile } from './localRuntimeTownScenarioProfile';
import { loadLocalRuntimeTownPaperEvidenceSource } from './localRuntimeTownPaperEvidenceSource';
import { resolveLocalRuntimeTownPaperStratificationCliConfig } from './localRuntimeTownPaperStratificationCli';
import { resolveLocalRuntimeTownPaperTrajectoryCliConfig } from './localRuntimeTownPaperTrajectoryCli';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('local runtime town offline paper evidence source', () => {
  test('loads the real operations manifest layout and hydrates the exact canonical partition set', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'paper-evidence-source-'));
    tempDirs.push(rootDir);
    const profile = createLocalRuntimeTownDaemonScenarioProfile('smoke-25');
    const manifest = createLocalSimulationRuntimeResolvedRunManifest({
      schemaVersion: LOCAL_SIMULATION_RUNTIME_RESOLVED_RUN_MANIFEST_SCHEMA_VERSION,
      composition: { id: 'town', version: 'test' },
      sourceRevision: { commit: '0'.repeat(40), dirty: false },
      seed: 'paper-evidence-seed',
      scenario: { profileId: profile.profileId, manifest: profile.manifest },
      policies: {},
      cognition: {},
      memory: {},
      observations: {},
      validation: {},
      runtime: {},
    });
    await new FileLocalSimulationRuntimeResolvedRunManifestRepository({
      rootDir: join(rootDir, 'operations'),
    }).save(manifest);
    for (const partition of profile.manifest.partitions) {
      createLocalWorldRuntimeStorage({
        rootDir,
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
      });
    }

    const source = await loadLocalRuntimeTownPaperEvidenceSource({
      rootDir,
      simulationId: profile.manifest.id,
      runManifestId: manifest.runManifestId,
    });

    expect(source.runManifest.runManifestId).toBe(manifest.runManifestId);
    expect(source.partitions).toHaveLength(1);
    expect(Object.keys(source.partitions[0]!.finalProjection.agents)).toHaveLength(25);
    expect(source.partitions[0]!.events).toEqual([]);
  });

  test('accepts pnpm argument separators for both new paper CLIs', () => {
    const argv = [
      '--',
      '--root-dir',
      './runtime',
      '--simulation-id',
      'aivilization-default-100',
      '--run-manifest-id',
      `resolved-run-manifest:sha256:${'a'.repeat(64)}`,
      '--analysis-run-id',
      'analysis-main',
      '--confirm-quiescent-source',
    ];
    expect(resolveLocalRuntimeTownPaperStratificationCliConfig({ argv, cwd: '/workspace' })).toMatchObject({
      rootDir: '/workspace/runtime',
      analysisRunId: 'analysis-main',
    });
    expect(resolveLocalRuntimeTownPaperTrajectoryCliConfig({ argv, cwd: '/workspace' })).toMatchObject({
      rootDir: '/workspace/runtime',
      analysisRunId: 'analysis-main',
    });
  });
});
