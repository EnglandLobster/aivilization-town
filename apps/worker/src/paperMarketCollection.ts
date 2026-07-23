import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { SourceRevision } from '@aivilization/sim-core';
import type { PaperMatureMarketSourceLedgerFile } from '@aivilization/observability';

export const PAPER_MARKET_COLLECTION_SCHEMA_VERSION = 'paper-market-collection-v1';
const COLLECTION_ID_PREFIX = 'paper-market-collection:sha256:';

export type PaperMarketCollectionPlan = {
  readonly schemaVersion: typeof PAPER_MARKET_COLLECTION_SCHEMA_VERSION;
  readonly collectionId: string;
  readonly simulationId: string;
  readonly profileId: string;
  readonly sourceRevision: SourceRevision;
  readonly collectionSeed: string;
  readonly epochCycleCount: number;
  readonly targetEpochCount: number;
  readonly leaseDurationMs: number;
  readonly maxAttemptsPerEpoch: number;
  readonly topology?: 'independent-canonical-replicates' | 'single-persistent-society-partitions';
  readonly aggregationRule?:
    | 'per-shard-only-never-merge-as-one-persistent-society'
    | 'merge-owned-partitions-after-global-epoch-barrier';
  readonly shards: readonly {
    readonly shardId: string;
    readonly runtimeRootDir: string;
    readonly seed: string;
    readonly ownedPartitionKeys?: readonly string[];
  }[];
};

export type PaperMarketCollectionEpochResult = {
  readonly resultId: string;
  readonly runManifestId: string;
  readonly simulationId: string;
  readonly shardId: string;
  readonly epochIndex: number;
  readonly idempotencyKey: string;
  readonly completedCycleCount: number;
  readonly collectionWindowStartedAt: number;
  readonly collectionWindowEndedAt: number;
  readonly sourceRevision: SourceRevision;
  readonly seed: string;
  readonly partitions: readonly {
    readonly partitionKey: string;
    readonly tradeCount: number;
    readonly ledgerFile: PaperMatureMarketSourceLedgerFile;
  }[];
};

export type PaperMarketCollectionLedgerEvent =
  | {
      readonly schemaVersion: typeof PAPER_MARKET_COLLECTION_SCHEMA_VERSION;
      readonly eventId: string;
      readonly collectionId: string;
      readonly type: 'epoch-started';
      readonly shardId: string;
      readonly epochIndex: number;
      readonly attempt: number;
      readonly leaseOwnerId: string;
      readonly leaseToken: string;
      readonly occurredAt: number;
      readonly leaseExpiresAt: number;
    }
  | {
      readonly schemaVersion: typeof PAPER_MARKET_COLLECTION_SCHEMA_VERSION;
      readonly eventId: string;
      readonly collectionId: string;
      readonly type: 'epoch-completed';
      readonly shardId: string;
      readonly epochIndex: number;
      readonly attempt: number;
      readonly leaseToken: string;
      readonly occurredAt: number;
      readonly result: PaperMarketCollectionEpochResult;
    }
  | {
      readonly schemaVersion: typeof PAPER_MARKET_COLLECTION_SCHEMA_VERSION;
      readonly eventId: string;
      readonly collectionId: string;
      readonly type: 'epoch-failed';
      readonly shardId: string;
      readonly epochIndex: number;
      readonly attempt: number;
      readonly leaseToken: string;
      readonly occurredAt: number;
      readonly error: string;
    };

export type PaperMarketCollectionEpochState = {
  readonly shardId: string;
  readonly epochIndex: number;
  readonly status: 'pending' | 'leased' | 'completed' | 'failed';
  readonly attempt: number;
  readonly leaseOwnerId?: string;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: number;
  readonly result?: PaperMarketCollectionEpochResult;
  readonly lastError?: string;
};

export type PaperMarketCollectionProjection = {
  readonly collectionId: string;
  readonly complete: boolean;
  readonly completedEpochCount: number;
  readonly totalEpochCount: number;
  readonly epochs: readonly PaperMarketCollectionEpochState[];
};

