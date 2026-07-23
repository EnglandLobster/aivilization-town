import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  FilePaperMarketAnalysisArtifactRepository,
  FilePaperMatureMarketDatasetRepository,
  type PaperMarketAnalysisArtifact,
} from '@aivilization/observability';
import { runWorkerPaperMarketAnalysis } from '@aivilization/worker';

export type LocalRuntimeTownPaperMarketAnalysisCliConfig = {
  readonly rootDir: string;
  readonly datasetId: string;
  readonly analysisRunId: string;
  readonly generatedAt: number;
  readonly realWorldWindow?: {
    readonly startedAtIso: string;
    readonly endedAtIso: string;
  };
};

export function resolveLocalRuntimeTownPaperMarketAnalysisCliConfig(input: {
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly now?: number;
} = {}): LocalRuntimeTownPaperMarketAnalysisCliConfig {
  const options = parseOptions(input.argv ?? []);
  const cwd = input.cwd ?? process.cwd();
  const realWorldWindow = resolveRealWorldWindow(options);
  return {
    rootDir: resolveRequiredPath(options.rootDir, cwd, 'root-dir'),
    datasetId: requireOption(options.datasetId, 'dataset-id'),
    analysisRunId: requireOption(options.analysisRunId, 'analysis-run-id'),
    generatedAt:
      options.generatedAt === undefined
        ? (input.now ?? Date.now())
        : parseNonNegativeFinite(options.generatedAt, 'generated-at'),
    ...(realWorldWindow === undefined ? {} : { realWorldWindow }),
  };
}

export async function runLocalRuntimeTownPaperMarketAnalysis(
  config: LocalRuntimeTownPaperMarketAnalysisCliConfig,
): Promise<{
  readonly artifact: PaperMarketAnalysisArtifact;
  readonly artifactRootDir: string;
}> {
  const artifactRootDir = join(config.rootDir, 'artifacts');
  const datasetManifestPath = join(
    artifactRootDir,
    'paper-mature-market-datasets',
    encodeURIComponent(config.datasetId),
    'artifact.json',
  );
  if (!existsSync(datasetManifestPath)) {
    throw new Error(`paper mature market dataset does not exist: ${config.datasetId}`);
  }
  const datasetRepository = new FilePaperMatureMarketDatasetRepository({
    rootDir: artifactRootDir,
  });
  const dataset = await datasetRepository.get(config.datasetId);
  if (dataset === undefined) {
    throw new Error(`paper mature market dataset does not exist: ${config.datasetId}`);
  }
  const artifact = await runWorkerPaperMarketAnalysis({
    analysisRunId: config.analysisRunId,
    generatedAt: config.generatedAt,
    dataset,
    artifactRepository: new FilePaperMarketAnalysisArtifactRepository({
      rootDir: artifactRootDir,
    }),
    ...(config.realWorldWindow === undefined
      ? {}
      : { realWorldWindow: { ...config.realWorldWindow } }),
  });
  return { artifact, artifactRootDir };
}

export function hasLocalRuntimeTownPaperMarketAnalysisHelpFlag(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export function createLocalRuntimeTownPaperMarketAnalysisCliHelp(): string {
  return [
    'Generate dataset-bound paper market statistics and Figures 4-8.',
    '',
    'Usage:',
    '  pnpm --filter @aivilization/server paper-market-analysis -- [options]',
    '',
    'Required:',
    '  --root-dir <path>                    Durable runtime root',
    '  --dataset-id <id>                    Frozen paper mature market dataset ID',
    '  --analysis-run-id <id>               Human-readable analysis run ID',
    '',
    'Optional:',
    '  --generated-at <ms>                  Artifact generation timestamp (default: now)',
    '  --real-world-window-started-at <iso> Explicit Figure 4 real-world window start',
    '  --real-world-window-ended-at <iso>   Explicit Figure 4 real-world window end',
    '  -h, --help                            Show this help',
    '',
    'The command verifies the frozen transaction hash, creates five-minute OHLC bars,',
    'writes the ten-commodity Table 1 CSV, and persists Figures 4-8 in one content-addressed artifact.',
  ].join('\n');
}

type ParsedOptions = {
  readonly rootDir?: string;
  readonly datasetId?: string;
  readonly analysisRunId?: string;
  readonly generatedAt?: string;
  readonly realWorldWindowStartedAt?: string;
  readonly realWorldWindowEndedAt?: string;
};

function parseOptions(argv: readonly string[]): ParsedOptions {
  const values: Record<string, string | undefined> = {};
  const names: Readonly<Record<string, keyof ParsedOptions>> = {
    '--root-dir': 'rootDir',
    '--dataset-id': 'datasetId',
    '--analysis-run-id': 'analysisRunId',
    '--generated-at': 'generatedAt',
    '--real-world-window-started-at': 'realWorldWindowStartedAt',
    '--real-world-window-ended-at': 'realWorldWindowEndedAt',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--' || argument === '--help' || argument === '-h') {
      continue;
    }
    const name = names[argument];
    if (name === undefined) {
      throw new Error(`unknown paper market analysis option ${argument}`);
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
  return values;
}

function resolveRealWorldWindow(
  options: ParsedOptions,
): LocalRuntimeTownPaperMarketAnalysisCliConfig['realWorldWindow'] {
  if (
    options.realWorldWindowStartedAt === undefined &&
    options.realWorldWindowEndedAt === undefined
  ) {
    return undefined;
  }
  if (
    options.realWorldWindowStartedAt === undefined ||
    options.realWorldWindowEndedAt === undefined
  ) {
    throw new Error('real-world window start and end must be provided together');
  }
  return {
    startedAtIso: options.realWorldWindowStartedAt,
    endedAtIso: options.realWorldWindowEndedAt,
  };
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
