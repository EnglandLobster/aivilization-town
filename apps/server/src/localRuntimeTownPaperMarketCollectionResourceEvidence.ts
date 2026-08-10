import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { Dirent } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import type {
  PaperMarketCollectionEpochResult,
  PaperMarketCollectionPlan,
  PaperMarketCollectionProjection,
  PaperMarketCollectionSourceManifest,
} from '@aivilization/worker';
import type { PaperMarketCollectionProcessObserver } from './localRuntimeTownPaperMarketCollectionProcess';

export const PAPER_MARKET_COLLECTION_RESOURCE_EVIDENCE_SCHEMA_VERSION =
  'paper-market-collection-resource-evidence-v1';

const ARTIFACT_ID_PREFIX = 'paper-market-collection-resource-evidence:sha256:';

export type PaperMarketCollectionResourceSample = {
  readonly observedAt: number;
  readonly coordinatorRssBytes: number;
  readonly childProcesses: readonly {
    readonly executionId: string;
    readonly shardId: string;
    readonly epochIndex: number;
    readonly pid: number;
    readonly rssBytes: number;
  }[];
  readonly activeChildProcessCount: number;
  readonly sampledChildProcessCount: number;
  readonly observedCompletedEpochCount: number;
  readonly observedCompletedPartitionCycleCount: number;
  readonly observedTradeCount: number;
  readonly aggregateChildRssBytes: number;
  readonly aggregateProcessRssBytes: number;
  readonly storage: {
    readonly regularFileCount: number;
    readonly totalBytes: number;
  };
};

export type PaperMarketCollectionResourceEvidenceArtifact = {
  readonly schemaVersion: typeof PAPER_MARKET_COLLECTION_RESOURCE_EVIDENCE_SCHEMA_VERSION;
  readonly artifactId: string;
  readonly run: {
    readonly probeRunId: string;
    readonly collectionId: string;
    readonly sourceManifestId: string;
    readonly globalRunManifestId?: string;
    readonly profileId: string;
    readonly topology: NonNullable<PaperMarketCollectionPlan['topology']>;
    readonly aggregationRule: NonNullable<PaperMarketCollectionPlan['aggregationRule']>;
    readonly sourceRevision: PaperMarketCollectionPlan['sourceRevision'];
    readonly shardCount: number;
    readonly maxParallelShards: number;
    readonly epochCycleCount: number;
    readonly targetEpochCount: number;
    readonly initialCompletedEpochCount: number;
    readonly finalCompletedEpochCount: number;
    readonly startedAt: number;
    readonly endedAt: number;
    readonly sampleIntervalMs: number;
    readonly collectionRootDir: string;
    readonly environment: {
      readonly platform: string;
      readonly architecture: string;
      readonly osRelease: string;
      readonly logicalCpuCount: number;
      readonly totalMemoryBytes: number;
      readonly nodeVersion: string;
    };
  };
  readonly samples: readonly PaperMarketCollectionResourceSample[];
  readonly completedEpochResults: readonly {
    readonly resultId: string;
    readonly shardId: string;
    readonly epochIndex: number;
    readonly completedCycleCount: number;
    readonly cumulativeTradeCount: number;
    readonly observedTradeCount: number;
  }[];
  readonly summary: {
    readonly durationMs: number;
    readonly sampleCount: number;
    readonly maximumSampleGapMs: number;
    readonly maximumObservedParallelChildCount: number;
    readonly peakCoordinatorRssBytes: number;
    readonly peakAggregateChildRssBytes: number;
    readonly peakAggregateProcessRssBytes: number;
    readonly baselineStorageBytes: number;
    readonly finalStorageBytes: number;
    readonly storageGrowthBytes: number;
    readonly observedCompletedEpochCount: number;
    readonly completedPartitionCycleCount: number;
    readonly observedTradeCount: number;
    readonly completedPartitionCyclesPerSecond: number;
    readonly observedTradesPerSecond: number;
  };
  readonly evidenceClassification: {
    readonly mechanism: 'verified-by-content-addressed-artifact';
    readonly scope: 'multi-process-partitioned-market-collection-invocation';
    readonly purpose: 'capacity-planning-observation';
    readonly memoryMeasurement: 'point-sampled-coordinator-plus-child-rss';
    readonly paperScaleEstablished: false;
    readonly matureMarketDatasetEstablished: false;
  };
};

type ActiveChild = {
  readonly executionId: string;
  readonly shardId: string;
  readonly epochIndex: number;
  readonly pid: number;
};

