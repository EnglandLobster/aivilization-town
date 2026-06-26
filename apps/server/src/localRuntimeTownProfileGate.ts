import type {
  RuntimeProfileAgentCycleLlmStageName,
  RuntimeProfileCognitionLlmStageName,
  RuntimeProfileRunGateCriteria,
} from '@aivilization/observability';
import type { PartitionKey } from '@aivilization/sim-core';
import { createLocalRuntimeTownProfileDefaults } from './localRuntimeTownProfileDefaults';
import type { LocalRuntimeTownProfileRuntimeConfig } from './localRuntimeTownProfileRuntimeConfig';
import { createLocalRuntimeTownDaemonScenarioProfile } from './localRuntimeTownScenarioProfile';
import type { LocalRuntimeTownDaemonScenarioProfileId } from './localRuntimeTownScenarioProfile';

export type LocalRuntimeTownProfileGateCriteriaInput = {
  readonly minimumCompletedCycleCount?: number;
  readonly minimumTotalEventCount?: number;
  readonly minimumTotalAgentTraceCount?: number;
  readonly minimumFullReplanMaterializationCount?: number;
  readonly minimumSimulatorRolloutCoverageRatio?: number;
  readonly minimumLocalRepairAcceptedCount?: number;
  readonly runtimeConfig?: LocalRuntimeTownProfileRuntimeConfig;
  readonly requiredAgentCycleLlmAcceptedStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmNoFallbackStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmNoDeterministicStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmWorldContextStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmEconomicContextStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmRulesContextStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmMemoryContextStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmProfileContextStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmObservedStateStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredCognitionLlmAcceptedStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmNoFallbackStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmNoDeterministicStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmWorldContextStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmEconomicContextStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmRulesContextStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmMemoryContextStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmProfileContextStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmObservedStateStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly minimumCognitionLlmOutputArtifactCounts?: Readonly<
    Partial<Record<RuntimeProfileCognitionLlmStageName, number>>
  >;
};

