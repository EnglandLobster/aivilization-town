import { isAbsolute, resolve } from 'node:path';
import type { RuntimeSoakProfileId } from '@aivilization/observability';
import {
  resolveLocalRuntimeTownCliConfig,
  type LocalRuntimeTownCliConfigInput,
  type LocalRuntimeTownSourceRevision,
} from './localRuntimeTownCli';
import {
  createLocalRuntimeTownSoakDefaults,
  runLocalRuntimeTownSoak,
  type LocalRuntimeTownSoakConfig,
  type LocalRuntimeTownSoakDependencies,
  type LocalRuntimeTownSoakResult,
} from './localRuntimeTownSoak';

export type LocalRuntimeTownSoakCliConfig = LocalRuntimeTownSoakConfig;

export function resolveLocalRuntimeTownSoakCliConfig(
  input: {
    readonly argv?: readonly string[];
    readonly env?: LocalRuntimeTownCliConfigInput['env'];
    readonly cwd?: string;
    readonly now?: number;
    readonly sourceRevision?: LocalRuntimeTownSourceRevision;
  } = {},
): LocalRuntimeTownSoakCliConfig {
  const options = parseOptions(input.argv ?? []);
  const cwd = input.cwd ?? process.cwd();
  const now = input.now ?? Date.now();
  const profileId = requireProfileId(options.profile);
  const soakRunId = options.soakRunId ?? `${profileId}-${Math.trunc(now)}`;
  assertSafeRunId(soakRunId);
  const defaults = createLocalRuntimeTownSoakDefaults();
  const durationMs = parsePositiveInteger(
    options.durationMs ?? String(defaults.durationMs),
    'duration-ms',
  );
  const sampleIntervalMs = parsePositiveInteger(
    options.sampleIntervalMs ?? String(defaults.sampleIntervalMs),
    'sample-interval-ms',
  );
  const runtimeRootDir = resolvePath(
    options.runtimeRootDir ?? `.aivilization/soak-runs/${soakRunId}/runtime`,
    cwd,
  );
  const artifactRootDir = resolvePath(
    options.artifactRootDir ?? '.aivilization/soak-artifacts',
    cwd,
  );
  const llmMode = options.llmMode ?? 'deterministic';
  const seed = options.seed ?? `runtime-soak-evidence-v1:${profileId}:${soakRunId}`;
  const runtime = resolveLocalRuntimeTownCliConfig({
    argv: [
      '--profile',
      profileId,
      '--root-dir',
      runtimeRootDir,
      '--port',
      '0',
      '--seed',
      seed,
      '--llm-mode',
      llmMode,
    ],
    cwd,
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.sourceRevision === undefined ? {} : { sourceRevision: input.sourceRevision }),
  });
  return {
    soakRunId,
    durationMs,
    sampleIntervalMs,
    artifactRootDir,
    runtime,
  };
}

export function runLocalRuntimeTownSoakCli(
  config: LocalRuntimeTownSoakCliConfig,
  dependencies: LocalRuntimeTownSoakDependencies = {},
): Promise<LocalRuntimeTownSoakResult> {
  return runLocalRuntimeTownSoak(config, dependencies);
}

export function hasLocalRuntimeTownSoakHelpFlag(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export function createLocalRuntimeTownSoakCliHelp(): string {
  return [
    'Run a manifest-bound SCALE-001 backend soak and persist content-addressed evidence.',
    '',
    'Usage:',
    '  pnpm --filter @aivilization/server runtime-soak -- [options]',
    '',
    'Required:',
    '  --profile <id>              smoke-25 | default-100 | headless-stress-1000',
    '',
    'Optional:',
    '  --soak-run-id <id>          Safe run label (default: profile + current timestamp)',
    '  --duration-ms <ms>          Observation duration (canonical: 1800000)',
    '  --sample-interval-ms <ms>   Sampling cadence (default: 5000; canonical maximum gap: 10000)',
    '  --runtime-root-dir <path>   New empty dedicated runtime root',
    '  --artifact-root-dir <path>  Evidence repository root',
    '  --seed <seed>               Explicit reproducibility seed',
    '  --llm-mode <mode>           deterministic | provider (default: deterministic)',
    '  -h, --help                  Show this help',
    '',
    'The report includes throughput, queue/execution/end-to-end latency, process memory,',
    'queue depth, recovery counts, failure rate, and recursive durable-data growth.',
    'Runs shorter than 30 minutes or sampled more sparsely than every 10 seconds are',
    'preserved as noncanonical contract evidence and cannot establish scale capability.',
    'This is single-process backend evidence; it does not establish full provider or paper scale.',
  ].join('\n');
}

type ParsedOptions = {
  readonly profile?: string;
  readonly soakRunId?: string;
  readonly durationMs?: string;
  readonly sampleIntervalMs?: string;
  readonly runtimeRootDir?: string;
  readonly artifactRootDir?: string;
  readonly seed?: string;
  readonly llmMode?: string;
};

function parseOptions(argv: readonly string[]): ParsedOptions {
  const values: Record<string, string | undefined> = {};
  const names: Readonly<Record<string, keyof ParsedOptions>> = {
    '--profile': 'profile',
    '--soak-run-id': 'soakRunId',
    '--duration-ms': 'durationMs',
    '--sample-interval-ms': 'sampleIntervalMs',
    '--runtime-root-dir': 'runtimeRootDir',
    '--artifact-root-dir': 'artifactRootDir',
    '--seed': 'seed',
    '--llm-mode': 'llmMode',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--' || argument === '--help' || argument === '-h') {
      continue;
    }
    const equalsIndex = argument.indexOf('=');
    const optionName = equalsIndex < 0 ? argument : argument.slice(0, equalsIndex);
    const name = names[optionName];
    if (name === undefined) {
      throw new Error(`unknown runtime soak option ${argument}`);
    }
    if (values[name] !== undefined) {
      throw new Error(`${optionName} must not be repeated`);
    }
    const inlineValue = equalsIndex < 0 ? undefined : argument.slice(equalsIndex + 1);
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith('--') || value.trim().length === 0) {
      throw new Error(`${optionName} requires a non-empty value`);
    }
    values[name] = value;
    if (inlineValue === undefined) {
      index += 1;
    }
  }
  return values;
}

function requireProfileId(value: string | undefined): RuntimeSoakProfileId {
  if (value !== 'smoke-25' && value !== 'default-100' && value !== 'headless-stress-1000') {
    throw new Error('--profile must be one of smoke-25, default-100, or headless-stress-1000');
  }
  return value;
}

function assertSafeRunId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new Error('soak-run-id must contain only letters, digits, dot, underscore, or hyphen');
  }
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function resolvePath(value: string, cwd: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(cwd, value);
}
