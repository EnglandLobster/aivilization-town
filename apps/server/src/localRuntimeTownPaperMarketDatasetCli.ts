import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  MARKET_OBSERVATION_STORAGE_POLICY_VERSION,
  PAPER_MATURE_MARKET_DATASET_SCHEMA_VERSION,
  PAPER_MATURE_MARKET_SOURCE_LEDGER_FILENAME,
  streamMarketTradeObservationsFile,
  type PaperMatureMarketDatasetArtifact,
  type PaperMatureMarketSourceLedgerFile,
} from '@aivilization/observability';
import {
  PAPER_MARKET_DATA_PIPELINE_POLICY_VERSION,
  runWorkerPaperMatureMarketDatasetStreamingExtraction,
} from '@aivilization/worker';
import {
  loadLocalRuntimeTownPaperRunManifest,
  resolvePaperEvidenceManifestPartitionKeys,
} from './localRuntimeTownPaperEvidenceSource';

export type LocalRuntimeTownPaperMarketDatasetCliConfig = {
  readonly rootDir: string;
  readonly simulationId: string;
  readonly runManifestId: string;
  readonly collectionWindowStartedAt: number;
  readonly collectionWindowEndedAt: number;
  readonly generatedAt: number;
  readonly confirmedQuiescentSource: true;
};

export function resolveLocalRuntimeTownPaperMarketDatasetCliConfig(input: {
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly now?: number;
} = {}): LocalRuntimeTownPaperMarketDatasetCliConfig {
  const options = parseOptions(input.argv ?? []);
  if (!options.confirmQuiescentSource) {
    throw new Error(
      'paper market dataset extraction requires --confirm-quiescent-source',
    );
  }
  const cwd = input.cwd ?? process.cwd();
  const rootDir = resolveRequiredPath(options.rootDir, cwd, 'root-dir');
  const collectionWindowStartedAt = parseNonNegativeFinite(
    options.collectionStartedAt ?? '0',
    'collection-started-at',
  );
  const collectionWindowEndedAt = parseNonNegativeFinite(
    requireOption(options.collectionEndedAt, 'collection-ended-at'),
    'collection-ended-at',
  );
  if (collectionWindowEndedAt <= collectionWindowStartedAt) {
    throw new Error('collection-ended-at must be greater than collection-started-at');
  }
  const generatedAt =
    options.generatedAt === undefined
      ? (input.now ?? Date.now())
      : parseNonNegativeFinite(options.generatedAt, 'generated-at');
  return {
    rootDir,
    simulationId: requireOption(options.simulationId, 'simulation-id'),
    runManifestId: requireOption(options.runManifestId, 'run-manifest-id'),
    collectionWindowStartedAt,
    collectionWindowEndedAt,
    generatedAt,
    confirmedQuiescentSource: true,
  };
}