export type PaperMarketCollectionResourceMonitor = {
  readonly observer: PaperMarketCollectionProcessObserver;
  readonly start: () => Promise<void>;
  readonly finish: (input: {
    readonly sourceManifest: PaperMarketCollectionSourceManifest;
    readonly finalProjection: PaperMarketCollectionProjection;
  }) => Promise<PaperMarketCollectionResourceEvidenceArtifact>;
  readonly stop: () => Promise<void>;
};

export function createPaperMarketCollectionResourceMonitor(input: {
  readonly probeRunId: string;
  readonly collectionRootDir: string;
  readonly artifactRootDir: string;
  readonly sampleIntervalMs: number;
  readonly maxParallelShards: number;
  readonly plan: PaperMarketCollectionPlan;
  readonly initialProjection: PaperMarketCollectionProjection;
  readonly clock?: { readonly now: () => number };
  readonly processRssSampler?: (pid: number) => Promise<number | undefined>;
}): PaperMarketCollectionResourceMonitor {
  assertNonEmpty(input.probeRunId, 'probeRunId');
  assertPositiveInteger(input.sampleIntervalMs, 'sampleIntervalMs');
  assertPositiveInteger(input.maxParallelShards, 'maxParallelShards');
  const clock = input.clock ?? { now: () => Date.now() };
  const processRssSampler = input.processRssSampler ?? sampleProcessRssBytes;
  const activeChildren = new Map<string, ActiveChild>();
  const completedResults = new Map<string, PaperMarketCollectionEpochResult>();
  const previousTradeCountByShard = latestTradeCounts(input.initialProjection);
  const samples: PaperMarketCollectionResourceSample[] = [];
  let observedCompletedPartitionCycleCount = 0;
  let observedTradeCount = 0;
  let interval: NodeJS.Timeout | undefined;
  let startedAt: number | undefined;
  let sampleChain = Promise.resolve();

  const requestSample = (): void => {
    sampleChain = sampleChain.then(async () => {
      const observedAt = clock.now();
      if (samples.at(-1)?.observedAt === observedAt) return;
      samples.push(
        await captureSample({
          observedAt,
          collectionRootDir: input.collectionRootDir,
          activeChildren: [...activeChildren.values()],
          observedCompletedEpochCount: completedResults.size,
          observedCompletedPartitionCycleCount,
          observedTradeCount,
          processRssSampler,
        }),
      );
    });
  };

  const observer: PaperMarketCollectionProcessObserver = {
    onChildStarted(child) {
      activeChildren.set(child.executionId, child);
      requestSample();
    },
    onChildCompleted(child) {
      if (completedResults.has(child.result.resultId)) return;
      completedResults.set(child.result.resultId, child.result);
      observedCompletedPartitionCycleCount += child.result.completedCycleCount;
      const cumulativeTradeCount = child.result.partitions.reduce(
        (total, partition) => total + partition.tradeCount,
        0,
      );
      const previousTradeCount = previousTradeCountByShard.get(child.shardId) ?? 0;
      observedTradeCount += Math.max(0, cumulativeTradeCount - previousTradeCount);
      previousTradeCountByShard.set(child.shardId, cumulativeTradeCount);
      activeChildren.delete(child.executionId);
      requestSample();
    },
    onChildFailed(child) {
      activeChildren.delete(child.executionId);
      requestSample();
    },
  };

  const stopSampling = async (): Promise<void> => {
    if (interval !== undefined) {
      clearInterval(interval);
      interval = undefined;
    }
    requestSample();
    await sampleChain;
  };

  return {
    observer,
    async start() {
      if (startedAt !== undefined) throw new Error('collection resource monitor already started');
      startedAt = clock.now();
      requestSample();
      await sampleChain;
      interval = setInterval(requestSample, input.sampleIntervalMs);
      interval.unref();
    },
    async finish({ sourceManifest, finalProjection }) {
      if (startedAt === undefined) throw new Error('collection resource monitor was not started');
      await stopSampling();
      const artifact = createPaperMarketCollectionResourceEvidenceArtifact({
        probeRunId: input.probeRunId,
        collectionRootDir: input.collectionRootDir,
        sampleIntervalMs: input.sampleIntervalMs,
        maxParallelShards: input.maxParallelShards,
        plan: input.plan,
        initialProjection: input.initialProjection,
        finalProjection,
        sourceManifest,
        startedAt,
        endedAt: clock.now(),
        samples,
        completedEpochResults: [...completedResults.values()],
      });
      return new FilePaperMarketCollectionResourceEvidenceRepository({
        rootDir: input.artifactRootDir,
      }).save(artifact);
    },
    stop: stopSampling,
  };
}

