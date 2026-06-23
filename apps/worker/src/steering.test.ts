import {
  InMemoryAgentIntentionRepository,
  InMemoryShortTermMemoryRepository,
} from '@aivilization/memory';
import { createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { handleWorkerSteeringCommand } from './index';

describe('worker steering ingress', () => {
  test('persists SetLongHorizonObjective as agent intention state', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const command = createCommandEnvelope({
      id: 'cmd-objective-study',
      simulationId: 'sim-1',
      actorId: 'agent-1',
      source: 'human',
      type: 'SetLongHorizonObjective',
      payload: {
        objectiveId: 'objective-study',
        statement: 'Study before high-tech production.',
        priority: 2,
        affinityTags: ['study', 'education'],
      },
      issuedAt: 100,
    });

    const result = await handleWorkerSteeringCommand({
      command,
      intentionRepository,
      shortTermMemoryRepository,
      localizedPlanners: [],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    await expect(intentionRepository.getOrCreate(command.actorId!)).resolves.toMatchObject({
      activeObjective: {
        id: 'objective-study',
        statement: 'Study before high-tech production.',
        priority: 2,
        source: 'human',
        affinityTags: ['study', 'education'],
        createdAt: 100,
        updatedAt: 100,
      },
    });
    expect(result).toMatchObject({
      kind: 'long-horizon-objective-set',
      commandDrafts: [],
      shortTermMemoryRecords: [],
    });
  });

  test('routes IssueReactiveCommand through runtime and appends STM records', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const command = createCommandEnvelope({
      id: 'cmd-reactive-buy-fish',
      simulationId: 'sim-1',
      actorId: 'agent-1',
      source: 'human',
      type: 'IssueReactiveCommand',
      payload: {
        reactiveCommandId: 'reactive-buy-fish',
        summary: 'buy 10 fish now',
        tags: ['trade', 'fish'],
      },
      issuedAt: 200,
    });

    const result = await handleWorkerSteeringCommand({
      command,
      intentionRepository,
      shortTermMemoryRepository,
      localizedPlanners: [
        {
          domain: 'trade',
          supports: ({ summary }) => summary.includes('fish'),
          propose: () => [
            {
              id: 'buy-fish',
              description: 'buy 10 fish',
              commandType: 'AgentTrade',
              payload: { side: 'buy', commodityName: 'Fish', quantity: 10 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.kind).toBe('reactive-command-routed');
    expect(result.commandDrafts).toHaveLength(1);
    await expect(
      shortTermMemoryRepository.retrieve({
        agentId: command.actorId!,
        kinds: ['human-command'],
        requiredTags: ['reactive'],
        limit: 10,
      }),
    ).resolves.toHaveLength(2);
  });

  test('rejects steering commands without an actor agent', async () => {
    const command = createCommandEnvelope({
      id: 'cmd-objective-no-actor',
      simulationId: 'sim-1',
      source: 'human',
      type: 'SetLongHorizonObjective',
      payload: { statement: 'Study.' },
      issuedAt: 100,
    });

    await expect(
      handleWorkerSteeringCommand({
        command,
        intentionRepository: new InMemoryAgentIntentionRepository(),
        shortTermMemoryRepository: new InMemoryShortTermMemoryRepository(),
        localizedPlanners: [],
        simulate: ({ action }) => ({ status: 'accepted', action }),
      }),
    ).rejects.toThrow(/requires actorId/);
  });
});
