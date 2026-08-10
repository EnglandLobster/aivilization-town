import { isAbsolute, join, resolve } from 'node:path';
import {
  FilePaperStratificationArtifactRepository,
  createPaperStratificationArtifact,
  type PaperStratificationArtifact,
} from '@aivilization/observability';
import { createWealthSnapshotFromWorldProjection } from '@aivilization/worker';
import { loadLocalRuntimeTownPaperEvidenceSource } from './localRuntimeTownPaperEvidenceSource';

export type LocalRuntimeTownPaperStratificationCliConfig = {
  readonly rootDir: string;
  readonly simulationId: string;
  readonly runManifestId: string;
  readonly analysisRunId: string;
  readonly generatedAt: number;
  readonly confirmedQuiescentSource: true;
};

export function resolveLocalRuntimeTownPaperStratificationCliConfig(
  input: {
    readonly argv?: readonly string[];
    readonly cwd?: string;
    readonly now?: number;
  } = {},
): LocalRuntimeTownPaperStratificationCliConfig {
  const options = parseOptions(input.argv ?? []);
  if (!options.confirmQuiescentSource) {
    throw new Error('paper stratification requires --confirm-quiescent-source');
  }
  const cwd = input.cwd ?? process.cwd();
  return {
    rootDir: resolveRequiredPath(options.rootDir, cwd, 'root-dir'),
    simulationId: requireOption(options.simulationId, 'simulation-id'),
    runManifestId: requireOption(options.runManifestId, 'run-manifest-id'),
    analysisRunId: requireOption(options.analysisRunId, 'analysis-run-id'),
    generatedAt:
      options.generatedAt === undefined
        ? (input.now ?? Date.now())
        : parseNonNegativeFinite(options.generatedAt, 'generated-at'),
    confirmedQuiescentSource: true,
  };
}

export async function runLocalRuntimeTownPaperStratification(
  config: LocalRuntimeTownPaperStratificationCliConfig,
): Promise<{ readonly artifact: PaperStratificationArtifact; readonly artifactRootDir: string }> {
  if (config.confirmedQuiescentSource !== true) {
    throw new Error('paper stratification source must be explicitly confirmed quiescent');
  }
  const source = await loadLocalRuntimeTownPaperEvidenceSource({
    rootDir: config.rootDir,
    simulationId: config.simulationId,
    runManifestId: config.runManifestId,
  });
  const snapshot = source.partitions.flatMap((partition) =>
    createWealthSnapshotFromWorldProjection(partition.finalProjection),
  );
  const artifact = createPaperStratificationArtifact({
    run: {
      runId: config.analysisRunId,
      simulationId: config.simulationId,
      runManifestId: source.runManifest.runManifestId,
      sourceRevision: source.runManifest.payload.sourceRevision,
      seed: source.runManifest.payload.seed,
      generatedAt: config.generatedAt,
      partitions: source.partitions
        .map((partition) => ({
          partitionKey: partition.partitionKey,
          eventCount: partition.events.length,
          lastEventSequence: partition.events.at(-1)?.sequence ?? 0,
          finalSimulatedAt: partition.finalProjection.clock.now,
        }))
        .sort((left, right) => left.partitionKey.localeCompare(right.partitionKey)),
    },
    snapshot,
  });
  const artifactRootDir = join(config.rootDir, 'artifacts');
  const repository = new FilePaperStratificationArtifactRepository({ rootDir: artifactRootDir });
  return { artifact: await repository.save(artifact), artifactRootDir };
}

export function hasLocalRuntimeTownPaperStratificationHelpFlag(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export function createLocalRuntimeTownPaperStratificationCliHelp(): string {
  return [
    'Generate paper Figures 9-10 from a stopped, manifest-bound runtime root.',
    '',
    'Usage:',
    '  pnpm --filter @aivilization/server paper-stratification -- [options]',
    '',
    'Required:',
    '  --root-dir <path>              Durable runtime root',
    '  --simulation-id <id>           Source simulation ID',
    '  --run-manifest-id <id>         Persisted resolved run manifest ID',
    '  --analysis-run-id <id>         Immutable output run ID',
    '  --confirm-quiescent-source     Confirm no process is mutating the runtime root',
    '',
    'Optional:',
    '  --generated-at <ms>            Artifact generation timestamp (default: now)',
    '  -h, --help                     Show this help',
    '',
    'The command verifies the manifest/profile/partition set, hydrates every final projection,',
    'combines all agents, and persists the education/occupation wealth analysis plus Figures 9-10.',
  ].join('\n');
}

type ParsedOptions = {
  readonly rootDir?: string;
  readonly simulationId?: string;
  readonly runManifestId?: string;
  readonly analysisRunId?: string;
  readonly generatedAt?: string;
  readonly confirmQuiescentSource: boolean;
};

function parseOptions(argv: readonly string[]): ParsedOptions {
  const values: Record<string, string | undefined> = {};
  let confirmQuiescentSource = false;
  const names: Readonly<Record<string, string>> = {
    '--root-dir': 'rootDir',
    '--simulation-id': 'simulationId',
    '--run-manifest-id': 'runManifestId',
    '--analysis-run-id': 'analysisRunId',
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
      throw new Error(`unknown paper stratification option ${argument}`);
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
