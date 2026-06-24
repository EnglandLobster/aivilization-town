import { createScriptedLlmProvider } from '@aivilization/llm';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createLlmStrategicPlanCompiler,
  llmStrategicBranchPlanSchema,
  proposeStrategicBranchPlanWithLlm,
} from './llmStrategicPlanner';

const agentId = asAgentId('agent-1');

describe('LLM strategic planner seam', () => {
  test('accepts a structured LLM branch-plan proposal after schema and branch-plan validation', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planner-model',
          finishReason: 'stop',
          usage: { inputTokens: 30, outputTokens: 45 },
          content: JSON.stringify({
            objective: 'Build a bakery business.',
            branches: [
              {
                id: 'production',
                objective: 'Prepare bakery goods for market.',
                subtasks: [
                  {
                    id: 'produce-bread',
                    description: 'Bake bread for the bakery shelf.',
                    basePriority: 13,
                    signalKeys: ['production', 'trade'],
                    intentionAffinityTags: ['production'],
                    memoryAffinityTags: ['production'],
                    profileAffinityTags: ['production'],
                  },
                  {
                    id: 'sell-bread',
                    description: 'Sell bread through the local market.',
                    basePriority: 11,
                    dependsOnSubtaskIds: ['produce-bread'],
                    signalKeys: ['trade'],
                    intentionAffinityTags: ['trade'],
                    memoryAffinityTags: ['trade'],
                    profileAffinityTags: ['trade'],
                  },
                ],
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeStrategicBranchPlanWithLlm({
      objective: objective('Build a bakery business.', ['production', 'trade']),
      issuedAt: 100,
      provider: scripted.provider,
      model: 'planner-model',
      requestId: 'llm-plan-agent-1-100',
      maxAttempts: 1,
      pricing: {
        inputTokenCostMicros: 2,
        outputTokenCostMicros: 3,
      },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      source: 'llm',
      plan: {
        objective: 'Build a bakery business.',
        branches: [
          {
            id: 'production',
            objective: 'Prepare bakery goods for market.',
            subtasks: [
              {
                id: 'produce-bread',
                description: 'Bake bread for the bakery shelf.',
                basePriority: 13,
              },
              {
                id: 'sell-bread',
                dependsOnSubtaskIds: ['produce-bread'],
                description: 'Sell bread through the local market.',
                basePriority: 11,
              },
            ],
          },
        ],
      },
      gateway: {
        status: 'succeeded',
        requestId: 'llm-plan-agent-1-100',
        usage: {
          inputTokens: 30,
          outputTokens: 45,
          totalTokens: 75,
          estimatedCostMicros: 195,
        },
      },
    });

    const [providerRequest] = scripted.getRequests();
    expect(providerRequest).toMatchObject({
      requestId: 'llm-plan-agent-1-100',
      model: 'planner-model',
      schemaName: 'aivilization_branch_plan',
    });
    expect(providerRequest?.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(providerRequest?.messages[1]?.content).toContain('Build a bakery business.');
    const [tool] = providerRequest?.tools ?? [];
    expect(providerRequest?.tools).toHaveLength(1);
    expect(tool?.name).toBe('submit_branch_plan');
    expect(tool?.description).toContain('Branch-Thinking');
    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['objective', 'branches'],
    });
  });

  test('falls back to deterministic strategic planning when LLM output is invalid', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planner-model',
          finishReason: 'stop',
          content: JSON.stringify({
            objective: 'Study for a credential.',
            branches: [],
          }),
        },
      ],
    });

    const result = await proposeStrategicBranchPlanWithLlm({
      objective: objective('Study for a credential.', ['study']),
      issuedAt: 200,
      provider: scripted.provider,
      model: 'planner-model',
      requestId: 'llm-plan-invalid',
    });

    expect(result).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      failure: {
        status: 'failed',
        reason: 'schema-invalid',
        requestId: 'llm-plan-invalid',
      },
      plan: {
        objective: 'Study for a credential.',
        branches: [
          {
            id: 'development',
            subtasks: [
              {
                id: 'study',
                description: 'Study toward the long-horizon objective.',
              },
            ],
          },
        ],
      },
    });
  });

  test('rejects branch-plan invariant violations inside the LLM schema parser', () => {
    expect(
      llmStrategicBranchPlanSchema.parse({
        objective: 'Coordinate dependent work.',
        branches: [
          {
            id: 'work',
            objective: 'Do the dependent task first.',
            subtasks: [
              {
                id: 'dependent-task',
                description: 'Run before its prerequisite.',
                basePriority: 8,
                dependsOnSubtaskIds: ['prerequisite-task'],
              },
              {
                id: 'prerequisite-task',
                description: 'Prepare the dependency.',
                basePriority: 7,
              },
            ],
          },
        ],
      }),
    ).toEqual({
      status: 'invalid',
      reason:
        'branch plan candidate invalid: dependency prerequisite-task must appear earlier in branch work',
    });
  });

  test('creates a StrategicPlanCompiler-compatible LLM compiler', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planner-model',
          finishReason: 'stop',
          content: JSON.stringify({
            objective: 'Recover energy.',
            branches: [
              {
                id: 'rest',
                objective: 'Sleep before taking more actions.',
                subtasks: [
                  {
                    id: 'sleep',
                    description: 'Take a sleep cycle.',
                    basePriority: 12,
                    signalKeys: ['sleep'],
                    intentionAffinityTags: ['sleep'],
                    memoryAffinityTags: ['sleep'],
                    profileAffinityTags: ['sleep'],
                  },
                ],
              },
            ],
          }),
        },
      ],
    });
    const compiler = createLlmStrategicPlanCompiler({
      provider: scripted.provider,
      model: 'planner-model',
      requestId: ({ objective, issuedAt }) => `${objective.id}:${issuedAt}`,
    });

    await expect(
      compiler({
        objective: objective('Recover energy.', ['sleep']),
        issuedAt: 300,
      }),
    ).resolves.toMatchObject({
      objective: 'Recover energy.',
      branches: [
        {
          id: 'rest',
          subtasks: [{ id: 'sleep', description: 'Take a sleep cycle.' }],
        },
      ],
    });
    expect(scripted.getRequests()[0]?.requestId).toBe('objective-1:300');
  });
});

function objective(statement: string, affinityTags: readonly string[]) {
  return {
    id: 'objective-1',
    agentId,
    statement,
    priority: 3,
    source: 'agent' as const,
    affinityTags,
    createdAt: 100,
    updatedAt: 100,
  };
}
