import type {
  RuntimeProfileAgentCycleLlmStageName,
  RuntimeProfileCognitionLlmStageName,
  RuntimeProfileRunGateCriteria,
  RuntimeProfileRunGateResult,
} from '@aivilization/observability';

export type LocalRuntimeTownPaperAlignmentStageFamily =
  | 'agent-cycle'
  | 'cognition'
  | 'human-steering';

export type LocalRuntimeTownPaperAlignmentGateStatus = 'pass' | 'fail' | 'not-configured';
export type LocalRuntimeTownPaperAlignmentSteeringMetricStatus =
  | 'pass'
  | 'watch'
  | 'fail'
  | 'missing';

export type LocalRuntimeTownPaperAlignmentRequirements = {
  readonly acceptedTrace: boolean;
  readonly evidenceBackedTrace: boolean;
  readonly noFallback: boolean;
  readonly noDeterministic: boolean;
  readonly observedState: boolean;
  readonly worldDecisionContext: boolean;
  readonly economicContext: boolean;
  readonly rulesContext: boolean;
  readonly shortTermMemoryContext: boolean;
  readonly longTermProfileContext: boolean;
  readonly outputArtifactCount: number;
  readonly localRepairAcceptedCount: number;
};

export type LocalRuntimeTownPaperAlignmentSteeringRequirements = {
  readonly memoryPropagationMetric: boolean;
  readonly metricStatus: LocalRuntimeTownPaperAlignmentSteeringMetricStatus;
  readonly humanTraceCount: number;
  readonly longHorizonTraceCount: number;
  readonly reactiveTraceCount: number;
  readonly planBackedLongHorizonTraceCount: number;
  readonly memoryBackedReactiveTraceCount: number;
  readonly commandDraftBackedReactiveTraceCount: number;
};

export type LocalRuntimeTownPaperAlignmentExperimentValidationMetric = {
  readonly id: string;
  readonly status: string;
  readonly evidence: Readonly<Record<string, number | string>>;
};

export type LocalRuntimeTownPaperAlignmentExperimentValidationReport = {
  readonly metrics: readonly LocalRuntimeTownPaperAlignmentExperimentValidationMetric[];
};

export type LocalRuntimeTownPaperAlignmentStageCoverage = {
  readonly paperCapabilityId: string;
  readonly paperSection: string;
  readonly stageFamily: LocalRuntimeTownPaperAlignmentStageFamily;
  readonly stageName: string;
  readonly runtimeConfigured: boolean;
  readonly gateStatus: LocalRuntimeTownPaperAlignmentGateStatus;
  readonly requirements: LocalRuntimeTownPaperAlignmentRequirements;
  readonly steeringRequirements?: LocalRuntimeTownPaperAlignmentSteeringRequirements;
};

export type LocalRuntimeTownPaperAlignmentProfileCoverage = {
  readonly schemaVersion: 1;
  readonly stageCount: number;
  readonly configuredStageCount: number;
  readonly passedConfiguredStageCount: number;
  readonly failedConfiguredStageCount: number;
  readonly unconfiguredStageCount: number;
  readonly stages: readonly LocalRuntimeTownPaperAlignmentStageCoverage[];
};

export type LocalRuntimeTownPaperAlignmentSummary = {
  readonly schemaVersion: 1;
  readonly capabilityCount: number;
  readonly configuredCapabilityCount: number;
  readonly passedConfiguredCapabilityCount: number;
  readonly failedConfiguredCapabilityCount: number;
  readonly unconfiguredCapabilityCount: number;
};

type PaperAlignmentStageDefinition =
  | {
      readonly paperCapabilityId: string;
      readonly paperSection: string;
      readonly stageFamily: 'agent-cycle';
      readonly stageName: RuntimeProfileAgentCycleLlmStageName;
    }
  | {
      readonly paperCapabilityId: string;
      readonly paperSection: string;
      readonly stageFamily: 'cognition';
      readonly stageName: RuntimeProfileCognitionLlmStageName;
    }
  | {
      readonly paperCapabilityId: string;
      readonly paperSection: string;
      readonly stageFamily: 'agent-cycle';
      readonly stageName: 'localRepair';
    }
  | {
      readonly paperCapabilityId: string;
      readonly paperSection: string;
      readonly stageFamily: 'human-steering';
      readonly stageName: HumanSteeringStageName;
    };

