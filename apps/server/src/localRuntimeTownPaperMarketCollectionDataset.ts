import { join } from 'node:path';
import {
  streamMarketTradeObservationsFile,
  type PaperMatureMarketDatasetArtifact,
} from '@aivilization/observability';
import {
  FilePaperMarketCollectionLedger,
  runWorkerPaperMatureMarketDatasetStreamingExtraction,
  type PaperMarketCollectionSourceManifest,
} from '@aivilization/worker';
import {
  readPaperMarketSourceLedgerFileProvenance,
  resolvePaperMarketDatasetSourcePartitions,
} from './localRuntimeTownPaperMarketDatasetCli';

type FrozenShard = PaperMarketCollectionSourceManifest['shards'][number];

type FrozenPartition = {
  readonly partitionKey: string;
  readonly ledgerPath: string;
  readonly expectedLedgerFile: FrozenShard['finalResult']['partitions'][number]['ledgerFile'];
};

/**
 * Freezes either one independent replicate or every disjoint partition of one
 * globally barriered persistent society. Independent replicates can never be
 * pooled to satisfy the paper's volume threshold.
 */
export async function runLocalRuntimeTownPaperMarketCollectionDataset(input: {
  readonly collectionRootDir: string;
  readonly collectionId: string;
  readonly shardId?: string;
  readonly generatedAt: number;
}): Promise<PaperMatureMarketDatasetArtifact> {
  const ledger = new FilePaperMarketCollectionLedger(input.collectionRootDir);
  const sourceManifest = ledger.loadSourceManifest(input.collectionId);
  if (sourceManifest === undefined) {
    throw new Error(`paper market collection ${input.collectionId} has no frozen source manifest`);
  }
  const selected = selectDatasetShards(sourceManifest, input.shardId);
  const partitions = resolveFrozenPartitions(sourceManifest, selected.shards);
  await assertFrozenLedgerFiles(partitions, input.shardId);
  const artifactRootDir = join(input.collectionRootDir, 'artifacts');
  return runWorkerPaperMatureMarketDatasetStreamingExtraction({
    run: {
      runManifestId: selected.runManifestId,
      simulationId: sourceManifest.simulationId,
      partitionKeys: partitions.map((partition) => partition.partitionKey),
      sourceRevision: { ...sourceManifest.sourceRevision },
      seed: selected.seed,
      generatedAt: input.generatedAt,
      collectionWindowStartedAt: 0,
      collectionWindowEndedAt: selected.collectionWindowEndedAt,
    },
    sources: partitions.map((partition) => ({
      partitionKey: partition.partitionKey,
      openTrades: () =>
        streamMarketTradeObservationsFile({
          path: partition.ledgerPath,
          simulationId: sourceManifest.simulationId,
          fromObservedAt: 0,
          toObservedAtExclusive: selected.collectionWindowEndedAt,
        }),
      readLedgerFileProvenance: () =>
        readPaperMarketSourceLedgerFileProvenance(partition.ledgerPath),
    })),
    artifactRootDir,
    stagingDir: join(artifactRootDir, '.staging'),
  });
}