export function createLocalRuntimeTownProfileGateCriteria(
  profileId: LocalRuntimeTownDaemonScenarioProfileId,
  input: LocalRuntimeTownProfileGateCriteriaInput = {},
): RuntimeProfileRunGateCriteria {
  const profile = createLocalRuntimeTownDaemonScenarioProfile(profileId);
  const profileDefaults = createLocalRuntimeTownProfileDefaults(profile.profileId);
  const agentCountByPresetId = new Map(
    profile.scenarioPresets.map((preset) => [preset.id, preset.agentSeeds.length]),
  );
  const expectedProjectionAgentCountByPartition: Record<string, number> = {};
  const requiredAgentCycleLlmAcceptedStages =
    input.requiredAgentCycleLlmAcceptedStages ??
    deriveRequiredAgentCycleLlmAcceptedStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredAgentCycleLlmNoFallbackStages =
    input.requiredAgentCycleLlmNoFallbackStages ??
    deriveRequiredAgentCycleLlmNoFallbackStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredAgentCycleLlmNoDeterministicStages =
    input.requiredAgentCycleLlmNoDeterministicStages ??
    deriveRequiredAgentCycleLlmNoDeterministicStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredAgentCycleLlmWorldContextStages =
    input.requiredAgentCycleLlmWorldContextStages ??
    deriveRequiredAgentCycleLlmWorldContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredAgentCycleLlmEconomicContextStages =
    input.requiredAgentCycleLlmEconomicContextStages ??
    deriveRequiredAgentCycleLlmEconomicContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredAgentCycleLlmRulesContextStages =
    input.requiredAgentCycleLlmRulesContextStages ??
    deriveRequiredAgentCycleLlmRulesContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredAgentCycleLlmMemoryContextStages =
    input.requiredAgentCycleLlmMemoryContextStages ??
    deriveRequiredAgentCycleLlmMemoryContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredAgentCycleLlmProfileContextStages =
    input.requiredAgentCycleLlmProfileContextStages ??
    deriveRequiredAgentCycleLlmProfileContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredAgentCycleLlmObservedStateStages =
    input.requiredAgentCycleLlmObservedStateStages ??
    deriveRequiredAgentCycleLlmObservedStateStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredCognitionLlmAcceptedStages =
    input.requiredCognitionLlmAcceptedStages ??
    deriveRequiredCognitionLlmAcceptedStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredCognitionLlmNoFallbackStages =
    input.requiredCognitionLlmNoFallbackStages ??
    deriveRequiredCognitionLlmNoFallbackStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredCognitionLlmNoDeterministicStages =
    input.requiredCognitionLlmNoDeterministicStages ??
    deriveRequiredCognitionLlmNoDeterministicStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredCognitionLlmWorldContextStages =
    input.requiredCognitionLlmWorldContextStages ??
    deriveRequiredCognitionLlmWorldContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredCognitionLlmEconomicContextStages =
    input.requiredCognitionLlmEconomicContextStages ??
    deriveRequiredCognitionLlmEconomicContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredCognitionLlmRulesContextStages =
    input.requiredCognitionLlmRulesContextStages ??
    deriveRequiredCognitionLlmRulesContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredCognitionLlmMemoryContextStages =
    input.requiredCognitionLlmMemoryContextStages ??
    deriveRequiredCognitionLlmMemoryContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredCognitionLlmProfileContextStages =
    input.requiredCognitionLlmProfileContextStages ??
    deriveRequiredCognitionLlmProfileContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredCognitionLlmObservedStateStages =
    input.requiredCognitionLlmObservedStateStages ??
    deriveRequiredCognitionLlmObservedStateStagesFromRuntimeConfig(input.runtimeConfig);
  const minimumCognitionLlmOutputArtifactCounts =
    input.minimumCognitionLlmOutputArtifactCounts ??
    deriveMinimumCognitionLlmOutputArtifactCountsFromRuntimeConfig(input.runtimeConfig);
  const minimumSimulatorRolloutCoverageRatio =
    input.minimumSimulatorRolloutCoverageRatio ??
    profileDefaults.minimumSimulatorRolloutCoverageRatio;
  const minimumLocalRepairAcceptedCount = deriveMinimumLocalRepairAcceptedCount({
    inputMinimum: input.minimumLocalRepairAcceptedCount,
    runtimeConfig: input.runtimeConfig,
  });

  for (const partition of profile.manifest.partitions) {
    const agentCount = agentCountByPresetId.get(partition.scenarioPresetId);
    if (agentCount === undefined) {
      throw new Error(
        `scenario preset missing for profile gate partition ${partition.partitionKey}`,
      );
    }
    expectedProjectionAgentCountByPartition[partition.partitionKey] = agentCount;
  }

  return {
    criteriaId: `${profile.manifest.id}:profile-run-gate`,
    profileId: profile.profileId,
    manifestId: profile.manifest.id,
    partitionCount: profile.manifest.partitions.length,
    totalProjectionAgentCount: profile.agentCount,
    minimumCompletedCycleCount: input.minimumCompletedCycleCount ?? 1,
    minimumTotalEventCount: input.minimumTotalEventCount ?? profile.manifest.partitions.length + 1,
    minimumTotalAgentTraceCount: input.minimumTotalAgentTraceCount ?? 1,
    minimumFullReplanMaterializationCount:
      input.minimumFullReplanMaterializationCount ??
      profileDefaults.minimumFullReplanMaterializationCount ??
      0,
    requiredDaemonHealth: 'healthy',
    requiredOutcome: 'succeeded',
    requiredStopReason: 'cycle-count-completed',
    allowedPartitionStatuses: ['completed', 'succeeded'],
    requiredPartitionHealth: 'healthy',
    requireStreamVersionMatchesEventCount: true,
    expectedProjectionAgentCountByPartition,
    ...(requiredAgentCycleLlmAcceptedStages.length === 0
      ? {}
      : { requiredAgentCycleLlmAcceptedStages }),
    ...(requiredAgentCycleLlmNoFallbackStages.length === 0
      ? {}
      : { requiredAgentCycleLlmNoFallbackStages }),
    ...(requiredAgentCycleLlmNoDeterministicStages.length === 0
      ? {}
      : { requiredAgentCycleLlmNoDeterministicStages }),
    ...(requiredAgentCycleLlmWorldContextStages.length === 0
      ? {}
      : { requiredAgentCycleLlmWorldContextStages }),
    ...(requiredAgentCycleLlmEconomicContextStages.length === 0
      ? {}
      : { requiredAgentCycleLlmEconomicContextStages }),
    ...(requiredAgentCycleLlmRulesContextStages.length === 0
      ? {}
      : { requiredAgentCycleLlmRulesContextStages }),
    ...(requiredAgentCycleLlmMemoryContextStages.length === 0
      ? {}
      : { requiredAgentCycleLlmMemoryContextStages }),
    ...(requiredAgentCycleLlmProfileContextStages.length === 0
      ? {}
      : { requiredAgentCycleLlmProfileContextStages }),
    ...(requiredAgentCycleLlmObservedStateStages.length === 0
      ? {}
      : { requiredAgentCycleLlmObservedStateStages }),
    ...(requiredCognitionLlmAcceptedStages.length === 0
      ? {}
      : { requiredCognitionLlmAcceptedStages }),
    ...(requiredCognitionLlmNoFallbackStages.length === 0
      ? {}
      : { requiredCognitionLlmNoFallbackStages }),
    ...(requiredCognitionLlmNoDeterministicStages.length === 0
      ? {}
      : { requiredCognitionLlmNoDeterministicStages }),
    ...(requiredCognitionLlmWorldContextStages.length === 0
      ? {}
      : { requiredCognitionLlmWorldContextStages }),
    ...(requiredCognitionLlmEconomicContextStages.length === 0
      ? {}
      : { requiredCognitionLlmEconomicContextStages }),
    ...(requiredCognitionLlmRulesContextStages.length === 0
      ? {}
      : { requiredCognitionLlmRulesContextStages }),
    ...(requiredCognitionLlmMemoryContextStages.length === 0
      ? {}
      : { requiredCognitionLlmMemoryContextStages }),
    ...(requiredCognitionLlmProfileContextStages.length === 0
      ? {}
      : { requiredCognitionLlmProfileContextStages }),
    ...(requiredCognitionLlmObservedStateStages.length === 0
      ? {}
      : { requiredCognitionLlmObservedStateStages }),
    ...(Object.keys(minimumCognitionLlmOutputArtifactCounts).length === 0
      ? {}
      : { minimumCognitionLlmOutputArtifactCounts }),
    ...(minimumSimulatorRolloutCoverageRatio === undefined
      ? {}
      : { minimumSimulatorRolloutCoverageRatio }),
    ...(minimumLocalRepairAcceptedCount === undefined
      ? {}
      : { minimumLocalRepairAcceptedCount: minimumLocalRepairAcceptedCount }),
  };
}

