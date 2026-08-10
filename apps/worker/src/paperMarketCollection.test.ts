import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FilePaperMarketCollectionLedger,
  PAPER_MARKET_COLLECTION_SCHEMA_VERSION,
  createEpochIdempotencyKey,
  createPaperMarketCollectionEpochResult,
  createPaperMarketCollectionPlan,
  createPaperMarketCollectionSourceManifest,
  runPaperMarketCollection,
  type PaperMarketCollectionEpochResult,
  type PaperMarketCollectionPlan,
} from './index';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('paper market collection coordinator', () => {
  test('runs shards in parallel, serializes each shard epochs, and retries with one idempotency key', async () => {
    const plan = createPlan({ shardCount: 2, targetEpochCount: 2, maxAttemptsPerEpoch: 3 });
    const ledger = new FilePaperMarketCollectionLedger(createTempDir());
    const attempts = new Map<string, number>();
    const calls: string[] = [];
    const result = await runPaperMarketCollection({
      plan,
      ledger,
      leaseOwnerId: 'coordinator-a',
      maxParallelShards: 2,
      runner: async (request) => {
        const key = `${request.shard.shardId}:${request.epochIndex}`;
        const attempt = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, attempt);
        calls.push(`${key}:${attempt}`);
        await Promise.resolve();
        if (key === 'shard-b:0' && attempt === 1) throw new Error('transient crash');
        if (request.epochIndex > 0) {
          expect(request.previousResult?.epochIndex).toBe(request.epochIndex - 1);
        }
        return createResult(plan, request.shard.shardId, request.epochIndex);
      },
      clock: { now: () => 100 },
    });

    expect(result.complete).toBe(true);
    expect(result.completedEpochCount).toBe(4);
    expect(attempts.get('shard-b:0')).toBe(2);
    expect(calls.indexOf('shard-a:1:1')).toBeGreaterThan(calls.indexOf('shard-a:0:1'));
    expect(calls.indexOf('shard-b:1:1')).toBeGreaterThan(calls.indexOf('shard-b:0:2'));
    const shardBStarts = ledger
      .readEvents(plan.collectionId)
      .filter((event) => event.type === 'epoch-started' && event.shardId === 'shard-b');
    expect(shardBStarts.map((event) => [event.epochIndex, event.attempt])).toEqual([
      [0, 1],
      [0, 2],
      [1, 1],
    ]);
    const sourceManifest = createPaperMarketCollectionSourceManifest({ plan, projection: result });
    expect(sourceManifest).toMatchObject({
      topology: 'independent-canonical-replicates',
      aggregationRule: 'per-shard-only-never-merge-as-one-persistent-society',
      shards: [
        { shardId: 'shard-a', completedEpochCount: 2 },
        { shardId: 'shard-b', completedEpochCount: 2 },
      ],
    });
    expect(sourceManifest.sourceManifestId).toMatch(
      /^paper-market-collection-source:sha256:[a-f0-9]{64}$/u,
    );
    expect(ledger.saveSourceManifest(sourceManifest)).toEqual(sourceManifest);
  });

  test('does not steal a live lease and resumes the same epoch after lease expiry', async () => {
    const plan = createPlan({ shardCount: 1, targetEpochCount: 1, maxAttemptsPerEpoch: 2 });
    const ledger = new FilePaperMarketCollectionLedger(createTempDir());
    ledger.savePlan(plan);
    ledger.append({
      schemaVersion: PAPER_MARKET_COLLECTION_SCHEMA_VERSION,
      eventId: 'manually-started-before-crash',
      collectionId: plan.collectionId,
      type: 'epoch-started',
      shardId: 'shard-a',
      epochIndex: 0,
      attempt: 1,
      leaseOwnerId: 'dead-coordinator',
      leaseToken: 'dead-lease',
      occurredAt: 0,
      leaseExpiresAt: 10,
    });

    await expect(
      runPaperMarketCollection({
        plan,
        ledger,
        leaseOwnerId: 'coordinator-b',
        maxParallelShards: 1,
        runner: () => Promise.resolve(createResult(plan, 'shard-a', 0)),
        clock: { now: () => 5 },
      }),
    ).rejects.toThrow('active unexpired leases');

    await expect(
      runPaperMarketCollection({
        plan,
        ledger,
        leaseOwnerId: 'coordinator-b',
        maxParallelShards: 1,
        runner: () => Promise.resolve(createResult(plan, 'shard-a', 0)),
        clock: { now: () => 20 },
      }),
    ).resolves.toMatchObject({ complete: true, completedEpochCount: 1 });
    expect(
      ledger
        .readEvents(plan.collectionId)
        .filter((event) => event.type === 'epoch-started')
        .map((event) => event.attempt),
    ).toEqual([1, 2]);
  });

  test('holds every partition at the global epoch barrier until all peers complete', async () => {
    const plan = createSingleSocietyPlan();
    const ledger = new FilePaperMarketCollectionLedger(createTempDir());
    const calls: string[] = [];
    const attempts = new Map<string, number>();
    const projection = await runPaperMarketCollection({
      plan,
      ledger,
      leaseOwnerId: 'global-coordinator',
      maxParallelShards: 2,
      runner: async (request) => {
        const key = `${request.shard.shardId}:${request.epochIndex}`;
        const attempt = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, attempt);
        calls.push(`${key}:${attempt}`);
        await Promise.resolve();
        if (key === 'partition-east:0' && attempt === 1) {
          throw new Error('east partition restarted');
        }
        return createResult(plan, request.shard.shardId, request.epochIndex);
      },
      clock: { now: () => 100 },
    });

    expect(projection.complete).toBe(true);
    expect(calls.indexOf('partition-main:1:1')).toBeGreaterThan(
      calls.indexOf('partition-east:0:2'),
    );
    expect(calls.indexOf('partition-east:1:1')).toBeGreaterThan(
      calls.indexOf('partition-east:0:2'),
    );
    const sourceManifest = createPaperMarketCollectionSourceManifest({ plan, projection });
    expect(sourceManifest).toMatchObject({
      schemaVersion: 'paper-market-collection-source-v2',
      topology: 'single-persistent-society-partitions',
      aggregationRule: 'merge-owned-partitions-after-global-epoch-barrier',
      collectionSeed: 'single-society-seed',
    });
    expect(sourceManifest.globalRunManifestId).toMatch(
      /^paper-market-collection-global-run:sha256:[a-f0-9]{64}$/u,
    );
  });

  test('makes completion events idempotent and rejects altered replay or exhausted retries', async () => {
    const plan = createPlan({ shardCount: 1, targetEpochCount: 1, maxAttemptsPerEpoch: 1 });
    const ledger = new FilePaperMarketCollectionLedger(createTempDir());
    await runPaperMarketCollection({
      plan,
      ledger,
      leaseOwnerId: 'coordinator-a',
      maxParallelShards: 1,
      runner: () => Promise.resolve(createResult(plan, 'shard-a', 0)),
      clock: { now: () => 10 },
    });
    const completion = ledger
      .readEvents(plan.collectionId)
      .find((event) => event.type === 'epoch-completed')!;
    expect(() => ledger.append(completion)).not.toThrow();
    expect(() =>
      ledger.append({
        ...completion,
        occurredAt: completion.occurredAt + 1,
      }),
    ).toThrow('is immutable');

    const exhaustedPlan = createPlan({
      shardCount: 1,
      targetEpochCount: 1,
      maxAttemptsPerEpoch: 1,
    });
    const exhaustedLedger = new FilePaperMarketCollectionLedger(createTempDir());
    await expect(
      runPaperMarketCollection({
        plan: exhaustedPlan,
        ledger: exhaustedLedger,
        leaseOwnerId: 'coordinator-a',
        maxParallelShards: 1,
        runner: () => Promise.reject(new Error('permanent failure')),
        clock: { now: () => 10 },
      }),
    ).rejects.toThrow('exhausted retries for shard-a:0');
  });
});

