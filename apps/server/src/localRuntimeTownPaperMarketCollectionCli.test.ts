import { describe, expect, test } from 'vitest';
import {
  createCanonicalLocalRuntimeTownServerInput,
  resolveLocalRuntimeTownCliConfig,
} from './localRuntimeTownCli';
import {
  createLocalRuntimeTownPaperMarketCollectionPlan,
  resolveLocalRuntimeTownPaperMarketCollectionCliConfig,
} from './localRuntimeTownPaperMarketCollectionCli';

const sourceRevision = {
  commit: '0123456789abcdef0123456789abcdef01234567',
  dirty: false,
} as const;

describe('local runtime paper market collection CLI', () => {
  test('defaults to one disjoint process owner per canonical partition', () => {
    const config = resolveLocalRuntimeTownPaperMarketCollectionCliConfig({
      argv: [
        '--collection-root-dir',
        './collection',
        '--profile',
        'default-100',
        '--collection-seed',
        'shared-seed',
      ],
      cwd: '/workspace',
      env: {
        AIVILIZATION_COMMIT: sourceRevision.commit,
        AIVILIZATION_SOURCE_DIRTY: 'false',
      },
    });
    const plan = createLocalRuntimeTownPaperMarketCollectionPlan(config);

    expect(config.topology).toBe('single-society');
    expect(plan).toMatchObject({
      topology: 'single-persistent-society-partitions',
      aggregationRule: 'merge-owned-partitions-after-global-epoch-barrier',
      collectionSeed: 'shared-seed',
      shards: [
        {
          shardId: 'partition-owner-000',
          seed: 'shared-seed',
          ownedPartitionKeys: ['world-east'],
        },
        {
          shardId: 'partition-owner-001',
          seed: 'shared-seed',
          ownedPartitionKeys: ['world-main'],
        },
      ],
    });
  });

  test('keeps independent replicates explicit and rejects invalid owner counts', () => {
    const baseArgv = [
      '--collection-root-dir',
      '/collection',
      '--profile',
      'default-100',
      '--collection-seed',
      'replicate-seed',
    ] as const;
    const env = {
      AIVILIZATION_COMMIT: sourceRevision.commit,
      AIVILIZATION_SOURCE_DIRTY: 'false',
    };
    const replicatePlan = createLocalRuntimeTownPaperMarketCollectionPlan(
      resolveLocalRuntimeTownPaperMarketCollectionCliConfig({
        argv: [...baseArgv, '--topology', 'replicates', '--shard-count', '3'],
        cwd: '/workspace',
        env,
      }),
    );
    expect(replicatePlan).toMatchObject({
      topology: 'independent-canonical-replicates',
      aggregationRule: 'per-shard-only-never-merge-as-one-persistent-society',
    });
    expect(replicatePlan.shards.map((shard) => shard.seed)).toEqual([
      'replicate-seed:shard:0',
      'replicate-seed:shard:1',
      'replicate-seed:shard:2',
    ]);
    expect(() =>
      createLocalRuntimeTownPaperMarketCollectionPlan(
        resolveLocalRuntimeTownPaperMarketCollectionCliConfig({
          argv: [...baseArgv, '--shard-count', '1'],
          cwd: '/workspace',
          env,
        }),
      ),
    ).toThrow('must equal canonical partition count 2');
  });

  test('materializes only owned runtime partitions while retaining the full canonical run manifest', () => {
    const runtimeConfig = resolveLocalRuntimeTownCliConfig({
      argv: [
        '--profile',
        'default-100',
        '--root-dir',
        '/runtime/east',
        '--port',
        '0',
        '--seed',
        'shared-seed',
        '--llm-mode',
        'deterministic',
      ],
      cwd: '/workspace',
      sourceRevision,
    });
    const serverInput = createCanonicalLocalRuntimeTownServerInput(runtimeConfig, 100, {
      daemonAutoStart: false,
      ownedPartitionKeys: ['world-east'],
    });
    const fullManifest = serverInput.resolvedRunManifest?.payload.scenario.manifest as {
      readonly partitions: readonly { readonly partitionKey: string }[];
    };

    expect(serverInput.manifest.partitions.map((partition) => partition.partitionKey)).toEqual([
      'world-east',
    ]);
    expect(serverInput.scenarioPresets).toHaveLength(1);
    expect(fullManifest.partitions.map((partition) => partition.partitionKey).sort()).toEqual([
      'world-east',
      'world-main',
    ]);
  });
});
