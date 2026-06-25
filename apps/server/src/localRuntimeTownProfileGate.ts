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
  readonly runtimeConfig?: LocalRuntimeTownProfileRuntimeConfig;
  readonly requiredAgentCycleLlmAcceptedStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmWorldContextStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmMemoryContextStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmProfileContextStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredCognitionLlmAcceptedStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmWorldContextStages?: readonly RuntimeProfileCognitionLlmStageName[];
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
  const requiredAgentCycleLlmWorldContextStages =
    input.requiredAgentCycleLlmWorldContextStages ??
    deriveRequiredAgentCycleLlmWorldContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredAgentCycleLlmMemoryContextStages =
    input.requiredAgentCycleLlmMemoryContextStages ??
    deriveRequiredAgentCycleLlmMemoryContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredAgentCycleLlmProfileContextStages =
    input.requiredAgentCycleLlmProfileContextStages ??
    deriveRequiredAgentCycleLlmProfileContextStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredCognitionLlmAcceptedStages =
    input.requiredCognitionLlmAcceptedStages ??
    deriveRequiredCognitionLlmAcceptedStagesFromRuntimeConfig(input.runtimeConfig);
  const requiredCognitionLlmWorldContextStages =
    input.requiredCognitionLlmWorldContextStages ??
    deriveRequiredCognitionLlmWorldContextStagesFromRuntimeConfig(input.runtimeConfig);

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
    ...(requiredAgentCycleLlmWorldContextStages.length === 0
      ? {}
      : { requiredAgentCycleLlmWorldContextStages }),
    ...(requiredAgentCycleLlmMemoryContextStages.length === 0
      ? {}
      : { requiredAgentCycleLlmMemoryContextStages }),
    ...(requiredAgentCycleLlmProfileContextStages.length === 0
      ? {}
      : { requiredAgentCycleLlmProfileContextStages }),
    ...(requiredCognitionLlmAcceptedStages.length === 0
      ? {}
      : { requiredCognitionLlmAcceptedStages }),
    ...(requiredCognitionLlmWorldContextStages.length === 0
      ? {}
      : { requiredCognitionLlmWorldContextStages }),
  };
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

export function deriveRequiredAgentCycleLlmWorldContextStagesFromRuntimeConfig(
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

export function listLocalRuntimeTownProfileGatePartitionKeys(
  profileId: LocalRuntimeTownDaemonScenarioProfileId,
): readonly PartitionKey[] {
  return createLocalRuntimeTownDaemonScenarioProfile(profileId).manifest.partitions.map(
    (partition) => partition.partitionKey,
  );
}