function createPlan(input: {
  readonly shardCount: number;
  readonly targetEpochCount: number;
  readonly maxAttemptsPerEpoch: number;
}): PaperMarketCollectionPlan {
  return createPaperMarketCollectionPlan({
    simulationId: 'aivilization-default-100',
    profileId: 'default-100',
    sourceRevision: { commit: '0123456789abcdef', dirty: false },
    collectionSeed: 'collection-seed',
    epochCycleCount: 100,
    targetEpochCount: input.targetEpochCount,
    leaseDurationMs: 1_000,
    maxAttemptsPerEpoch: input.maxAttemptsPerEpoch,
    topology: 'independent-canonical-replicates',
    aggregationRule: 'per-shard-only-never-merge-as-one-persistent-society',
    shards: Array.from({ length: input.shardCount }, (_, index) => ({
      shardId: `shard-${String.fromCharCode(97 + index)}`,
      runtimeRootDir: `/runtime/shard-${index}`,
      seed: `collection-seed:shard:${index}`,
    })),
  });
}

function createSingleSocietyPlan(): PaperMarketCollectionPlan {
  return createPaperMarketCollectionPlan({
    simulationId: 'aivilization-default-100',
    profileId: 'default-100',
    sourceRevision: { commit: '0123456789abcdef', dirty: false },
    collectionSeed: 'single-society-seed',
    epochCycleCount: 100,
    targetEpochCount: 2,
    leaseDurationMs: 1_000,
    maxAttemptsPerEpoch: 3,
    topology: 'single-persistent-society-partitions',
    aggregationRule: 'merge-owned-partitions-after-global-epoch-barrier',
    shards: [
      {
        shardId: 'partition-main',
        runtimeRootDir: '/runtime/partition-main',
        seed: 'single-society-seed',
        ownedPartitionKeys: ['world-main'],
      },
      {
        shardId: 'partition-east',
        runtimeRootDir: '/runtime/partition-east',
        seed: 'single-society-seed',
        ownedPartitionKeys: ['world-east'],
      },
    ],
  });
}

function createResult(
  plan: PaperMarketCollectionPlan,
  shardId: string,
  epochIndex: number,
): PaperMarketCollectionEpochResult {
  const shard = plan.shards.find((candidate) => candidate.shardId === shardId)!;
  return createPaperMarketCollectionEpochResult({
    runManifestId: `resolved-run-manifest:sha256:${shardId}`,
    simulationId: plan.simulationId,
    shardId,
    epochIndex,
    idempotencyKey: createEpochIdempotencyKey(plan.collectionId, shardId, epochIndex),
    completedCycleCount: plan.epochCycleCount,
    collectionWindowStartedAt: epochIndex * 100,
    collectionWindowEndedAt: (epochIndex + 1) * 100,
    sourceRevision: plan.sourceRevision,
    seed: shard.seed,
    partitions: [
      {
        partitionKey: shard.ownedPartitionKeys?.[0] ?? 'world-main',
        tradeCount: (epochIndex + 1) * 10,
        ledgerFile: {
          filename: 'market-trade-observations.jsonl',
          byteLength: (epochIndex + 1) * 1_000,
          sha256: `sha256:${epochIndex.toString(16).padStart(64, '0')}`,
        },
      },
    ],
  });
}

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'paper-market-collection-'));
  tempDirs.push(dir);
  return dir;
}
