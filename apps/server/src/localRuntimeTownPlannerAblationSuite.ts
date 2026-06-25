import { join } from 'node:path';
import {
  compileStrategicObjectiveWithoutObjectiveDecomposition,
  createBranchPlan,
  type SubtaskPrioritizer,
  type SubtaskPrioritizationSensitivityProbeResult,
  type StrategicPlanCompiler,
} from '@aivilization/agent-runtime';
import {
  FileRuntimeProfileRunReportRepository,
  createRuntimeProfileRunReport,
  type PlannerExperimentMetric,
  type RuntimeProfileRunReport,
  type RuntimeProfileRunReportRepository,
} from '@aivilization/observability';
import type { SimulationTimestamp } from '@aivilization/sim-core';
import type {
  LocalWorldRuntimeAgentProvider,
  WorldCommandPolicySource,
} from '@aivilization/worker';
import {
  evaluateLocalRuntimeTownPlannerAblationStructureGate,
  type LocalRuntimeTownPlannerAblationStructureGateResult,
} from './localRuntimeTownPlannerAblationStructureGate';
import { createPlannerEconomicSensitivityMetricsFromProbeResults } from './localRuntimeTownPlannerEconomicSensitivityMetrics';
import { createLocalRuntimeTownPlannerEconomicSensitivityProbeResults } from './localRuntimeTownPlannerEconomicSensitivityProbe';
import type {
  LocalRuntimeTownProfileStrategicCompilerConfig,
  LocalRuntimeTownProfileSubtaskPrioritizerConfig,
} from './localRuntimeTownProfileLlmPlanning';
import { createLocalRuntimeTownProfilePlannerOutcomeMetrics } from './localRuntimeTownPlannerOutcomeMetrics';
import { createLocalRuntimeTownProfilePlannerShapeMetrics } from './localRuntimeTownPlannerShapeMetrics';
import {
  runLocalRuntimeTownDaemonScenarioProfile,
  type LocalRuntimeTownProfileRunnerInput,
  type LocalRuntimeTownProfileRunnerSummary,
} from './localRuntimeTownProfileRunner';
import type { LocalRuntimeTownDaemonScenarioProfileId } from './localRuntimeTownScenarioProfile';

export const localRuntimeTownPlannerAblationSuiteDefaultVariants: readonly LocalRuntimeTownPlannerAblationVariant[] =
  [
    { variant: 'default' },
    {
      variant: 'without-branch',
      strategicPlanCompiler: createLocalRuntimeTownWithoutBranchStrategicPlanCompiler(),
    },
    {
      variant: 'without-objective-decomposition',
      strategicPlanCompiler: compileStrategicObjectiveWithoutObjectiveDecomposition,
    },
  ];

export type LocalRuntimeTownPlannerAblationVariant = {
  readonly variant: string;
  readonly runIdSuffix?: string;
  readonly policies?: WorldCommandPolicySource;
  readonly agentProvider?: LocalWorldRuntimeAgentProvider;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly llmPlanning?: LocalRuntimeTownProfileStrategicCompilerConfig;
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly subtaskPrioritization?: LocalRuntimeTownProfileSubtaskPrioritizerConfig;
};

export type LocalRuntimeTownPlannerAblationSuiteInput = {
  readonly rootDir: string;
  readonly reportRootDir?: string;
  readonly profileRunReportRepository?: RuntimeProfileRunReportRepository;
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly taskId: string;
  readonly requestedAt: SimulationTimestamp;
  readonly cycleCount?: number;
  readonly cycleIntervalMs?: number;
  readonly reportGeneratedAt?: SimulationTimestamp;
  readonly variants?: readonly LocalRuntimeTownPlannerAblationVariant[];
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly subtaskPrioritization?: LocalRuntimeTownProfileSubtaskPrioritizerConfig;
  readonly createMetrics?: (
    summary: LocalRuntimeTownProfileRunnerSummary,
    variant: LocalRuntimeTownPlannerAblationVariant,
  ) => readonly PlannerExperimentMetric[] | Promise<readonly PlannerExperimentMetric[]>;
  readonly createEconomicSensitivityProbeResults?: (
    summary: LocalRuntimeTownProfileRunnerSummary,
    variant: LocalRuntimeTownPlannerAblationVariant,
  ) =>
    | readonly SubtaskPrioritizationSensitivityProbeResult[]
    | Promise<readonly SubtaskPrioritizationSensitivityProbeResult[]>;
  readonly runProfile?: (
    input: LocalRuntimeTownProfileRunnerInput,
  ) => Promise<LocalRuntimeTownProfileRunnerSummary>;
};

