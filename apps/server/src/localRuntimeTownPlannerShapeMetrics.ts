import { join } from 'node:path';
import { FileBranchPlanRepository, type BranchPlanRecord } from '@aivilization/agent-runtime';
import type { PlannerExperimentMetric } from '@aivilization/observability';
import type { LocalRuntimeTownProfileRunnerSummary } from './localRuntimeTownProfileRunner';

export function createPlannerShapeMetricsFromBranchPlans(
  records: readonly BranchPlanRecord[],
): PlannerExperimentMetric[] {
  const planCount = records.length;
  const totalBranchCount = sumBy(records, (record) => record.plan.branches.length);
  const totalSubtaskCount = sumBy(records, (record) =>
    sumBy(record.plan.branches, (branch) => branch.subtasks.length),
  );
  const multiSubtaskBranchCount = sumBy(records, (record) =>
    record.plan.branches.filter((branch) => branch.subtasks.length > 1).length,
  );
  const singleBranchPlanCount = records.filter((record) => record.plan.branches.length === 1).length;

  return [
    {
      metricId: 'planner-plan-count',
      value: planCount,
      higherIsBetter: true,
    },
    {
      metricId: 'planner-mean-branch-count',
      value: average(totalBranchCount, planCount),
      higherIsBetter: true,
    },
    {
      metricId: 'planner-mean-subtask-count',
      value: average(totalSubtaskCount, planCount),
      higherIsBetter: true,
    },
    {
      metricId: 'planner-mean-subtasks-per-branch',
      value: average(totalSubtaskCount, totalBranchCount),
      higherIsBetter: true,
    },
    {
      metricId: 'planner-single-branch-plan-ratio',
      value: average(singleBranchPlanCount, planCount),
      higherIsBetter: false,
    },
    {
      metricId: 'planner-multi-subtask-branch-ratio',
      value: average(multiSubtaskBranchCount, totalBranchCount),
      higherIsBetter: true,
    },
    {
      metricId: 'planner-llm-source-count',
      value: countPlanningSource(records, 'llm'),
      higherIsBetter: true,
    },
    {
      metricId: 'planner-deterministic-source-count',
      value: countPlanningSource(records, 'deterministic'),
      higherIsBetter: true,
    },
    {
      metricId: 'planner-deterministic-fallback-source-count',
      value: countPlanningSource(records, 'deterministic-fallback'),
      higherIsBetter: true,
    },
  ];
}

export async function createLocalRuntimeTownProfilePlannerShapeMetrics(
  summary: LocalRuntimeTownProfileRunnerSummary,
): Promise<PlannerExperimentMetric[]> {
  const records: BranchPlanRecord[] = [];

  for (const partition of summary.partitions) {
    const repository = new FileBranchPlanRepository({
      rootDir: join(
        summary.rootDir,
        'simulations',
        partition.simulationId,
        'partitions',
        partition.partitionKey,
        'planning',
      ),
    });
    records.push(...(await repository.query({})));
  }

  return createPlannerShapeMetricsFromBranchPlans(records);
}

function countPlanningSource(
  records: readonly BranchPlanRecord[],
  source: NonNullable<BranchPlanRecord['planningTrace']>['source'],
): number {
  return records.filter((record) => record.planningTrace?.source === source).length;
}

function average(total: number, count: number): number {
  return count === 0 ? 0 : total / count;
}

function sumBy<TValue>(values: readonly TValue[], project: (value: TValue) => number): number {
  return values.reduce((total, value) => total + project(value), 0);
}