type HumanSteeringStageName = 'strategicSteering' | 'reactiveSteering';

const PAPER_ALIGNMENT_STAGE_DEFINITIONS = [
  {
    paperCapabilityId: 'strategic-branch-planning',
    paperSection: '2.1.1 Branch-Thinking Planner',
    stageFamily: 'cognition',
    stageName: 'strategicPlanning',
  },
  {
    paperCapabilityId: 'daily-planning',
    paperSection: '2.1.1 Branch-Thinking Planner',
    stageFamily: 'cognition',
    stageName: 'dailyPlanning',
  },
  {
    paperCapabilityId: 'reaction-evaluation',
    paperSection: '2.2 Adaptive Agent Profile',
    stageFamily: 'cognition',
    stageName: 'reactionEvaluation',
  },
  {
    paperCapabilityId: 'contextual-prioritization',
    paperSection: '2.1.1 Branch-Thinking Planner',
    stageFamily: 'agent-cycle',
    stageName: 'contextualPrioritization',
  },
  {
    paperCapabilityId: 'action-sequence-generation',
    paperSection: '2.1.1 Branch-Thinking Planner',
    stageFamily: 'agent-cycle',
    stageName: 'actionSequenceGeneration',
  },
  {
    paperCapabilityId: 'social-dialogue-generation',
    paperSection: '2.2 Adaptive Agent Profile',
    stageFamily: 'agent-cycle',
    stageName: 'socialDialogueGeneration',
  },
  {
    paperCapabilityId: 'global-synthesis',
    paperSection: '2.1.1 Branch-Thinking Planner',
    stageFamily: 'agent-cycle',
    stageName: 'globalSynthesis',
  },
  {
    paperCapabilityId: 'reactive-correction',
    paperSection: '2.1.2 Action Simulator And Tiered Replanning',
    stageFamily: 'agent-cycle',
    stageName: 'reactiveCorrection',
  },
  {
    paperCapabilityId: 'local-repair',
    paperSection: '2.1.2 Action Simulator And Tiered Replanning',
    stageFamily: 'agent-cycle',
    stageName: 'localRepair',
  },
  {
    paperCapabilityId: 'memory-guided-replanning',
    paperSection: '2.1.2 Action Simulator And Tiered Replanning',
    stageFamily: 'agent-cycle',
    stageName: 'replanningDecision',
  },
  {
    paperCapabilityId: 'reflection-synthesis',
    paperSection: '2.2 Adaptive Agent Profile',
    stageFamily: 'cognition',
    stageName: 'reflectionSynthesis',
  },
  {
    paperCapabilityId: 'social-model-synthesis',
    paperSection: '2.2 Adaptive Agent Profile',
    stageFamily: 'cognition',
    stageName: 'socialModelSynthesis',
  },
  {
    paperCapabilityId: 'strategic-steering',
    paperSection: '2.3 Human-in-the-Loop Steering',
    stageFamily: 'human-steering',
    stageName: 'strategicSteering',
  },
  {
    paperCapabilityId: 'reactive-steering',
    paperSection: '2.3 Human-in-the-Loop Steering',
    stageFamily: 'human-steering',
    stageName: 'reactiveSteering',
  },
] as const satisfies readonly PaperAlignmentStageDefinition[];

export function createLocalRuntimeTownPaperAlignmentProfileCoverage(input: {
  readonly criteria: RuntimeProfileRunGateCriteria;
  readonly gate: RuntimeProfileRunGateResult;
  readonly experimentValidationReports?: readonly LocalRuntimeTownPaperAlignmentExperimentValidationReport[];
}): LocalRuntimeTownPaperAlignmentProfileCoverage {
  const steeringRequirements = createSteeringRequirements(
    input.experimentValidationReports ?? [],
  );
  const stages = PAPER_ALIGNMENT_STAGE_DEFINITIONS.map((definition) =>
    createStageCoverage(definition, input.criteria, input.gate, steeringRequirements),
  );
  return {
    schemaVersion: 1,
    stageCount: stages.length,
    ...summarizeStages(stages),
    stages,
  };
}

