import { isAbsolute, join, resolve } from 'node:path';
import {
  FilePaperMarketCollectionLedger,
  createPaperMarketCollectionPlan,
  createPaperMarketCollectionSourceManifest,
  runPaperMarketCollection,
  type PaperMarketCollectionPlan,
  type PaperMarketCollectionProjection,
  type PaperMarketCollectionRunner,
} from '@aivilization/worker';
import { createLocalRuntimeTownPaperMarketCollectionProcessRunner } from './localRuntimeTownPaperMarketCollectionProcess';
import {
  createPaperMarketCollectionResourceMonitor,
  type PaperMarketCollectionResourceEvidenceArtifact,
} from './localRuntimeTownPaperMarketCollectionResourceEvidence';
import {
  createLocalRuntimeTownDaemonScenarioProfile,
  type LocalRuntimeTownDaemonScenarioProfileId,
} from './localRuntimeTownScenarioProfile';
import { resolveLocalRuntimeTownSourceRevision } from './localRuntimeTownSourceRevision';

export type LocalRuntimeTownPaperMarketCollectionCliConfig = {
  readonly collectionRootDir: string;
  readonly collectionId?: string;
  readonly profileId?: LocalRuntimeTownDaemonScenarioProfileId;
  readonly topology?: 'single-society' | 'replicates';
  readonly shardCount?: number;
  readonly collectionSeed?: string;
  readonly epochCycleCount?: number;
  readonly targetEpochCount?: number;
  readonly leaseDurationMs?: number;
  readonly maxAttemptsPerEpoch?: number;
  readonly maxParallelShards: number;
  readonly leaseOwnerId: string;
  readonly resourceEvidenceRootDir?: string;
  readonly resourceProbeRunId?: string;
  readonly resourceSampleIntervalMs: number;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
};

export function resolveLocalRuntimeTownPaperMarketCollectionCliConfig(
  input: {
    readonly argv?: readonly string[];
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
  } = {},
): LocalRuntimeTownPaperMarketCollectionCliConfig {
  const options = parseOptions(input.argv ?? []);
  const cwd = input.cwd ?? process.cwd();
  const collectionId = options.collectionId;
  const createMode = collectionId === undefined;
  if (
    (options.resourceEvidenceRootDir === undefined) !==
    (options.resourceProbeRunId === undefined)
  ) {
    throw new Error(
      '--resource-evidence-root-dir and --resource-probe-run-id must be supplied together',
    );
  }
  return {
    collectionRootDir: resolvePath(
      requireOption(options.collectionRootDir, 'collection-root-dir'),
      cwd,
    ),
    ...(collectionId === undefined ? {} : { collectionId }),
    ...(createMode ? { profileId: requireProfile(options.profile) } : {}),
    ...(createMode ? { topology: requireTopology(options.topology ?? 'single-society') } : {}),
    ...(createMode && options.shardCount !== undefined
      ? { shardCount: parsePositiveInteger(options.shardCount, 'shard-count') }
      : {}),
    ...(createMode
      ? { collectionSeed: requireOption(options.collectionSeed, 'collection-seed') }
      : {}),
    ...(createMode
      ? {
          epochCycleCount: parsePositiveInteger(
            options.epochCycleCount ?? '100',
            'epoch-cycle-count',
          ),
        }
      : {}),
    ...(createMode
      ? {
          targetEpochCount: parsePositiveInteger(
            options.targetEpochCount ?? '100',
            'target-epoch-count',
          ),
        }
      : {}),
    ...(createMode
      ? {
          leaseDurationMs: parsePositiveInteger(
            options.leaseDurationMs ?? '3600000',
            'lease-duration-ms',
          ),
        }
      : {}),
    ...(createMode
      ? {
          maxAttemptsPerEpoch: parsePositiveInteger(
            options.maxAttemptsPerEpoch ?? '3',
            'max-attempts-per-epoch',
          ),
        }
      : {}),
    maxParallelShards: parsePositiveInteger(
      options.maxParallelShards ?? '2',
      'max-parallel-shards',
    ),
    leaseOwnerId: options.leaseOwnerId ?? `paper-market-coordinator-${process.pid}`,
    ...(options.resourceEvidenceRootDir === undefined
      ? {}
      : { resourceEvidenceRootDir: resolvePath(options.resourceEvidenceRootDir, cwd) }),
    ...(options.resourceProbeRunId === undefined
      ? {}
      : { resourceProbeRunId: options.resourceProbeRunId }),
    resourceSampleIntervalMs: parsePositiveInteger(
      options.resourceSampleIntervalMs ?? '1000',
      'resource-sample-interval-ms',
    ),
    cwd,
    environment: input.env ?? process.env,
  };
}

