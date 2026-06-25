import type { RuntimeProfileRunGateCriteria } from '@aivilization/observability';
import type { PartitionKey } from '@aivilization/sim-core';
import { createLocalRuntimeTownDaemonScenarioProfile } from './localRuntimeTownScenarioProfile';
import type { LocalRuntimeTownDaemonScenarioProfileId } from './localRuntimeTownScenarioProfile';

export type LocalRuntimeTownProfileGateCriteriaInput = {
  readonly minimumCompletedCycleCount?: number;
  readonly minimumTotalEventCount?: number;
  readonly minimumTotalAgentTraceCount?: number;
  readonly minimumFullReplanMaterializationCount?: number;
};

export function createLocalRuntimeTownProfileGateCriteria(
  profileId: LocalRuntimeTownDaemonScenarioProfileId,
  input: LocalRuntimeTownProfileGateCriteriaInput = {},
): RuntimeProfileRunGateCriteria {
  const profile = createLocalRuntimeTownDaemonScenarioProfile(profileId);
  const agentCountByPresetId = new Map(
    profile.scenarioPresets.map((preset) => [preset.id, preset.agentSeeds.length]),
  );
  const expectedProjectionAgentCountByPartition: Record<string, number> = {};

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
    minimumFullReplanMaterializationCount: input.minimumFullReplanMaterializationCount ?? 0,
    requiredDaemonHealth: 'healthy',
    requiredOutcome: 'succeeded',
    requiredStopReason: 'cycle-count-completed',
    allowedPartitionStatuses: ['completed', 'succeeded'],
    requiredPartitionHealth: 'healthy',
    requireStreamVersionMatchesEventCount: true,
    expectedProjectionAgentCountByPartition,
  };
}

export function listLocalRuntimeTownProfileGatePartitionKeys(
  profileId: LocalRuntimeTownDaemonScenarioProfileId,
): readonly PartitionKey[] {
  return createLocalRuntimeTownDaemonScenarioProfile(profileId).manifest.partitions.map(
    (partition) => partition.partitionKey,
  );
}