export function summarizeLocalRuntimeTownPaperAlignmentProfileCoverages(
  profiles: readonly LocalRuntimeTownPaperAlignmentProfileCoverage[],
): LocalRuntimeTownPaperAlignmentSummary {
  return {
    schemaVersion: 1,
    capabilityCount: sumBy(profiles, (profile) => profile.stageCount),
    configuredCapabilityCount: sumBy(profiles, (profile) => profile.configuredStageCount),
    passedConfiguredCapabilityCount: sumBy(
      profiles,
      (profile) => profile.passedConfiguredStageCount,
    ),
    failedConfiguredCapabilityCount: sumBy(
      profiles,
      (profile) => profile.failedConfiguredStageCount,
    ),
    unconfiguredCapabilityCount: sumBy(profiles, (profile) => profile.unconfiguredStageCount),
  };
}

function createStageCoverage(
  definition: PaperAlignmentStageDefinition,
  criteria: RuntimeProfileRunGateCriteria,
  gate: RuntimeProfileRunGateResult,
  steeringRequirements: LocalRuntimeTownPaperAlignmentSteeringRequirements,
): LocalRuntimeTownPaperAlignmentStageCoverage {
  if (definition.stageFamily === 'human-steering') {
    return createHumanSteeringStageCoverage(definition, steeringRequirements);
  }
  if (definition.stageName === 'localRepair') {
    return createLocalRepairStageCoverage(definition, criteria, gate);
  }

  const requirements =
    definition.stageFamily === 'agent-cycle'
      ? createAgentCycleRequirements(definition.stageName, criteria)
      : createCognitionRequirements(definition.stageName, criteria);
  const runtimeConfigured = requirements.acceptedTrace;
  return {
    paperCapabilityId: definition.paperCapabilityId,
    paperSection: definition.paperSection,
    stageFamily: definition.stageFamily,
    stageName: definition.stageName,
    runtimeConfigured,
    gateStatus: runtimeConfigured
      ? hasStageFailure(definition, gate)
        ? 'fail'
        : 'pass'
      : 'not-configured',
    requirements,
  };
}

function createHumanSteeringStageCoverage(
  definition: Extract<PaperAlignmentStageDefinition, { readonly stageFamily: 'human-steering' }>,
  steeringRequirements: LocalRuntimeTownPaperAlignmentSteeringRequirements,
): LocalRuntimeTownPaperAlignmentStageCoverage {
  const runtimeConfigured = isHumanSteeringRuntimeConfigured(
    definition.stageName,
    steeringRequirements,
  );
  return {
    paperCapabilityId: definition.paperCapabilityId,
    paperSection: definition.paperSection,
    stageFamily: definition.stageFamily,
    stageName: definition.stageName,
    runtimeConfigured,
    gateStatus: runtimeConfigured
      ? isHumanSteeringStagePassed(definition.stageName, steeringRequirements)
        ? 'pass'
        : 'fail'
      : 'not-configured',
    requirements: createUnconfiguredRequirements(),
    steeringRequirements,
  };
}

function createLocalRepairStageCoverage(
  definition: Extract<PaperAlignmentStageDefinition, { readonly stageName: 'localRepair' }>,
  criteria: RuntimeProfileRunGateCriteria,
  gate: RuntimeProfileRunGateResult,
): LocalRuntimeTownPaperAlignmentStageCoverage {
  const requirements = createLocalRepairRequirements(criteria);
  const runtimeConfigured = requirements.localRepairAcceptedCount > 0;
  return {
    paperCapabilityId: definition.paperCapabilityId,
    paperSection: definition.paperSection,
    stageFamily: definition.stageFamily,
    stageName: definition.stageName,
    runtimeConfigured,
    gateStatus: runtimeConfigured
      ? hasLocalRepairFailure(gate)
        ? 'fail'
        : 'pass'
      : 'not-configured',
    requirements,
  };
}

