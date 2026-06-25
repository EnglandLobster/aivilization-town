export type ExperimentValidationMetricId =
  | 'market-stability'
  | 'heavy-tail-returns'
  | 'volatility-clustering'
  | 'wealth-stratification'
  | 'planner-ablation'
  | 'social-reflection-coverage'
  | 'trajectory-coverage';

export type ExperimentValidationStatus = 'pass' | 'watch' | 'fail';

export type ExperimentValidationEvidenceValue = number | string;

export type ExperimentValidationEvidence = Readonly<
  Record<string, ExperimentValidationEvidenceValue>
>;

export type ExperimentValidationRunMetadata = {
  readonly runId: string;
  readonly simulationId: string;
  readonly generatedAt: number;
  readonly source?: string;
};

export type PriceCloseObservation = {
  readonly commodityId: string;
  readonly observedAt: number;
  readonly closePrice: number;
};

export type WealthSnapshotObservation = {
  readonly agentId: string;
  readonly educationScore: number;
  readonly netWorth: number;
  readonly occupationId?: string;
};

export type PlannerExperimentMetric = {
  readonly metricId: string;
  readonly value: number;
  readonly higherIsBetter: boolean;
};

export type PlannerExperimentRun = {
  readonly taskId: string;
  readonly variant: string;
  readonly metrics: readonly PlannerExperimentMetric[];
};

export type AgentTrajectoryObservation = {
  readonly agentId: string;
  readonly stepCount: number;
  readonly firstEventId?: string;
  readonly lastEventId?: string;
  readonly firstCommandId?: string;
  readonly lastCommandId?: string;
};

export type SocialReflectionValidationObservation = {
  readonly observationId: string;
  readonly agentId: string;
  readonly targetAgentId: string;
  readonly confidence: number;
  readonly evidenceRecordIds: readonly string[];
  readonly generatedAt: number;
  readonly tags: readonly string[];
};

export type MarketStabilityThresholds = {
  readonly maximumLogPriceRange?: number;
  readonly maximumDrawdown?: number;
  readonly minimumLogReturnStandardDeviation?: number;
};

export type HeavyTailThresholds = {
  readonly minimumExcessKurtosis?: number;
};

export type VolatilityClusteringThresholds = {
  readonly minimumLagOneAbsoluteReturnAutocorrelation?: number;
};

export type WealthStratificationThresholds = {
  readonly minimumGiniCoefficient?: number;
  readonly minimumEducationWealthRatio?: number;
};

export type PlannerAblationThresholds = {
  readonly expectedVariants?: readonly string[];
  readonly minimumDefaultWinRate?: number;
  readonly minimumDefaultCommandEmittingCycleRatio?: number;
  readonly maximumDefaultSimulatorRejectedRatio?: number;
  readonly maximumDefaultReplanningCycleRatio?: number;
  readonly maximumDefaultSingleBranchPlanRatio?: number;
};

export type SocialReflectionCoverageThresholds = {
  readonly minimumObservationCount?: number;
  readonly minimumAgentCoverageRatio?: number;
  readonly minimumDirectedPairCount?: number;
  readonly minimumMeanConfidence?: number;
  readonly requiredTag?: string;
};

export type TrajectoryCoverageThresholds = {
  readonly minimumCoverageRatio?: number;
  readonly minimumMinimumStepCount?: number;
};

export type ExperimentValidationThresholds = {
  readonly marketStability?: MarketStabilityThresholds;
  readonly heavyTailReturns?: HeavyTailThresholds;
  readonly volatilityClustering?: VolatilityClusteringThresholds;
  readonly wealthStratification?: WealthStratificationThresholds;
  readonly plannerAblation?: PlannerAblationThresholds;
  readonly socialReflectionCoverage?: SocialReflectionCoverageThresholds;
  readonly trajectoryCoverage?: TrajectoryCoverageThresholds;
};

export type ExperimentValidationReportInput = {
  readonly run: ExperimentValidationRunMetadata;
  readonly priceSeries: readonly PriceCloseObservation[];
  readonly wealthSnapshot: readonly WealthSnapshotObservation[];
  readonly plannerRuns: readonly PlannerExperimentRun[];
  readonly socialReflectionObservations?: readonly SocialReflectionValidationObservation[];
  readonly expectedTrajectoryAgentIds: readonly string[];
  readonly trajectories: readonly AgentTrajectoryObservation[];
  readonly thresholds?: ExperimentValidationThresholds;
};

export type ExperimentValidationMetric = {
  readonly id: ExperimentValidationMetricId;
  readonly label: string;
  readonly status: ExperimentValidationStatus;
  readonly value: number;
  readonly unit: string;
  readonly evidence: ExperimentValidationEvidence;
};

export type ExperimentValidationFinding = {
  readonly topic: ExperimentValidationMetricId;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly message: string;
  readonly evidence: ExperimentValidationEvidence;
};

export type ExperimentValidationReport = {
  readonly run: ExperimentValidationRunMetadata;
  readonly metrics: readonly ExperimentValidationMetric[];
  readonly findings: readonly ExperimentValidationFinding[];
};

export type ExperimentValidationReportGateCriteria = {
  readonly criteriaId: string;
  readonly defaultAllowedStatuses?: readonly ExperimentValidationStatus[];
  readonly allowedStatusesByMetricId?: Partial<
    Record<ExperimentValidationMetricId, readonly ExperimentValidationStatus[]>
  >;
};

export type ExperimentValidationReportGateFailure = {
  readonly code: string;
  readonly message: string;
  readonly evidence: ExperimentValidationEvidence;
};

export type ExperimentValidationReportGateResult = {
  readonly status: 'pass' | 'fail';
  readonly criteriaId: string;
  readonly runId: string;
  readonly simulationId: string;
  readonly failureCount: number;
  readonly failures: readonly ExperimentValidationReportGateFailure[];
};

type PriceSeriesDiagnostics = {
  readonly commodityCount: number;
  readonly observationCount: number;
  readonly maximumLogPriceRange: number;
  readonly maximumDrawdown: number;
  readonly minimumLogReturnStandardDeviation: number;
  readonly maximumExcessKurtosis: number;
  readonly maximumAbsoluteSkewness: number;
  readonly maximumLagOneAbsoluteReturnAutocorrelation: number;
};

type PlannerComparison = {
  readonly defaultValue: number;
  readonly ablatedValue: number;
  readonly higherIsBetter: boolean;
};

