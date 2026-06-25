import type { SubtaskPrioritizationSensitivityProbeResult } from '@aivilization/agent-runtime';
import type { PlannerExperimentMetric } from '@aivilization/observability';

export function createPlannerEconomicSensitivityMetricsFromProbeResults(
  results: readonly SubtaskPrioritizationSensitivityProbeResult[],
): PlannerExperimentMetric[] {
  if (results.length === 0) {
    return [];
  }

  let selectionChangeCount = 0;
  let completeEconomicContextCount = 0;

  for (const result of results) {
    assertNonEmpty(result.scenarioId, 'economic sensitivity scenarioId');
    const statusIsSensitive = result.status === 'sensitive';
    if (statusIsSensitive !== result.selectionChanged) {
      throw new Error(
        `economic sensitivity result ${result.scenarioId} status must match selectionChanged`,
      );
    }

    if (result.selectionChanged) {
      selectionChangeCount += 1;
    }
    if (result.completeEconomicContext) {
      completeEconomicContextCount += 1;
    }
  }

  return [
    {
      metricId: 'planner-economic-sensitivity-scenario-count',
      value: results.length,
      higherIsBetter: true,
    },
    {
      metricId: 'planner-economic-sensitivity-selection-change-count',
      value: selectionChangeCount,
      higherIsBetter: true,
    },
    {
      metricId: 'planner-economic-sensitivity-complete-economic-context-count',
      value: completeEconomicContextCount,
      higherIsBetter: true,
    },
  ];
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