function deriveMinimumLocalRepairAcceptedCount(input: {
  readonly inputMinimum: number | undefined;
  readonly runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined;
}): number | undefined {
  const configMinimum = input.runtimeConfig?.paperAlignment?.minimumLocalRepairAcceptedCount;
  if (input.inputMinimum === undefined && configMinimum === undefined) {
    return undefined;
  }
  return Math.max(input.inputMinimum ?? 0, configMinimum ?? 0);
}

export function deriveRequiredAgentCycleLlmAcceptedStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileAgentCycleLlmStageName[] {
  if (runtimeConfig === undefined) {
    return [];
  }

  const stages: RuntimeProfileAgentCycleLlmStageName[] = [];
  if (runtimeConfig.subtaskPrioritization !== undefined) {
    stages.push('contextualPrioritization');
  }
  if (runtimeConfig.actionSequenceGeneration !== undefined) {
    stages.push('actionSequenceGeneration');
  }
  if (runtimeConfig.socialDialogue !== undefined) {
    stages.push('socialDialogueGeneration');
  }
  if (runtimeConfig.globalSynthesis !== undefined) {
    stages.push('globalSynthesis');
  }
  if (runtimeConfig.reactiveCorrection !== undefined) {
    stages.push('reactiveCorrection');
  }
  if (runtimeConfig.replanningDecision !== undefined) {
    stages.push('replanningDecision');
  }
  return stages;
}