export type LocalRuntimeTownPlannerAblationSuiteVariantResult = {
  readonly variant: string;
  readonly rootDir: string;
  readonly summary: LocalRuntimeTownProfileRunnerSummary;
  readonly report: RuntimeProfileRunReport;
  readonly structureGate: LocalRuntimeTownPlannerAblationStructureGateResult;
};

export type LocalRuntimeTownPlannerAblationSuiteSummary = {
  readonly status: 'completed';
  readonly structureStatus: 'pass' | 'fail';
  readonly structureFailureCount: number;
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly taskId: string;
  readonly requestedAt: SimulationTimestamp;
  readonly variantCount: number;
  readonly variants: readonly LocalRuntimeTownPlannerAblationSuiteVariantResult[];
};

export async function runLocalRuntimeTownPlannerAblationSuite(
  input: LocalRuntimeTownPlannerAblationSuiteInput,
): Promise<LocalRuntimeTownPlannerAblationSuiteSummary> {
  assertNonEmpty(input.rootDir, 'rootDir');
  assertNonEmpty(input.taskId, 'taskId');
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
  const variants = input.variants ?? localRuntimeTownPlannerAblationSuiteDefaultVariants;
  assertValidVariants(variants);

  const runProfile = input.runProfile ?? runLocalRuntimeTownDaemonScenarioProfile;
  const reportRepository = createReportRepository(input);
  const createMetrics =
    input.createMetrics ??
    ((summary: LocalRuntimeTownProfileRunnerSummary, variant: LocalRuntimeTownPlannerAblationVariant) =>
      createDefaultPlannerExperimentMetrics(summary, variant, {
        createEconomicSensitivityProbeResults:
          input.createEconomicSensitivityProbeResults ??
          ((_probeSummary, probeVariant) =>
            createLocalRuntimeTownPlannerEconomicSensitivityProbeResults({
              profileId: input.profileId,
              variant: probeVariant.variant,
              issuedAt: input.requestedAt,
              ...resolveVariantSubtaskPrioritization(input, probeVariant),
            })),
      }));
  const results: LocalRuntimeTownPlannerAblationSuiteVariantResult[] = [];

  for (const variant of variants) {
    const variantRootDir = join(input.rootDir, encodeURIComponent(variant.variant));
    const variantSubtaskPrioritization = resolveVariantSubtaskPrioritization(input, variant);
    const summary = await runProfile({
      profileId: input.profileId,
      rootDir: variantRootDir,
      cycleCount,
      requestedAt: input.requestedAt,
      runIdSuffix: variant.runIdSuffix ?? variant.variant,
      ...(input.cycleIntervalMs === undefined ? {} : { cycleIntervalMs: input.cycleIntervalMs }),
      ...(variant.policies === undefined ? {} : { policies: variant.policies }),
      ...(variant.agentProvider === undefined ? {} : { agentProvider: variant.agentProvider }),
      ...(variant.strategicPlanCompiler === undefined
        ? {}
        : { strategicPlanCompiler: variant.strategicPlanCompiler }),
      ...(variant.llmPlanning === undefined ? {} : { llmPlanning: variant.llmPlanning }),
      ...variantSubtaskPrioritization,
    });
    const report = createRuntimeProfileRunReport({
      runId: summary.run.traceId,
      profileId: summary.profileId,
      manifestId: summary.manifestId,
      rootDir: summary.rootDir,
      generatedAt: input.reportGeneratedAt ?? Date.now(),
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
      partitions: summary.partitions.map((partition) => ({ ...partition })),
      plannerExperiment: {
        taskId: input.taskId,
        variant: variant.variant,
        metrics: await createMetrics(summary, variant),
      },
    });
    const structureGate = evaluateLocalRuntimeTownPlannerAblationStructureGate({
      variant: variant.variant,
      metrics: report.plannerExperiment?.metrics ?? [],
    });

    if (reportRepository !== undefined) {
      await reportRepository.record(report);
    }
    results.push({
      variant: variant.variant,
      rootDir: variantRootDir,
      summary,
      report,
      structureGate,
    });
  }
  const structureFailureCount = sumBy(results, (result) => result.structureGate.failureCount);

  return {
    status: 'completed',
    structureStatus: structureFailureCount === 0 ? 'pass' : 'fail',
    structureFailureCount,
    profileId: input.profileId,
    taskId: input.taskId,
    requestedAt: input.requestedAt,
    variantCount: results.length,
    variants: results,
  };
}