type PlannerNamedMetricSummary = {
  readonly comparisonCount: number;
  readonly defaultValue: number;
  readonly ablatedValue: number;
  readonly defaultAdvantage: number;
};

type SocialReflectionDiagnostics = {
  readonly observationCount: number;
  readonly expectedAgentCount: number;
  readonly coveredAgentCount: number;
  readonly agentCoverageRatio: number;
  readonly directedPairCount: number;
  readonly meanConfidence: number;
  readonly evidenceBackedObservationCount: number;
  readonly requiredTagObservationCount: number;
  readonly latestGeneratedAt: number;
};

const DEFAULT_PLANNER_ABLATION_VARIANTS = [
  'default',
  'without-branch',
  'without-objective-decomposition',
] as const;

const DEFAULT_VALIDATION_REPORT_GATE_ALLOWED_STATUSES = ['pass', 'watch'] as const;

const PLANNER_SHAPE_METRIC_IDS = new Set([
  'planner-plan-count',
  'planner-mean-branch-count',
  'planner-mean-subtask-count',
  'planner-single-branch-plan-ratio',
]);

const PLANNER_OUTCOME_METRIC_IDS = new Set([
  'planner-cycle-trace-count',
  'planner-command-emitting-cycle-ratio',
  'planner-simulator-accepted-ratio',
  'planner-simulator-repaired-ratio',
  'planner-simulator-rejected-ratio',
  'planner-replanning-cycle-ratio',
  'planner-mean-accepted-action-count',
  'planner-mean-emitted-command-count',
  'planner-distinct-selected-branch-count',
]);

const DEFAULT_THRESHOLDS = {
  marketStability: {
    maximumLogPriceRange: 2,
    maximumDrawdown: 0.5,
    minimumLogReturnStandardDeviation: Number.EPSILON,
  },
  heavyTailReturns: {
    minimumExcessKurtosis: 3,
  },
  volatilityClustering: {
    minimumLagOneAbsoluteReturnAutocorrelation: 0.05,
  },
  wealthStratification: {
    minimumGiniCoefficient: 0.1,
    minimumEducationWealthRatio: 1.1,
  },
  plannerAblation: {
    expectedVariants: DEFAULT_PLANNER_ABLATION_VARIANTS,
    minimumDefaultWinRate: 0.5,
    minimumDefaultCommandEmittingCycleRatio: 0,
    maximumDefaultSimulatorRejectedRatio: 1,
    maximumDefaultReplanningCycleRatio: 1,
    maximumDefaultSingleBranchPlanRatio: 1,
  },
  socialReflectionCoverage: {
    minimumObservationCount: 1,
    minimumAgentCoverageRatio: 0.5,
    minimumDirectedPairCount: 1,
    minimumMeanConfidence: 0.5,
    requiredTag: 'post-interaction-reflection',
  },
  trajectoryCoverage: {
    minimumCoverageRatio: 1,
    minimumMinimumStepCount: 1,
  },
} satisfies Required<{
  [Key in keyof ExperimentValidationThresholds]: Required<
    NonNullable<ExperimentValidationThresholds[Key]>
  >;
}>;

export function createExperimentValidationReport(
  input: ExperimentValidationReportInput,
): ExperimentValidationReport {
  const run = validateRunMetadata(input.run);
  const thresholds = mergeThresholds(input.thresholds);
  const priceDiagnostics = calculatePriceSeriesDiagnostics(input.priceSeries);
  const wealthDiagnostics = calculateWealthDiagnostics(input.wealthSnapshot);
  const plannerDiagnostics = calculatePlannerDiagnostics(
    input.plannerRuns,
    thresholds.plannerAblation.expectedVariants,
  );
  const trajectoryDiagnostics = calculateTrajectoryDiagnostics(
    input.expectedTrajectoryAgentIds,
    input.trajectories,
  );
  const socialReflectionDiagnostics = calculateSocialReflectionDiagnostics({
    expectedAgentIds: input.expectedTrajectoryAgentIds,
    observations: input.socialReflectionObservations ?? [],
    requiredTag: thresholds.socialReflectionCoverage.requiredTag,
  });

  const metrics: ExperimentValidationMetric[] = [
    createMarketStabilityMetric(priceDiagnostics, thresholds.marketStability),
    createHeavyTailMetric(priceDiagnostics, thresholds.heavyTailReturns),
    createVolatilityClusteringMetric(priceDiagnostics, thresholds.volatilityClustering),
    createWealthStratificationMetric(wealthDiagnostics, thresholds.wealthStratification),
    createPlannerAblationMetric(plannerDiagnostics, thresholds.plannerAblation),
    createSocialReflectionCoverageMetric(
      socialReflectionDiagnostics,
      thresholds.socialReflectionCoverage,
    ),
    createTrajectoryCoverageMetric(trajectoryDiagnostics, thresholds.trajectoryCoverage),
  ];

  return {
    run,
    metrics,
    findings: metrics.map((metric) => createFinding(metric)),
  };
}

export function evaluateExperimentValidationReportGate(
  report: ExperimentValidationReport,
  criteria: ExperimentValidationReportGateCriteria,
): ExperimentValidationReportGateResult {
  const criteriaId = validateCriteriaId(criteria.criteriaId);
  const defaultAllowedStatuses = normalizeAllowedValidationStatuses(
    criteria.defaultAllowedStatuses ?? DEFAULT_VALIDATION_REPORT_GATE_ALLOWED_STATUSES,
    'defaultAllowedStatuses',
  );
  const allowedStatusesByMetricId = normalizeAllowedStatusesByMetricId(
    criteria.allowedStatusesByMetricId,
  );
  const failures: ExperimentValidationReportGateFailure[] = [];

  for (const metric of report.metrics) {
    const allowedStatuses = allowedStatusesByMetricId[metric.id] ?? defaultAllowedStatuses;
    if (allowedStatuses.includes(metric.status)) {
      continue;
    }
    failures.push({
      code: 'metric-status-not-allowed',
      message: `metric ${metric.id} status ${metric.status} is not allowed`,
      evidence: {
        metricId: metric.id,
        actual: metric.status,
        allowed: allowedStatuses.join(','),
      },
    });
  }

  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    criteriaId,
    runId: report.run.runId,
    simulationId: report.run.simulationId,
    failureCount: failures.length,
    failures,
  };
}

