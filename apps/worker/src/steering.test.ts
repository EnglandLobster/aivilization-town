import {
  createBranchPlan,
  InMemoryBranchPlanRepository,
  type StrategicPlanCompilationTrace,
} from '@aivilization/agent-runtime';
import {
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
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
      shortTermMemoryRecords: [
        {
          id: 'cmd-objective-study:strategic-objective',
          kind: 'human-command',
          status: 'observed',
          summary: 'Human steering set long-horizon objective: Study before high-tech production.',
          occurredAt: 100,
          importanceScore: 0.9,
          source: {
            commandId: 'cmd-objective-study',
            eventIds: [],
          },
          tags: ['steering', 'strategic', 'long-horizon-objective', 'study', 'education'],
        },
      ],
    });
    await expect(
      shortTermMemoryRepository.retrieve({
        agentId: command.actorId!,
        kinds: ['human-command'],
        requiredTags: ['strategic', 'long-horizon-objective'],
        limit: 10,
      }),
    ).resolves.toMatchObject([
      {
        id: 'cmd-objective-study:strategic-objective',
        summary: 'Human steering set long-horizon objective: Study before high-tech production.',
      },
    ]);
  });

  test('applies human-set objectives into long-term profile values when repository is available', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
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
      longTermProfileRepository,
      shortTermMemoryRepository,
      localizedPlanners: [],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    if (result.kind !== 'long-horizon-objective-set') {
      throw new Error('expected long horizon objective result');
    }
    expect(result.longTermMemoryPatches).toEqual([
      {
        id: 'ltm-patch-agent-1-steering-value-human-objective-objective-study-100',
        agentId: 'agent-1',
        section: 'values',
        key: 'human-objective:objective-study',
        statement: 'Human steering set long-horizon objective: Study before high-tech production.',
        confidence: 0.95,
        provenanceRecordIds: ['cmd-objective-study:strategic-objective'],
        proposedAt: 100,
      },
    ]);
    await expect(longTermProfileRepository.getOrCreate(command.actorId!)).resolves.toMatchObject({
      values: [
        {
          key: 'human-objective:objective-study',
          statement:
            'Human steering set long-horizon objective: Study before high-tech production.',
          confidence: 0.95,
          updatedAt: 100,
          provenanceRecordIds: ['cmd-objective-study:strategic-objective'],
        },
      ],
    });
    expect(result.longTermProfile).toMatchObject({
      values: [
        {
          key: 'human-objective:objective-study',
          provenanceRecordIds: ['cmd-objective-study:strategic-objective'],
        },
      ],
    });
  });

  test('compiles SetLongHorizonObjective into a durable branch plan when repository is provided', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const command = createCommandEnvelope({
      id: 'cmd-objective-study',
      simulationId: 'sim-1',
      actorId: 'agent-1',
      source: 'human',
      type: 'SetLongHorizonObjective',
      payload: {
        objectiveId: 'objective-study',
        statement: 'Do not work yet; study until education score exceeds 100.',
        priority: 2,
        affinityTags: ['study', 'education'],
      },
      issuedAt: 100,
    });

    const result = await handleWorkerSteeringCommand({
      command,
      intentionRepository,
      shortTermMemoryRepository,
      planRepository,
      localizedPlanners: [],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    if (result.kind !== 'long-horizon-objective-set') {
      throw new Error('expected long horizon objective result');
    }
    await expect(
      planRepository.require({
        planId: 'objective-study',
        agentId: command.actorId!,
      }),
    ).resolves.toEqual(result.planRecord);
    expect(result).toMatchObject({
      kind: 'long-horizon-objective-set',
      planRecord: {
        planId: 'objective-study',
        agentId: command.actorId,
        createdAt: 100,
        updatedAt: 100,
        plan: {
          objective: 'Do not work yet; study until education score exceeds 100.',
        },
      },
      commandDrafts: [],
      shortTermMemoryRecords: [
        {
          id: 'cmd-objective-study:strategic-objective',
        },
      ],
    });
    expect(result.planRecord?.plan.branches.map((branch) => branch.id)).toEqual(['development']);
  });

  test('persists traceable strategic compiler evidence for human-set objective plans', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
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
    const planningTrace = createPlanningTrace('steering-llm-plan-objective-study');

    const result = await handleWorkerSteeringCommand({
      command,
      intentionRepository,
      shortTermMemoryRepository,
      planRepository,
      strategicPlanCompiler: ({ objective }) => ({
        plan: createBranchPlan({
          objective: objective.statement,
          branches: [
            {
              id: 'llm-development',
              objective: 'Use an LLM-proposed steering route.',
              subtasks: [
                {
                  id: 'study',
                  description: 'Study via steering LLM plan.',
                  basePriority: 12,
                },
              ],
            },
          ],
        }),
        planningTrace,
      }),
      localizedPlanners: [],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    if (result.kind !== 'long-horizon-objective-set') {
      throw new Error('expected long horizon objective result');
    }
    expect(result.planRecord?.planningTrace).toEqual(planningTrace);
    await expect(
      planRepository.require({
        planId: 'objective-study',
        agentId: command.actorId!,
      }),
    ).resolves.toMatchObject({
      planningTrace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'steering-llm-plan-objective-study',
        providerId: 'scripted-planner',
        model: 'planner-model',
      },
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

function createPlanningTrace(requestId: string): StrategicPlanCompilationTrace {
  return {
    status: 'accepted',
    source: 'llm',
    requestId,
    providerId: 'scripted-planner',
    model: 'planner-model',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      estimatedCostMicros: 70,
    },
    attempts: [
      {
        attemptIndex: 1,
        status: 'succeeded',
        providerId: 'scripted-planner',
        model: 'planner-model',
        message: 'LLM structured response validated',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          estimatedCostMicros: 70,
        },
      },
    ],
  };
}
