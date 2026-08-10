import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createEpochIdempotencyKey,
  createPaperMarketCollectionPlan,
} from '@aivilization/worker';
import { resolveLocalRuntimeTownCliConfig } from './localRuntimeTownCli';
import { runLocalRuntimeTownPaperMarketCollectionShardEpoch } from './localRuntimeTownPaperMarketCollectionShard';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('local runtime paper market collection shard', () => {
  test('runs one exact canonical epoch without daemon races and replays by idempotency key', async () => {
    const rootDir = createTempDir();
    const sourceRevision = { commit: '0'.repeat(40), dirty: false } as const;
    const runtimeConfig = resolveLocalRuntimeTownCliConfig({
      argv: [
        '--profile',
        'smoke-25',
        '--root-dir',
        rootDir,
        '--port',
        '0',
        '--seed',
        'collection-seed:shard-a',
        '--llm-mode',
        'deterministic',
      ],
      cwd: rootDir,
      sourceRevision,
    });
    const plan = createPaperMarketCollectionPlan({
      simulationId: 'aivilization-smoke-25',
      profileId: 'smoke-25',
      sourceRevision,
      collectionSeed: 'collection-seed',
      epochCycleCount: 1,
      targetEpochCount: 2,
      leaseDurationMs: 30_000,
      maxAttemptsPerEpoch: 2,
      shards: [
        {
          shardId: 'shard-a',
          runtimeRootDir: rootDir,
          seed: 'collection-seed:shard-a',
        },
      ],
    });
    const shard = plan.shards[0]!;
    const idempotencyKey = createEpochIdempotencyKey(plan.collectionId, shard.shardId, 0);
    const first = await runLocalRuntimeTownPaperMarketCollectionShardEpoch({
      plan,
      shard,
      epochIndex: 0,
      idempotencyKey,
      runtimeConfig,
    });
    const replay = await runLocalRuntimeTownPaperMarketCollectionShardEpoch({
      plan,
      shard,
      epochIndex: 0,
      idempotencyKey,
      runtimeConfig,
    });

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      shardId: 'shard-a',
      epochIndex: 0,
      completedCycleCount: 1,
      simulationId: 'aivilization-smoke-25',
      partitions: [{ partitionKey: 'world-main' }],
    });
    expect(first.collectionWindowEndedAt).toBeGreaterThan(0);
  });
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'paper-market-collection-shard-'));
  tempDirs.push(dir);
  return dir;
}
