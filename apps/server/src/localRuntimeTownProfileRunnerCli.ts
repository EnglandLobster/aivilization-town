#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  FileRuntimeProfileRunReportRepository,
  createRuntimeProfileRunReport,
  evaluateRuntimeProfileRunReport,
} from '@aivilization/observability';
import { createLocalRuntimeTownProfileGateCriteria } from './localRuntimeTownProfileGate';
import {
  loadLocalRuntimeTownProfileRuntimeConfig,
  type LocalRuntimeTownProfileRuntimeConfig,
} from './localRuntimeTownProfileRuntimeConfig';
import {
  runLocalRuntimeTownDaemonScenarioProfile,
  type LocalRuntimeTownProfileRunnerInput,
  type LocalRuntimeTownProfileRunnerPartitionSummary,
  type LocalRuntimeTownProfileRunnerSummary,
} from './localRuntimeTownProfileRunner';
import type { LocalRuntimeTownDaemonScenarioProfileId } from './localRuntimeTownScenarioProfile';

export type LocalRuntimeTownProfileRunnerCliConfig = Pick<
  LocalRuntimeTownProfileRunnerInput,
  'profileId' | 'rootDir' | 'cycleCount' | 'requestedAt' | 'cycleIntervalMs'
> & {
  readonly reportRootDir?: string;
  readonly experimentValidation?: boolean;
  readonly requireGate?: boolean;
  readonly runtimeConfigPath?: string;
};

export type LocalRuntimeTownProfileRunnerCliWriter = {
  readonly write: (chunk: string) => void;
};

export type LocalRuntimeTownProfileRunnerCliInput = {
  readonly argv?: readonly string[];
  readonly stdout?: LocalRuntimeTownProfileRunnerCliWriter;
  readonly stderr?: LocalRuntimeTownProfileRunnerCliWriter;
  readonly runProfile?: (
    input: LocalRuntimeTownProfileRunnerInput,
  ) => Promise<LocalRuntimeTownProfileRunnerSummary>;
};

const profileIds = new Set<LocalRuntimeTownDaemonScenarioProfileId>([
  'smoke-25',
  'default-100',
  'headless-stress-1000',
  'recovery-drill-25',
]);

export function parseLocalRuntimeTownProfileRunnerCliArgs(
  argv: readonly string[],
): LocalRuntimeTownProfileRunnerCliConfig {
  const args = parseFlagArgs(argv, new Set(['--require-gate', '--experiment-validation']));
  const profileId = readRequiredProfileId(args, '--profile');
  const rootDir = readRequiredString(args, '--root-dir');
  const cycleCount = readOptionalPositiveInteger(args, '--cycles') ?? 1;
  const requestedAt = readOptionalNonNegativeFinite(args, '--requested-at') ?? Date.now();
  const cycleIntervalMs = readOptionalNonNegativeFinite(args, '--cycle-interval-ms');
  const reportRootDir = readOptionalString(args, '--report-root-dir');
  const experimentValidation = readOptionalBoolean(args, '--experiment-validation');
  const requireGate = readOptionalBoolean(args, '--require-gate');
  const runtimeConfigPath = readRuntimeConfigPath(args);

  return {
    profileId,
    rootDir,
    cycleCount,
    requestedAt,
    ...(cycleIntervalMs === undefined ? {} : { cycleIntervalMs }),
    ...(reportRootDir === undefined ? {} : { reportRootDir }),
    ...(experimentValidation === undefined ? {} : { experimentValidation }),
    ...(requireGate === undefined ? {} : { requireGate }),
    ...(runtimeConfigPath === undefined ? {} : { runtimeConfigPath }),
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
    const runContext = await createRunnerContext(config);
    const summary = await runProfile(runContext.runnerInput);
    stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (config.requireGate === true) {
      const gate = evaluateRuntimeProfileRunReport(
        createProfileRunReportFromSummary(summary),
        createLocalRuntimeTownProfileGateCriteria(summary.profileId, {
          ...(runContext.runtimeConfig === undefined
            ? {}
            : { runtimeConfig: runContext.runtimeConfig }),
        }),
      );
      if (gate.status === 'fail') {
        stderr.write(formatGateFailure(gate.failures));
        return 2;
      }
    }
    return 0;
  } catch (error) {
    stderr.write(`${formatError(error)}\n`);
    return 1;
  }
}

type LocalRuntimeTownProfileRunnerCliRunContext = {
  readonly runnerInput: LocalRuntimeTownProfileRunnerInput;
  readonly runtimeConfig?: LocalRuntimeTownProfileRuntimeConfig;
};

