import { join } from 'node:path';
import {
  FileAgentCycleTraceRepository,
  type AgentCycleTrace,
} from '@aivilization/observability';
import type { PlannerExperimentMetric } from '@aivilization/observability';
import type { LocalRuntimeTownProfileRunnerSummary } from './localRuntimeTownProfileRunner';

export function createPlannerOutcomeMetricsFromAgentCycleTraces(
  traces: readonly AgentCycleTrace[],
): PlannerExperimentMetric[] {
  const traceCount = traces.length;
  const commandEmittingCycleCount = traces.filter((trace) => trace.emittedCommandIds.length > 0)
    .length;
  const acceptedCycleCount = countSimulatorStatus(traces, 'accepted');
  const repairedCycleCount = countSimulatorStatus(traces, 'repaired');
  const rejectedCycleCount = countSimulatorStatus(traces, 'rejected');
  const replanningCycleCount = traces.filter((trace) => trace.replanningDecision.kind !== 'none')
    .length;
  const acceptedActionCount = sumBy(
    traces,
    (trace) => trace.actionSynthesis.acceptedActions.length,
  );
  const emittedCommandCount = sumBy(traces, (trace) => trace.emittedCommandIds.length);
  const distinctSelectedBranchCount = new Set(traces.map((trace) => trace.selectedBranch)).size;

  return [
    {
      metricId: 'planner-cycle-trace-count',
      value: traceCount,
      higherIsBetter: true,
    },
    {
      metricId: 'planner-command-emitting-cycle-ratio',
      value: average(commandEmittingCycleCount, traceCount),
      higherIsBetter: true,
    },
    {
      metricId: 'planner-simulator-accepted-ratio',
      value: average(acceptedCycleCount, traceCount),
      higherIsBetter: true,
    },
    {
      metricId: 'planner-simulator-repaired-ratio',
      value: average(repairedCycleCount, traceCount),
      higherIsBetter: false,
    },
    {
      metricId: 'planner-simulator-rejected-ratio',
      value: average(rejectedCycleCount, traceCount),
      higherIsBetter: false,
    },
    {
      metricId: 'planner-replanning-cycle-ratio',
      value: average(replanningCycleCount, traceCount),
      higherIsBetter: false,
    },
    {
      metricId: 'planner-mean-accepted-action-count',
      value: average(acceptedActionCount, traceCount),
      higherIsBetter: true,
    },
    {
      metricId: 'planner-mean-emitted-command-count',
      value: average(emittedCommandCount, traceCount),
      higherIsBetter: true,
    },
    {
      metricId: 'planner-distinct-selected-branch-count',
      value: distinctSelectedBranchCount,
      higherIsBetter: true,
    },
  ];
}

export async function createLocalRuntimeTownProfilePlannerOutcomeMetrics(
  summary: LocalRuntimeTownProfileRunnerSummary,
): Promise<PlannerExperimentMetric[]> {
  const traces: AgentCycleTrace[] = [];

  for (const partition of summary.partitions) {
    const repository = new FileAgentCycleTraceRepository({
      rootDir: join(
        summary.rootDir,
        'simulations',
        partition.simulationId,
        'partitions',
        partition.partitionKey,
        'observability',
      ),
    });
    traces.push(...(await repository.query({ simulationId: partition.simulationId })));
  }

  return createPlannerOutcomeMetricsFromAgentCycleTraces(traces);
}

function countSimulatorStatus(
  traces: readonly AgentCycleTrace[],
  status: AgentCycleTrace['simulatorResult']['status'],
): number {
  return traces.filter((trace) => trace.simulatorResult.status === status).length;
}

function average(total: number, count: number): number {
  return count === 0 ? 0 : total / count;
}

function sumBy<TValue>(values: readonly TValue[], project: (value: TValue) => number): number {
  return values.reduce((total, value) => total + project(value), 0);
}
