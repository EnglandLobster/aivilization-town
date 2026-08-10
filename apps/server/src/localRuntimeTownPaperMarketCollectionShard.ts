import { resolve } from 'node:path';
import { FileMarketObservationRepository } from '@aivilization/observability';
import { sourceRevisionsEqual } from '@aivilization/sim-core';
import {
  createPaperMarketCollectionEpochResult,
  type PaperMarketCollectionEpochResult,
  type PaperMarketCollectionPlan,
} from '@aivilization/worker';
import {
  readPaperMarketSourceLedgerFileProvenance,
  resolvePaperMarketDatasetSourcePartitions,
} from './localRuntimeTownPaperMarketDatasetCli';
import { startLocalRuntimeTownCli, type LocalRuntimeTownCliConfig } from './localRuntimeTownCli';

export async function runLocalRuntimeTownPaperMarketCollectionShardEpoch(input: {
  readonly plan: PaperMarketCollectionPlan;
  readonly shard: PaperMarketCollectionPlan['shards'][number];
  readonly epochIndex: number;
  readonly idempotencyKey: string;
  readonly runtimeConfig: LocalRuntimeTownCliConfig;
  readonly previousResult?: PaperMarketCollectionEpochResult;
}): Promise<PaperMarketCollectionEpochResult> {
  assertInput(input);
  const application = await startLocalRuntimeTownCli(input.runtimeConfig, {
    daemonAutoStart: false,
    ...(input.shard.ownedPartitionKeys === undefined
      ? {}
      : { ownedPartitionKeys: input.shard.ownedPartitionKeys }),
  });
  try {
    const run = await application.runtime.runtimeOrchestration.supervisor.runCycles({
      operationId: input.idempotencyKey,
      requestedAt: input.epochIndex,
      cycleCount: input.plan.epochCycleCount,
      stopOnAttention: true,
    });
    if (
      run.outcome !== 'succeeded' ||
      run.stopReason !== 'cycle-count-completed' ||
      run.completedCycleCount !== input.plan.epochCycleCount
    ) {
      throw new Error(
        `paper market collection shard ${input.shard.shardId} epoch ${input.epochIndex} stopped with ${run.outcome}/${run.stopReason}/${run.completedCycleCount}`,
      );
    }
    const partitionKeys = application.runtime.runtimeOrchestration.host.partitions
      .map((partition) => partition.partitionKey)
      .sort();
    const expectedPartitionKeys =
      input.shard.ownedPartitionKeys === undefined
        ? undefined
        : [...input.shard.ownedPartitionKeys].sort();
    if (
      expectedPartitionKeys !== undefined &&
      (partitionKeys.length !== expectedPartitionKeys.length ||
        !partitionKeys.every((key, index) => key === expectedPartitionKeys[index]))
    ) {
      throw new Error(`collection shard ${input.shard.shardId} runtime ownership drifted`);
    }
    const sources = resolvePaperMarketDatasetSourcePartitions({
      rootDir: input.shard.runtimeRootDir,
      simulationId: input.plan.simulationId,
      partitionKeys,
    });
    const partitions = await Promise.all(
      sources.map(async (source) => ({
        partitionKey: source.partitionKey,
        tradeCount: new FileMarketObservationRepository({
          rootDir: source.observabilityDir,
        }).getStorageDiagnostics().tradeRecordCount,
        ledgerFile: await readPaperMarketSourceLedgerFileProvenance(source.ledgerPath),
      })),
    );
    const collectionWindowStartedAt = input.previousResult?.collectionWindowEndedAt ?? 0;
    const collectionWindowEndedAt = Math.max(
      ...application.runtime.runtimeOrchestration.host.partitions.map((partition) => {
        const checkpoint = partition.bootstrap.storage.checkpointStore.getLatestCheckpoint({
          simulationId: partition.bootstrap.storage.partition.simulationId,
          partitionKey: partition.bootstrap.storage.partition.partitionKey,
        });
        if (checkpoint?.snapshot === undefined) {
          throw new Error(
            `paper market collection partition ${partition.partitionKey} has no durable snapshot`,
          );
        }
        const projection = partition.bootstrap.storage.snapshotStore.loadSnapshot(
          checkpoint.snapshot,
        );
        if (projection === undefined) {
          throw new Error(
            `paper market collection partition ${partition.partitionKey} snapshot is missing`,
          );
        }
        return projection.clock.now;
      }),
    );
    if (collectionWindowEndedAt <= collectionWindowStartedAt) {
      throw new Error(
        `paper market collection shard ${input.shard.shardId} did not advance simulated time`,
      );
    }
    return createPaperMarketCollectionEpochResult({
      runManifestId: application.runManifestId,
      simulationId: input.plan.simulationId,
      shardId: input.shard.shardId,
      epochIndex: input.epochIndex,
      idempotencyKey: input.idempotencyKey,
      completedCycleCount: run.completedCycleCount,
      collectionWindowStartedAt,
      collectionWindowEndedAt,
      sourceRevision: { ...input.runtimeConfig.sourceRevision },
      seed: input.runtimeConfig.seed,
      partitions,
    });
  } finally {
    await application.close();
  }
}

function assertInput(input: {
  readonly plan: PaperMarketCollectionPlan;
  readonly shard: PaperMarketCollectionPlan['shards'][number];
  readonly epochIndex: number;
  readonly idempotencyKey: string;
  readonly runtimeConfig: LocalRuntimeTownCliConfig;
}): void {
  if (input.runtimeConfig.rootDir !== input.shard.runtimeRootDir) {
    throw new Error('collection shard runtime root does not match runtime config');
  }
  if (
    input.runtimeConfig.profileId !== input.plan.profileId ||
    input.runtimeConfig.seed !== input.shard.seed ||
    input.runtimeConfig.llmMode !== 'deterministic'
  ) {
    throw new Error('collection shard runtime config does not match its plan');
  }
  if (!sourceRevisionsEqual(input.runtimeConfig.sourceRevision, input.plan.sourceRevision)) {
    throw new Error('collection shard source revision does not match its plan');
  }
  if (!Number.isSafeInteger(input.epochIndex) || input.epochIndex < 0) {
    throw new Error('collection epochIndex must be a non-negative integer');
  }
  if (input.idempotencyKey.trim().length === 0) {
    throw new Error('collection idempotencyKey must not be empty');
  }
  if (resolve(input.shard.runtimeRootDir) !== input.shard.runtimeRootDir) {
    throw new Error('collection shard runtime root must be normalized');
  }
}