export function createPaperMarketCollectionResourceEvidenceArtifact(input: {
  readonly probeRunId: string;
  readonly collectionRootDir: string;
  readonly sampleIntervalMs: number;
  readonly maxParallelShards: number;
  readonly plan: PaperMarketCollectionPlan;
  readonly initialProjection: PaperMarketCollectionProjection;
  readonly finalProjection: PaperMarketCollectionProjection;
  readonly sourceManifest: PaperMarketCollectionSourceManifest;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly samples: readonly PaperMarketCollectionResourceSample[];
  readonly completedEpochResults: readonly PaperMarketCollectionEpochResult[];
}): PaperMarketCollectionResourceEvidenceArtifact {
  if (input.sourceManifest.collectionId !== input.plan.collectionId) {
    throw new Error('collection resource evidence source manifest does not match plan');
  }
  if (
    input.initialProjection.collectionId !== input.plan.collectionId ||
    input.finalProjection.collectionId !== input.plan.collectionId
  ) {
    throw new Error('collection resource evidence projection does not match plan');
  }
  if (!input.finalProjection.complete) {
    throw new Error('collection resource evidence requires a completed collection invocation');
  }
  if (input.endedAt < input.startedAt) {
    throw new Error('collection resource evidence endedAt precedes startedAt');
  }
  const samples = [...input.samples].sort((left, right) => left.observedAt - right.observedAt);
  if (samples.length < 2)
    throw new Error('collection resource evidence requires at least two samples');
  if (samples[0]!.observedAt < input.startedAt || samples.at(-1)!.observedAt > input.endedAt) {
    throw new Error('collection resource evidence samples fall outside the observation window');
  }
  const rawCompletedEpochResults = [...input.completedEpochResults].sort(
    (left, right) =>
      left.epochIndex - right.epochIndex || left.shardId.localeCompare(right.shardId),
  );
  const previousTradeCountByShard = new Map<string, number>();
  for (const epoch of input.initialProjection.epochs) {
    if (epoch.status !== 'completed' || epoch.result === undefined) continue;
    const cumulativeTradeCount = epoch.result.partitions.reduce(
      (total, partition) => total + partition.tradeCount,
      0,
    );
    previousTradeCountByShard.set(epoch.shardId, cumulativeTradeCount);
  }
  const completedEpochResults = rawCompletedEpochResults
    .map((result) => ({
      resultId: result.resultId,
      shardId: result.shardId,
      epochIndex: result.epochIndex,
      completedCycleCount: result.completedCycleCount,
      cumulativeTradeCount: result.partitions.reduce(
        (total, partition) => total + partition.tradeCount,
        0,
      ),
    }))
    .map((result) => {
      const previousTradeCount = previousTradeCountByShard.get(result.shardId) ?? 0;
      if (result.cumulativeTradeCount < previousTradeCount) {
        throw new Error(
          `collection resource evidence cumulative trade count regressed for ${result.shardId}`,
        );
      }
      previousTradeCountByShard.set(result.shardId, result.cumulativeTradeCount);
      return {
        ...result,
        observedTradeCount: result.cumulativeTradeCount - previousTradeCount,
      };
    });
  const uniqueResultIds = new Set(completedEpochResults.map((result) => result.resultId));
  if (uniqueResultIds.size !== completedEpochResults.length) {
    throw new Error('collection resource evidence contains duplicate epoch results');
  }
  const durationMs = input.endedAt - input.startedAt;
  const completedPartitionCycleCount = completedEpochResults.reduce(
    (total, result) => total + result.completedCycleCount,
    0,
  );
  const observedTradeCount = completedEpochResults.reduce(
    (total, result) => total + result.observedTradeCount,
    0,
  );
  const maximumSampleGapMs = samples
    .slice(1)
    .reduce(
      (maximum, sample, index) => Math.max(maximum, sample.observedAt - samples[index]!.observedAt),
      0,
    );
  const seconds = durationMs / 1_000;
  const withoutId: Omit<PaperMarketCollectionResourceEvidenceArtifact, 'artifactId'> = {
    schemaVersion: PAPER_MARKET_COLLECTION_RESOURCE_EVIDENCE_SCHEMA_VERSION,
    run: {
      probeRunId: input.probeRunId,
      collectionId: input.plan.collectionId,
      sourceManifestId: input.sourceManifest.sourceManifestId,
      ...(input.sourceManifest.globalRunManifestId === undefined
        ? {}
        : { globalRunManifestId: input.sourceManifest.globalRunManifestId }),
      profileId: input.plan.profileId,
      topology: requireTopology(input.plan),
      aggregationRule: requireAggregationRule(input.plan),
      sourceRevision: { ...input.plan.sourceRevision },
      shardCount: input.plan.shards.length,
      maxParallelShards: input.maxParallelShards,
      epochCycleCount: input.plan.epochCycleCount,
      targetEpochCount: input.plan.targetEpochCount,
      initialCompletedEpochCount: input.initialProjection.completedEpochCount,
      finalCompletedEpochCount: input.finalProjection.completedEpochCount,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      sampleIntervalMs: input.sampleIntervalMs,
      collectionRootDir: input.collectionRootDir,
      environment: {
        platform: platform(),
        architecture: arch(),
        osRelease: release(),
        logicalCpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        nodeVersion: process.version,
      },
    },
    samples,
    completedEpochResults,
    summary: {
      durationMs,
      sampleCount: samples.length,
      maximumSampleGapMs,
      maximumObservedParallelChildCount: Math.max(
        ...samples.map((sample) => sample.sampledChildProcessCount),
      ),
      peakCoordinatorRssBytes: Math.max(...samples.map((sample) => sample.coordinatorRssBytes)),
      peakAggregateChildRssBytes: Math.max(
        ...samples.map((sample) => sample.aggregateChildRssBytes),
      ),
      peakAggregateProcessRssBytes: Math.max(
        ...samples.map((sample) => sample.aggregateProcessRssBytes),
      ),
      baselineStorageBytes: samples[0]!.storage.totalBytes,
      finalStorageBytes: samples.at(-1)!.storage.totalBytes,
      storageGrowthBytes: samples.at(-1)!.storage.totalBytes - samples[0]!.storage.totalBytes,
      observedCompletedEpochCount: completedEpochResults.length,
      completedPartitionCycleCount,
      observedTradeCount,
      completedPartitionCyclesPerSecond: seconds === 0 ? 0 : completedPartitionCycleCount / seconds,
      observedTradesPerSecond: seconds === 0 ? 0 : observedTradeCount / seconds,
    },
    evidenceClassification: {
      mechanism: 'verified-by-content-addressed-artifact',
      scope: 'multi-process-partitioned-market-collection-invocation',
      purpose: 'capacity-planning-observation',
      memoryMeasurement: 'point-sampled-coordinator-plus-child-rss',
      paperScaleEstablished: false,
      matureMarketDatasetEstablished: false,
    },
  };
  return {
    ...withoutId,
    artifactId: `${ARTIFACT_ID_PREFIX}${sha256(stableStringify(withoutId))}`,
  };
}