export async function runLocalRuntimeTownPaperMarketDatasetExtraction(
  config: LocalRuntimeTownPaperMarketDatasetCliConfig,
): Promise<{
  readonly artifact: PaperMatureMarketDatasetArtifact;
  readonly artifactRootDir: string;
  readonly sourceObservabilityDirs: readonly string[];
}> {
  if (config.confirmedQuiescentSource !== true) {
    throw new Error('paper market dataset source must be explicitly confirmed quiescent');
  }
  const evidenceSource = await loadLocalRuntimeTownPaperRunManifest({
    rootDir: config.rootDir,
    simulationId: config.simulationId,
    runManifestId: config.runManifestId,
  });
  const { runManifest } = evidenceSource;
  const partitionKeys = resolvePaperMarketDatasetManifestPartitionKeys(
    runManifest.payload.scenario,
    config.simulationId,
  );
  assertPaperMarketDatasetManifestPolicies({
    validation: runManifest.payload.validation,
    observations: runManifest.payload.observations,
  });
  const sourcePartitions = resolvePaperMarketDatasetSourcePartitions({
    rootDir: config.rootDir,
    simulationId: config.simulationId,
    partitionKeys,
  });

  const artifactRootDir = join(config.rootDir, 'artifacts');
  const artifact = await runWorkerPaperMatureMarketDatasetStreamingExtraction({
    run: {
      runManifestId: runManifest.runManifestId,
      simulationId: config.simulationId,
      partitionKeys,
      sourceRevision: { ...runManifest.payload.sourceRevision },
      seed: runManifest.payload.seed,
      generatedAt: config.generatedAt,
      collectionWindowStartedAt: config.collectionWindowStartedAt,
      collectionWindowEndedAt: config.collectionWindowEndedAt,
    },
    sources: sourcePartitions.map((source) => ({
      partitionKey: source.partitionKey,
      openTrades: () =>
        streamMarketTradeObservationsFile({
          path: source.ledgerPath,
          simulationId: config.simulationId,
          fromObservedAt: config.collectionWindowStartedAt,
          toObservedAtExclusive: config.collectionWindowEndedAt,
        }),
      readLedgerFileProvenance: () =>
        readPaperMarketSourceLedgerFileProvenance(source.ledgerPath),
    })),
    artifactRootDir,
    stagingDir: join(artifactRootDir, '.staging'),
  });
  return {
    artifact,
    artifactRootDir,
    sourceObservabilityDirs: sourcePartitions.map((source) => source.observabilityDir),
  };
}

export function hasLocalRuntimeTownPaperMarketDatasetHelpFlag(
  argv: readonly string[],
): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export function createLocalRuntimeTownPaperMarketDatasetCliHelp(): string {
  return [
    'Extract the canonical paper mature-phase market dataset from every partition of a stopped runtime root.',
    '',
    'Usage:',
    '  pnpm --filter @aivilization/server paper-market-dataset -- [options]',
    '',
    'Required:',
    '  --root-dir <path>                 Durable runtime root',
    '  --simulation-id <id>              Source simulation ID',
    '  --run-manifest-id <id>             Persisted resolved run manifest ID',
    '  --collection-ended-at <ms>          Exclusive simulated-time collection boundary',
    '  --confirm-quiescent-source          Confirm no process is appending to source JSONL',
    '',
    'Optional:',
    '  --collection-started-at <ms>        Inclusive simulated-time boundary (default: 0)',
    '  --generated-at <ms>                 Artifact generation timestamp (default: now)',
    '  -h, --help                          Show this help',
    '',
    'The source partition set is derived exactly from the resolved run manifest.',
    'The canonical policy requires >600,000 source trades, a stable seven-day window,',
    'complete participant and partition provenance, and 400,000 subsequent trades.',
  ].join('\n');
}

type ParsedOptions = {
  readonly rootDir?: string;
  readonly simulationId?: string;
  readonly runManifestId?: string;
  readonly collectionStartedAt?: string;
  readonly collectionEndedAt?: string;
  readonly generatedAt?: string;
  readonly confirmQuiescentSource: boolean;
};

