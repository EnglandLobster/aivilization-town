import { aivilizationAblationScenarioPreset } from '@aivilization/content';
import {
  InMemoryLongTermProfileRepository,
  createEmptyLongTermAgentProfile,
} from '@aivilization/memory';
import { describe, expect, test } from 'vitest';
import { seedLongTermProfilesFromScenario } from './index';

describe('scenario profile seeding', () => {
  test('seeds deterministic MBTI entries for scenario agents', async () => {
    const repository = new InMemoryLongTermProfileRepository();
    const result = await seedLongTermProfilesFromScenario({
      preset: aivilizationAblationScenarioPreset,
      repository,
      seededAt: 0,
    });

    await expect(
      repository.getOrCreate(aivilizationAblationScenarioPreset.agentSeeds[0]!.agentId),
    ).resolves.toMatchObject({
      personality: [
        {
          key: 'initial-mbti',
          statement: 'MBTI: INTJ.',
          confidence: 1,
          updatedAt: 0,
          provenanceRecordIds: [],
        },
      ],
    });
    expect(result).toEqual({
      seededAgentIds: aivilizationAblationScenarioPreset.agentSeeds.map((agent) => agent.agentId),
      skippedAgentIds: [],
    });
  });

  test('skips agents that already have initial MBTI profile entries', async () => {
    const repository = new InMemoryLongTermProfileRepository();
    const [firstAgent, secondAgent] = aivilizationAblationScenarioPreset.agentSeeds;
    if (firstAgent === undefined || secondAgent === undefined) {
      throw new Error('expected ablation scenario agents');
    }
    await repository.save({
      ...createEmptyLongTermAgentProfile(firstAgent.agentId),
      personality: [
        {
          key: 'initial-mbti',
          statement: 'MBTI: CUSTOM.',
          confidence: 0.5,
          updatedAt: 99,
          provenanceRecordIds: [],
        },
        {
          key: 'evolved-style',
          statement: 'Prefers cooperative planning.',
          confidence: 0.8,
          updatedAt: 100,
          provenanceRecordIds: [],
        },
      ],
    });

    const result = await seedLongTermProfilesFromScenario({
      preset: {
        ...aivilizationAblationScenarioPreset,
        agentSeeds: [firstAgent, secondAgent],
      },
      repository,
      seededAt: 0,
    });

    const firstProfile = await repository.getOrCreate(firstAgent.agentId);
    expect(firstProfile.personality).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'evolved-style',
          statement: 'Prefers cooperative planning.',
        }),
        expect.objectContaining({
          key: 'initial-mbti',
          statement: 'MBTI: CUSTOM.',
          updatedAt: 99,
        }),
      ]),
    );
    await expect(repository.getOrCreate(secondAgent.agentId)).resolves.toMatchObject({
      personality: [
        {
          key: 'initial-mbti',
          statement: 'MBTI: INTJ.',
          updatedAt: 0,
        },
      ],
    });
    expect(result).toEqual({
      seededAgentIds: [secondAgent.agentId],
      skippedAgentIds: [firstAgent.agentId],
    });
  });
});
