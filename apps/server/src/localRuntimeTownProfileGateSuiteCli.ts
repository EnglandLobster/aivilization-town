#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  localRuntimeTownProfileGateSuiteDefaultProfileIds,
  runLocalRuntimeTownProfileGateSuite,
  type LocalRuntimeTownProfileGateSuiteInput,
  type LocalRuntimeTownProfileGateSuiteSummary,
} from './localRuntimeTownProfileGateSuite';
import type { LocalRuntimeTownDaemonScenarioProfileId } from './localRuntimeTownScenarioProfile';

export type LocalRuntimeTownProfileGateSuiteCliConfig = Pick<
  LocalRuntimeTownProfileGateSuiteInput,
  | 'rootDir'
  | 'requestedAt'
  | 'cycleCount'
  | 'cycleIntervalMs'
  | 'experimentValidation'
  | 'profileIds'
  | 'reportRootDir'
  | 'runtimeConfigPath'
  | 'minimumFullReplanMaterializationCount'
  | 'minimumSimulatorRolloutCoverageRatio'
>;

export type LocalRuntimeTownProfileGateSuiteCliWriter = {
  readonly write: (chunk: string) => void;
};

export type LocalRuntimeTownProfileGateSuiteCliInput = {
  readonly argv?: readonly string[];
  readonly stdout?: LocalRuntimeTownProfileGateSuiteCliWriter;
  readonly stderr?: LocalRuntimeTownProfileGateSuiteCliWriter;
  readonly runSuite?: (
    input: LocalRuntimeTownProfileGateSuiteInput,
  ) => Promise<LocalRuntimeTownProfileGateSuiteSummary>;
};

const profileIds = new Set<LocalRuntimeTownDaemonScenarioProfileId>(
  localRuntimeTownProfileGateSuiteDefaultProfileIds,
);

export function parseLocalRuntimeTownProfileGateSuiteCliArgs(
  argv: readonly string[],
): LocalRuntimeTownProfileGateSuiteCliConfig {
  const args = parseFlagArgs(argv, new Set(['--experiment-validation']));
  const rootDir = readRequiredString(args, '--root-dir');
  const requestedAt = readOptionalNonNegativeFinite(args, '--requested-at') ?? Date.now();
  const cycleCount = readOptionalPositiveInteger(args, '--cycles') ?? 1;
  const cycleIntervalMs = readOptionalNonNegativeFinite(args, '--cycle-interval-ms');
  const profileIds = readOptionalProfileIds(args, '--profiles');
  const reportRootDir = readOptionalString(args, '--report-root-dir');
  const experimentValidation = readOptionalBoolean(args, '--experiment-validation');
  const runtimeConfigPath = readOptionalString(args, '--runtime-config');
  const minimumFullReplanMaterializationCount = readOptionalNonNegativeInteger(
    args,
    '--minimum-full-replan-materializations',
  );
  const minimumSimulatorRolloutCoverageRatio = readOptionalRatio(
    args,
    '--minimum-simulator-rollout-coverage-ratio',
  );
  if (experimentValidation === true && reportRootDir === undefined) {
    throw new Error('--experiment-validation requires --report-root-dir');
  }

  return {
    rootDir,
    requestedAt,
    cycleCount,
    ...(cycleIntervalMs === undefined ? {} : { cycleIntervalMs }),
    ...(profileIds === undefined ? {} : { profileIds }),
    ...(reportRootDir === undefined ? {} : { reportRootDir }),
    ...(experimentValidation === undefined ? {} : { experimentValidation }),
    ...(runtimeConfigPath === undefined ? {} : { runtimeConfigPath }),
    ...(minimumFullReplanMaterializationCount === undefined
      ? {}
      : { minimumFullReplanMaterializationCount }),
    ...(minimumSimulatorRolloutCoverageRatio === undefined
      ? {}
      : { minimumSimulatorRolloutCoverageRatio }),
  };
}

export async function runLocalRuntimeTownProfileGateSuiteCli(
  input: LocalRuntimeTownProfileGateSuiteCliInput = {},
): Promise<number> {
  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  const runSuite = input.runSuite ?? runLocalRuntimeTownProfileGateSuite;

  try {
    const config = parseLocalRuntimeTownProfileGateSuiteCliArgs(
      input.argv ?? process.argv.slice(2),
    );
    const summary = await runSuite(config);
    stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.status === 'fail') {
      stderr.write(formatSuiteFailure(summary));
      return 2;
    }
    return 0;
  } catch (error) {
    stderr.write(`${formatError(error)}\n`);
    return 1;
  }
}

function parseFlagArgs(
  argv: readonly string[],
  booleanFlags: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === undefined || !flag.startsWith('--')) {
      throw new Error(`unexpected argument: ${flag ?? ''}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      if (booleanFlags.has(flag)) {
        args.set(flag, 'true');
        continue;
      }
      throw new Error(`missing value for ${flag}`);
    }
    args.set(flag, value);
    index += 1;
  }
  return args;
}

function readOptionalBoolean(args: ReadonlyMap<string, string>, flag: string): boolean | undefined {
  const value = args.get(flag);
  if (value === undefined) {
    return undefined;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`${flag} must be true or false`);
}

function readRequiredString(args: ReadonlyMap<string, string>, flag: string): string {
  const value = args.get(flag);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

function readOptionalString(args: ReadonlyMap<string, string>, flag: string): string | undefined {
  const value = args.get(flag);
  if (value === undefined) {
    return undefined;
  }
  if (value.trim().length === 0) {
    throw new Error(`${flag} must not be empty`);
  }
  return value;
}

function readOptionalProfileIds(
  args: ReadonlyMap<string, string>,
  flag: string,
): readonly LocalRuntimeTownDaemonScenarioProfileId[] | undefined {
  const value = readOptionalString(args, flag);
  if (value === undefined) {
    return undefined;
  }
  const parsed = value
    .split(',')
    .map((profileId) => profileId.trim())
    .filter((profileId) => profileId.length > 0);
  if (parsed.length === 0) {
    throw new Error(`${flag} must include at least one profile id`);
  }
  for (const profileId of parsed) {
    if (!profileIds.has(profileId as LocalRuntimeTownDaemonScenarioProfileId)) {
      throw new Error(`unsupported profile id: ${profileId}`);
    }
  }
  return parsed as readonly LocalRuntimeTownDaemonScenarioProfileId[];
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

function readOptionalNonNegativeInteger(
  args: ReadonlyMap<string, string>,
  flag: string,
): number | undefined {
  const value = args.get(flag);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
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

function readOptionalRatio(args: ReadonlyMap<string, string>, flag: string): number | undefined {
  const value = args.get(flag);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${flag} must be between 0 and 1`);
  }
  return parsed;
}

function formatSuiteFailure(summary: LocalRuntimeTownProfileGateSuiteSummary): string {
  const lines = ['runtime profile gate suite failed'];
  for (const profile of summary.profiles) {
    if (profile.gate.status === 'pass') {
      continue;
    }
    for (const failure of profile.gate.failures) {
      lines.push(`- ${profile.profileId} ${failure.code}: ${failure.message}`);
    }
  }
  return lines.join('\n');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDirectExecution(metaUrl: string, argvPath: string | undefined): boolean {
  return argvPath !== undefined && pathToFileURL(argvPath).href === metaUrl;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  void runLocalRuntimeTownProfileGateSuiteCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