export class FilePaperMarketCollectionResourceEvidenceRepository {
  private readonly artifactsDir: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.artifactsDir = join(input.rootDir, 'paper-market-collection-resource-evidence');
  }

  save(
    artifact: PaperMarketCollectionResourceEvidenceArtifact,
  ): PaperMarketCollectionResourceEvidenceArtifact {
    assertArtifactIntegrity(artifact);
    const directory = join(this.artifactsDir, encodeURIComponent(artifact.artifactId));
    const path = join(directory, 'artifact.json');
    const content = `${JSON.stringify(artifact, null, 2)}\n`;
    mkdirSync(directory, { recursive: true });
    if (existsSync(path)) {
      if (readFileSync(path, 'utf8') !== content) {
        throw new Error(`collection resource evidence collision for ${artifact.artifactId}`);
      }
      return clone(artifact);
    }
    writeAtomically(path, content);
    return clone(artifact);
  }

  get(artifactId: string): PaperMarketCollectionResourceEvidenceArtifact | undefined {
    if (!/^paper-market-collection-resource-evidence:sha256:[a-f0-9]{64}$/u.test(artifactId)) {
      throw new Error('invalid collection resource evidence artifactId');
    }
    const path = join(this.artifactsDir, encodeURIComponent(artifactId), 'artifact.json');
    if (!existsSync(path)) return undefined;
    const artifact = JSON.parse(
      readFileSync(path, 'utf8'),
    ) as PaperMarketCollectionResourceEvidenceArtifact;
    assertArtifactIntegrity(artifact);
    return clone(artifact);
  }
}

