import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileLocalSimulationRuntimeResolvedRunManifestRepository,
  LOCAL_SIMULATION_RUNTIME_RESOLVED_RUN_MANIFEST_SCHEMA_VERSION,
  createLocalSimulationRuntimeResolvedRunManifest,
} from '@aivilization/worker';
import {
  assertPaperMarketDatasetManifestPolicies,
  createLocalRuntimeTownPaperMarketDatasetCliHelp,
  readPaperMarketSourceLedgerFileProvenance,
  resolveLocalRuntimeTownPaperMarketDatasetCliConfig,
  resolvePaperMarketDatasetManifestPartitionKeys,
  resolvePaperMarketDatasetSourcePartitions,
  runLocalRuntimeTownPaperMarketDatasetExtraction,
} from './localRuntimeTownPaperMarketDatasetCli';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('local runtime town paper market dataset CLI', () => {
  test('requires an explicit quiescent-source confirmation and complete provenance inputs', () => {
    expect(() =>
      resolveLocalRuntimeTownPaperMarketDatasetCliConfig({
        argv: [],
        cwd: '/workspace',
      }),
    ).toThrow('requires --confirm-quiescent-source');

    expect(
      resolveLocalRuntimeTownPaperMarketDatasetCliConfig({
        argv: [
          '--root-dir',
          './runtime',
          '--simulation-id',
          'sim-paper',
          '--run-manifest-id',
          'resolved-run-manifest:sha256:abc',
          '--collection-started-at',
          '100',
          '--collection-ended-at',
          '200',
          '--confirm-quiescent-source',
        ],
        cwd: '/workspace',
        now: 300,
      }),
    ).toEqual({
      rootDir: '/workspace/runtime',
      simulationId: 'sim-paper',
      runManifestId: 'resolved-run-manifest:sha256:abc',
      collectionWindowStartedAt: 100,
      collectionWindowEndedAt: 200,
      generatedAt: 300,
      confirmedQuiescentSource: true,
    });
    expect(createLocalRuntimeTownPaperMarketDatasetCliHelp()).toContain('>600,000 source trades');
    expect(createLocalRuntimeTownPaperMarketDatasetCliHelp()).toContain(
      'derived exactly from the resolved run manifest',
    );
  });

  test('fails before reading sources when the resolved run manifest is absent', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'paper-market-dataset-cli-missing-'));
    tempDirs.push(rootDir);
    await expect(
      runLocalRuntimeTownPaperMarketDatasetExtraction({
        rootDir,
        simulationId: 'sim-paper',
        runManifestId: `resolved-run-manifest:sha256:${'a'.repeat(64)}`,
        collectionWindowStartedAt: 0,
        collectionWindowEndedAt: 100,
        generatedAt: 200,
        confirmedQuiescentSource: true,
      }),
    ).rejects.toThrow('resolved run manifest does not exist');
  });

  test('derives a unique sorted partition set and rejects manifest simulation drift', () => {
    const scenario = {
      manifest: {
        partitions: [
          { simulationId: 'sim-paper', partitionKey: 'world-main' },
          { simulationId: 'sim-paper', partitionKey: 'world-east' },
        ],
      },
    };
    expect(resolvePaperMarketDatasetManifestPartitionKeys(scenario, 'sim-paper')).toEqual([
      'world-east',
      'world-main',
    ]);
    expect(() =>
      resolvePaperMarketDatasetManifestPartitionKeys(
        {
          manifest: {
            partitions: [
              { simulationId: 'sim-paper', partitionKey: 'world-main' },
              { simulationId: 'other-simulation', partitionKey: 'world-east' },
            ],
          },
        },
        'sim-paper',
      ),
    ).toThrow('does not match sim-paper');
  });

  test('rejects run manifests that predate the v2 dataset or current source policy', () => {
    expect(() =>
      assertPaperMarketDatasetManifestPolicies({
        validation: {
          paperMatureMarketDataset: { policyVersion: 'paper-mature-market-dataset-v1' },
        },
        observations: {},
      }),
    ).toThrow('must declare paper-mature-market-dataset-v2');
  });

  test('requires the exact manifest shard layout and hashes each raw ledger', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'paper-market-dataset-cli-'));
    tempDirs.push(rootDir);
    const partitionsDir = join(rootDir, 'simulations', 'sim-paper', 'partitions');
    const eastObservability = join(partitionsDir, 'world-east', 'observability');
    const mainObservability = join(partitionsDir, 'world-main', 'observability');
    mkdirSync(eastObservability, { recursive: true });
    mkdirSync(mainObservability, { recursive: true });
    const eastLedger = join(eastObservability, 'market-trade-observations.jsonl');
    const mainLedger = join(mainObservability, 'market-trade-observations.jsonl');
    writeFileSync(eastLedger, '{"observationId":"east"}\n', 'utf8');
    writeFileSync(mainLedger, '', 'utf8');

    expect(
      resolvePaperMarketDatasetSourcePartitions({
        rootDir,
        simulationId: 'sim-paper',
        partitionKeys: ['world-east', 'world-main'],
      }).map((source) => source.partitionKey),
    ).toEqual(['world-east', 'world-main']);
    await expect(readPaperMarketSourceLedgerFileProvenance(eastLedger)).resolves.toEqual({
      filename: 'market-trade-observations.jsonl',
      byteLength: 25,
      sha256: 'sha256:54ccf8dc92ac3eefea0ac6583c77dfbc04e9d68f746a606071fafcb460957c07',
    });

    mkdirSync(join(partitionsDir, 'world-extra'), { recursive: true });
    expect(() =>
      resolvePaperMarketDatasetSourcePartitions({
        rootDir,
        simulationId: 'sim-paper',
        partitionKeys: ['world-east', 'world-main'],
      }),
    ).toThrow('partitions absent from the resolved run manifest');
  });

  test('walks every manifest shard before enforcing the canonical paper volume gate', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'paper-market-dataset-cli-integration-'));
    tempDirs.push(rootDir);
    const manifest = createLocalSimulationRuntimeResolvedRunManifest({
      schemaVersion: LOCAL_SIMULATION_RUNTIME_RESOLVED_RUN_MANIFEST_SCHEMA_VERSION,
      composition: { id: 'town', version: 'test' },
      sourceRevision: { commit: '0123456789abcdef', dirty: true },
      seed: 'paper-market-seed',
      scenario: {
        profileId: 'default-100',
        manifest: {
          id: 'aivilization-default-100',
          partitions: [
            { simulationId: 'aivilization-default-100', partitionKey: 'world-main' },
            { simulationId: 'aivilization-default-100', partitionKey: 'world-east' },
          ],
        },
      },
      policies: {},
      cognition: {},
      memory: {},
      observations: {
        marketTradeObservations: {
          repositoryScope: 'per-partition-file-repository',
          policyVersion: 'paper-market-data-pipeline-v2',
          storage: { policyVersion: 'market-observation-storage-v3' },
        },
      },
      validation: {
        paperMatureMarketDataset: { policyVersion: 'paper-mature-market-dataset-v2' },
      },
      runtime: {},
    });
    await new FileLocalSimulationRuntimeResolvedRunManifestRepository({
      rootDir: join(rootDir, 'operations'),
    }).save(manifest);
    for (const [index, partitionKey] of ['world-east', 'world-main'].entries()) {
      const observabilityDir = join(
        rootDir,
        'simulations',
        'aivilization-default-100',
        'partitions',
        partitionKey,
        'observability',
      );
      mkdirSync(observabilityDir, { recursive: true });
      writeFileSync(
        join(observabilityDir, 'market-trade-observations.jsonl'),
        `${JSON.stringify({
          observationId: `${partitionKey}-trade`,
          simulationId: 'aivilization-default-100',
          agentId: `${partitionKey}-agent`,
          commodityId: 'Fish',
          sourceEventId: `${partitionKey}-event`,
          sourceSequence: index + 1,
          side: 'buy',
          observedAt: 10,
          price: 10,
          commodityQuantity: 1,
          currencyQuantity: 10,
        })}\n`,
        'utf8',
      );
    }

    await expect(
      runLocalRuntimeTownPaperMarketDatasetExtraction({
        rootDir,
        simulationId: 'aivilization-default-100',
        runManifestId: manifest.runManifestId,
        collectionWindowStartedAt: 0,
        collectionWindowEndedAt: 100,
        generatedAt: 200,
        confirmedQuiescentSource: true,
      }),
    ).rejects.toThrow('requires more than 600000 source trades; received 2');
  });
});