function createAgentCycleRequirements(
  stageName: RuntimeProfileAgentCycleLlmStageName,
  criteria: RuntimeProfileRunGateCriteria,
): LocalRuntimeTownPaperAlignmentRequirements {
  return {
    acceptedTrace: includesStage(criteria.requiredAgentCycleLlmAcceptedStages, stageName),
    evidenceBackedTrace: includesStage(
      criteria.requiredAgentCycleLlmEvidenceBackedStages,
      stageName,
    ),
    noFallback: includesStage(criteria.requiredAgentCycleLlmNoFallbackStages, stageName),
    noDeterministic: includesStage(criteria.requiredAgentCycleLlmNoDeterministicStages, stageName),
    observedState: includesStage(criteria.requiredAgentCycleLlmObservedStateStages, stageName),
    worldDecisionContext: includesStage(
      criteria.requiredAgentCycleLlmWorldContextStages,
      stageName,
    ),
    economicContext: includesStage(criteria.requiredAgentCycleLlmEconomicContextStages, stageName),
    rulesContext: includesStage(criteria.requiredAgentCycleLlmRulesContextStages, stageName),
    shortTermMemoryContext: includesStage(
      criteria.requiredAgentCycleLlmMemoryContextStages,
      stageName,
    ),
    longTermProfileContext: includesStage(
      criteria.requiredAgentCycleLlmProfileContextStages,
      stageName,
    ),
    outputArtifactCount: 0,
    localRepairAcceptedCount: 0,
  };
}

function createCognitionRequirements(
  stageName: RuntimeProfileCognitionLlmStageName,
  criteria: RuntimeProfileRunGateCriteria,
): LocalRuntimeTownPaperAlignmentRequirements {
  return {
    acceptedTrace: includesStage(criteria.requiredCognitionLlmAcceptedStages, stageName),
    evidenceBackedTrace: false,
    noFallback: includesStage(criteria.requiredCognitionLlmNoFallbackStages, stageName),
    noDeterministic: includesStage(criteria.requiredCognitionLlmNoDeterministicStages, stageName),
    observedState: includesStage(criteria.requiredCognitionLlmObservedStateStages, stageName),
    worldDecisionContext: includesStage(criteria.requiredCognitionLlmWorldContextStages, stageName),
    economicContext: includesStage(criteria.requiredCognitionLlmEconomicContextStages, stageName),
    rulesContext: includesStage(criteria.requiredCognitionLlmRulesContextStages, stageName),
    shortTermMemoryContext: includesStage(
      criteria.requiredCognitionLlmMemoryContextStages,
      stageName,
    ),
    longTermProfileContext: includesStage(
      criteria.requiredCognitionLlmProfileContextStages,
      stageName,
    ),
    outputArtifactCount: criteria.minimumCognitionLlmOutputArtifactCounts?.[stageName] ?? 0,
    localRepairAcceptedCount: 0,
  };
}

function createLocalRepairRequirements(
  criteria: RuntimeProfileRunGateCriteria,
): LocalRuntimeTownPaperAlignmentRequirements {
  return {
    acceptedTrace: false,
    evidenceBackedTrace: false,
    noFallback: false,
    noDeterministic: false,
    observedState: false,
    worldDecisionContext: false,
    economicContext: false,
    rulesContext: false,
    shortTermMemoryContext: false,
    longTermProfileContext: false,
    outputArtifactCount: 0,
    localRepairAcceptedCount: criteria.minimumLocalRepairAcceptedCount ?? 0,
  };
}

function createUnconfiguredRequirements(): LocalRuntimeTownPaperAlignmentRequirements {
  return {
    acceptedTrace: false,
    evidenceBackedTrace: false,
    noFallback: false,
    noDeterministic: false,
    observedState: false,
    worldDecisionContext: false,
    economicContext: false,
    rulesContext: false,
    shortTermMemoryContext: false,
    longTermProfileContext: false,
    outputArtifactCount: 0,
    localRepairAcceptedCount: 0,
  };
}

function createSteeringRequirements(
  reports: readonly LocalRuntimeTownPaperAlignmentExperimentValidationReport[],
): LocalRuntimeTownPaperAlignmentSteeringRequirements {
  const metrics = reports.flatMap((report) =>
    report.metrics.filter((metric) => metric.id === 'steering-memory-propagation'),
  );
  const metricStatus = summarizeSteeringMetricStatus(metrics);
  return {
    memoryPropagationMetric: metrics.length > 0,
    metricStatus,
    humanTraceCount: sumMetricEvidence(metrics, 'humanTraceCount'),
    longHorizonTraceCount: sumMetricEvidence(metrics, 'longHorizonTraceCount'),
    reactiveTraceCount: sumMetricEvidence(metrics, 'reactiveTraceCount'),
    planBackedLongHorizonTraceCount: sumMetricEvidence(
      metrics,
      'planBackedLongHorizonTraceCount',
    ),
    memoryBackedReactiveTraceCount: sumMetricEvidence(metrics, 'memoryBackedReactiveTraceCount'),
    commandDraftBackedReactiveTraceCount: sumMetricEvidence(
      metrics,
      'commandDraftBackedReactiveTraceCount',
    ),
  };
}