async function captureSample(input: {
  readonly observedAt: number;
  readonly collectionRootDir: string;
  readonly activeChildren: readonly ActiveChild[];
  readonly observedCompletedEpochCount: number;
  readonly observedCompletedPartitionCycleCount: number;
  readonly observedTradeCount: number;
  readonly processRssSampler: (pid: number) => Promise<number | undefined>;
}): Promise<PaperMarketCollectionResourceSample> {
  const observedChildren = (
    await Promise.all(
      input.activeChildren.map(async (child) => {
        const rssBytes = await input.processRssSampler(child.pid);
        return rssBytes === undefined ? undefined : { ...child, rssBytes };
      }),
    )
  )
    .filter((child): child is ActiveChild & { readonly rssBytes: number } => child !== undefined)
    .sort((left, right) => left.executionId.localeCompare(right.executionId));
  const coordinatorRssBytes = process.memoryUsage().rss;
  const aggregateChildRssBytes = observedChildren.reduce(
    (total, child) => total + child.rssBytes,
    0,
  );
  return {
    observedAt: input.observedAt,
    coordinatorRssBytes,
    childProcesses: observedChildren,
    activeChildProcessCount: input.activeChildren.length,
    sampledChildProcessCount: observedChildren.length,
    observedCompletedEpochCount: input.observedCompletedEpochCount,
    observedCompletedPartitionCycleCount: input.observedCompletedPartitionCycleCount,
    observedTradeCount: input.observedTradeCount,
    aggregateChildRssBytes,
    aggregateProcessRssBytes: coordinatorRssBytes + aggregateChildRssBytes,
    storage: measureRegularFileStorage(input.collectionRootDir),
  };
}

function latestTradeCounts(projection: PaperMarketCollectionProjection): Map<string, number> {
  const latestByShard = new Map<
    string,
    { readonly epochIndex: number; readonly cumulativeTradeCount: number }
  >();
  for (const epoch of projection.epochs) {
    if (epoch.status !== 'completed' || epoch.result === undefined) continue;
    const previous = latestByShard.get(epoch.shardId);
    if (previous !== undefined && previous.epochIndex > epoch.epochIndex) continue;
    latestByShard.set(epoch.shardId, {
      epochIndex: epoch.epochIndex,
      cumulativeTradeCount: epoch.result.partitions.reduce(
        (total, partition) => total + partition.tradeCount,
        0,
      ),
    });
  }
  return new Map(
    [...latestByShard].map(([shardId, value]) => [shardId, value.cumulativeTradeCount]),
  );
}

function sampleProcessRssBytes(pid: number): Promise<number | undefined> {
  return new Promise((resolveSample, rejectSample) => {
    execFile('ps', ['-o', 'rss=', '-p', String(pid)], (error, stdout) => {
      if (error !== null) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          rejectSample(
            error instanceof Error ? error : new Error('ps command failed', { cause: error }),
          );
        } else resolveSample(undefined);
        return;
      }
      const rssKiB = Number(stdout.trim());
      resolveSample(Number.isFinite(rssKiB) && rssKiB >= 0 ? rssKiB * 1_024 : undefined);
    });
  });
}

function measureRegularFileStorage(
  rootDir: string,
): PaperMarketCollectionResourceSample['storage'] {
  if (!existsSync(rootDir)) return { regularFileCount: 0, totalBytes: 0 };
  let regularFileCount = 0;
  let totalBytes = 0;
  const pending = [rootDir];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        try {
          totalBytes += statSync(path).size;
          regularFileCount += 1;
        } catch (error) {
          // Runtime WAL files are atomically created and removed. A point-in-time
          // recursive sample may legitimately race that lifecycle.
          if (!isMissingPathError(error)) throw error;
        }
      }
    }
  }
  return { regularFileCount, totalBytes };
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function requireTopology(
  plan: PaperMarketCollectionPlan,
): NonNullable<PaperMarketCollectionPlan['topology']> {
  if (plan.topology === undefined)
    throw new Error('collection resource evidence requires topology');
  return plan.topology;
}

function requireAggregationRule(
  plan: PaperMarketCollectionPlan,
): NonNullable<PaperMarketCollectionPlan['aggregationRule']> {
  if (plan.aggregationRule === undefined) {
    throw new Error('collection resource evidence requires aggregationRule');
  }
  return plan.aggregationRule;
}

function assertArtifactIntegrity(artifact: PaperMarketCollectionResourceEvidenceArtifact): void {
  if (artifact.schemaVersion !== PAPER_MARKET_COLLECTION_RESOURCE_EVIDENCE_SCHEMA_VERSION) {
    throw new Error('unsupported collection resource evidence schema');
  }
  const { artifactId, ...withoutId } = artifact;
  const expectedId = `${ARTIFACT_ID_PREFIX}${sha256(stableStringify(withoutId))}`;
  if (artifactId !== expectedId) {
    throw new Error(`collection resource evidence content mismatch for ${artifactId}`);
  }
}

function writeAtomically(path: string, content: string): void {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, content);
  renameSync(temporaryPath, path);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be positive integer`);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) throw new Error(`${name} must not be empty`);
}
