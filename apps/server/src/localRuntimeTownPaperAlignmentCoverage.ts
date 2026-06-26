import type {
  RuntimeProfileAgentCycleLlmStageName,
  RuntimeProfileCognitionLlmStageName,
  RuntimeProfileRunGateCriteria,
  RuntimeProfileRunGateResult,
} from '@aivilization/observability';

export type LocalRuntimeTownPaperAlignmentStageFamily = 'agent-cycle' | 'cognition';

export type LocalRuntimeTownPaperAlignmentGateStatus = 'pass' | 'fail' | 'not-configured';

export type LocalRuntimeTownPaperAlignmentRequirements = {
  readonly acceptedTrace: boolean;
  readonly noFallback: boolean;
  readonly noDeterministic: boolean;
  readonly observedState: boolean;
  readonly worldDecisionContext: boolean;
  readonly economicContext: boolean;
  readonly rulesContext: boolean;
  readonly shortTermMemoryContext: boolean;
  readonly longTermProfileContext: boolean;
  readonly outputArtifactCount: number;
};

export type LocalRuntimeTownPaperAlignmentStageCoverage = {
  readonly paperCapabilityId: string;
  readonly paperSection: string;
  readonly stageFamily: LocalRuntimeTownPaperAlignmentStageFamily;
  readonly stageName: string;
  readonly runtimeConfigured: boolean;
  readonly gateStatus: LocalRuntimeTownPaperAlignmentGateStatus;
  readonly requirements: LocalRuntimeTownPaperAlignmentRequirements;
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
    };

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
] as const satisfies readonly PaperAlignmentStageDefinition[];

export function createLocalRuntimeTownPaperAlignmentProfileCoverage(input: {
  readonly criteria: RuntimeProfileRunGateCriteria;
  readonly gate: RuntimeProfileRunGateResult;
}): LocalRuntimeTownPaperAlignmentProfileCoverage {
  const stages = PAPER_ALIGNMENT_STAGE_DEFINITIONS.map((definition) =>
    createStageCoverage(definition, input.criteria, input.gate),
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
): LocalRuntimeTownPaperAlignmentStageCoverage {
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

function createAgentCycleRequirements(
  stageName: RuntimeProfileAgentCycleLlmStageName,
  criteria: RuntimeProfileRunGateCriteria,
): LocalRuntimeTownPaperAlignmentRequirements {
  return {
    acceptedTrace: includesStage(criteria.requiredAgentCycleLlmAcceptedStages, stageName),
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
  };
}

function createCognitionRequirements(
  stageName: RuntimeProfileCognitionLlmStageName,
  criteria: RuntimeProfileRunGateCriteria,
): LocalRuntimeTownPaperAlignmentRequirements {
  return {
    acceptedTrace: includesStage(criteria.requiredCognitionLlmAcceptedStages, stageName),
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
  };
}

function hasStageFailure(
  definition: PaperAlignmentStageDefinition,
  gate: RuntimeProfileRunGateResult,
): boolean {
  const prefix = definition.stageFamily === 'agent-cycle' ? 'agent-cycle-' : 'cognition-';
  return gate.failures.some(
    (failure) =>
      failure.code.startsWith(prefix) && failure.evidence.stageName === definition.stageName,
  );
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