export function deriveRequiredAgentCycleLlmNoFallbackStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileAgentCycleLlmStageName[] {
  return deriveRequiredAgentCycleLlmAcceptedStagesFromRuntimeConfig(runtimeConfig);
}

export function deriveRequiredAgentCycleLlmNoDeterministicStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileAgentCycleLlmStageName[] {
  return deriveRequiredAgentCycleLlmAcceptedStagesFromRuntimeConfig(runtimeConfig);
}

export function deriveRequiredAgentCycleLlmWorldContextStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileAgentCycleLlmStageName[] {
  return deriveRequiredAgentCycleLlmAcceptedStagesFromRuntimeConfig(runtimeConfig);
}

export function deriveRequiredAgentCycleLlmRulesContextStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileAgentCycleLlmStageName[] {
  return deriveRequiredAgentCycleLlmAcceptedStagesFromRuntimeConfig(runtimeConfig);
}

export function deriveRequiredAgentCycleLlmEconomicContextStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileAgentCycleLlmStageName[] {
  return deriveRequiredAgentCycleLlmAcceptedStagesFromRuntimeConfig(runtimeConfig);
}

export function deriveRequiredAgentCycleLlmMemoryContextStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileAgentCycleLlmStageName[] {
  return deriveRequiredAgentCycleLlmAcceptedStagesFromRuntimeConfig(runtimeConfig);
}

export function deriveRequiredAgentCycleLlmProfileContextStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileAgentCycleLlmStageName[] {
  return deriveRequiredAgentCycleLlmAcceptedStagesFromRuntimeConfig(runtimeConfig);
}

export function deriveRequiredAgentCycleLlmObservedStateStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileAgentCycleLlmStageName[] {
  return deriveRequiredAgentCycleLlmAcceptedStagesFromRuntimeConfig(runtimeConfig);
}

export function deriveRequiredCognitionLlmAcceptedStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileCognitionLlmStageName[] {
  if (runtimeConfig === undefined) {
    return [];
  }

  const stages: RuntimeProfileCognitionLlmStageName[] = [];
  if (runtimeConfig.strategicPlanning !== undefined) {
    stages.push('strategicPlanning');
  }
  if (runtimeConfig.dailyPlanning !== undefined) {
    stages.push('dailyPlanning');
  }
  if (runtimeConfig.reactionPlanning !== undefined) {
    stages.push('reactionEvaluation');
  }
  if (runtimeConfig.reflectionSynthesis !== undefined) {
    stages.push('reflectionSynthesis');
  }
  if (runtimeConfig.socialModelSynthesis !== undefined) {
    stages.push('socialModelSynthesis');
  }
  return stages;
}

export function deriveRequiredCognitionLlmNoFallbackStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileCognitionLlmStageName[] {
  return deriveRequiredCognitionLlmAcceptedStagesFromRuntimeConfig(runtimeConfig);
}

export function deriveRequiredCognitionLlmNoDeterministicStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileCognitionLlmStageName[] {
  return deriveRequiredCognitionLlmAcceptedStagesFromRuntimeConfig(runtimeConfig);
}