function validateRunMetadata(
  run: ExperimentValidationRunMetadata,
): ExperimentValidationRunMetadata {
  assertNonEmptyString(run.runId, 'run runId');
  assertNonEmptyString(run.simulationId, 'run simulationId');
  assertFinite(run.generatedAt, 'run generatedAt');
  if (run.source !== undefined) {
    assertNonEmptyString(run.source, 'run source');
  }

  return {
    runId: run.runId,
    simulationId: run.simulationId,
    generatedAt: run.generatedAt,
    ...(run.source === undefined ? {} : { source: run.source }),
  };
}

function mergeThresholds(thresholds: ExperimentValidationThresholds | undefined): Required<{
  [Key in keyof ExperimentValidationThresholds]: Required<
    NonNullable<ExperimentValidationThresholds[Key]>
  >;
}> {
  return {
    marketStability: {
      ...DEFAULT_THRESHOLDS.marketStability,
      ...thresholds?.marketStability,
    },
    heavyTailReturns: {
      ...DEFAULT_THRESHOLDS.heavyTailReturns,
      ...thresholds?.heavyTailReturns,
    },
    volatilityClustering: {
      ...DEFAULT_THRESHOLDS.volatilityClustering,
      ...thresholds?.volatilityClustering,
    },
    wealthStratification: {
      ...DEFAULT_THRESHOLDS.wealthStratification,
      ...thresholds?.wealthStratification,
    },
    plannerAblation: {
      ...DEFAULT_THRESHOLDS.plannerAblation,
      ...thresholds?.plannerAblation,
    },
    socialReflectionCoverage: {
      ...DEFAULT_THRESHOLDS.socialReflectionCoverage,
      ...thresholds?.socialReflectionCoverage,
    },
    trajectoryCoverage: {
      ...DEFAULT_THRESHOLDS.trajectoryCoverage,
      ...thresholds?.trajectoryCoverage,
    },
  };
}

function calculatePriceSeriesDiagnostics(
  priceSeries: readonly PriceCloseObservation[],
): PriceSeriesDiagnostics {
  if (priceSeries.length === 0) {
    throw new Error('priceSeries requires at least one close-price observation');
  }

  const seriesByCommodity = new Map<string, PriceCloseObservation[]>();
  for (const observation of priceSeries) {
    assertNonEmptyString(observation.commodityId, 'priceSeries commodityId');
    assertFinite(observation.observedAt, 'priceSeries observedAt');
    assertPositiveFinite(observation.closePrice, 'priceSeries closePrice');
    const existing = seriesByCommodity.get(observation.commodityId) ?? [];
    existing.push(observation);
    seriesByCommodity.set(observation.commodityId, existing);
  }

  const commodityDiagnostics = [...seriesByCommodity.values()].map((series) =>
    calculateSingleCommodityDiagnostics(
      series.sort((left, right) => left.observedAt - right.observedAt),
    ),
  );

  return {
    commodityCount: commodityDiagnostics.length,
    observationCount: priceSeries.length,
    maximumLogPriceRange: Math.max(
      ...commodityDiagnostics.map((diagnostics) => diagnostics.logPriceRange),
    ),
    maximumDrawdown: Math.max(...commodityDiagnostics.map((diagnostics) => diagnostics.drawdown)),
    minimumLogReturnStandardDeviation: Math.min(
      ...commodityDiagnostics.map((diagnostics) => diagnostics.logReturnStandardDeviation),
    ),
    maximumExcessKurtosis: Math.max(
      ...commodityDiagnostics.map((diagnostics) => diagnostics.excessKurtosis),
    ),
    maximumAbsoluteSkewness: Math.max(
      ...commodityDiagnostics.map((diagnostics) => Math.abs(diagnostics.skewness)),
    ),
    maximumLagOneAbsoluteReturnAutocorrelation: Math.max(
      ...commodityDiagnostics.map((diagnostics) => diagnostics.lagOneAbsoluteReturnAutocorrelation),
    ),
  };
}

function calculateSingleCommodityDiagnostics(series: readonly PriceCloseObservation[]): {
  readonly logPriceRange: number;
  readonly drawdown: number;
  readonly logReturnStandardDeviation: number;
  readonly excessKurtosis: number;
  readonly skewness: number;
  readonly lagOneAbsoluteReturnAutocorrelation: number;
} {
  if (series.length < 2) {
    throw new Error('priceSeries requires at least two close prices per commodity');
  }

  const closePrices = series.map((observation) => observation.closePrice);
  const logPrices = closePrices.map((price) => Math.log(price));
  const logReturns = calculateLogReturns(closePrices);

  return {
    logPriceRange: Math.max(...logPrices) - Math.min(...logPrices),
    drawdown: calculateMaximumDrawdown(closePrices),
    logReturnStandardDeviation: Math.sqrt(calculateVariance(logReturns)),
    excessKurtosis: calculateExcessKurtosis(logReturns),
    skewness: calculateSkewness(logReturns),
    lagOneAbsoluteReturnAutocorrelation: calculateLagOneAutocorrelation(
      logReturns.map((value) => Math.abs(value)),
    ),
  };
}

function calculateWealthDiagnostics(wealthSnapshot: readonly WealthSnapshotObservation[]): {
  readonly agentCount: number;
  readonly giniCoefficient: number;
  readonly topDecileWealthShare: number;
  readonly educationWealthRatio: number;
  readonly occupationGroupCount: number;
  readonly highestOccupationMedianWealth: number;
  readonly lowestOccupationMedianWealth: number;
} {
  if (wealthSnapshot.length === 0) {
    throw new Error('wealthSnapshot requires at least one agent observation');
  }

  for (const observation of wealthSnapshot) {
    assertNonEmptyString(observation.agentId, 'wealthSnapshot agentId');
    assertFinite(observation.educationScore, 'wealthSnapshot educationScore');
    assertFinite(observation.netWorth, 'wealthSnapshot netWorth');
    if (observation.netWorth < 0) {
      throw new Error('wealthSnapshot netWorth must be non-negative');
    }
    if (observation.occupationId !== undefined) {
      assertNonEmptyString(observation.occupationId, 'wealthSnapshot occupationId');
    }
  }

  const netWorths = wealthSnapshot.map((observation) => observation.netWorth);
  const educationSorted = [...wealthSnapshot].sort(
    (left, right) => left.educationScore - right.educationScore,
  );
  const splitIndex = Math.max(1, Math.floor(educationSorted.length / 2));
  const lowEducation = educationSorted
    .slice(0, splitIndex)
    .map((observation) => observation.netWorth);
  const highEducation = educationSorted
    .slice(splitIndex)
    .map((observation) => observation.netWorth);
  const lowEducationMedian = calculateMedian(lowEducation);
  const highEducationMedian = calculateMedian(
    highEducation.length === 0 ? lowEducation : highEducation,
  );
  const occupationMedians = calculateOccupationMedians(wealthSnapshot);

  return {
    agentCount: wealthSnapshot.length,
    giniCoefficient: calculateGiniCoefficient(netWorths),
    topDecileWealthShare: calculateTopDecileShare(netWorths),
    educationWealthRatio: safeRatio(highEducationMedian, lowEducationMedian),
    occupationGroupCount: occupationMedians.length,
    highestOccupationMedianWealth:
      occupationMedians.length === 0 ? 0 : Math.max(...occupationMedians),
    lowestOccupationMedianWealth:
      occupationMedians.length === 0 ? 0 : Math.min(...occupationMedians),
  };
}