export type PaperMarketCollectionSourceManifest = {
  readonly schemaVersion: 'paper-market-collection-source-v1' | 'paper-market-collection-source-v2';
  readonly sourceManifestId: string;
  readonly collectionId: string;
  /** Present on v2 manifests and shared by every owned partition of one logical run. */
  readonly globalRunManifestId?: string;
  /** Present on v2 manifests. Kept optional so frozen v1 replicate manifests remain readable. */
  readonly collectionSeed?: string;
  readonly topology: NonNullable<PaperMarketCollectionPlan['topology']>;
  readonly aggregationRule: NonNullable<PaperMarketCollectionPlan['aggregationRule']>;
  readonly simulationId: string;
  readonly profileId: string;
  readonly sourceRevision: SourceRevision;
  readonly shards: readonly {
    readonly shardId: string;
    readonly runtimeRootDir: string;
    readonly seed: string;
    readonly ownedPartitionKeys?: readonly string[];
    readonly runManifestId: string;
    readonly completedEpochCount: number;
    readonly epochResultIds: readonly string[];
    readonly finalResult: PaperMarketCollectionEpochResult;
  }[];
};

export type PaperMarketCollectionRunner = (input: {
  readonly plan: PaperMarketCollectionPlan;
  readonly shard: PaperMarketCollectionPlan['shards'][number];
  readonly epochIndex: number;
  readonly idempotencyKey: string;
  readonly previousResult?: PaperMarketCollectionEpochResult;
}) => Promise<PaperMarketCollectionEpochResult>;

export function createPaperMarketCollectionPlan(input: {
  readonly simulationId: string;
  readonly profileId: string;
  readonly sourceRevision: SourceRevision;
  readonly collectionSeed: string;
  readonly epochCycleCount: number;
  readonly targetEpochCount: number;
  readonly leaseDurationMs: number;
  readonly maxAttemptsPerEpoch: number;
  readonly topology?: PaperMarketCollectionPlan['topology'];
  readonly aggregationRule?: PaperMarketCollectionPlan['aggregationRule'];
  readonly shards: PaperMarketCollectionPlan['shards'];
}): PaperMarketCollectionPlan {
  assertNonEmpty(input.simulationId, 'simulationId');
  assertNonEmpty(input.profileId, 'profileId');
  assertNonEmpty(input.sourceRevision.commit, 'sourceRevision.commit');
  assertNonEmpty(input.collectionSeed, 'collectionSeed');
  assertPositiveInteger(input.epochCycleCount, 'epochCycleCount');
  assertPositiveInteger(input.targetEpochCount, 'targetEpochCount');
  assertPositiveInteger(input.leaseDurationMs, 'leaseDurationMs');
  assertPositiveInteger(input.maxAttemptsPerEpoch, 'maxAttemptsPerEpoch');
  const shards = input.shards
    .map((shard) => ({ ...shard }))
    .sort((left, right) => left.shardId.localeCompare(right.shardId));
  if (shards.length === 0) throw new Error('collection shards must not be empty');
  const shardIds = new Set<string>();
  const roots = new Set<string>();
  const ownedPartitions = new Set<string>();
  for (const shard of shards) {
    assertSafeId(shard.shardId, 'shardId');
    assertNonEmpty(shard.runtimeRootDir, 'runtimeRootDir');
    assertNonEmpty(shard.seed, 'shard.seed');
    if (shardIds.has(shard.shardId)) throw new Error(`duplicate collection shard ${shard.shardId}`);
    if (roots.has(shard.runtimeRootDir))
      throw new Error(`duplicate collection runtime root ${shard.runtimeRootDir}`);
    shardIds.add(shard.shardId);
    roots.add(shard.runtimeRootDir);
    for (const partitionKey of shard.ownedPartitionKeys ?? []) {
      assertSafeId(partitionKey, 'ownedPartitionKey');
      if (ownedPartitions.has(partitionKey)) {
        throw new Error(`duplicate owned collection partition ${partitionKey}`);
      }
      ownedPartitions.add(partitionKey);
    }
  }
  if (input.topology === 'single-persistent-society-partitions') {
    if (
      input.aggregationRule !== 'merge-owned-partitions-after-global-epoch-barrier' ||
      shards.some(
        (shard) =>
          shard.seed !== input.collectionSeed || (shard.ownedPartitionKeys?.length ?? 0) === 0,
      )
    ) {
      throw new Error(
        'single-society collection requires shared seed and explicit partition ownership',
      );
    }
  } else if (
    input.topology === 'independent-canonical-replicates' &&
    (input.aggregationRule !== 'per-shard-only-never-merge-as-one-persistent-society' ||
      shards.some((shard) => shard.ownedPartitionKeys !== undefined))
  ) {
    throw new Error('independent replicate collection must not declare partition ownership');
  }
  const withoutId: Omit<PaperMarketCollectionPlan, 'collectionId'> = {
    schemaVersion: PAPER_MARKET_COLLECTION_SCHEMA_VERSION,
    simulationId: input.simulationId,
    profileId: input.profileId,
    sourceRevision: { ...input.sourceRevision },
    collectionSeed: input.collectionSeed,
    epochCycleCount: input.epochCycleCount,
    targetEpochCount: input.targetEpochCount,
    leaseDurationMs: input.leaseDurationMs,
    maxAttemptsPerEpoch: input.maxAttemptsPerEpoch,
    ...(input.topology === undefined ? {} : { topology: input.topology }),
    ...(input.aggregationRule === undefined ? {} : { aggregationRule: input.aggregationRule }),
    shards,
  };
  return {
    ...withoutId,
    collectionId: `${COLLECTION_ID_PREFIX}${sha256(stableStringify(withoutId))}`,
  };
}