function parseOptions(argv: readonly string[]): ParsedOptions {
  const values: Record<string, string | undefined> = {};
  let confirmQuiescentSource = false;
  const names: Readonly<Record<string, keyof Omit<ParsedOptions, 'confirmQuiescentSource'>>> = {
    '--root-dir': 'rootDir',
    '--simulation-id': 'simulationId',
    '--run-manifest-id': 'runManifestId',
    '--collection-started-at': 'collectionStartedAt',
    '--collection-ended-at': 'collectionEndedAt',
    '--generated-at': 'generatedAt',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--confirm-quiescent-source') {
      confirmQuiescentSource = true;
      continue;
    }
    if (argument === '--' || argument === '--help' || argument === '-h') {
      continue;
    }
    const name = names[argument];
    if (name === undefined) {
      throw new Error(`unknown paper market dataset option ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    if (values[name] !== undefined) {
      throw new Error(`${argument} must not be repeated`);
    }
    values[name] = value;
    index += 1;
  }
  return { ...values, confirmQuiescentSource };
}

export function resolvePaperMarketDatasetManifestPartitionKeys(
  scenario: Readonly<Record<string, unknown>>,
  simulationId: string,
): string[] {
  return resolvePaperEvidenceManifestPartitionKeys(scenario, simulationId);
}

export function resolvePaperMarketDatasetSourcePartitions(input: {
  readonly rootDir: string;
  readonly simulationId: string;
  readonly partitionKeys: readonly string[];
}): readonly {
  readonly partitionKey: string;
  readonly observabilityDir: string;
  readonly ledgerPath: string;
}[] {
  const partitionsDir = join(
    input.rootDir,
    'simulations',
    encodeURIComponent(input.simulationId),
    'partitions',
  );
  if (!existsSync(partitionsDir)) {
    throw new Error(`simulation partitions directory does not exist: ${partitionsDir}`);
  }
  const expectedDirectoryNames = new Set(
    input.partitionKeys.map((partitionKey) => encodeURIComponent(partitionKey)),
  );
  const actualDirectoryNames = readdirSync(partitionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const unexpectedDirectoryNames = actualDirectoryNames.filter(
    (name) => !expectedDirectoryNames.has(name),
  );
  if (unexpectedDirectoryNames.length > 0) {
    throw new Error(
      `runtime root contains partitions absent from the resolved run manifest: ${unexpectedDirectoryNames.join(',')}`,
    );
  }
  return input.partitionKeys.map((partitionKey) => {
    const partitionDir = join(partitionsDir, encodeURIComponent(partitionKey));
    if (!existsSync(partitionDir)) {
      throw new Error(`manifest partition directory does not exist: ${partitionDir}`);
    }
    const observabilityDir = join(partitionDir, 'observability');
    const ledgerPath = join(
      observabilityDir,
      PAPER_MATURE_MARKET_SOURCE_LEDGER_FILENAME,
    );
    if (!existsSync(ledgerPath)) {
      throw new Error(`market trade source does not exist: ${ledgerPath}`);
    }
    return { partitionKey, observabilityDir, ledgerPath };
  });
}

export function assertPaperMarketDatasetManifestPolicies(input: {
  readonly validation: Readonly<Record<string, unknown>>;
  readonly observations: Readonly<Record<string, unknown>>;
}): void {
  const datasetPolicy = input.validation.paperMatureMarketDataset;
  if (
    !isRecord(datasetPolicy) ||
    datasetPolicy.policyVersion !== PAPER_MATURE_MARKET_DATASET_SCHEMA_VERSION
  ) {
    throw new Error(
      `resolved run manifest must declare ${PAPER_MATURE_MARKET_DATASET_SCHEMA_VERSION}`,
    );
  }
  const marketObservations = input.observations.marketTradeObservations;
  if (
    !isRecord(marketObservations) ||
    marketObservations.repositoryScope !== 'per-partition-file-repository' ||
    marketObservations.policyVersion !== PAPER_MARKET_DATA_PIPELINE_POLICY_VERSION
  ) {
    throw new Error(
      `resolved run manifest must declare per-partition ${PAPER_MARKET_DATA_PIPELINE_POLICY_VERSION}`,
    );
  }
  const storage = marketObservations.storage;
  if (
    !isRecord(storage) ||
    storage.policyVersion !== MARKET_OBSERVATION_STORAGE_POLICY_VERSION
  ) {
    throw new Error(
      `resolved run manifest must declare ${MARKET_OBSERVATION_STORAGE_POLICY_VERSION}`,
    );
  }
}

export async function readPaperMarketSourceLedgerFileProvenance(
  path: string,
): Promise<PaperMatureMarketSourceLedgerFile> {
  const hash = createHash('sha256');
  let byteLength = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    hash.update(buffer);
  }
  return {
    filename: PAPER_MATURE_MARKET_SOURCE_LEDGER_FILENAME,
    byteLength,
    sha256: `sha256:${hash.digest('hex')}`,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveRequiredPath(value: string | undefined, cwd: string, name: string): string {
  const path = requireOption(value, name);
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function requireOption(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function parseNonNegativeFinite(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return parsed;
}