function calculatePlannerDiagnostics(
  plannerRuns: readonly PlannerExperimentRun[],
  expectedVariantsInput: readonly string[],
): {
  readonly taskMetricCount: number;
  readonly expectedVariantCount: number;
  readonly observedVariantCount: number;
  readonly missingVariantCount: number;
  readonly expectedVariants: string;
  readonly observedVariants: string;
  readonly missingVariants: string;
  readonly plannerShapeMetricCount: number;
  readonly plannerOutcomeMetricCount: number;
  readonly comparisonCount: number;
  readonly defaultWinRate: number;
  readonly meanNormalizedDefaultAdvantage: number;
  readonly commandEmittingCycleRatio: PlannerNamedMetricSummary;
  readonly simulatorRejectedRatio: PlannerNamedMetricSummary;
  readonly replanningCycleRatio: PlannerNamedMetricSummary;
  readonly singleBranchPlanRatio: PlannerNamedMetricSummary;
} {
  if (plannerRuns.length === 0) {
    throw new Error('plannerRuns requires at least one planner experiment run');
  }

  const expectedVariants = normalizeExpectedPlannerVariants(expectedVariantsInput);
  const observedVariants: string[] = [];
  const groups = new Map<string, PlannerExperimentRun[]>();
  for (const run of plannerRuns) {
    assertNonEmptyString(run.taskId, 'plannerRuns taskId');
    assertNonEmptyString(run.variant, 'plannerRuns variant');
    pushUnique(observedVariants, run.variant);
    if (run.metrics.length === 0) {
      throw new Error('plannerRuns metrics requires at least one metric');
    }

    for (const metric of run.metrics) {
      assertNonEmptyString(metric.metricId, 'plannerRuns metricId');
      assertFinite(metric.value, 'plannerRuns value');
      const key = createTaskMetricKey(run.taskId, metric.metricId);
      const existing = groups.get(key) ?? [];
      existing.push(run);
      groups.set(key, existing);
    }
  }

  const comparisons: PlannerComparison[] = [];
  for (const [key, runs] of groups) {
    const defaultRun = runs.find((run) => run.variant === 'default');
    if (defaultRun === undefined) {
      throw new Error('plannerRuns must include a default variant for each task metric');
    }
    const metricId = parseTaskMetricKey(key).metricId;
    const defaultMetric = getMetricFromRun(defaultRun, metricId);
    const ablatedRuns = runs.filter((run) => run.variant !== 'default');
    if (ablatedRuns.length === 0) {
      throw new Error('plannerRuns must include at least one ablated variant for each task metric');
    }
    assertPlannerExpectedVariantsPresent({ key, runs, expectedVariants });

    for (const ablatedRun of ablatedRuns) {
      const ablatedMetric = getMetricFromRun(ablatedRun, metricId);
      if (ablatedMetric.higherIsBetter !== defaultMetric.higherIsBetter) {
        throw new Error('plannerRuns higherIsBetter must match within each task metric');
      }
      comparisons.push({
        defaultValue: defaultMetric.value,
        ablatedValue: ablatedMetric.value,
        higherIsBetter: defaultMetric.higherIsBetter,
      });
    }
  }

  const winningComparisons = comparisons.filter((comparison) => isDefaultAtLeastAsGood(comparison));
  return {
    taskMetricCount: groups.size,
    expectedVariantCount: expectedVariants.length,
    observedVariantCount: observedVariants.length,
    missingVariantCount: 0,
    expectedVariants: expectedVariants.join(','),
    observedVariants: observedVariants.join(','),
    missingVariants: '',
    plannerShapeMetricCount: countPlannerMetricGroups(groups, PLANNER_SHAPE_METRIC_IDS),
    plannerOutcomeMetricCount: countPlannerMetricGroups(groups, PLANNER_OUTCOME_METRIC_IDS),
    comparisonCount: comparisons.length,
    defaultWinRate: winningComparisons.length / comparisons.length,
    meanNormalizedDefaultAdvantage: calculateMean(
      comparisons.map((comparison) => calculateNormalizedDefaultAdvantage(comparison)),
    ),
    commandEmittingCycleRatio: summarizeNamedPlannerMetric(
      groups,
      'planner-command-emitting-cycle-ratio',
    ),
    simulatorRejectedRatio: summarizeNamedPlannerMetric(groups, 'planner-simulator-rejected-ratio'),
    replanningCycleRatio: summarizeNamedPlannerMetric(groups, 'planner-replanning-cycle-ratio'),
    singleBranchPlanRatio: summarizeNamedPlannerMetric(groups, 'planner-single-branch-plan-ratio'),
  };
}

function calculateSocialReflectionDiagnostics(input: {
  readonly expectedAgentIds: readonly string[];
  readonly observations: readonly SocialReflectionValidationObservation[];
  readonly requiredTag: string;
}): SocialReflectionDiagnostics {
  assertNonEmptyString(input.requiredTag, 'socialReflectionCoverage requiredTag');
  const expected = createExpectedAgentIdSet(input.expectedAgentIds);
  const coveredAgentIds = new Set<string>();
  const directedPairs = new Set<string>();
  let confidenceTotal = 0;
  let evidenceBackedObservationCount = 0;
  let requiredTagObservationCount = 0;
  let latestGeneratedAt = 0;

  for (const observation of input.observations) {
    validateSocialReflectionObservation(observation);
    if (expected.has(observation.agentId)) {
      coveredAgentIds.add(observation.agentId);
    }
    directedPairs.add(`${observation.agentId}->${observation.targetAgentId}`);
    confidenceTotal += observation.confidence;
    evidenceBackedObservationCount += observation.evidenceRecordIds.length > 0 ? 1 : 0;
    requiredTagObservationCount += observation.tags.includes(input.requiredTag) ? 1 : 0;
    latestGeneratedAt = Math.max(latestGeneratedAt, observation.generatedAt);
  }

  return {
    observationCount: input.observations.length,
    expectedAgentCount: expected.size,
    coveredAgentCount: coveredAgentIds.size,
    agentCoverageRatio: coveredAgentIds.size / expected.size,
    directedPairCount: directedPairs.size,
    meanConfidence:
      input.observations.length === 0 ? 0 : confidenceTotal / input.observations.length,
    evidenceBackedObservationCount,
    requiredTagObservationCount,
    latestGeneratedAt,
  };
}