export class FilePaperMarketCollectionLedger {
  constructor(private readonly rootDir: string) {
    assertNonEmpty(rootDir, 'rootDir');
  }

  savePlan(plan: PaperMarketCollectionPlan): PaperMarketCollectionPlan {
    assertValidPlan(plan);
    const directory = this.directory(plan.collectionId);
    const path = join(directory, 'plan.json');
    const content = `${JSON.stringify(plan, null, 2)}\n`;
    mkdirSync(directory, { recursive: true });
    if (existsSync(path)) {
      if (readFileSync(path, 'utf8') !== content) {
        throw new Error(`paper market collection ${plan.collectionId} plan is immutable`);
      }
      return clone(plan);
    }
    writeAtomically(path, content);
    return clone(plan);
  }

  loadPlan(collectionId: string): PaperMarketCollectionPlan | undefined {
    assertCollectionId(collectionId);
    const path = join(this.directory(collectionId), 'plan.json');
    if (!existsSync(path)) return undefined;
    const plan = JSON.parse(readFileSync(path, 'utf8')) as PaperMarketCollectionPlan;
    assertValidPlan(plan);
    if (plan.collectionId !== collectionId)
      throw new Error('collection plan path does not match content');
    return clone(plan);
  }

  readEvents(collectionId: string): PaperMarketCollectionLedgerEvent[] {
    assertCollectionId(collectionId);
    const path = join(this.directory(collectionId), 'events.jsonl');
    if (!existsSync(path)) return [];
    const content = readFileSync(path, 'utf8');
    if (content.length > 0 && !content.endsWith('\n')) {
      throw new Error('paper market collection ledger has an incomplete trailing row');
    }
    const events = content
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as PaperMarketCollectionLedgerEvent);
    const ids = new Set<string>();
    for (const event of events) {
      assertValidEvent(event, collectionId);
      if (ids.has(event.eventId)) throw new Error(`duplicate collection eventId ${event.eventId}`);
      ids.add(event.eventId);
    }
    return events.map(clone);
  }

  append(event: PaperMarketCollectionLedgerEvent): void {
    const plan = this.loadPlan(event.collectionId);
    if (plan === undefined)
      throw new Error(`paper market collection ${event.collectionId} does not exist`);
    assertValidEvent(event, plan.collectionId);
    const existing = this.readEvents(plan.collectionId);
    const duplicate = existing.find((candidate) => candidate.eventId === event.eventId);
    if (duplicate !== undefined) {
      if (stableStringify(duplicate) !== stableStringify(event)) {
        throw new Error(`collection event ${event.eventId} is immutable`);
      }
      return;
    }
    assertEventTransition(plan, existing, event);
    appendFileSync(
      join(this.directory(plan.collectionId), 'events.jsonl'),
      `${JSON.stringify(event)}\n`,
    );
  }

  project(collectionId: string, observedAt: number): PaperMarketCollectionProjection {
    assertNonNegativeFinite(observedAt, 'observedAt');
    const plan = this.loadPlan(collectionId);
    if (plan === undefined)
      throw new Error(`paper market collection ${collectionId} does not exist`);
    return projectCollection(plan, this.readEvents(collectionId), observedAt);
  }

  saveSourceManifest(
    manifest: PaperMarketCollectionSourceManifest,
  ): PaperMarketCollectionSourceManifest {
    if (
      manifest.collectionId.trim().length === 0 ||
      manifest.sourceManifestId.trim().length === 0
    ) {
      throw new Error('paper market collection source manifest IDs must not be empty');
    }
    const directory = this.directory(manifest.collectionId);
    const path = join(directory, 'source-manifest.json');
    const content = `${JSON.stringify(manifest, null, 2)}\n`;
    if (existsSync(path)) {
      if (readFileSync(path, 'utf8') !== content) {
        throw new Error(
          `paper market collection ${manifest.collectionId} source manifest is immutable`,
        );
      }
      return clone(manifest);
    }
    writeAtomically(path, content);
    return clone(manifest);
  }

  loadSourceManifest(collectionId: string): PaperMarketCollectionSourceManifest | undefined {
    assertCollectionId(collectionId);
    const path = join(this.directory(collectionId), 'source-manifest.json');
    if (!existsSync(path)) return undefined;
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as PaperMarketCollectionSourceManifest;
    const withoutId = Object.fromEntries(
      Object.entries(manifest).filter(([key]) => key !== 'sourceManifestId'),
    );
    const expectedId = `paper-market-collection-source:sha256:${sha256(stableStringify(withoutId))}`;
    if (
      (manifest.schemaVersion !== 'paper-market-collection-source-v1' &&
        manifest.schemaVersion !== 'paper-market-collection-source-v2') ||
      manifest.collectionId !== collectionId ||
      manifest.sourceManifestId !== expectedId
    ) {
      throw new Error('paper market collection source manifest content address is invalid');
    }
    if (
      manifest.schemaVersion === 'paper-market-collection-source-v2' &&
      (manifest.collectionSeed === undefined || manifest.globalRunManifestId === undefined)
    ) {
      throw new Error('paper market collection v2 source manifest is incomplete');
    }
    return clone(manifest);
  }

  private directory(collectionId: string): string {
    return join(this.rootDir, 'paper-market-collections', encodeURIComponent(collectionId));
  }
}

