import type { ScenarioPreset } from '@aivilization/content';
import type {
  LongTermAgentProfile,
  LongTermProfileRepository,
} from '@aivilization/memory';
import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';

export type ScenarioProfileSeedingInput = {
  readonly preset: ScenarioPreset;
  readonly repository: LongTermProfileRepository;
  readonly seededAt: SimulationTimestamp;
};

export type ScenarioProfileSeedingResult = {
  readonly seededAgentIds: readonly AgentId[];
  readonly skippedAgentIds: readonly AgentId[];
};

const INITIAL_MBTI_PROFILE_KEY = 'initial-mbti';

export async function seedLongTermProfilesFromScenario(
  input: ScenarioProfileSeedingInput,
): Promise<ScenarioProfileSeedingResult> {
  const seededAgentIds: AgentId[] = [];
  const skippedAgentIds: AgentId[] = [];

  for (const agent of input.preset.agentSeeds) {
    const profile = await input.repository.getOrCreate(agent.agentId);
    if (hasInitialMbtiEntry(profile)) {
      skippedAgentIds.push(agent.agentId);
      continue;
    }

    await input.repository.save({
      ...profile,
      personality: [
        ...profile.personality,
        {
          key: INITIAL_MBTI_PROFILE_KEY,
          statement: `MBTI: ${agent.profile.personality.mbti}.`,
          confidence: 1,
          updatedAt: input.seededAt,
          provenanceRecordIds: [],
        },
      ].sort((left, right) => left.key.localeCompare(right.key)),
    });
    seededAgentIds.push(agent.agentId);
  }

  return { seededAgentIds, skippedAgentIds };
}

function hasInitialMbtiEntry(profile: LongTermAgentProfile): boolean {
  return profile.personality.some((entry) => entry.key === INITIAL_MBTI_PROFILE_KEY);
}