function calculateTrajectoryDiagnostics(
  expectedAgentIds: readonly string[],
  trajectories: readonly AgentTrajectoryObservation[],
): {
  readonly expectedAgentCount: number;
  readonly coveredAgentCount: number;
  readonly coverageRatio: number;
  readonly missingAgentCount: number;
  readonly minimumStepCount: number;
  readonly maximumStepCount: number;
  readonly commandBackedTrajectoryCount: number;
} {
  if (expectedAgentIds.length === 0) {
    throw new Error('expectedTrajectoryAgentIds requires at least one agent id');
  }
  if (trajectories.length === 0) {
    throw new Error('trajectories requires at least one trajectory observation');
  }

  const expected = createExpectedAgentIdSet(expectedAgentIds);

  const trajectoryByAgent = new Map<string, AgentTrajectoryObservation>();
  for (const trajectory of trajectories) {
    assertNonEmptyString(trajectory.agentId, 'trajectories agentId');
    assertNonNegativeInteger(trajectory.stepCount, 'trajectories stepCount');
    if (trajectory.firstEventId !== undefined) {
      assertNonEmptyString(trajectory.firstEventId, 'trajectories firstEventId');
    }
    if (trajectory.lastEventId !== undefined) {
      assertNonEmptyString(trajectory.lastEventId, 'trajectories lastEventId');
    }
    if (trajectory.firstCommandId !== undefined) {
      assertNonEmptyString(trajectory.firstCommandId, 'trajectories firstCommandId');
    }
    if (trajectory.lastCommandId !== undefined) {
      assertNonEmptyString(trajectory.lastCommandId, 'trajectories lastCommandId');
    }
    trajectoryByAgent.set(trajectory.agentId, trajectory);
  }

  const coveredTrajectories = [...expected]
    .map((agentId) => trajectoryByAgent.get(agentId))
    .filter((trajectory): trajectory is AgentTrajectoryObservation => trajectory !== undefined);
  const coveredStepCounts = coveredTrajectories.map((trajectory) => trajectory.stepCount);

  return {
    expectedAgentCount: expected.size,
    coveredAgentCount: coveredStepCounts.length,
    coverageRatio: coveredStepCounts.length / expected.size,
    missingAgentCount: expected.size - coveredStepCounts.length,
    minimumStepCount: coveredStepCounts.length === 0 ? 0 : Math.min(...coveredStepCounts),
    maximumStepCount: coveredStepCounts.length === 0 ? 0 : Math.max(...coveredStepCounts),
    commandBackedTrajectoryCount: coveredTrajectories.filter(hasCommandSpan).length,
  };
}

function createMarketStabilityMetric(
  diagnostics: PriceSeriesDiagnostics,
  thresholds: Required<MarketStabilityThresholds>,
): ExperimentValidationMetric {
  const status =
    diagnostics.maximumLogPriceRange <= thresholds.maximumLogPriceRange &&
    diagnostics.maximumDrawdown <= thresholds.maximumDrawdown &&
    diagnostics.minimumLogReturnStandardDeviation >= thresholds.minimumLogReturnStandardDeviation
      ? 'pass'
      : 'fail';

  return {
    id: 'market-stability',
    label: 'Market stability',
    status,
    value: diagnostics.maximumDrawdown,
    unit: 'maximum drawdown ratio',
    evidence: {
      maximumLogPriceRange: diagnostics.maximumLogPriceRange,
      maximumDrawdown: diagnostics.maximumDrawdown,
      minimumLogReturnStandardDeviation: diagnostics.minimumLogReturnStandardDeviation,
      commodityCount: diagnostics.commodityCount,
      observationCount: diagnostics.observationCount,
    },
  };
}

function createHeavyTailMetric(
  diagnostics: PriceSeriesDiagnostics,
  thresholds: Required<HeavyTailThresholds>,
): ExperimentValidationMetric {
  return {
    id: 'heavy-tail-returns',
    label: 'Heavy-tail returns',
    status:
      diagnostics.maximumExcessKurtosis >= thresholds.minimumExcessKurtosis ? 'pass' : 'watch',
    value: diagnostics.maximumExcessKurtosis,
    unit: 'maximum excess kurtosis',
    evidence: {
      maximumExcessKurtosis: diagnostics.maximumExcessKurtosis,
      maximumAbsoluteSkewness: diagnostics.maximumAbsoluteSkewness,
      commodityCount: diagnostics.commodityCount,
    },
  };
}

function createVolatilityClusteringMetric(
  diagnostics: PriceSeriesDiagnostics,
  thresholds: Required<VolatilityClusteringThresholds>,
): ExperimentValidationMetric {
  return {
    id: 'volatility-clustering',
    label: 'Volatility clustering',
    status:
      diagnostics.maximumLagOneAbsoluteReturnAutocorrelation >=
      thresholds.minimumLagOneAbsoluteReturnAutocorrelation
        ? 'pass'
        : 'watch',
    value: diagnostics.maximumLagOneAbsoluteReturnAutocorrelation,
    unit: 'lag-1 absolute-return autocorrelation',
    evidence: {
      maximumLagOneAbsoluteReturnAutocorrelation:
        diagnostics.maximumLagOneAbsoluteReturnAutocorrelation,
      commodityCount: diagnostics.commodityCount,
    },
  };
}