export async function runPaperMarketCollection(input: {
  readonly plan: PaperMarketCollectionPlan;
  readonly ledger: FilePaperMarketCollectionLedger;
  readonly leaseOwnerId: string;
  readonly maxParallelShards: number;
  readonly runner: PaperMarketCollectionRunner;
  readonly clock?: { readonly now: () => number };
}): Promise<PaperMarketCollectionProjection> {
  assertNonEmpty(input.leaseOwnerId, 'leaseOwnerId');
  assertPositiveInteger(input.maxParallelShards, 'maxParallelShards');
  input.ledger.savePlan(input.plan);
  const clock = input.clock ?? { now: () => Date.now() };
  while (true) {
    const observedAt = clock.now();
    const projection = input.ledger.project(input.plan.collectionId, observedAt);
    if (projection.complete) return projection;
    const runnable = projection.epochs
      .filter((epoch) => epoch.status === 'pending' || epoch.status === 'failed')
      .filter((epoch) => epoch.attempt < input.plan.maxAttemptsPerEpoch)
      .filter((epoch) => previousEpochComplete(input.plan, projection, epoch))
      .slice(0, input.maxParallelShards);
    if (runnable.length === 0) {
      const exhausted = projection.epochs.filter(
        (epoch) => epoch.status === 'failed' && epoch.attempt >= input.plan.maxAttemptsPerEpoch,
      );
      if (exhausted.length > 0) {
        throw new Error(
          `paper market collection exhausted retries for ${exhausted.map((epoch) => `${epoch.shardId}:${epoch.epochIndex}`).join(',')}`,
        );
      }
      throw new Error(
        'paper market collection has active unexpired leases and cannot make progress',
      );
    }
    await Promise.all(
      runnable.map(async (epoch) => {
        const shard = input.plan.shards.find((candidate) => candidate.shardId === epoch.shardId)!;
        const attempt = epoch.attempt + 1;
        const leaseToken = randomUUID();
        const startedAt = clock.now();
        input.ledger.append({
          schemaVersion: PAPER_MARKET_COLLECTION_SCHEMA_VERSION,
          eventId: eventId(
            input.plan.collectionId,
            epoch.shardId,
            epoch.epochIndex,
            attempt,
            'started',
          ),
          collectionId: input.plan.collectionId,
          type: 'epoch-started',
          shardId: epoch.shardId,
          epochIndex: epoch.epochIndex,
          attempt,
          leaseOwnerId: input.leaseOwnerId,
          leaseToken,
          occurredAt: startedAt,
          leaseExpiresAt: startedAt + input.plan.leaseDurationMs,
        });
        const idempotencyKey = createEpochIdempotencyKey(
          input.plan.collectionId,
          epoch.shardId,
          epoch.epochIndex,
        );
        try {
          const previousResult = previousCompletedResult(
            projection,
            epoch.shardId,
            epoch.epochIndex,
          );
          const result = await input.runner({
            plan: input.plan,
            shard,
            epochIndex: epoch.epochIndex,
            idempotencyKey,
            ...(previousResult === undefined ? {} : { previousResult }),
          });
          assertEpochResult(input.plan, shard, epoch.epochIndex, idempotencyKey, result);
          input.ledger.append({
            schemaVersion: PAPER_MARKET_COLLECTION_SCHEMA_VERSION,
            eventId: eventId(
              input.plan.collectionId,
              epoch.shardId,
              epoch.epochIndex,
              attempt,
              'completed',
            ),
            collectionId: input.plan.collectionId,
            type: 'epoch-completed',
            shardId: epoch.shardId,
            epochIndex: epoch.epochIndex,
            attempt,
            leaseToken,
            occurredAt: clock.now(),
            result,
          });
        } catch (error) {
          const failedAt = clock.now();
          if (failedAt >= startedAt + input.plan.leaseDurationMs) {
            throw new Error(
              `paper market collection lease expired for ${epoch.shardId}:${epoch.epochIndex} attempt ${attempt}`,
              { cause: error },
            );
          }
          input.ledger.append({
            schemaVersion: PAPER_MARKET_COLLECTION_SCHEMA_VERSION,
            eventId: eventId(
              input.plan.collectionId,
              epoch.shardId,
              epoch.epochIndex,
              attempt,
              'failed',
            ),
            collectionId: input.plan.collectionId,
            type: 'epoch-failed',
            shardId: epoch.shardId,
            epochIndex: epoch.epochIndex,
            attempt,
            leaseToken,
            occurredAt: failedAt,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  }
}

export function createEpochIdempotencyKey(
  collectionId: string,
  shardId: string,
  epochIndex: number,
): string {
  return `${collectionId}:shard:${shardId}:epoch:${epochIndex}`;
}

export function createPaperMarketCollectionSourceManifest(input: {
  readonly plan: PaperMarketCollectionPlan;
  readonly projection: PaperMarketCollectionProjection;
}): PaperMarketCollectionSourceManifest {
  if (!input.projection.complete || input.projection.collectionId !== input.plan.collectionId) {
    throw new Error('paper market collection must be complete before freezing sources');
  }
  if (input.plan.topology === undefined || input.plan.aggregationRule === undefined) {
    throw new Error('paper market collection source topology must be explicit');
  }
  if (
    (input.plan.topology === 'independent-canonical-replicates' &&
      input.plan.aggregationRule !== 'per-shard-only-never-merge-as-one-persistent-society') ||
    (input.plan.topology === 'single-persistent-society-partitions' &&
      input.plan.aggregationRule !== 'merge-owned-partitions-after-global-epoch-barrier')
  ) {
    throw new Error('paper market collection topology and aggregation rule are inconsistent');
  }
  const shards = input.plan.shards.map((shard) => {
    const epochs = input.projection.epochs
      .filter((epoch) => epoch.shardId === shard.shardId)
      .sort((left, right) => left.epochIndex - right.epochIndex);
    const results = epochs.map((epoch) => {
      if (epoch.status !== 'completed' || epoch.result === undefined) {
        throw new Error(`paper market collection shard ${shard.shardId} is incomplete`);
      }
      return epoch.result;
    });
    const finalResult = results.at(-1);
    if (finalResult === undefined || finalResult.epochIndex !== input.plan.targetEpochCount - 1) {
      throw new Error(`paper market collection shard ${shard.shardId} final epoch is missing`);
    }
    assertShardEpochSequence(input.plan, shard, results);
    return {
      shardId: shard.shardId,
      runtimeRootDir: shard.runtimeRootDir,
      seed: shard.seed,
      ...(shard.ownedPartitionKeys === undefined
        ? {}
        : { ownedPartitionKeys: [...shard.ownedPartitionKeys] }),
      runManifestId: finalResult.runManifestId,
      completedEpochCount: results.length,
      epochResultIds: results.map((result) => result.resultId),
      finalResult: clone(finalResult),
    };
  });
  if (input.plan.topology === 'single-persistent-society-partitions') {
    assertGlobalEpochWindows(input.plan, input.projection);
  }
  const globalRunManifestId = `paper-market-collection-global-run:sha256:${sha256(
    stableStringify({
      collectionId: input.plan.collectionId,
      simulationId: input.plan.simulationId,
      profileId: input.plan.profileId,
      sourceRevision: input.plan.sourceRevision,
      collectionSeed: input.plan.collectionSeed,
      topology: input.plan.topology,
      shards: shards.map((shard) => ({
        shardId: shard.shardId,
        runManifestId: shard.runManifestId,
        ownedPartitionKeys: shard.ownedPartitionKeys ?? [],
      })),
    }),
  )}`;
  const withoutId: Omit<PaperMarketCollectionSourceManifest, 'sourceManifestId'> = {
    schemaVersion: 'paper-market-collection-source-v2',
    collectionId: input.plan.collectionId,
    globalRunManifestId,
    collectionSeed: input.plan.collectionSeed,
    topology: input.plan.topology,
    aggregationRule: input.plan.aggregationRule,
    simulationId: input.plan.simulationId,
    profileId: input.plan.profileId,
    sourceRevision: clone(input.plan.sourceRevision),
    shards,
  };
  return {
    ...withoutId,
    sourceManifestId: `paper-market-collection-source:sha256:${sha256(stableStringify(withoutId))}`,
  };
}

export function createPaperMarketCollectionEpochResult(
  input: Omit<PaperMarketCollectionEpochResult, 'resultId'>,
): PaperMarketCollectionEpochResult {
  const canonical = clone(input);
  return {
    ...canonical,
    resultId: `paper-market-collection-epoch:sha256:${sha256(stableStringify(canonical))}`,
  };
}

function projectCollection(
  plan: PaperMarketCollectionPlan,
  events: readonly PaperMarketCollectionLedgerEvent[],
  observedAt: number,
): PaperMarketCollectionProjection {
  const states = new Map<string, PaperMarketCollectionEpochState>();
  for (const shard of plan.shards) {
    for (let epochIndex = 0; epochIndex < plan.targetEpochCount; epochIndex += 1) {
      states.set(epochKey(shard.shardId, epochIndex), {
        shardId: shard.shardId,
        epochIndex,
        status: 'pending',
        attempt: 0,
      });
    }
  }
  for (const event of events) {
    const key = epochKey(event.shardId, event.epochIndex);
    const current = states.get(key)!;
    if (event.type === 'epoch-started') {
      states.set(key, {
        shardId: event.shardId,
        epochIndex: event.epochIndex,
        status: event.leaseExpiresAt <= observedAt ? 'failed' : 'leased',
        attempt: event.attempt,
        leaseOwnerId: event.leaseOwnerId,
        leaseToken: event.leaseToken,
        leaseExpiresAt: event.leaseExpiresAt,
        ...(event.leaseExpiresAt <= observedAt ? { lastError: 'lease-expired' } : {}),
      });
    } else if (event.type === 'epoch-completed') {
      states.set(key, {
        shardId: event.shardId,
        epochIndex: event.epochIndex,
        status: 'completed',
        attempt: event.attempt,
        result: clone(event.result),
      });
    } else {
      states.set(key, {
        shardId: event.shardId,
        epochIndex: event.epochIndex,
        status: 'failed',
        attempt: event.attempt,
        lastError: event.error,
      });
    }
    void current;
  }
  const epochs = [...states.values()].sort(
    (left, right) =>
      left.epochIndex - right.epochIndex || left.shardId.localeCompare(right.shardId),
  );
  const completedEpochCount = epochs.filter((epoch) => epoch.status === 'completed').length;
  return {
    collectionId: plan.collectionId,
    complete: completedEpochCount === epochs.length,
    completedEpochCount,
    totalEpochCount: epochs.length,
    epochs,
  };
}

function assertEventTransition(
  plan: PaperMarketCollectionPlan,
  events: readonly PaperMarketCollectionLedgerEvent[],
  event: PaperMarketCollectionLedgerEvent,
): void {
  const projection = projectCollection(plan, events, event.occurredAt);
  const state = projection.epochs.find(
    (candidate) => candidate.shardId === event.shardId && candidate.epochIndex === event.epochIndex,
  );
  if (state === undefined) throw new Error('collection event targets an unknown epoch');
  if (state.status === 'completed') throw new Error('completed collection epoch is immutable');
  if (event.type === 'epoch-started') {
    if (state.status === 'leased') throw new Error('collection epoch already has an active lease');
    if (event.attempt !== state.attempt + 1)
      throw new Error('collection epoch attempt is not monotonic');
    if (!previousEpochComplete(plan, projection, state))
      throw new Error('previous collection epoch is incomplete');
    return;
  }
  if (
    state.status !== 'leased' ||
    state.leaseToken !== event.leaseToken ||
    state.attempt !== event.attempt
  ) {
    throw new Error('collection epoch completion does not own the active lease');
  }
}

function previousEpochComplete(
  plan: PaperMarketCollectionPlan,
  projection: PaperMarketCollectionProjection,
  epoch: Pick<PaperMarketCollectionEpochState, 'shardId' | 'epochIndex'>,
): boolean {
  if (epoch.epochIndex === 0) return true;
  if (plan.topology === 'single-persistent-society-partitions') {
    return plan.shards.every((shard) =>
      projection.epochs.some(
        (candidate) =>
          candidate.shardId === shard.shardId &&
          candidate.epochIndex === epoch.epochIndex - 1 &&
          candidate.status === 'completed',
      ),
    );
  }
  return projection.epochs.some(
    (candidate) =>
      candidate.shardId === epoch.shardId &&
      candidate.epochIndex === epoch.epochIndex - 1 &&
      candidate.status === 'completed',
  );
}

function previousCompletedResult(
  projection: PaperMarketCollectionProjection,
  shardId: string,
  epochIndex: number,
): PaperMarketCollectionEpochResult | undefined {
  if (epochIndex === 0) return undefined;
  return projection.epochs.find(
    (candidate) => candidate.shardId === shardId && candidate.epochIndex === epochIndex - 1,
  )?.result;
}

function assertEpochResult(
  plan: PaperMarketCollectionPlan,
  shard: PaperMarketCollectionPlan['shards'][number],
  epochIndex: number,
  idempotencyKey: string,
  result: PaperMarketCollectionEpochResult,
): void {
  if (
    result.simulationId !== plan.simulationId ||
    result.shardId !== shard.shardId ||
    result.epochIndex !== epochIndex ||
    result.idempotencyKey !== idempotencyKey ||
    result.seed !== shard.seed ||
    stableStringify(result.sourceRevision) !== stableStringify(plan.sourceRevision)
  ) {
    throw new Error('paper market collection epoch result provenance does not match its plan');
  }
  if (result.completedCycleCount !== plan.epochCycleCount) {
    throw new Error('paper market collection epoch completed cycle count does not match its plan');
  }
  if (result.collectionWindowEndedAt <= result.collectionWindowStartedAt) {
    throw new Error('paper market collection epoch result window must have positive duration');
  }
  if (result.partitions.length === 0)
    throw new Error('paper market collection result has no partitions');
  if (shard.ownedPartitionKeys !== undefined) {
    const expectedPartitionKeys = [...shard.ownedPartitionKeys].sort();
    const actualPartitionKeys = result.partitions.map((partition) => partition.partitionKey).sort();
    if (!sameStrings(actualPartitionKeys, expectedPartitionKeys)) {
      throw new Error('paper market collection epoch result does not match shard ownership');
    }
  }
  assertNonEmpty(result.resultId, 'resultId');
  const recreated = createPaperMarketCollectionEpochResult(
    Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'resultId')) as Omit<
      PaperMarketCollectionEpochResult,
      'resultId'
    >,
  );
  if (recreated.resultId !== result.resultId) {
    throw new Error('paper market collection epoch result content address is invalid');
  }
  assertNonEmpty(result.runManifestId, 'runManifestId');
}

function assertShardEpochSequence(
  plan: PaperMarketCollectionPlan,
  shard: PaperMarketCollectionPlan['shards'][number],
  results: readonly PaperMarketCollectionEpochResult[],
): void {
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]!;
    const previous = results[index - 1];
    if (
      result.epochIndex !== index ||
      result.shardId !== shard.shardId ||
      result.seed !== shard.seed ||
      result.completedCycleCount !== plan.epochCycleCount ||
      result.collectionWindowStartedAt !== (previous?.collectionWindowEndedAt ?? 0)
    ) {
      throw new Error(
        `paper market collection shard ${shard.shardId} epoch sequence is discontinuous`,
      );
    }
  }
}

function assertGlobalEpochWindows(
  plan: PaperMarketCollectionPlan,
  projection: PaperMarketCollectionProjection,
): void {
  for (let epochIndex = 0; epochIndex < plan.targetEpochCount; epochIndex += 1) {
    const results = plan.shards.map(
      (shard) =>
        projection.epochs.find(
          (epoch) => epoch.shardId === shard.shardId && epoch.epochIndex === epochIndex,
        )?.result,
    );
    if (results.some((result) => result === undefined)) {
      throw new Error(`single-society collection epoch ${epochIndex} is incomplete`);
    }
    const first = results[0]!;
    if (
      results.some(
        (result) =>
          result!.collectionWindowStartedAt !== first.collectionWindowStartedAt ||
          result!.collectionWindowEndedAt !== first.collectionWindowEndedAt,
      )
    ) {
      throw new Error(
        `single-society collection epoch ${epochIndex} crossed a global time barrier`,
      );
    }
  }
}

function assertValidPlan(plan: PaperMarketCollectionPlan): void {
  const recreated = createPaperMarketCollectionPlan({
    simulationId: plan.simulationId,
    profileId: plan.profileId,
    sourceRevision: plan.sourceRevision,
    collectionSeed: plan.collectionSeed,
    epochCycleCount: plan.epochCycleCount,
    targetEpochCount: plan.targetEpochCount,
    leaseDurationMs: plan.leaseDurationMs,
    maxAttemptsPerEpoch: plan.maxAttemptsPerEpoch,
    ...(plan.topology === undefined ? {} : { topology: plan.topology }),
    ...(plan.aggregationRule === undefined ? {} : { aggregationRule: plan.aggregationRule }),
    shards: plan.shards,
  });
  if (
    plan.schemaVersion !== PAPER_MARKET_COLLECTION_SCHEMA_VERSION ||
    recreated.collectionId !== plan.collectionId
  ) {
    throw new Error('paper market collection plan content address is invalid');
  }
}

function assertValidEvent(event: PaperMarketCollectionLedgerEvent, collectionId: string): void {
  if (
    event.schemaVersion !== PAPER_MARKET_COLLECTION_SCHEMA_VERSION ||
    event.collectionId !== collectionId
  ) {
    throw new Error('paper market collection event provenance is invalid');
  }
  assertNonEmpty(event.eventId, 'eventId');
  assertSafeId(event.shardId, 'shardId');
  assertNonNegativeInteger(event.epochIndex, 'epochIndex');
  assertPositiveInteger(event.attempt, 'attempt');
  assertNonNegativeFinite(event.occurredAt, 'occurredAt');
  assertNonEmpty(event.leaseToken, 'leaseToken');
}

function eventId(
  collectionId: string,
  shardId: string,
  epochIndex: number,
  attempt: number,
  phase: string,
): string {
  return `paper-market-collection-event:sha256:${sha256(stableStringify({ collectionId, shardId, epochIndex, attempt, phase }))}`;
}

function epochKey(shardId: string, epochIndex: number): string {
  return `${shardId}\u0000${epochIndex}`;
}

function writeAtomically(path: string, content: string): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, content, 'utf8');
  renameSync(temporaryPath, path);
}

function assertCollectionId(value: string): void {
  if (!/^paper-market-collection:sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error('paper market collection ID is invalid');
  }
}

function assertSafeId(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) throw new Error(`${name} is not a safe ID`);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) throw new Error(`${name} must not be empty`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${name} must be non-negative and finite`);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
