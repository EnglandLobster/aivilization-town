import { describe, expect, test } from 'vitest';
import { createExperimentValidationReport, type ExperimentValidationMetric } from './index';

function getMetric(
  metrics: readonly ExperimentValidationMetric[],
  id: ExperimentValidationMetric['id'],
): ExperimentValidationMetric {
  const metric = metrics.find((candidate) => candidate.id === id);
  if (metric === undefined) {
    throw new Error(`missing metric ${id}`);
  }
  return metric;
}

describe('experiment validation report', () => {
  test('builds paper validation metrics from deterministic experiment observations', () => {
    const report = createExperimentValidationReport({
      run: {
        runId: 'validation-run-1',
        simulationId: 'sim-validation',
        generatedAt: 1_700_000_000,
        source: 'unit-test',
      },
      priceSeries: [
        { commodityId: 'Fish', observedAt: 0, closePrice: 100 },
        { commodityId: 'Fish', observedAt: 1, closePrice: 110 },
        { commodityId: 'Fish', observedAt: 2, closePrice: 99 },
        { commodityId: 'Fish', observedAt: 3, closePrice: 120 },
        { commodityId: 'Fish', observedAt: 4, closePrice: 105 },
        { commodityId: 'Fish', observedAt: 5, closePrice: 126 },
      ],
      wealthSnapshot: [
        { agentId: 'agent-a', educationScore: 1_400, netWorth: 100, occupationId: 'CEO' },
        { agentId: 'agent-b', educationScore: 900, netWorth: 50, occupationId: 'Teacher' },
        { agentId: 'agent-c', educationScore: 100, netWorth: 25, occupationId: 'Worker' },
        { agentId: 'agent-d', educationScore: 0, netWorth: 25 },
      ],
      plannerRuns: [
        {
          taskId: 'high-tech-production',
          variant: 'default',
          metrics: [{ metricId: 'net-worth', value: 110_098, higherIsBetter: true }],
        },
        {
          taskId: 'high-tech-production',
          variant: 'without-branch',
          metrics: [{ metricId: 'net-worth', value: 75_237, higherIsBetter: true }],
        },
        {
          taskId: 'high-tech-production',
          variant: 'without-objective-decomposition',
          metrics: [{ metricId: 'net-worth', value: 95_279, higherIsBetter: true }],
        },
      ],
      expectedTrajectoryAgentIds: ['agent-a', 'agent-b', 'agent-c'],
      trajectories: [
        {
          agentId: 'agent-a',
          stepCount: 5,
          firstEventId: 'event-1',
          lastEventId: 'event-5',
          firstCommandId: 'cmd-a-1',
          lastCommandId: 'cmd-a-5',
        },
        {
          agentId: 'agent-b',
          stepCount: 1,
          firstEventId: 'event-6',
          lastEventId: 'event-6',
        },
      ],
      thresholds: {
        marketStability: {
          maximumLogPriceRange: 1,
          maximumDrawdown: 0.2,
          minimumLogReturnStandardDeviation: 0,
        },
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
        wealthStratification: { minimumGiniCoefficient: 0.2, minimumEducationWealthRatio: 2 },
        plannerAblation: { minimumDefaultWinRate: 1 },
        trajectoryCoverage: { minimumCoverageRatio: 0.6, minimumMinimumStepCount: 1 },
      },
    });

    expect(report.run).toEqual({
      runId: 'validation-run-1',
      simulationId: 'sim-validation',
      generatedAt: 1_700_000_000,
      source: 'unit-test',
    });
    expect(report.metrics.map((metric) => metric.id)).toEqual([
      'market-stability',
      'heavy-tail-returns',
      'volatility-clustering',
      'wealth-stratification',
      'planner-ablation',
      'trajectory-coverage',
    ]);

    const marketStability = getMetric(report.metrics, 'market-stability');
    expect(marketStability.status).toBe('pass');
    expect(marketStability.evidence.maximumDrawdown).toBeCloseTo(0.125);
    expect(marketStability.evidence.maximumLogPriceRange).toBeCloseTo(Math.log(126) - Math.log(99));
    expect(marketStability.evidence.minimumLogReturnStandardDeviation).toBeGreaterThan(0);

    const wealth = getMetric(report.metrics, 'wealth-stratification');
    expect(wealth.status).toBe('pass');
    expect(wealth.value).toBeCloseTo(0.3125);
    expect(wealth.evidence.topDecileWealthShare).toBeCloseTo(0.5);
    expect(wealth.evidence.educationWealthRatio).toBeCloseTo(3);
    expect(wealth.evidence.occupationGroupCount).toBe(3);

    const ablation = getMetric(report.metrics, 'planner-ablation');
    expect(ablation.status).toBe('pass');
    expect(ablation.value).toBe(1);
    expect(ablation.evidence.comparisonCount).toBe(2);

    const trajectories = getMetric(report.metrics, 'trajectory-coverage');
    expect(trajectories.status).toBe('pass');
    expect(trajectories.value).toBeCloseTo(2 / 3);
    expect(trajectories.evidence.missingAgentCount).toBe(1);
    expect(trajectories.evidence.minimumStepCount).toBe(1);
    expect(trajectories.evidence.commandBackedTrajectoryCount).toBe(1);

    expect(report.findings).toHaveLength(6);
    expect(report.findings.map((finding) => finding.topic)).toEqual(
      report.metrics.map((metric) => metric.id),
    );
  });

  test('rejects invalid observations before emitting a validation report', () => {
    const validInput = {
      run: {
        runId: 'validation-run-2',
        simulationId: 'sim-validation',
        generatedAt: 1_700_000_001,
      },
      priceSeries: [
        { commodityId: 'Fish', observedAt: 0, closePrice: 100 },
        { commodityId: 'Fish', observedAt: 1, closePrice: 101 },
      ],
      wealthSnapshot: [
        { agentId: 'agent-a', educationScore: 10, netWorth: 100 },
        { agentId: 'agent-b', educationScore: 0, netWorth: 25 },
      ],
      plannerRuns: [
        {
          taskId: 'task-1',
          variant: 'default',
          metrics: [{ metricId: 'net-worth', value: 100, higherIsBetter: true }],
        },
        {
          taskId: 'task-1',
          variant: 'without-branch',
          metrics: [{ metricId: 'net-worth', value: 80, higherIsBetter: true }],
        },
      ],
      expectedTrajectoryAgentIds: ['agent-a'],
      trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
    };

    expect(() =>
      createExperimentValidationReport({
        ...validInput,
        priceSeries: [{ commodityId: 'Fish', observedAt: 0, closePrice: 0 }],
      }),
    ).toThrow('priceSeries closePrice must be positive and finite');

    expect(() =>
      createExperimentValidationReport({
        ...validInput,
        wealthSnapshot: [{ agentId: 'agent-a', educationScore: 0, netWorth: Number.NaN }],
      }),
    ).toThrow('wealthSnapshot netWorth must be finite');

    expect(() =>
      createExperimentValidationReport({
        ...validInput,
        plannerRuns: [
          {
            taskId: 'task-1',
            variant: 'without-branch',
            metrics: [{ metricId: 'net-worth', value: 80, higherIsBetter: true }],
          },
        ],
      }),
    ).toThrow('plannerRuns must include a default variant for each task metric');
  });

  test('reports missing trajectory coverage without non-finite evidence', () => {
    const report = createExperimentValidationReport({
      run: {
        runId: 'validation-run-3',
        simulationId: 'sim-validation',
        generatedAt: 1_700_000_002,
      },
      priceSeries: [
        { commodityId: 'Fish', observedAt: 0, closePrice: 100 },
        { commodityId: 'Fish', observedAt: 1, closePrice: 101 },
      ],
      wealthSnapshot: [
        { agentId: 'agent-a', educationScore: 10, netWorth: 100 },
        { agentId: 'agent-b', educationScore: 0, netWorth: 25 },
      ],
      plannerRuns: [
        {
          taskId: 'task-1',
          variant: 'default',
          metrics: [{ metricId: 'net-worth', value: 100, higherIsBetter: true }],
        },
        {
          taskId: 'task-1',
          variant: 'without-branch',
          metrics: [{ metricId: 'net-worth', value: 80, higherIsBetter: true }],
        },
      ],
      expectedTrajectoryAgentIds: ['agent-a'],
      trajectories: [{ agentId: 'agent-outside-cohort', stepCount: 2 }],
      thresholds: {
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        trajectoryCoverage: { minimumCoverageRatio: 1, minimumMinimumStepCount: 1 },
      },
    });

    const trajectories = getMetric(report.metrics, 'trajectory-coverage');

    expect(trajectories.status).toBe('watch');
    expect(trajectories.value).toBe(0);
    expect(trajectories.evidence.minimumStepCount).toBe(0);
    expect(trajectories.evidence.maximumStepCount).toBe(0);
  });
});