function createWealthStratificationMetric(
  diagnostics: ReturnType<typeof calculateWealthDiagnostics>,
  thresholds: Required<WealthStratificationThresholds>,
): ExperimentValidationMetric {
  const status =
    diagnostics.giniCoefficient >= thresholds.minimumGiniCoefficient &&
    diagnostics.educationWealthRatio >= thresholds.minimumEducationWealthRatio
      ? 'pass'
      : 'watch';

  return {
    id: 'wealth-stratification',
    label: 'Wealth stratification',
    status,
    value: diagnostics.giniCoefficient,
    unit: 'gini coefficient',
    evidence: {
      agentCount: diagnostics.agentCount,
      giniCoefficient: diagnostics.giniCoefficient,
      topDecileWealthShare: diagnostics.topDecileWealthShare,
      educationWealthRatio: diagnostics.educationWealthRatio,
      occupationGroupCount: diagnostics.occupationGroupCount,
      highestOccupationMedianWealth: diagnostics.highestOccupationMedianWealth,
      lowestOccupationMedianWealth: diagnostics.lowestOccupationMedianWealth,
    },
  };
}

function createPlannerAblationMetric(
  diagnostics: ReturnType<typeof calculatePlannerDiagnostics>,
  thresholds: Required<PlannerAblationThresholds>,
): ExperimentValidationMetric {
  const status =
    diagnostics.defaultWinRate >= thresholds.minimumDefaultWinRate &&
    thresholdPassesMinimum(
      diagnostics.commandEmittingCycleRatio,
      thresholds.minimumDefaultCommandEmittingCycleRatio,
    ) &&
    thresholdPassesMaximum(
      diagnostics.simulatorRejectedRatio,
      thresholds.maximumDefaultSimulatorRejectedRatio,
    ) &&
    thresholdPassesMaximum(
      diagnostics.replanningCycleRatio,
      thresholds.maximumDefaultReplanningCycleRatio,
    ) &&
    thresholdPassesMaximum(
      diagnostics.singleBranchPlanRatio,
      thresholds.maximumDefaultSingleBranchPlanRatio,
    )
      ? 'pass'
      : 'watch';

  return {
    id: 'planner-ablation',
    label: 'Planner ablation',
    status,
    value: diagnostics.defaultWinRate,
    unit: 'default win rate',
    evidence: {
      taskMetricCount: diagnostics.taskMetricCount,
      expectedVariantCount: diagnostics.expectedVariantCount,
      observedVariantCount: diagnostics.observedVariantCount,
      missingVariantCount: diagnostics.missingVariantCount,
      expectedVariants: diagnostics.expectedVariants,
      observedVariants: diagnostics.observedVariants,
      missingVariants: diagnostics.missingVariants,
      plannerShapeMetricCount: diagnostics.plannerShapeMetricCount,
      plannerOutcomeMetricCount: diagnostics.plannerOutcomeMetricCount,
      comparisonCount: diagnostics.comparisonCount,
      defaultWinRate: diagnostics.defaultWinRate,
      meanNormalizedDefaultAdvantage: diagnostics.meanNormalizedDefaultAdvantage,
      defaultCommandEmittingCycleRatio: diagnostics.commandEmittingCycleRatio.defaultValue,
      ablatedCommandEmittingCycleRatio: diagnostics.commandEmittingCycleRatio.ablatedValue,
      commandEmittingCycleRatioDefaultAdvantage:
        diagnostics.commandEmittingCycleRatio.defaultAdvantage,
      defaultSimulatorRejectedRatio: diagnostics.simulatorRejectedRatio.defaultValue,
      ablatedSimulatorRejectedRatio: diagnostics.simulatorRejectedRatio.ablatedValue,
      simulatorRejectedRatioDefaultAdvantage: diagnostics.simulatorRejectedRatio.defaultAdvantage,
      defaultReplanningCycleRatio: diagnostics.replanningCycleRatio.defaultValue,
      ablatedReplanningCycleRatio: diagnostics.replanningCycleRatio.ablatedValue,
      replanningCycleRatioDefaultAdvantage: diagnostics.replanningCycleRatio.defaultAdvantage,
      defaultSingleBranchPlanRatio: diagnostics.singleBranchPlanRatio.defaultValue,
      ablatedSingleBranchPlanRatio: diagnostics.singleBranchPlanRatio.ablatedValue,
      singleBranchPlanRatioDefaultAdvantage: diagnostics.singleBranchPlanRatio.defaultAdvantage,
    },
  };
}

function createSocialReflectionCoverageMetric(
  diagnostics: SocialReflectionDiagnostics,
  thresholds: Required<SocialReflectionCoverageThresholds>,
): ExperimentValidationMetric {
  validateSocialReflectionThresholds(thresholds);
  const status =
    diagnostics.observationCount >= thresholds.minimumObservationCount &&
    diagnostics.agentCoverageRatio >= thresholds.minimumAgentCoverageRatio &&
    diagnostics.directedPairCount >= thresholds.minimumDirectedPairCount &&
    diagnostics.meanConfidence >= thresholds.minimumMeanConfidence &&
    diagnostics.evidenceBackedObservationCount >= thresholds.minimumObservationCount &&
    diagnostics.requiredTagObservationCount >= thresholds.minimumObservationCount
      ? 'pass'
      : 'watch';

  return {
    id: 'social-reflection-coverage',
    label: 'Social reflection coverage',
    status,
    value: diagnostics.agentCoverageRatio,
    unit: 'covered expected-agent ratio',
    evidence: {
      observationCount: diagnostics.observationCount,
      expectedAgentCount: diagnostics.expectedAgentCount,
      coveredAgentCount: diagnostics.coveredAgentCount,
      agentCoverageRatio: diagnostics.agentCoverageRatio,
      directedPairCount: diagnostics.directedPairCount,
      meanConfidence: diagnostics.meanConfidence,
      evidenceBackedObservationCount: diagnostics.evidenceBackedObservationCount,
      requiredTagObservationCount: diagnostics.requiredTagObservationCount,
      latestGeneratedAt: diagnostics.latestGeneratedAt,
    },
  };
}

function createTrajectoryCoverageMetric(
  diagnostics: ReturnType<typeof calculateTrajectoryDiagnostics>,
  thresholds: Required<TrajectoryCoverageThresholds>,
): ExperimentValidationMetric {
  const status =
    diagnostics.coverageRatio >= thresholds.minimumCoverageRatio &&
    diagnostics.minimumStepCount >= thresholds.minimumMinimumStepCount
      ? 'pass'
      : 'watch';

  return {
    id: 'trajectory-coverage',
    label: 'Trajectory coverage',
    status,
    value: diagnostics.coverageRatio,
    unit: 'covered expected-agent ratio',
    evidence: {
      expectedAgentCount: diagnostics.expectedAgentCount,
      coveredAgentCount: diagnostics.coveredAgentCount,
      coverageRatio: diagnostics.coverageRatio,
      missingAgentCount: diagnostics.missingAgentCount,
      minimumStepCount: diagnostics.minimumStepCount,
      maximumStepCount: diagnostics.maximumStepCount,
      commandBackedTrajectoryCount: diagnostics.commandBackedTrajectoryCount,
    },
  };
}