function selectDatasetShards(
  sourceManifest: PaperMarketCollectionSourceManifest,
  shardId: string | undefined,
): {
  readonly shards: readonly FrozenShard[];
  readonly runManifestId: string;
  readonly seed: string;
  readonly collectionWindowEndedAt: number;
} {
  if (
    sourceManifest.topology === 'independent-canonical-replicates' &&
    sourceManifest.aggregationRule === 'per-shard-only-never-merge-as-one-persistent-society'
  ) {
    if (shardId === undefined) {
      throw new Error('independent paper market collection extraction requires one shardId');
    }
    const shard = sourceManifest.shards.find((candidate) => candidate.shardId === shardId);
    if (shard === undefined) {
      throw new Error(`paper market collection shard ${shardId} does not exist`);
    }
    return {
      shards: [shard],
      runManifestId: shard.runManifestId,
      seed: shard.seed,
      collectionWindowEndedAt: shard.finalResult.collectionWindowEndedAt,
    };
  }
  if (
    sourceManifest.topology !== 'single-persistent-society-partitions' ||
    sourceManifest.aggregationRule !== 'merge-owned-partitions-after-global-epoch-barrier'
  ) {
    throw new Error('paper market collection topology and aggregation rule are inconsistent');
  }
  if (shardId !== undefined) {
    throw new Error('single-society paper market extraction must include every owned partition');
  }
  if (
    sourceManifest.schemaVersion !== 'paper-market-collection-source-v2' ||
    sourceManifest.globalRunManifestId === undefined ||
    sourceManifest.collectionSeed === undefined
  ) {
    throw new Error('single-society paper market extraction requires a v2 global run manifest');
  }
  const endedAt = new Set(
    sourceManifest.shards.map((shard) => shard.finalResult.collectionWindowEndedAt),
  );
  const startedAt = new Set(
    sourceManifest.shards.map((shard) => shard.finalResult.collectionWindowStartedAt),
  );
  if (endedAt.size !== 1 || startedAt.size !== 1) {
    throw new Error(
      'single-society paper market partitions did not stop at one global epoch barrier',
    );
  }
  if (sourceManifest.shards.some((shard) => shard.seed !== sourceManifest.collectionSeed)) {
    throw new Error('single-society paper market partitions do not share the collection seed');
  }
  return {
    shards: sourceManifest.shards,
    runManifestId: sourceManifest.globalRunManifestId,
    seed: sourceManifest.collectionSeed,
    collectionWindowEndedAt: [...endedAt][0]!,
  };
}

function resolveFrozenPartitions(
  sourceManifest: PaperMarketCollectionSourceManifest,
  shards: readonly FrozenShard[],
): FrozenPartition[] {
  const partitions = shards.flatMap((shard) => {
    const finalPartitionKeys = shard.finalResult.partitions
      .map((partition) => partition.partitionKey)
      .sort();
    if (shard.ownedPartitionKeys !== undefined) {
      const ownedPartitionKeys = [...shard.ownedPartitionKeys].sort();
      if (!sameStrings(finalPartitionKeys, ownedPartitionKeys)) {
        throw new Error(`paper market collection shard ${shard.shardId} ownership drifted`);
      }
    }
    const sources = resolvePaperMarketDatasetSourcePartitions({
      rootDir: shard.runtimeRootDir,
      simulationId: sourceManifest.simulationId,
      partitionKeys: finalPartitionKeys,
    });
    return sources.map((source) => {
      const expected = shard.finalResult.partitions.find(
        (partition) => partition.partitionKey === source.partitionKey,
      );
      if (expected === undefined) {
        throw new Error(`paper market source ${source.partitionKey} is absent from frozen result`);
      }
      return {
        partitionKey: source.partitionKey,
        ledgerPath: source.ledgerPath,
        expectedLedgerFile: expected.ledgerFile,
      };
    });
  });
  partitions.sort((left, right) => left.partitionKey.localeCompare(right.partitionKey));
  const partitionKeys = partitions.map((partition) => partition.partitionKey);
  if (new Set(partitionKeys).size !== partitionKeys.length) {
    throw new Error('paper market collection contains duplicate partition ownership');
  }
  return partitions;
}

async function assertFrozenLedgerFiles(
  partitions: readonly FrozenPartition[],
  shardId: string | undefined,
): Promise<void> {
  for (const partition of partitions) {
    const actual = await readPaperMarketSourceLedgerFileProvenance(partition.ledgerPath);
    if (
      actual.filename !== partition.expectedLedgerFile.filename ||
      actual.byteLength !== partition.expectedLedgerFile.byteLength ||
      actual.sha256 !== partition.expectedLedgerFile.sha256
    ) {
      const scope = shardId === undefined ? 'single-society' : `shard ${shardId}`;
      throw new Error(
        `paper market collection ${scope} source ${partition.partitionKey} changed after completion`,
      );
    }
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
