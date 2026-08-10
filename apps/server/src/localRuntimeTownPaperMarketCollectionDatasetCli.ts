import { isAbsolute, resolve } from 'node:path';
import type { PaperMatureMarketDatasetArtifact } from '@aivilization/observability';
import { runLocalRuntimeTownPaperMarketCollectionDataset } from './localRuntimeTownPaperMarketCollectionDataset';

export type LocalRuntimeTownPaperMarketCollectionDatasetCliConfig = {
  readonly collectionRootDir: string;
  readonly collectionId: string;
  readonly shardId?: string;
  readonly generatedAt: number;
  readonly confirmedQuiescentSource: true;
};

export function resolveLocalRuntimeTownPaperMarketCollectionDatasetCliConfig(
  input: {
    readonly argv?: readonly string[];
    readonly cwd?: string;
    readonly now?: number;
  } = {},
): LocalRuntimeTownPaperMarketCollectionDatasetCliConfig {
  const options = parseOptions(input.argv ?? []);
  if (!options.confirmQuiescentSource) {
    throw new Error('paper market collection dataset requires --confirm-quiescent-source');
  }
  const cwd = input.cwd ?? process.cwd();
  const root = requireOption(options.collectionRootDir, 'collection-root-dir');
  return {
    collectionRootDir: isAbsolute(root) ? resolve(root) : resolve(cwd, root),
    collectionId: requireOption(options.collectionId, 'collection-id'),
    ...(options.shardId === undefined
      ? {}
      : { shardId: requireOption(options.shardId, 'shard-id') }),
    generatedAt:
      options.generatedAt === undefined
        ? (input.now ?? Date.now())
        : parseNonNegativeFinite(options.generatedAt, 'generated-at'),
    confirmedQuiescentSource: true,
  };
}

export function runLocalRuntimeTownPaperMarketCollectionDatasetCli(
  config: LocalRuntimeTownPaperMarketCollectionDatasetCliConfig,
): Promise<PaperMatureMarketDatasetArtifact> {
  if (config.confirmedQuiescentSource !== true) {
    throw new Error(
      'paper market collection dataset source must be explicitly confirmed quiescent',
    );
  }
  return runLocalRuntimeTownPaperMarketCollectionDataset(config);
}

export function createLocalRuntimeTownPaperMarketCollectionDatasetCliHelp(): string {
  return [
    'Extract the paper mature-market dataset from a completed collection source manifest.',
    '',
    'Usage:',
    '  paper-market-collection-dataset --collection-root-dir <path> --collection-id <id> [options]',
    '',
    'Required: --collection-root-dir, --collection-id, --confirm-quiescent-source',
    'Optional: --shard-id <id> (required only for independent-replicate collections),',
    '  --generated-at <ms>, -h, --help',
    '',
    'Single-society collections always merge every uniquely owned partition at the frozen global',
    'epoch barrier. Independent replicate collections require exactly one shard and never pool.',
  ].join('\n');
}

type ParsedOptions = {
  readonly collectionRootDir?: string;
  readonly collectionId?: string;
  readonly shardId?: string;
  readonly generatedAt?: string;
  readonly confirmQuiescentSource: boolean;
};

function parseOptions(argv: readonly string[]): ParsedOptions {
  const values: Record<string, string | undefined> = {};
  let confirmQuiescentSource = false;
  const names: Readonly<Record<string, keyof Omit<ParsedOptions, 'confirmQuiescentSource'>>> = {
    '--collection-root-dir': 'collectionRootDir',
    '--collection-id': 'collectionId',
    '--shard-id': 'shardId',
    '--generated-at': 'generatedAt',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--confirm-quiescent-source') {
      confirmQuiescentSource = true;
      continue;
    }
    if (argument === '--' || argument === '--help' || argument === '-h') continue;
    const name = names[argument];
    if (name === undefined) throw new Error(`unknown collection dataset option ${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`${argument} requires a value`);
    if (values[name] !== undefined) throw new Error(`${argument} must not be repeated`);
    values[name] = value;
    index += 1;
  }
  return { ...values, confirmQuiescentSource };
}

function requireOption(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) throw new Error(`--${name} is required`);
  return value;
}

function parseNonNegativeFinite(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return parsed;
}