function createExpectedAgentIdSet(expectedAgentIds: readonly string[]): ReadonlySet<string> {
  const expected = new Set<string>();
  for (const agentId of expectedAgentIds) {
    assertNonEmptyString(agentId, 'expectedTrajectoryAgentIds agentId');
    expected.add(agentId);
  }
  return expected;
}

function validateSocialReflectionObservation(
  observation: SocialReflectionValidationObservation,
): void {
  assertNonEmptyString(observation.observationId, 'socialReflectionObservations observationId');
  assertNonEmptyString(observation.agentId, 'socialReflectionObservations agentId');
  assertNonEmptyString(observation.targetAgentId, 'socialReflectionObservations targetAgentId');
  if (observation.agentId === observation.targetAgentId) {
    throw new Error('socialReflectionObservations targetAgentId must differ from agentId');
  }
  assertUnitInterval(observation.confidence, 'socialReflectionObservations confidence');
  assertFinite(observation.generatedAt, 'socialReflectionObservations generatedAt');
  if (observation.evidenceRecordIds.length === 0) {
    throw new Error('socialReflectionObservations evidenceRecordIds must not be empty');
  }
  for (const evidenceRecordId of observation.evidenceRecordIds) {
    assertNonEmptyString(evidenceRecordId, 'socialReflectionObservations evidenceRecordId');
  }
  for (const tag of observation.tags) {
    assertNonEmptyString(tag, 'socialReflectionObservations tag');
  }
}

function validateSocialReflectionThresholds(
  thresholds: Required<SocialReflectionCoverageThresholds>,
): void {
  assertNonNegativeInteger(
    thresholds.minimumObservationCount,
    'socialReflectionCoverage minimumObservationCount',
  );
  assertUnitInterval(
    thresholds.minimumAgentCoverageRatio,
    'socialReflectionCoverage minimumAgentCoverageRatio',
  );
  assertNonNegativeInteger(
    thresholds.minimumDirectedPairCount,
    'socialReflectionCoverage minimumDirectedPairCount',
  );
  assertUnitInterval(
    thresholds.minimumMeanConfidence,
    'socialReflectionCoverage minimumMeanConfidence',
  );
  assertNonEmptyString(thresholds.requiredTag, 'socialReflectionCoverage requiredTag');
}

function hasCommandSpan(trajectory: AgentTrajectoryObservation): boolean {
  return trajectory.firstCommandId !== undefined && trajectory.lastCommandId !== undefined;
}

function createFinding(metric: ExperimentValidationMetric): ExperimentValidationFinding {
  return {
    topic: metric.id,
    severity:
      metric.status === 'fail' ? 'critical' : metric.status === 'watch' ? 'warning' : 'info',
    message: `${metric.label}: ${metric.status}`,
    evidence: metric.evidence,
  };
}

function calculateLogReturns(closePrices: readonly number[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < closePrices.length; index += 1) {
    returns.push(Math.log(closePrices[index]!) - Math.log(closePrices[index - 1]!));
  }
  return returns;
}

function calculateMaximumDrawdown(values: readonly number[]): number {
  let peak = values[0]!;
  let maximumDrawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    maximumDrawdown = Math.max(maximumDrawdown, 1 - value / peak);
  }
  return maximumDrawdown;
}

function calculateGiniCoefficient(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return 0;
  }

  const weightedSum = sorted.reduce(
    (sum, value, index) => sum + (2 * (index + 1) - sorted.length - 1) * value,
    0,
  );
  return weightedSum / (sorted.length * total);
}

function calculateTopDecileShare(values: readonly number[]): number {
  const sortedDescending = [...values].sort((left, right) => right - left);
  const total = sortedDescending.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return 0;
  }

  const topCount = Math.max(1, Math.ceil(sortedDescending.length * 0.1));
  const topWealth = sortedDescending.slice(0, topCount).reduce((sum, value) => sum + value, 0);
  return topWealth / total;
}

function calculateMedian(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint]!;
  }
  return (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
}

function calculateOccupationMedians(
  wealthSnapshot: readonly WealthSnapshotObservation[],
): number[] {
  const wealthByOccupation = new Map<string, number[]>();
  for (const observation of wealthSnapshot) {
    if (observation.occupationId === undefined) {
      continue;
    }
    const existing = wealthByOccupation.get(observation.occupationId) ?? [];
    existing.push(observation.netWorth);
    wealthByOccupation.set(observation.occupationId, existing);
  }

  return [...wealthByOccupation.values()].map((values) => calculateMedian(values));
}

function calculateMean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateVariance(values: readonly number[]): number {
  const mean = calculateMean(values);
  return calculateMean(values.map((value) => (value - mean) ** 2));
}

function calculateSkewness(values: readonly number[]): number {
  const variance = calculateVariance(values);
  if (variance === 0) {
    return 0;
  }

  const mean = calculateMean(values);
  const thirdMoment = calculateMean(values.map((value) => (value - mean) ** 3));
  return thirdMoment / variance ** 1.5;
}

function calculateExcessKurtosis(values: readonly number[]): number {
  const variance = calculateVariance(values);
  if (variance === 0) {
    return 0;
  }

  const mean = calculateMean(values);
  const fourthMoment = calculateMean(values.map((value) => (value - mean) ** 4));
  return fourthMoment / variance ** 2 - 3;
}

function calculateLagOneAutocorrelation(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const mean = calculateMean(values);
  const denominator = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  if (denominator === 0) {
    return 0;
  }

  let numerator = 0;
  for (let index = 1; index < values.length; index += 1) {
    numerator += (values[index]! - mean) * (values[index - 1]! - mean);
  }
  return numerator / denominator;
}

function createTaskMetricKey(taskId: string, metricId: string): string {
  return `${taskId}\u0000${metricId}`;
}

function parseTaskMetricKey(key: string): { readonly taskId: string; readonly metricId: string } {
  const [taskId, metricId] = key.split('\u0000');
  if (taskId === undefined || metricId === undefined) {
    throw new Error('invalid planner task metric key');
  }
  return { taskId, metricId };
}