async function createRunnerContext(
  config: LocalRuntimeTownProfileRunnerCliConfig,
): Promise<LocalRuntimeTownProfileRunnerCliRunContext> {
  const profileRunReportRepository =
    config.reportRootDir === undefined
      ? undefined
      : new FileRuntimeProfileRunReportRepository({ rootDir: config.reportRootDir });
  if (config.experimentValidation === true && profileRunReportRepository === undefined) {
    throw new Error('--experiment-validation requires --report-root-dir');
  }
  const runtimeConfig =
    config.runtimeConfigPath === undefined
      ? undefined
      : await loadLocalRuntimeTownProfileRuntimeConfig({
          profileId: config.profileId,
          path: config.runtimeConfigPath,
          env: process.env,
        });

  return {
    runnerInput: {
      profileId: config.profileId,
      rootDir: config.rootDir,
      cycleCount: config.cycleCount,
      requestedAt: config.requestedAt,
      ...(config.cycleIntervalMs === undefined ? {} : { cycleIntervalMs: config.cycleIntervalMs }),
      ...(profileRunReportRepository === undefined ? {} : { profileRunReportRepository }),
      ...(config.experimentValidation !== true || profileRunReportRepository === undefined
        ? {}
        : {
            experimentValidationSchedule: {
              plannerRunSource: {
                repository: profileRunReportRepository,
                profileId: config.profileId,
              },
              reportGate: {
                criteriaId: `${config.profileId}:profile-runner-cli:experiment-validation-gate`,
                defaultAllowedStatuses: ['pass', 'watch'],
              },
            },
          }),
      ...(runtimeConfig?.strategicPlanning === undefined
        ? {}
        : { llmPlanning: runtimeConfig.strategicPlanning }),
      ...(runtimeConfig?.dailyPlanning === undefined
        ? {}
        : { dailyPlanning: runtimeConfig.dailyPlanning }),
      ...(runtimeConfig?.reactionPlanning === undefined
        ? {}
        : { reactionPlanning: runtimeConfig.reactionPlanning }),
      ...(runtimeConfig?.subtaskPrioritization === undefined
        ? {}
        : { subtaskPrioritization: runtimeConfig.subtaskPrioritization }),
      ...(runtimeConfig?.actionSequenceGeneration === undefined
        ? {}
        : { actionSequenceGeneration: runtimeConfig.actionSequenceGeneration }),
      ...(runtimeConfig?.socialDialogue === undefined
        ? {}
        : { socialDialogue: runtimeConfig.socialDialogue }),
      ...(runtimeConfig?.globalSynthesis === undefined
        ? {}
        : { globalSynthesis: runtimeConfig.globalSynthesis }),
      ...(runtimeConfig?.reactiveCorrection === undefined
        ? {}
        : { reactiveCorrection: runtimeConfig.reactiveCorrection }),
      ...(runtimeConfig?.replanningDecision === undefined
        ? {}
        : { replanningDecision: runtimeConfig.replanningDecision }),
      ...(runtimeConfig?.reflectionSynthesis === undefined
        ? {}
        : { reflectionSynthesis: runtimeConfig.reflectionSynthesis }),
      ...(runtimeConfig?.socialModelSynthesis === undefined
        ? {}
        : { socialModelSynthesis: runtimeConfig.socialModelSynthesis }),
      ...(runtimeConfig?.replanningPolicy === undefined
        ? {}
        : { replanningPolicy: runtimeConfig.replanningPolicy }),
    },
    ...(runtimeConfig === undefined ? {} : { runtimeConfig }),
  };
}

function readRuntimeConfigPath(args: ReadonlyMap<string, string>): string | undefined {
  const runtimeConfigPath = readOptionalString(args, '--runtime-config');
  const legacyLlmPlanningConfigPath = readOptionalString(args, '--llm-planning-config');
  if (
    runtimeConfigPath !== undefined &&
    legacyLlmPlanningConfigPath !== undefined &&
    runtimeConfigPath !== legacyLlmPlanningConfigPath
  ) {
    throw new Error('--runtime-config and --llm-planning-config must not disagree');
  }
  return runtimeConfigPath ?? legacyLlmPlanningConfigPath;
}

function createProfileRunReportFromSummary(summary: LocalRuntimeTownProfileRunnerSummary) {
  return createRuntimeProfileRunReport({
    runId: summary.run.traceId,
    profileId: summary.profileId,
    manifestId: summary.manifestId,
    rootDir: summary.rootDir,
    generatedAt: Date.now(),
    requestedAt: summary.requestedAt,
    daemonHealth: summary.daemonHealth,
    outcome: summary.run.outcome,
    requestedCycleCount: summary.run.requestedCycleCount,
    completedCycleCount: summary.run.completedCycleCount,
    stopReason: summary.run.stopReason,
    partitionCount: summary.partitionCount,
    totalProjectionAgentCount: summary.totalProjectionAgentCount,
    totalEventCount: summary.totalEventCount,
    totalAgentTraceCount: summary.totalAgentTraceCount,
    agentCycleDiagnostics: summary.agentCycleDiagnostics,
    ...(summary.cognitionLlmStageDiagnostics === undefined
      ? {}
      : { cognitionLlmStageDiagnostics: summary.cognitionLlmStageDiagnostics }),
    partitions: summary.partitions.map(clonePartitionSummary),
  });
}

function clonePartitionSummary(
  partition: LocalRuntimeTownProfileRunnerPartitionSummary,
): LocalRuntimeTownProfileRunnerPartitionSummary {
  return { ...partition };
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

function formatGateFailure(
  failures: readonly {
    readonly code: string;
    readonly message: string;
  }[],
): string {
  return [
    'runtime profile run gate failed',
    ...failures.map((failure) => `- ${failure.code}: ${failure.message}`),
  ].join('\n');
}

function isDirectExecution(metaUrl: string, argvPath: string | undefined): boolean {
  return argvPath !== undefined && pathToFileURL(argvPath).href === metaUrl;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  void runLocalRuntimeTownProfileRunnerCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