function summarizeSteeringMetricStatus(
  metrics: readonly LocalRuntimeTownPaperAlignmentExperimentValidationMetric[],
): LocalRuntimeTownPaperAlignmentSteeringMetricStatus {
  if (metrics.length === 0) {
    return 'missing';
  }
  if (metrics.some((metric) => metric.status === 'fail')) {
    return 'fail';
  }
  if (metrics.some((metric) => metric.status === 'watch')) {
    return 'watch';
  }
  return 'pass';
}

function sumMetricEvidence(
  metrics: readonly LocalRuntimeTownPaperAlignmentExperimentValidationMetric[],
  key: string,
): number {
  return metrics.reduce((total, metric) => total + readEvidenceNumber(metric.evidence[key]), 0);
}

function readEvidenceNumber(value: number | string | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isHumanSteeringRuntimeConfigured(
  stageName: HumanSteeringStageName,
  requirements: LocalRuntimeTownPaperAlignmentSteeringRequirements,
): boolean {
  if (!requirements.memoryPropagationMetric) {
    return false;
  }
  switch (stageName) {
    case 'strategicSteering':
      return requirements.longHorizonTraceCount > 0;
    case 'reactiveSteering':
      return requirements.reactiveTraceCount > 0;
  }
}

function isHumanSteeringStagePassed(
  stageName: HumanSteeringStageName,
  requirements: LocalRuntimeTownPaperAlignmentSteeringRequirements,
): boolean {
  if (requirements.metricStatus !== 'pass') {
    return false;
  }
  switch (stageName) {
    case 'strategicSteering':
      return (
        requirements.longHorizonTraceCount > 0 &&
        requirements.planBackedLongHorizonTraceCount >= requirements.longHorizonTraceCount
      );
    case 'reactiveSteering':
      return (
        requirements.reactiveTraceCount > 0 &&
        requirements.memoryBackedReactiveTraceCount >= requirements.reactiveTraceCount &&
        requirements.commandDraftBackedReactiveTraceCount >= requirements.reactiveTraceCount
      );
  }
}

function hasStageFailure(
  definition: PaperAlignmentStageDefinition,
  gate: RuntimeProfileRunGateResult,
): boolean {
  if (definition.stageName === 'localRepair') {
    return hasLocalRepairFailure(gate);
  }

  const prefix = definition.stageFamily === 'agent-cycle' ? 'agent-cycle-' : 'cognition-';
  return gate.failures.some(
    (failure) =>
      failure.code.startsWith(prefix) && failure.evidence.stageName === definition.stageName,
  );
}

function hasLocalRepairFailure(gate: RuntimeProfileRunGateResult): boolean {
  return gate.failures.some((failure) => failure.code === 'local-repair-accepted-count-too-low');
}

function summarizeStages(
  stages: readonly LocalRuntimeTownPaperAlignmentStageCoverage[],
): Omit<LocalRuntimeTownPaperAlignmentProfileCoverage, 'schemaVersion' | 'stageCount' | 'stages'> {
  const configuredStageCount = stages.filter((stage) => stage.runtimeConfigured).length;
  const passedConfiguredStageCount = stages.filter((stage) => stage.gateStatus === 'pass').length;
  const failedConfiguredStageCount = stages.filter((stage) => stage.gateStatus === 'fail').length;
  return {
    configuredStageCount,
    passedConfiguredStageCount,
    failedConfiguredStageCount,
    unconfiguredStageCount: stages.length - configuredStageCount,
  };
}

function includesStage<TStage extends string>(
  stages: readonly TStage[] | undefined,
  stageName: TStage,
): boolean {
  return stages?.includes(stageName) ?? false;
}

function sumBy<TValue>(values: readonly TValue[], getValue: (value: TValue) => number): number {
  return values.reduce((total, value) => total + getValue(value), 0);
}
