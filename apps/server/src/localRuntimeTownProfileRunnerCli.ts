#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  runLocalRuntimeTownDaemonScenarioProfile,
  type LocalRuntimeTownProfileRunnerInput,
  type LocalRuntimeTownProfileRunnerSummary,
} from './localRuntimeTownProfileRunner';
import type { LocalRuntimeTownDaemonScenarioProfileId } from './localRuntimeTownScenarioProfile';

export type LocalRuntimeTownProfileRunnerCliConfig = Pick<
  LocalRuntimeTownProfileRunnerInput,
  'profileId' | 'rootDir' | 'cycleCount' | 'requestedAt' | 'cycleIntervalMs'
>;

export type LocalRuntimeTownProfileRunnerCliWriter = {
  readonly write: (chunk: string) => void;
};

export type LocalRuntimeTownProfileRunnerCliInput = {
  readonly argv?: readonly string[];
  readonly stdout?: LocalRuntimeTownProfileRunnerCliWriter;
  readonly stderr?: LocalRuntimeTownProfileRunnerCliWriter;
  readonly runProfile?: (
    input: LocalRuntimeTownProfileRunnerCliConfig,
  ) => Promise<LocalRuntimeTownProfileRunnerSummary>;
};

const profileIds = new Set<LocalRuntimeTownDaemonScenarioProfileId>([
  'smoke-25',
  'default-100',
  'headless-stress-1000',
]);

export function parseLocalRuntimeTownProfileRunnerCliArgs(
  argv: readonly string[],
): LocalRuntimeTownProfileRunnerCliConfig {
  const args = parseFlagArgs(argv);
  const profileId = readRequiredProfileId(args, '--profile');
  const rootDir = readRequiredString(args, '--root-dir');
  const cycleCount = readOptionalPositiveInteger(args, '--cycles') ?? 1;
  const requestedAt = readOptionalNonNegativeFinite(args, '--requested-at') ?? Date.now();
  const cycleIntervalMs = readOptionalNonNegativeFinite(args, '--cycle-interval-ms');

  return {
    profileId,
    rootDir,
    cycleCount,
    requestedAt,
    ...(cycleIntervalMs === undefined ? {} : { cycleIntervalMs }),
  };
}

export async function runLocalRuntimeTownProfileRunnerCli(
  input: LocalRuntimeTownProfileRunnerCliInput = {},
): Promise<number> {
  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  const runProfile = input.runProfile ?? runLocalRuntimeTownDaemonScenarioProfile;

  try {
    const config = parseLocalRuntimeTownProfileRunnerCliArgs(input.argv ?? process.argv.slice(2));
    const summary = await runProfile(config);
    stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${formatError(error)}\n`);
    return 1;
  }
}

function parseFlagArgs(argv: readonly string[]): ReadonlyMap<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === undefined || !flag.startsWith('--')) {
      throw new Error(`unexpected argument: ${flag ?? ''}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for ${flag}`);
    }
    args.set(flag, value);
    index += 1;
  }
  return args;
}

function readRequiredProfileId(
  args: ReadonlyMap<string, string>,
  flag: string,
): LocalRuntimeTownDaemonScenarioProfileId {
  const value = readRequiredString(args, flag);
  if (!profileIds.has(value as LocalRuntimeTownDaemonScenarioProfileId)) {
    throw new Error(`unsupported profile id: ${value}`);
  }
  return value as LocalRuntimeTownDaemonScenarioProfileId;
}

function readRequiredString(args: ReadonlyMap<string, string>, flag: string): string {
  const value = args.get(flag);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

function readOptionalPositiveInteger(
  args: ReadonlyMap<string, string>,
  flag: string,
): number | undefined {
  const value = args.get(flag);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function readOptionalNonNegativeFinite(
  args: ReadonlyMap<string, string>,
  flag: string,
): number | undefined {
  const value = args.get(flag);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative finite number`);
  }
  return parsed;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDirectExecution(metaUrl: string, argvPath: string | undefined): boolean {
  return argvPath !== undefined && pathToFileURL(argvPath).href === metaUrl;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  void runLocalRuntimeTownProfileRunnerCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
