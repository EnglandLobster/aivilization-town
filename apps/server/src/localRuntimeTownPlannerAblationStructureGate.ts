import type { PlannerExperimentMetric } from '@aivilization/observability';

export type LocalRuntimeTownPlannerAblationStructureGateEvidenceValue =
  | number
  | string
  | boolean;

export type LocalRuntimeTownPlannerAblationStructureGateFailure = {
  readonly code: string;
  readonly message: string;
  readonly evidence: Readonly<Record<string, LocalRuntimeTownPlannerAblationStructureGateEvidenceValue>>;
};

export type LocalRuntimeTownPlannerAblationStructureGateResult = {
  readonly variant: string;
  readonly status: 'pass' | 'fail';
  readonly failureCount: number;
  readonly failures: readonly LocalRuntimeTownPlannerAblationStructureGateFailure[];
};

export function evaluateLocalRuntimeTownPlannerAblationStructureGate(input: {
  readonly variant: string;
  readonly metrics: readonly PlannerExperimentMetric[];
}): LocalRuntimeTownPlannerAblationStructureGateResult {
  const metrics = new Map(input.metrics.map((metric) => [metric.metricId, metric.value]));
  const failures: LocalRuntimeTownPlannerAblationStructureGateFailure[] = [];
  const planCount = getMetric(metrics, 'planner-plan-count');

  if (planCount < 1) {
    failures.push({
      code: 'planner-plan-count-too-low',
      message: 'planner ablation variant must have at least one durable branch plan',
      evidence: {
        actual: planCount,
        minimum: 1,
      },
    });
  }

  if (input.variant === 'default') {
    addDefaultPlannerFailures(failures, metrics);
  }
  if (input.variant === 'without-branch') {
    addWithoutBranchFailures(failures, metrics);
  }
  if (input.variant === 'without-objective-decomposition') {
    addWithoutObjectiveDecompositionFailures(failures, metrics);
  }

  return {
    variant: input.variant,
    status: failures.length === 0 ? 'pass' : 'fail',
    failureCount: failures.length,
    failures,
  };
}

function addDefaultPlannerFailures(
  failures: LocalRuntimeTownPlannerAblationStructureGateFailure[],
  metrics: ReadonlyMap<string, number>,
): void {
  const meanBranchCount = getMetric(metrics, 'planner-mean-branch-count');
  if (meanBranchCount < 2) {
    failures.push({
      code: 'default-branch-decomposition-missing',
      message: 'default planner must retain branch decomposition',
      evidence: {
        actual: meanBranchCount,
        minimum: 2,
      },
    });
  }

  const multiSubtaskBranchRatio = getMetric(metrics, 'planner-multi-subtask-branch-ratio');
  if (multiSubtaskBranchRatio <= 0) {
    failures.push({
      code: 'default-objective-decomposition-missing',
      message: 'default planner must retain branch-internal objective decomposition',
      evidence: {
        actual: multiSubtaskBranchRatio,
        minimumExclusive: 0,
      },
    });
  }
}

function addWithoutBranchFailures(
  failures: LocalRuntimeTownPlannerAblationStructureGateFailure[],
  metrics: ReadonlyMap<string, number>,
): void {
  const singleBranchPlanRatio = getMetric(metrics, 'planner-single-branch-plan-ratio');
  if (singleBranchPlanRatio !== 1) {
    failures.push({
      code: 'without-branch-retains-branch-decomposition',
      message: 'without-branch planner must restrict every plan to a single branch',
      evidence: {
        actual: singleBranchPlanRatio,
        expected: 1,
      },
    });
  }
}

function addWithoutObjectiveDecompositionFailures(
  failures: LocalRuntimeTownPlannerAblationStructureGateFailure[],
  metrics: ReadonlyMap<string, number>,
): void {
  const meanBranchCount = getMetric(metrics, 'planner-mean-branch-count');
  if (meanBranchCount < 2) {
    failures.push({
      code: 'without-objective-decomposition-branch-decomposition-missing',
      message: 'without-objective-decomposition planner must retain parallel branch decomposition',
      evidence: {
        actual: meanBranchCount,
        minimum: 2,
      },
    });
  }

  const multiSubtaskBranchRatio = getMetric(metrics, 'planner-multi-subtask-branch-ratio');
  if (multiSubtaskBranchRatio !== 0) {
    failures.push({
      code: 'without-objective-decomposition-retains-objective-decomposition',
      message:
        'without-objective-decomposition planner must remove branch-internal objective decomposition',
      evidence: {
        actual: multiSubtaskBranchRatio,
        expected: 0,
      },
    });
  }
}

function getMetric(metrics: ReadonlyMap<string, number>, metricId: string): number {
  return metrics.get(metricId) ?? 0;
}