function resolveVariantSubtaskPrioritization(
  input: Pick<
    LocalRuntimeTownPlannerAblationSuiteInput,
    'subtaskPrioritizer' | 'subtaskPrioritization'
  >,
  variant: LocalRuntimeTownPlannerAblationVariant,
): Pick<LocalRuntimeTownProfileRunnerInput, 'subtaskPrioritizer' | 'subtaskPrioritization'> {
  const subtaskPrioritizer = variant.subtaskPrioritizer ?? input.subtaskPrioritizer;
  const subtaskPrioritization = variant.subtaskPrioritization ?? input.subtaskPrioritization;

  return {
    ...(subtaskPrioritizer === undefined ? {} : { subtaskPrioritizer }),
    ...(subtaskPrioritization === undefined ? {} : { subtaskPrioritization }),
  };
}

async function createDefaultPlannerExperimentMetrics(
  summary: LocalRuntimeTownProfileRunnerSummary,
  variant: LocalRuntimeTownPlannerAblationVariant,
  input: {
    readonly createEconomicSensitivityProbeResults?: LocalRuntimeTownPlannerAblationSuiteInput['createEconomicSensitivityProbeResults'];
  } = {},
): Promise<PlannerExperimentMetric[]> {
  const economicSensitivityProbeResults =
    input.createEconomicSensitivityProbeResults === undefined
      ? []
      : await input.createEconomicSensitivityProbeResults(summary, variant);

  return [
    {
      metricId: 'completed-cycle-count',
      value: summary.run.completedCycleCount,
      higherIsBetter: true,
    },
    {
      metricId: 'total-agent-trace-count',
      value: summary.totalAgentTraceCount,
      higherIsBetter: true,
    },
    {
      metricId: 'total-event-count',
      value: summary.totalEventCount,
      higherIsBetter: true,
    },
    ...(await createLocalRuntimeTownProfilePlannerShapeMetrics(summary)),
    ...(await createLocalRuntimeTownProfilePlannerOutcomeMetrics(summary)),
    ...createPlannerEconomicSensitivityMetricsFromProbeResults(economicSensitivityProbeResults),
  ];
}

export function createLocalRuntimeTownWithoutBranchStrategicPlanCompiler(): StrategicPlanCompiler {
  return ({ objective }) => {
    const affinityTags = normalizeAffinityTags(objective.affinityTags);

    return {
      plan: createBranchPlan({
        objective: objective.statement,
        branches: [
          {
            id: 'without-branch',
            objective: 'Pursue the objective without alternative branch decomposition.',
            subtasks: [
              {
                id: 'pursue-objective',
                description: `Pursue the objective directly without branch decomposition: ${objective.statement}`,
                basePriority: 8 + objective.priority,
                signalKeys: affinityTags,
                intentionAffinityTags: affinityTags,
                memoryAffinityTags: affinityTags,
                profileAffinityTags: affinityTags,
              },
            ],
          },
        ],
      }),
      planningTrace: {
        status: 'deterministic',
        source: 'deterministic',
        message: 'Planner ablation without branch decomposition',
      },
    };
  };
}

function normalizeAffinityTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0))];
}

function createReportRepository(
  input: LocalRuntimeTownPlannerAblationSuiteInput,
): RuntimeProfileRunReportRepository | undefined {
  if (input.profileRunReportRepository !== undefined) {
    return input.profileRunReportRepository;
  }
  if (input.reportRootDir !== undefined) {
    return new FileRuntimeProfileRunReportRepository({ rootDir: input.reportRootDir });
  }
  return undefined;
}

function assertValidVariants(variants: readonly LocalRuntimeTownPlannerAblationVariant[]): void {
  if (variants.length === 0) {
    throw new Error('variants must not be empty');
  }
  let hasDefault = false;
  let hasAblated = false;
  const seen = new Set<string>();
  for (const variant of variants) {
    assertNonEmpty(variant.variant, 'variant');
    const suffix = variant.runIdSuffix ?? variant.variant;
    assertNonEmpty(suffix, 'variant runIdSuffix');
    if (seen.has(variant.variant)) {
      throw new Error(`variant ${variant.variant} must be unique`);
    }
    seen.add(variant.variant);
    if (variant.variant === 'default') {
      hasDefault = true;
    } else {
      hasAblated = true;
    }
  }
  if (!hasDefault) {
    throw new Error('variants must include default');
  }
  if (!hasAblated) {
    throw new Error('variants must include at least one ablated variant');
  }
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

function sumBy<TValue>(values: readonly TValue[], project: (value: TValue) => number): number {
  return values.reduce((total, value) => total + project(value), 0);
}