export async function runLocalRuntimeTownPaperMarketCollection(
  config: LocalRuntimeTownPaperMarketCollectionCliConfig,
  dependencies: { readonly runner?: PaperMarketCollectionRunner } = {},
): Promise<{
  readonly plan: PaperMarketCollectionPlan;
  readonly projection: PaperMarketCollectionProjection;
  readonly sourceManifest: ReturnType<typeof createPaperMarketCollectionSourceManifest>;
  readonly resourceEvidence?: PaperMarketCollectionResourceEvidenceArtifact;
}> {
  const ledger = new FilePaperMarketCollectionLedger(config.collectionRootDir);
  const plan =
    config.collectionId === undefined
      ? createLocalRuntimeTownPaperMarketCollectionPlan(config)
      : requireExistingPlan(ledger, config.collectionId);
  ledger.savePlan(plan);
  if (config.resourceEvidenceRootDir !== undefined && dependencies.runner !== undefined) {
    throw new Error('collection resource evidence requires the canonical child-process runner');
  }
  const maxParallelShards = Math.min(config.maxParallelShards, plan.shards.length);
  const resourceMonitor =
    config.resourceEvidenceRootDir === undefined
      ? undefined
      : createPaperMarketCollectionResourceMonitor({
          probeRunId: config.resourceProbeRunId!,
          collectionRootDir: config.collectionRootDir,
          artifactRootDir: config.resourceEvidenceRootDir,
          sampleIntervalMs: config.resourceSampleIntervalMs,
          maxParallelShards,
          plan,
          initialProjection: ledger.project(plan.collectionId, Date.now()),
        });
  await resourceMonitor?.start();
  let projection: PaperMarketCollectionProjection;
  try {
    projection = await runPaperMarketCollection({
      plan,
      ledger,
      leaseOwnerId: config.leaseOwnerId,
      maxParallelShards,
      runner:
        dependencies.runner ??
        createLocalRuntimeTownPaperMarketCollectionProcessRunner({
          collectionRootDir: config.collectionRootDir,
          environment: { ...config.environment },
          ...(resourceMonitor === undefined ? {} : { observer: resourceMonitor.observer }),
        }),
    });
  } catch (error) {
    await resourceMonitor?.stop();
    throw error;
  }
  const existingSourceManifest = ledger.loadSourceManifest(plan.collectionId);
  const sourceManifest =
    existingSourceManifest ??
    ledger.saveSourceManifest(createPaperMarketCollectionSourceManifest({ plan, projection }));
  const resourceEvidence = await resourceMonitor?.finish({
    sourceManifest,
    finalProjection: projection,
  });
  return {
    plan,
    projection,
    sourceManifest,
    ...(resourceEvidence === undefined ? {} : { resourceEvidence }),
  };
}

export function createLocalRuntimeTownPaperMarketCollectionCliHelp(): string {
  return [
    'Run or resume a lease-backed multi-process canonical market collection.',
    '',
    'Create:',
    '  paper-market-collect --collection-root-dir <path> --profile <id> --collection-seed <seed> [options]',
    'Resume:',
    '  paper-market-collect --collection-root-dir <path> --collection-id <id> [options]',
    '',
    'Create options: --topology single-society|replicates (single-society),',
    '  --shard-count (must equal partition count for single-society; 2 for replicates),',
    '  --epoch-cycle-count (100), --target-epoch-count (100),',
    '  --lease-duration-ms (3600000), --max-attempts-per-epoch (3)',
    'Run options: --max-parallel-shards (2), --lease-owner-id <id>',
    'Resource probe: --resource-evidence-root-dir <path> and --resource-probe-run-id <id>,',
    '  with optional --resource-sample-interval-ms (1000). The content-addressed artifact samples',
    '  coordinator plus active child RSS and collection storage for capacity planning only.',
    '',
    'Single-society shards share one seed, own disjoint canonical partitions, and cross a global',
    'epoch barrier before any partition advances. Replicates remain independent and cannot pool',
    'their market data. Epoch operation IDs are stable,',
    'so an expired lease retries the same durable run session instead of applying cycles twice.',
  ].join('\n');
}