export function deriveRequiredCognitionLlmWorldContextStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileCognitionLlmStageName[] {
  if (runtimeConfig === undefined) {
    return [];
  }

  const stages: RuntimeProfileCognitionLlmStageName[] = [];
  if (runtimeConfig.strategicPlanning !== undefined) {
    stages.push('strategicPlanning');
  }
  if (runtimeConfig.dailyPlanning !== undefined) {
    stages.push('dailyPlanning');
  }
  if (runtimeConfig.reactionPlanning !== undefined) {
    stages.push('reactionEvaluation');
  }
  if (runtimeConfig.reflectionSynthesis !== undefined) {
    stages.push('reflectionSynthesis');
  }
  if (runtimeConfig.socialModelSynthesis !== undefined) {
    stages.push('socialModelSynthesis');
  }
  return stages;
}

export function deriveRequiredCognitionLlmRulesContextStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileCognitionLlmStageName[] {
  if (runtimeConfig === undefined) {
    return [];
  }

  const stages: RuntimeProfileCognitionLlmStageName[] = [];
  if (runtimeConfig.strategicPlanning !== undefined) {
    stages.push('strategicPlanning');
  }
  if (runtimeConfig.dailyPlanning !== undefined) {
    stages.push('dailyPlanning');
  }
  if (runtimeConfig.reactionPlanning !== undefined) {
    stages.push('reactionEvaluation');
  }
  if (runtimeConfig.reflectionSynthesis !== undefined) {
    stages.push('reflectionSynthesis');
  }
  if (runtimeConfig.socialModelSynthesis !== undefined) {
    stages.push('socialModelSynthesis');
  }
  return stages;
}

export function deriveRequiredCognitionLlmEconomicContextStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileCognitionLlmStageName[] {
  return deriveRequiredCognitionLlmWorldContextStagesFromRuntimeConfig(runtimeConfig);
}

export function deriveRequiredCognitionLlmMemoryContextStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileCognitionLlmStageName[] {
  if (runtimeConfig === undefined) {
    return [];
  }

  const stages: RuntimeProfileCognitionLlmStageName[] = [];
  if (runtimeConfig.strategicPlanning !== undefined) {
    stages.push('strategicPlanning');
  }
  if (runtimeConfig.reflectionSynthesis !== undefined) {
    stages.push('reflectionSynthesis');
  }
  if (runtimeConfig.socialModelSynthesis !== undefined) {
    stages.push('socialModelSynthesis');
  }
  return stages;
}

export function deriveRequiredCognitionLlmProfileContextStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileCognitionLlmStageName[] {
  if (runtimeConfig === undefined) {
    return [];
  }

  const stages: RuntimeProfileCognitionLlmStageName[] = [];
  if (runtimeConfig.strategicPlanning !== undefined) {
    stages.push('strategicPlanning');
  }
  if (runtimeConfig.reflectionSynthesis !== undefined) {
    stages.push('reflectionSynthesis');
  }
  if (runtimeConfig.socialModelSynthesis !== undefined) {
    stages.push('socialModelSynthesis');
  }
  return stages;
}

export function deriveRequiredCognitionLlmObservedStateStagesFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): readonly RuntimeProfileCognitionLlmStageName[] {
  return deriveRequiredCognitionLlmAcceptedStagesFromRuntimeConfig(runtimeConfig);
}

export function deriveMinimumCognitionLlmOutputArtifactCountsFromRuntimeConfig(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): Readonly<Partial<Record<RuntimeProfileCognitionLlmStageName, number>>> {
  if (runtimeConfig === undefined) {
    return {};
  }

  const minimumCounts: Partial<Record<RuntimeProfileCognitionLlmStageName, number>> = {};
  if (runtimeConfig.reflectionSynthesis !== undefined) {
    minimumCounts.reflectionSynthesis = 1;
  }
  if (runtimeConfig.socialModelSynthesis !== undefined) {
    minimumCounts.socialModelSynthesis = 1;
  }
  return minimumCounts;
}

export function listLocalRuntimeTownProfileGatePartitionKeys(
  profileId: LocalRuntimeTownDaemonScenarioProfileId,
): readonly PartitionKey[] {
  return createLocalRuntimeTownDaemonScenarioProfile(profileId).manifest.partitions.map(
    (partition) => partition.partitionKey,
  );
}
