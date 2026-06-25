import { join } from 'node:path';
import {
  FileRuntimeProfileRunReportRepository,
  createRuntimeProfileRunReport,
  evaluateRuntimeProfileRunReport,
  type RuntimeProfileRunGateResult,
  type RuntimeProfileRunReport,
  type RuntimeProfileRunReportRepository,
} from '@aivilization/observability';
import type { SimulationTimestamp } from '@aivilization/sim-core';
import { createLocalRuntimeTownProfileGateCriteria } from './localRuntimeTownProfileGate';
import {
  runLocalRuntimeTownDaemonScenarioProfile,
  type LocalRuntimeTownProfileRunnerInput,
  type LocalRuntimeTownProfileRunnerPartitionSummary,
  type LocalRuntimeTownProfileRunnerSummary,
} from './localRuntimeTownProfileRunner';
import type { LocalRuntimeTownDaemonScenarioProfileId } from './localRuntimeTownScenarioProfile';

export const localRuntimeTownProfileGateSuiteDefaultProfileIds = [
  'smoke-25',
  'default-100',
  'headless-stress-1000',
] as const satisfies readonly LocalRuntimeTownDaemonScenarioProfileId[];

export type LocalRuntimeTownProfileGateSuiteInput = {
  readonly rootDir: string;
  readonly reportRootDir?: string;
  readonly profileIds?: readonly LocalRuntimeTownDaemonScenarioProfileId[];
  readonly requestedAt: SimulationTimestamp;
  readonly cycleCount?: number;
  readonly cycleIntervalMs?: number;
  readonly reportGeneratedAt?: SimulationTimestamp;
  readonly runProfile?: (
    input: LocalRuntimeTownProfileRunnerInput,
  ) => Promise<LocalRuntimeTownProfileRunnerSummary>;
};

export type LocalRuntimeTownProfileGateSuiteProfileResult = {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly rootDir: string;
  readonly summary: LocalRuntimeTownProfileRunnerSummary;
  readonly report: RuntimeProfileRunReport;
  readonly gate: RuntimeProfileRunGateResult;
};

export type LocalRuntimeTownProfileGateSuiteSummary = {
  readonly status: 'pass' | 'fail';
  readonly requestedAt: SimulationTimestamp;
  readonly profileCount: number;
  readonly passedProfileCount: number;
  readonly failedProfileCount: number;
  readonly profiles: readonly LocalRuntimeTownProfileGateSuiteProfileResult[];
};

export async function runLocalRuntimeTownProfileGateSuite(
  input: LocalRuntimeTownProfileGateSuiteInput,
): Promise<LocalRuntimeTownProfileGateSuiteSummary> {
  assertNonEmpty(input.rootDir, 'rootDir');
  assertNonNegativeFinite(input.requestedAt, 'requestedAt');
  if (input.reportRootDir !== undefined) {
    assertNonEmpty(input.reportRootDir, 'reportRootDir');
  }
  if (input.cycleIntervalMs !== undefined) {
    assertNonNegativeFinite(input.cycleIntervalMs, 'cycleIntervalMs');
  }
  if (input.reportGeneratedAt !== undefined) {
    assertNonNegativeFinite(input.reportGeneratedAt, 'reportGeneratedAt');
  }

  const cycleCount = input.cycleCount ?? 1;
  assertPositiveInteger(cycleCount, 'cycleCount');
  const profileIds = input.profileIds ?? localRuntimeTownProfileGateSuiteDefaultProfileIds;
  if (profileIds.length === 0) {
    throw new Error('profileIds must not be empty');
  }

  const runProfile = input.runProfile ?? runLocalRuntimeTownDaemonScenarioProfile;
  const profileRunReportRepository =
    input.reportRootDir === undefined
      ? undefined
      : new FileRuntimeProfileRunReportRepository({ rootDir: input.reportRootDir });
  const profiles: LocalRuntimeTownProfileGateSuiteProfileResult[] = [];

  for (const profileId of profileIds) {
    const summary = await runProfile(
      createProfileRunnerInput({
        profileId,
        suiteInput: input,
        cycleCount,
        ...(profileRunReportRepository === undefined ? {} : { profileRunReportRepository }),
      }),
    );
    const report = createLocalRuntimeTownProfileRunReportFromSummary({
      summary,
      generatedAt: input.reportGeneratedAt ?? Date.now(),
    });
    if (profileRunReportRepository !== undefined) {
      await profileRunReportRepository.record(report);
    }
    const gate = evaluateRuntimeProfileRunReport(
      report,
      createLocalRuntimeTownProfileGateCriteria(profileId, {
        minimumCompletedCycleCount: cycleCount,
      }),
    );

    profiles.push({
      profileId,
      rootDir: summary.rootDir,
      summary,
      report,
      gate,
    });
  }

  const failedProfileCount = profiles.filter((profile) => profile.gate.status === 'fail').length;
  const passedProfileCount = profiles.length - failedProfileCount;

  return {
    status: failedProfileCount === 0 ? 'pass' : 'fail',
    requestedAt: input.requestedAt,
    profileCount: profiles.length,
    passedProfileCount,
    failedProfileCount,
    profiles,
  };
}

export function createLocalRuntimeTownProfileRunReportFromSummary(input: {
  readonly summary: LocalRuntimeTownProfileRunnerSummary;
  readonly generatedAt: SimulationTimestamp;
}): RuntimeProfileRunReport {
  assertNonNegativeFinite(input.generatedAt, 'generatedAt');
  return createRuntimeProfileRunReport({
    runId: input.summary.run.traceId,
    profileId: input.summary.profileId,
    manifestId: input.summary.manifestId,
    rootDir: input.summary.rootDir,
    generatedAt: input.generatedAt,
    requestedAt: input.summary.requestedAt,
    daemonHealth: input.summary.daemonHealth,
    outcome: input.summary.run.outcome,
    requestedCycleCount: input.summary.run.requestedCycleCount,
    completedCycleCount: input.summary.run.completedCycleCount,
    stopReason: input.summary.run.stopReason,
    partitionCount: input.summary.partitionCount,
    totalProjectionAgentCount: input.summary.totalProjectionAgentCount,
    totalEventCount: input.summary.totalEventCount,
    totalAgentTraceCount: input.summary.totalAgentTraceCount,
    agentCycleDiagnostics: input.summary.agentCycleDiagnostics,
    partitions: input.summary.partitions.map(clonePartitionSummary),
  });
}

function createProfileRunnerInput(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly suiteInput: LocalRuntimeTownProfileGateSuiteInput;
  readonly cycleCount: number;
  readonly profileRunReportRepository?: RuntimeProfileRunReportRepository;
}): LocalRuntimeTownProfileRunnerInput {
  return {
    profileId: input.profileId,
    rootDir: join(input.suiteInput.rootDir, encodeURIComponent(input.profileId)),
    cycleCount: input.cycleCount,
    requestedAt: input.suiteInput.requestedAt,
    ...(input.suiteInput.cycleIntervalMs === undefined
      ? {}
      : { cycleIntervalMs: input.suiteInput.cycleIntervalMs }),
    ...(input.suiteInput.reportGeneratedAt === undefined
      ? {}
      : { reportGeneratedAt: input.suiteInput.reportGeneratedAt }),
    ...(input.profileRunReportRepository === undefined
      ? {}
      : { profileRunReportRepository: input.profileRunReportRepository }),
  };
}

function clonePartitionSummary(
  partition: LocalRuntimeTownProfileRunnerPartitionSummary,
): LocalRuntimeTownProfileRunnerPartitionSummary {
  return { ...partition };
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must not be empty`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
}
