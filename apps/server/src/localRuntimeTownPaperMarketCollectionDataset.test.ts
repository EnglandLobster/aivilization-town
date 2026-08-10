import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { PAPER_MATURE_MARKET_SOURCE_LEDGER_FILENAME } from '@aivilization/observability';
import {
  FilePaperMarketCollectionLedger,
  createEpochIdempotencyKey,
  createPaperMarketCollectionEpochResult,
  createPaperMarketCollectionPlan,
  createPaperMarketCollectionSourceManifest,
  type PaperMarketCollectionPlan,
} from '@aivilization/worker';
import { runLocalRuntimeTownPaperMarketCollectionDataset } from './localRuntimeTownPaperMarketCollectionDataset';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('paper market collection dataset', () => {
  test('merges all owned single-society partitions and reaches the volume gate', async () => {
    const frozen = freezeSingleSocietyCollection();

    await expect(
      runLocalRuntimeTownPaperMarketCollectionDataset({
        collectionRootDir: frozen.rootDir,
        collectionId: frozen.plan.collectionId,
        generatedAt: 1,
      }),
    ).rejects.toThrow('source trades must not be empty');
    await expect(
      runLocalRuntimeTownPaperMarketCollectionDataset({
        collectionRootDir: frozen.rootDir,
        collectionId: frozen.plan.collectionId,
        shardId: frozen.plan.shards[0]!.shardId,
        generatedAt: 1,
      }),
    ).rejects.toThrow('must include every owned partition');
  });

  test('checks every owned ledger against the frozen source manifest before aggregation', async () => {
    const frozen = freezeSingleSocietyCollection();
    writeFileSync(frozen.ledgerPaths.get('world-main')!, '{}\n', 'utf8');

    await expect(
      runLocalRuntimeTownPaperMarketCollectionDataset({
        collectionRootDir: frozen.rootDir,
        collectionId: frozen.plan.collectionId,
        generatedAt: 1,
      }),
    ).rejects.toThrow('single-society source world-main changed after completion');
  });
});

function freezeSingleSocietyCollection(): {
  readonly rootDir: string;
  readonly plan: PaperMarketCollectionPlan;
  readonly ledgerPaths: ReadonlyMap<string, string>;
} {
  const rootDir = mkdtempSync(join(tmpdir(), 'paper-market-single-society-'));
  tempDirs.push(rootDir);
  const sourceRevision = { commit: '0'.repeat(40), dirty: false } as const;
  const partitionKeys = ['world-east', 'world-main'] as const;
  const plan = createPaperMarketCollectionPlan({
    simulationId: 'aivilization-default-100',
    profileId: 'default-100',
    sourceRevision,
    collectionSeed: 'shared-seed',
    epochCycleCount: 1,
    targetEpochCount: 1,
    leaseDurationMs: 1_000,
    maxAttemptsPerEpoch: 2,
    topology: 'single-persistent-society-partitions',
    aggregationRule: 'merge-owned-partitions-after-global-epoch-barrier',
    shards: partitionKeys.map((partitionKey, index) => ({
      shardId: `owner-${index}`,
      runtimeRootDir: join(rootDir, 'runtime-shards', `owner-${index}`),
      seed: 'shared-seed',
      ownedPartitionKeys: [partitionKey],
    })),
  });
  const emptyHash = `sha256:${createHash('sha256').digest('hex')}`;
  const ledgerPaths = new Map<string, string>();
  const epochs = plan.shards.map((shard) => {
    const partitionKey = shard.ownedPartitionKeys![0]!;
    const ledgerPath = join(
      shard.runtimeRootDir,
      'simulations',
      encodeURIComponent(plan.simulationId),
      'partitions',
      encodeURIComponent(partitionKey),
      'observability',
      PAPER_MATURE_MARKET_SOURCE_LEDGER_FILENAME,
    );
    mkdirSync(join(ledgerPath, '..'), { recursive: true });
    writeFileSync(ledgerPath, '', 'utf8');
    ledgerPaths.set(partitionKey, ledgerPath);
    const result = createPaperMarketCollectionEpochResult({
      runManifestId: `resolved-run-manifest:sha256:${String(shard.shardId).padEnd(64, '0')}`,
      simulationId: plan.simulationId,
      shardId: shard.shardId,
      epochIndex: 0,
      idempotencyKey: createEpochIdempotencyKey(plan.collectionId, shard.shardId, 0),
      completedCycleCount: 1,
      collectionWindowStartedAt: 0,
      collectionWindowEndedAt: 14_000,
      sourceRevision,
      seed: 'shared-seed',
      partitions: [
        {
          partitionKey,
          tradeCount: 0,
          ledgerFile: {
            filename: PAPER_MATURE_MARKET_SOURCE_LEDGER_FILENAME,
            byteLength: 0,
            sha256: emptyHash,
          },
        },
      ],
    });
    return {
      shardId: shard.shardId,
      epochIndex: 0,
      status: 'completed' as const,
      attempt: 1,
      result,
    };
  });
  const projection = {
    collectionId: plan.collectionId,
    complete: true,
    completedEpochCount: epochs.length,
    totalEpochCount: epochs.length,
    epochs,
  };
  const ledger = new FilePaperMarketCollectionLedger(rootDir);
  ledger.savePlan(plan);
  ledger.saveSourceManifest(createPaperMarketCollectionSourceManifest({ plan, projection }));
  return { rootDir, plan, ledgerPaths };
}
