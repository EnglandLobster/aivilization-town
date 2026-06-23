import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createEmptyAgentIntentionState,
  InMemoryAgentIntentionRepository,
  type LongHorizonObjective,
  type ScheduledIntention,
} from './index';

describe('agent intention repository', () => {
  test('gets or creates empty intention state for an agent', async () => {
    const repository = new InMemoryAgentIntentionRepository();

    await expect(repository.getOrCreate(asAgentId('agent-1'))).resolves.toEqual(
      createEmptyAgentIntentionState(asAgentId('agent-1')),
    );
  });

  test('clones saved state at repository boundaries', async () => {
    const agentId = asAgentId('agent-1');
    const repository = new InMemoryAgentIntentionRepository();
    const mutableTags = ['study'];
    const schedule: ScheduledIntention = {
      id: 'study-block',
      agentId,
      description: 'Study quietly.',
      priority: 2,
      startsAt: 100,
      endsAt: 200,
      status: 'planned',
      affinityTags: mutableTags,
      createdAt: 10,
      updatedAt: 10,
    };

    await repository.save({
      agentId,
      updatedAt: 10,
      scheduledIntentions: [schedule],
    });
    mutableTags.push('external-mutation');

    const firstRead = await repository.getOrCreate(agentId);
    expect(firstRead.scheduledIntentions[0]?.affinityTags).toEqual(['study']);

    const mutableReadTags = firstRead.scheduledIntentions[0]?.affinityTags as string[] | undefined;
    mutableReadTags?.push('read-mutation');

    await expect(repository.getOrCreate(agentId)).resolves.toEqual({
      agentId: 'agent-1',
      updatedAt: 10,
      scheduledIntentions: [
        {
          ...schedule,
          affinityTags: ['study'],
        },
      ],
    });
  });

  test('persists objective and schedule updates', async () => {
    const agentId = asAgentId('agent-1');
    const repository = new InMemoryAgentIntentionRepository();
    const objective: LongHorizonObjective = {
      id: 'objective-study',
      agentId,
      statement: 'Study before high-tech work.',
      priority: 2,
      source: 'human',
      affinityTags: ['study'],
      createdAt: 10,
      updatedAt: 20,
    };

    await repository.setObjective(agentId, objective);
    await repository.upsertScheduledIntentions(agentId, [
      {
        id: 'study-block',
        agentId,
        objectiveId: objective.id,
        description: 'Study now.',
        priority: 1,
        startsAt: 100,
        endsAt: 200,
        status: 'planned',
        affinityTags: ['study'],
        createdAt: 30,
        updatedAt: 30,
      },
    ]);

    await expect(repository.getOrCreate(agentId)).resolves.toMatchObject({
      activeObjective: objective,
      scheduledIntentions: [{ id: 'study-block' }],
      updatedAt: 30,
    });
  });
});