function normalizeExpectedPlannerVariants(variants: readonly string[]): string[] {
  if (variants.length === 0) {
    throw new Error('plannerAblation expectedVariants must not be empty');
  }

  const normalized: string[] = [];
  for (const variant of variants) {
    assertNonEmptyString(variant, 'plannerAblation expectedVariants');
    if (normalized.includes(variant)) {
      throw new Error(`plannerAblation expected variant ${variant} must be unique`);
    }
    normalized.push(variant);
  }

  if (!normalized.includes('default')) {
    throw new Error('plannerAblation expectedVariants must include default');
  }
  if (normalized.every((variant) => variant === 'default')) {
    throw new Error('plannerAblation expectedVariants must include at least one ablated variant');
  }

  return normalized;
}

function assertPlannerExpectedVariantsPresent(input: {
  readonly key: string;
  readonly runs: readonly PlannerExperimentRun[];
  readonly expectedVariants: readonly string[];
}): void {
  const observedVariants = new Set(input.runs.map((run) => run.variant));
  const missingVariants = input.expectedVariants.filter(
    (variant) => !observedVariants.has(variant),
  );
  if (missingVariants.length === 0) {
    return;
  }

  const { taskId, metricId } = parseTaskMetricKey(input.key);
  throw new Error(
    `plannerRuns missing expected variants ${missingVariants.join(',')} for task ${taskId} metric ${metricId}`,
  );
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function validateCriteriaId(criteriaId: string): string {
  assertNonEmptyString(criteriaId, 'criteriaId');
  return criteriaId;
}

function normalizeAllowedStatusesByMetricId(
  allowedStatusesByMetricId:
    | Partial<Record<ExperimentValidationMetricId, readonly ExperimentValidationStatus[]>>
    | undefined,
): Partial<Record<ExperimentValidationMetricId, readonly ExperimentValidationStatus[]>> {
  if (allowedStatusesByMetricId === undefined) {
    return {};
  }

  const normalized: Partial<
    Record<ExperimentValidationMetricId, readonly ExperimentValidationStatus[]>
  > = {};
  for (const metricId of Object.keys(allowedStatusesByMetricId) as ExperimentValidationMetricId[]) {
    normalized[metricId] = normalizeAllowedValidationStatuses(
      allowedStatusesByMetricId[metricId] ?? [],
      `allowedStatusesByMetricId.${metricId}`,
    );
  }
  return normalized;
}

function normalizeAllowedValidationStatuses(
  statuses: readonly ExperimentValidationStatus[],
  label: string,
): ExperimentValidationStatus[] {
  if (statuses.length === 0) {
    throw new Error(`${label} must not be empty`);
  }

  const normalized: ExperimentValidationStatus[] = [];
  for (const status of statuses) {
    if (!isExperimentValidationStatus(status)) {
      throw new Error(`${label} contains invalid status`);
    }
    if (!normalized.includes(status)) {
      normalized.push(status);
    }
  }
  return normalized;
}

function isExperimentValidationStatus(value: string): value is ExperimentValidationStatus {
  return value === 'pass' || value === 'watch' || value === 'fail';
}

function countPlannerMetricGroups(
  groups: ReadonlyMap<string, readonly PlannerExperimentRun[]>,
  metricIds: ReadonlySet<string>,
): number {
  return [...groups.keys()].filter((key) => metricIds.has(parseTaskMetricKey(key).metricId)).length;
}

function summarizeNamedPlannerMetric(
  groups: ReadonlyMap<string, readonly PlannerExperimentRun[]>,
  metricId: string,
): PlannerNamedMetricSummary {
  const defaultValues: number[] = [];
  const ablatedValues: number[] = [];
  const defaultAdvantages: number[] = [];

  for (const [key, runs] of groups) {
    if (parseTaskMetricKey(key).metricId !== metricId) {
      continue;
    }
    const defaultRun = runs.find((run) => run.variant === 'default');
    if (defaultRun === undefined) {
      continue;
    }
    const defaultMetric = getMetricFromRun(defaultRun, metricId);
    for (const ablatedRun of runs.filter((run) => run.variant !== 'default')) {
      const ablatedMetric = getMetricFromRun(ablatedRun, metricId);
      defaultValues.push(defaultMetric.value);
      ablatedValues.push(ablatedMetric.value);
      defaultAdvantages.push(
        calculateAbsoluteDefaultAdvantage({
          defaultValue: defaultMetric.value,
          ablatedValue: ablatedMetric.value,
          higherIsBetter: defaultMetric.higherIsBetter,
        }),
      );
    }
  }

  return {
    comparisonCount: defaultAdvantages.length,
    defaultValue: calculateMean(defaultValues),
    ablatedValue: calculateMean(ablatedValues),
    defaultAdvantage: calculateMean(defaultAdvantages),
  };
}

function getMetricFromRun(run: PlannerExperimentRun, metricId: string): PlannerExperimentMetric {
  const metric = run.metrics.find((candidate) => candidate.metricId === metricId);
  if (metric === undefined) {
    throw new Error('plannerRuns metric groups must include matching metric rows');
  }
  return metric;
}

function isDefaultAtLeastAsGood(comparison: PlannerComparison): boolean {
  return comparison.higherIsBetter
    ? comparison.defaultValue >= comparison.ablatedValue
    : comparison.defaultValue <= comparison.ablatedValue;
}

function calculateNormalizedDefaultAdvantage(comparison: PlannerComparison): number {
  const numerator = comparison.higherIsBetter
    ? comparison.defaultValue - comparison.ablatedValue
    : comparison.ablatedValue - comparison.defaultValue;
  return numerator / Math.max(Math.abs(comparison.ablatedValue), 1);
}

function calculateAbsoluteDefaultAdvantage(comparison: PlannerComparison): number {
  return comparison.higherIsBetter
    ? comparison.defaultValue - comparison.ablatedValue
    : comparison.ablatedValue - comparison.defaultValue;
}

function thresholdPassesMinimum(summary: PlannerNamedMetricSummary, minimumValue: number): boolean {
  return summary.comparisonCount === 0 || summary.defaultValue >= minimumValue;
}

function thresholdPassesMaximum(summary: PlannerNamedMetricSummary, maximumValue: number): boolean {
  return summary.comparisonCount === 0 || summary.defaultValue <= maximumValue;
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return numerator === 0 ? 1 : numerator;
  }
  return numerator / denominator;
}

function assertNonEmptyString(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must be non-empty`);
  }
}

function assertFinite(value: number, fieldName: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be finite`);
  }
}

function assertPositiveFinite(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be positive and finite`);
  }
}

function assertNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}

function assertUnitInterval(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${fieldName} must be within [0, 1]`);
  }
}
