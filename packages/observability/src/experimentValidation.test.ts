import { describe, expect, test } from 'vitest';
import {
  createExperimentValidationReport,
  evaluateExperimentValidationReportGate,
  type ExperimentValidationMetric,
} from './index';

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
      socialReflectionObservations: [
        {
          observationId: 'reflection-agent-a-agent-b',
          agentId: 'agent-a',
          targetAgentId: 'agent-b',
          confidence: 0.8,
          evidenceRecordIds: ['memory-agent-a-agent-b'],
          generatedAt: 10,
          tags: ['social', 'post-interaction-reflection'],
        },
        {
          observationId: 'reflection-agent-b-agent-a',
          agentId: 'agent-b',
          targetAgentId: 'agent-a',
          confidence: 0.6,
          evidenceRecordIds: ['memory-agent-b-agent-a'],
          generatedAt: 11,
          tags: ['social', 'post-interaction-reflection'],
        },
      ],
      steeringTraces: [
        {
          traceId: 'steering-objective-agent-a',
          agentId: 'agent-a',
          source: 'human',
          resultKind: 'long-horizon-objective-set',
          objectiveId: 'objective-study-production',
          planId: 'objective-study-production',
          commandDraftCount: 0,
          shortTermMemoryRecordIds: [],
          issuedAt: 12,
        },
        {
          traceId: 'steering-reactive-agent-b',
          agentId: 'agent-b',
          source: 'human',
          resultKind: 'reactive-command-routed',
          reactiveCommandId: 'reactive-buy-fish',
          commandDraftCount: 1,
          shortTermMemoryRecordIds: ['stm-reactive-buy-fish'],
          issuedAt: 13,
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
        socialReflectionCoverage: {
          minimumObservationCount: 2,
          minimumAgentCoverageRatio: 0.6,
          minimumDirectedPairCount: 2,
          minimumMeanConfidence: 0.7,
          requiredTag: 'post-interaction-reflection',
        },
        steeringMemoryPropagation: {
          minimumTraceCount: 2,
          minimumAgentCoverageRatio: 0.6,
          minimumLongHorizonTraceCount: 1,
          minimumReactiveTraceCount: 1,
        },
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
      'planner-economic-sensitivity',
      'social-reflection-coverage',
      'steering-memory-propagation',
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
    expect(ablation.evidence.expectedVariantCount).toBe(3);
    expect(ablation.evidence.observedVariantCount).toBe(3);
    expect(ablation.evidence.missingVariantCount).toBe(0);
    expect(ablation.evidence.expectedVariants).toBe(
      'default,without-branch,without-objective-decomposition',
    );

    const socialReflection = getMetric(report.metrics, 'social-reflection-coverage');
    expect(socialReflection.status).toBe('pass');
    expect(socialReflection.value).toBeCloseTo(2 / 3);
    expect(socialReflection.evidence).toMatchObject({
      observationCount: 2,
      expectedAgentCount: 3,
      coveredAgentCount: 2,
      directedPairCount: 2,
      evidenceBackedObservationCount: 2,
      requiredTagObservationCount: 2,
      latestGeneratedAt: 11,
    });
    expect(socialReflection.evidence.agentCoverageRatio).toBeCloseTo(2 / 3);
    expect(socialReflection.evidence.meanConfidence).toBeCloseTo(0.7);

    const steering = getMetric(report.metrics, 'steering-memory-propagation');
    expect(steering.status).toBe('pass');
    expect(steering.value).toBeCloseTo(2 / 3);
    expect(steering.evidence).toMatchObject({
      traceCount: 2,
      humanTraceCount: 2,
      expectedAgentCount: 3,
      coveredAgentCount: 2,
      longHorizonTraceCount: 1,
      reactiveTraceCount: 1,
      planBackedLongHorizonTraceCount: 1,
      memoryBackedReactiveTraceCount: 1,
      commandDraftBackedReactiveTraceCount: 1,
      latestIssuedAt: 13,
    });
    expect(steering.evidence.agentCoverageRatio).toBeCloseTo(2 / 3);

    const trajectories = getMetric(report.metrics, 'trajectory-coverage');
    expect(trajectories.status).toBe('pass');
    expect(trajectories.value).toBeCloseTo(2 / 3);
    expect(trajectories.evidence.missingAgentCount).toBe(1);
    expect(trajectories.evidence.minimumStepCount).toBe(1);
    expect(trajectories.evidence.commandBackedTrajectoryCount).toBe(1);

    expect(report.findings).toHaveLength(9);
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
        {
          taskId: 'task-1',
          variant: 'without-objective-decomposition',
          metrics: [{ metricId: 'net-worth', value: 90, higherIsBetter: true }],
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

    expect(() =>
      createExperimentValidationReport({
        ...validInput,
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
      }),
    ).toThrow(
      'plannerRuns missing expected variants without-objective-decomposition for task task-1 metric net-worth',
    );

    expect(() =>
      createExperimentValidationReport({
        ...validInput,
        socialReflectionObservations: [
          {
            observationId: 'reflection-self-target',
            agentId: 'agent-a',
            targetAgentId: 'agent-a',
            confidence: 0.8,
            evidenceRecordIds: ['memory-self-target'],
            generatedAt: 10,
            tags: ['post-interaction-reflection'],
          },
        ],
      }),
    ).toThrow('socialReflectionObservations targetAgentId must differ from agentId');

    expect(() =>
      createExperimentValidationReport({
        ...validInput,
        steeringTraces: [
          {
            traceId: 'steering-reactive-without-memory',
            agentId: 'agent-a',
            source: 'human',
            resultKind: 'reactive-command-routed',
            reactiveCommandId: 'reactive-buy-fish',
            commandDraftCount: 1,
            shortTermMemoryRecordIds: [],
            issuedAt: 12,
          },
        ],
      }),
    ).toThrow('steeringTraces reactive trace requires at least one shortTermMemoryRecordId');
  });

  test('reports missing social reflection coverage as watch without non-finite evidence', () => {
    const report = createExperimentValidationReport({
      run: {
        runId: 'validation-run-social-reflection-missing',
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
        {
          taskId: 'task-1',
          variant: 'without-objective-decomposition',
          metrics: [{ metricId: 'net-worth', value: 90, higherIsBetter: true }],
        },
      ],
      expectedTrajectoryAgentIds: ['agent-a', 'agent-b'],
      trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
      thresholds: {
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        socialReflectionCoverage: {
          minimumObservationCount: 1,
          minimumAgentCoverageRatio: 0.5,
          minimumDirectedPairCount: 1,
          minimumMeanConfidence: 0.5,
        },
      },
    });

    const socialReflection = getMetric(report.metrics, 'social-reflection-coverage');

    expect(socialReflection.status).toBe('watch');
    expect(socialReflection.value).toBe(0);
    expect(socialReflection.evidence).toMatchObject({
      observationCount: 0,
      expectedAgentCount: 2,
      coveredAgentCount: 0,
      agentCoverageRatio: 0,
      directedPairCount: 0,
      meanConfidence: 0,
      evidenceBackedObservationCount: 0,
      requiredTagObservationCount: 0,
      latestGeneratedAt: 0,
    });
  });

  test('reports missing steering propagation as watch without non-finite evidence', () => {
    const report = createExperimentValidationReport({
      run: {
        runId: 'validation-run-steering-missing',
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
        {
          taskId: 'task-1',
          variant: 'without-objective-decomposition',
          metrics: [{ metricId: 'net-worth', value: 90, higherIsBetter: true }],
        },
      ],
      expectedTrajectoryAgentIds: ['agent-a', 'agent-b'],
      trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
      thresholds: {
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        steeringMemoryPropagation: {
          minimumTraceCount: 1,
          minimumAgentCoverageRatio: 0.5,
          minimumLongHorizonTraceCount: 1,
          minimumReactiveTraceCount: 1,
        },
      },
    });

    const steering = getMetric(report.metrics, 'steering-memory-propagation');

    expect(steering.status).toBe('watch');
    expect(steering.value).toBe(0);
    expect(steering.evidence).toMatchObject({
      traceCount: 0,
      humanTraceCount: 0,
      expectedAgentCount: 2,
      coveredAgentCount: 0,
      agentCoverageRatio: 0,
      longHorizonTraceCount: 0,
      reactiveTraceCount: 0,
      planBackedLongHorizonTraceCount: 0,
      memoryBackedReactiveTraceCount: 0,
      commandDraftBackedReactiveTraceCount: 0,
      latestIssuedAt: 0,
    });
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
        {
          taskId: 'task-1',
          variant: 'without-objective-decomposition',
          metrics: [{ metricId: 'net-worth', value: 90, higherIsBetter: true }],
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

  test('requires mature price sample size before accepting stylized market facts', () => {
    const report = createExperimentValidationReport({
      run: {
        runId: 'validation-run-short-price-sample',
        simulationId: 'sim-validation',
        generatedAt: 1_700_000_003,
      },
      priceSeries: [
        { commodityId: 'Fish', observedAt: 0, closePrice: 100 },
        { commodityId: 'Fish', observedAt: 1, closePrice: 130 },
        { commodityId: 'Fish', observedAt: 2, closePrice: 95 },
        { commodityId: 'Fish', observedAt: 3, closePrice: 140 },
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
        {
          taskId: 'task-1',
          variant: 'without-objective-decomposition',
          metrics: [{ metricId: 'net-worth', value: 90, higherIsBetter: true }],
        },
      ],
      expectedTrajectoryAgentIds: ['agent-a'],
      trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
      thresholds: {
        heavyTailReturns: {
          minimumExcessKurtosis: -10,
          minimumReturnObservationCount: 5,
        },
        volatilityClustering: {
          minimumLagOneAbsoluteReturnAutocorrelation: -1,
          minimumReturnObservationCount: 5,
        },
      },
    });

    const heavyTail = getMetric(report.metrics, 'heavy-tail-returns');
    const volatility = getMetric(report.metrics, 'volatility-clustering');

    expect(heavyTail.status).toBe('watch');
    expect(heavyTail.evidence).toMatchObject({
      returnObservationCount: 3,
      minimumReturnObservationCount: 5,
    });
    expect(volatility.status).toBe('watch');
    expect(volatility.evidence).toMatchObject({
      returnObservationCount: 3,
      minimumReturnObservationCount: 5,
    });
  });

  test('consumes planner shape and outcome metrics in ablation validation', () => {
    const report = createExperimentValidationReport({
      run: {
        runId: 'validation-run-planner-metrics',
        simulationId: 'sim-validation',
        generatedAt: 1_700_000_003,
      },
      priceSeries: [
        { commodityId: 'Fish', observedAt: 0, closePrice: 100 },
        { commodityId: 'Fish', observedAt: 1, closePrice: 102 },
      ],
      wealthSnapshot: [
        { agentId: 'agent-a', educationScore: 10, netWorth: 100 },
        { agentId: 'agent-b', educationScore: 0, netWorth: 25 },
      ],
      plannerRuns: [
        createPlannerRun({
          variant: 'default',
          commandEmittingRatio: 0.4,
          rejectedRatio: 0.05,
          replanningRatio: 0.1,
          singleBranchRatio: 0.25,
        }),
        createPlannerRun({
          variant: 'without-branch',
          commandEmittingRatio: 0.15,
          rejectedRatio: 0.35,
          replanningRatio: 0.6,
          singleBranchRatio: 1,
        }),
        createPlannerRun({
          variant: 'without-objective-decomposition',
          commandEmittingRatio: 0.15,
          rejectedRatio: 0.35,
          replanningRatio: 0.6,
          singleBranchRatio: 1,
        }),
      ],
      expectedTrajectoryAgentIds: ['agent-a'],
      trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
      thresholds: {
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        plannerAblation: {
          minimumDefaultWinRate: 0.5,
          minimumDefaultCommandEmittingCycleRatio: 0.5,
          maximumDefaultSimulatorRejectedRatio: 0.1,
          maximumDefaultReplanningCycleRatio: 0.2,
        },
      },
    });

    const ablation = getMetric(report.metrics, 'planner-ablation');

    expect(ablation.status).toBe('watch');
    expect(ablation.evidence).toMatchObject({
      defaultWinRate: 1,
      plannerShapeMetricCount: 1,
      plannerOutcomeMetricCount: 3,
      defaultCommandEmittingCycleRatio: 0.4,
      ablatedCommandEmittingCycleRatio: 0.15,
      commandEmittingCycleRatioDefaultAdvantage: 0.25,
      defaultSimulatorRejectedRatio: 0.05,
      ablatedSimulatorRejectedRatio: 0.35,
      simulatorRejectedRatioDefaultAdvantage: 0.3,
      defaultReplanningCycleRatio: 0.1,
      ablatedReplanningCycleRatio: 0.6,
      replanningCycleRatioDefaultAdvantage: 0.5,
      defaultSingleBranchPlanRatio: 0.25,
      ablatedSingleBranchPlanRatio: 1,
      singleBranchPlanRatioDefaultAdvantage: 0.75,
    });
  });

  test('consumes planner economic sensitivity metrics without polluting ablation comparisons', () => {
    const report = createExperimentValidationReport({
      run: {
        runId: 'validation-run-planner-economic-sensitivity',
        simulationId: 'sim-validation',
        generatedAt: 1_700_000_004,
      },
      priceSeries: [
        { commodityId: 'Fish', observedAt: 0, closePrice: 100 },
        { commodityId: 'Fish', observedAt: 1, closePrice: 102 },
      ],
      wealthSnapshot: [
        { agentId: 'agent-a', educationScore: 10, netWorth: 100 },
        { agentId: 'agent-b', educationScore: 0, netWorth: 25 },
      ],
      plannerRuns: [
        {
          taskId: 'economic-contextual-prioritization',
          variant: 'default',
          metrics: [
            { metricId: 'net-worth', value: 120, higherIsBetter: true },
            {
              metricId: 'planner-economic-sensitivity-scenario-count',
              value: 4,
              higherIsBetter: true,
            },
            {
              metricId: 'planner-economic-sensitivity-selection-change-count',
              value: 2,
              higherIsBetter: true,
            },
            {
              metricId: 'planner-economic-sensitivity-complete-economic-context-count',
              value: 4,
              higherIsBetter: true,
            },
          ],
        },
        {
          taskId: 'economic-contextual-prioritization',
          variant: 'without-branch',
          metrics: [{ metricId: 'net-worth', value: 95, higherIsBetter: true }],
        },
        {
          taskId: 'economic-contextual-prioritization',
          variant: 'without-objective-decomposition',
          metrics: [{ metricId: 'net-worth', value: 105, higherIsBetter: true }],
        },
      ],
      expectedTrajectoryAgentIds: ['agent-a'],
      trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
      thresholds: {
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        plannerEconomicSensitivity: {
          minimumScenarioCount: 4,
          minimumSensitiveScenarioRatio: 0.5,
          minimumCompleteEconomicContextRatio: 1,
        },
      },
    });

    const economicSensitivity = getMetric(report.metrics, 'planner-economic-sensitivity');
    expect(economicSensitivity.status).toBe('pass');
    expect(economicSensitivity.value).toBeCloseTo(0.5);
    expect(economicSensitivity.evidence).toMatchObject({
      scenarioCount: 4,
      sensitiveScenarioCount: 2,
      insensitiveScenarioCount: 2,
      completeEconomicContextScenarioCount: 4,
      sensitivityRatio: 0.5,
      completeEconomicContextRatio: 1,
    });

    const ablation = getMetric(report.metrics, 'planner-ablation');
    expect(ablation.evidence).toMatchObject({
      taskMetricCount: 1,
      comparisonCount: 2,
    });
  });

  test('requires the full default economic sensitivity matrix before passing validation', () => {
    const report = createExperimentValidationReport({
      run: {
        runId: 'validation-run-single-economic-sensitivity-scenario',
        simulationId: 'sim-validation',
        generatedAt: 1_700_000_004,
      },
      priceSeries: [
        { commodityId: 'Fish', observedAt: 0, closePrice: 100 },
        { commodityId: 'Fish', observedAt: 1, closePrice: 102 },
      ],
      wealthSnapshot: [
        { agentId: 'agent-a', educationScore: 10, netWorth: 100 },
        { agentId: 'agent-b', educationScore: 0, netWorth: 25 },
      ],
      plannerRuns: [
        {
          taskId: 'economic-contextual-prioritization',
          variant: 'default',
          metrics: [
            { metricId: 'net-worth', value: 120, higherIsBetter: true },
            {
              metricId: 'planner-economic-sensitivity-scenario-count',
              value: 1,
              higherIsBetter: true,
            },
            {
              metricId: 'planner-economic-sensitivity-selection-change-count',
              value: 1,
              higherIsBetter: true,
            },
            {
              metricId: 'planner-economic-sensitivity-complete-economic-context-count',
              value: 1,
              higherIsBetter: true,
            },
          ],
        },
        {
          taskId: 'economic-contextual-prioritization',
          variant: 'without-branch',
          metrics: [{ metricId: 'net-worth', value: 95, higherIsBetter: true }],
        },
        {
          taskId: 'economic-contextual-prioritization',
          variant: 'without-objective-decomposition',
          metrics: [{ metricId: 'net-worth', value: 105, higherIsBetter: true }],
        },
      ],
      expectedTrajectoryAgentIds: ['agent-a'],
      trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
      thresholds: {
        heavyTailReturns: { minimumExcessKurtosis: -2 },
      },
    });

    const economicSensitivity = getMetric(report.metrics, 'planner-economic-sensitivity');
    expect(economicSensitivity.status).toBe('watch');
    expect(economicSensitivity.evidence).toMatchObject({
      scenarioCount: 1,
      sensitiveScenarioCount: 1,
      insensitiveScenarioCount: 0,
      completeEconomicContextScenarioCount: 1,
      sensitivityRatio: 1,
      completeEconomicContextRatio: 1,
    });
  });

  test('fails validation report gates when any metric status is not allowed', () => {
    const report = createExperimentValidationReport({
      run: {
        runId: 'validation-run-gate',
        simulationId: 'sim-validation',
        generatedAt: 1_700_000_004,
      },
      priceSeries: [
        { commodityId: 'Fish', observedAt: 0, closePrice: 100 },
        { commodityId: 'Fish', observedAt: 1, closePrice: 110 },
        { commodityId: 'Fish', observedAt: 2, closePrice: 99 },
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
        {
          taskId: 'task-1',
          variant: 'without-objective-decomposition',
          metrics: [{ metricId: 'net-worth', value: 90, higherIsBetter: true }],
        },
      ],
      expectedTrajectoryAgentIds: ['agent-a'],
      trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
      thresholds: {
        marketStability: {
          maximumLogPriceRange: 1,
          maximumDrawdown: 0.05,
          minimumLogReturnStandardDeviation: 0,
        },
        heavyTailReturns: { minimumExcessKurtosis: -2 },
        volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
      },
    });

    const gate = evaluateExperimentValidationReportGate(report, {
      criteriaId: 'validation-report-gate',
      defaultAllowedStatuses: ['pass', 'watch'],
    });

    expect(gate).toEqual({
      status: 'fail',
      criteriaId: 'validation-report-gate',
      runId: 'validation-run-gate',
      simulationId: 'sim-validation',
      failureCount: 1,
      failures: [
        {
          code: 'metric-status-not-allowed',
          message: 'metric market-stability status fail is not allowed',
          evidence: {
            metricId: 'market-stability',
            actual: 'fail',
            allowed: 'pass,watch',
          },
        },
      ],
    });
  });
});

function createPlannerRun(input: {
  readonly variant: string;
  readonly commandEmittingRatio: number;
  readonly rejectedRatio: number;
  readonly replanningRatio: number;
  readonly singleBranchRatio: number;
}) {
  return {
    taskId: 'planner-validation-task',
    variant: input.variant,
    metrics: [
      {
        metricId: 'planner-command-emitting-cycle-ratio',
        value: input.commandEmittingRatio,
        higherIsBetter: true,
      },
      {
        metricId: 'planner-simulator-rejected-ratio',
        value: input.rejectedRatio,
        higherIsBetter: false,
      },
      {
        metricId: 'planner-replanning-cycle-ratio',
        value: input.replanningRatio,
        higherIsBetter: false,
      },
      {
        metricId: 'planner-single-branch-plan-ratio',
        value: input.singleBranchRatio,
        higherIsBetter: false,
      },
    ],
  };
}