export function createLocalRuntimeTownPaperMarketCollectionPlan(
  config: LocalRuntimeTownPaperMarketCollectionCliConfig,
): PaperMarketCollectionPlan {
  const profileId = config.profileId!;
  const profile = createLocalRuntimeTownDaemonScenarioProfile(profileId);
  const simulationIds = [
    ...new Set(profile.manifest.partitions.map((partition) => partition.simulationId)),
  ];
  if (simulationIds.length !== 1) throw new Error('collection profile must use one simulationId');
  const sourceRevision = resolveLocalRuntimeTownSourceRevision({
    env: config.environment,
    cwd: config.cwd,
  });
  const partitionKeys = profile.manifest.partitions
    .map((partition) => partition.partitionKey)
    .sort();
  const topology = config.topology ?? 'single-society';
  if (topology === 'single-society') {
    const shardCount = config.shardCount ?? partitionKeys.length;
    if (shardCount !== partitionKeys.length) {
      throw new Error(
        `single-society shard-count must equal canonical partition count ${partitionKeys.length}`,
      );
    }
    return createPaperMarketCollectionPlan({
      simulationId: simulationIds[0]!,
      profileId,
      sourceRevision,
      collectionSeed: config.collectionSeed!,
      epochCycleCount: config.epochCycleCount!,
      targetEpochCount: config.targetEpochCount!,
      leaseDurationMs: config.leaseDurationMs!,
      maxAttemptsPerEpoch: config.maxAttemptsPerEpoch!,
      topology: 'single-persistent-society-partitions',
      aggregationRule: 'merge-owned-partitions-after-global-epoch-barrier',
      shards: partitionKeys.map((partitionKey, index) => {
        const shardId = `partition-owner-${String(index).padStart(3, '0')}`;
        return {
          shardId,
          runtimeRootDir: join(config.collectionRootDir, 'runtime-shards', shardId),
          seed: config.collectionSeed!,
          ownedPartitionKeys: [partitionKey],
        };
      }),
    });
  }
  const shardCount = config.shardCount ?? 2;
  return createPaperMarketCollectionPlan({
    simulationId: simulationIds[0]!,
    profileId,
    sourceRevision,
    collectionSeed: config.collectionSeed!,
    epochCycleCount: config.epochCycleCount!,
    targetEpochCount: config.targetEpochCount!,
    leaseDurationMs: config.leaseDurationMs!,
    maxAttemptsPerEpoch: config.maxAttemptsPerEpoch!,
    topology: 'independent-canonical-replicates',
    aggregationRule: 'per-shard-only-never-merge-as-one-persistent-society',
    shards: Array.from({ length: shardCount }, (_, index) => {
      const shardId = `shard-${String(index).padStart(3, '0')}`;
      return {
        shardId,
        runtimeRootDir: join(config.collectionRootDir, 'runtime-shards', shardId),
        seed: `${config.collectionSeed!}:shard:${index}`,
      };
    }),
  });
}

function requireExistingPlan(
  ledger: FilePaperMarketCollectionLedger,
  collectionId: string,
): PaperMarketCollectionPlan {
  const plan = ledger.loadPlan(collectionId);
  if (plan === undefined) throw new Error(`paper market collection ${collectionId} does not exist`);
  return plan;
}

type ParsedOptions = Readonly<Record<string, string | undefined>>;

function parseOptions(argv: readonly string[]): ParsedOptions {
  const values: Record<string, string | undefined> = {};
  const names: Readonly<Record<string, string>> = {
    '--collection-root-dir': 'collectionRootDir',
    '--collection-id': 'collectionId',
    '--profile': 'profile',
    '--topology': 'topology',
    '--shard-count': 'shardCount',
    '--collection-seed': 'collectionSeed',
    '--epoch-cycle-count': 'epochCycleCount',
    '--target-epoch-count': 'targetEpochCount',
    '--lease-duration-ms': 'leaseDurationMs',
    '--max-attempts-per-epoch': 'maxAttemptsPerEpoch',
    '--max-parallel-shards': 'maxParallelShards',
    '--lease-owner-id': 'leaseOwnerId',
    '--resource-evidence-root-dir': 'resourceEvidenceRootDir',
    '--resource-probe-run-id': 'resourceProbeRunId',
    '--resource-sample-interval-ms': 'resourceSampleIntervalMs',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (option === '--help' || option === '-h' || option === '--') continue;
    const name = names[option];
    if (name === undefined) throw new Error(`unknown paper market collection option ${option}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`${option} requires a value`);
    if (values[name] !== undefined) throw new Error(`${option} must not be repeated`);
    values[name] = value;
    index += 1;
  }
  return values;
}

function requireTopology(value: string): 'single-society' | 'replicates' {
  if (value !== 'single-society' && value !== 'replicates') {
    throw new Error('--topology must be single-society or replicates');
  }
  return value;
}

function requireProfile(value: string | undefined): LocalRuntimeTownDaemonScenarioProfileId {
  if (value !== 'smoke-25' && value !== 'default-100' && value !== 'headless-stress-1000') {
    throw new Error('--profile must be smoke-25, default-100, or headless-stress-1000');
  }
  return value;
}

function requireOption(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) throw new Error(`--${name} is required`);
  return value;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function resolvePath(value: string, cwd: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(cwd, value);
}
