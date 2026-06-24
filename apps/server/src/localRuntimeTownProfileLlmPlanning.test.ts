import { normalizeStrategicPlanCompilerOutput } from '@aivilization/agent-runtime';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createLocalRuntimeTownProfileStrategicPlanCompiler } from './localRuntimeTownProfileLlmPlanning';

describe('local runtime town profile LLM planning config', () => {
  test('creates a traceable strategic compiler from scripted provider config', async () => {
    const compiler = createLocalRuntimeTownProfileStrategicPlanCompiler({
      kind: 'traceable-llm-strategic-planner',
      profileId: 'smoke-25',
      model: 'profile-planner-model',
      maxAttempts: 2,
      timeoutMs: 1_000,
      pricing: {
        inputTokenCostMicros: 2,
        outputTokenCostMicros: 3,
      },
      provider: {
        kind: 'scripted',
        providerId: 'scripted-profile-planner',
        responses: [
          {
            providerId: 'scripted-profile-planner',
            model: 'profile-planner-model',
            content: JSON.stringify({
              objective: 'Build a bakery business.',
              branches: [
                {
                  id: 'production',
                  objective: 'Produce bakery inputs.',
                  subtasks: [
                    {
                      id: 'source-grain',
                      description: 'Produce Wheat for future baking.',
                      basePriority: 2,
                      memoryAffinityTags: ['production'],
                    },
                  ],
                },
              ],
            }),
            finishReason: 'stop',
            usage: {
              inputTokens: 7,
              outputTokens: 11,
            },
          },
        ],
      },
    });

    expect(compiler).not.toBeUndefined();
    if (compiler === undefined) {
      throw new Error('expected LLM strategic compiler');
    }
    const compiled = normalizeStrategicPlanCompilerOutput(
      await compiler({
        objective: {
          id: 'objective-bakery',
          agentId: asAgentId('agent-1'),
          statement: 'Build a bakery business.',
          priority: 2,
          source: 'agent',
          affinityTags: ['production'],
          createdAt: 100,
          updatedAt: 100,
        },
        issuedAt: 333,
      }),
    );

    expect(compiled.plan.branches).toHaveLength(1);
    expect(compiled.plan.branches[0]?.id).toBe('production');
    expect(compiled.planningTrace).toEqual({
      status: 'accepted',
      source: 'llm',
      requestId: 'profile-llm-plan:smoke-25:agent-1:objective-bakery:333',
      providerId: 'scripted-profile-planner',
      model: 'profile-planner-model',
      attempts: [
        {
          attemptIndex: 1,
          status: 'succeeded',
          providerId: 'scripted-profile-planner',
          model: 'profile-planner-model',
          message: 'LLM structured response validated',
          usage: {
            inputTokens: 7,
            outputTokens: 11,
            totalTokens: 18,
            estimatedCostMicros: 47,
          },
        },
      ],
      usage: {
        inputTokens: 7,
        outputTokens: 11,
        totalTokens: 18,
        estimatedCostMicros: 47,
      },
    });
  });

  test('keeps deterministic planning as the default when config is absent', () => {
    expect(createLocalRuntimeTownProfileStrategicPlanCompiler(undefined)).toBeUndefined();
  });

  test('rejects invalid provider configuration before runtime use', () => {
    expect(() =>
      createLocalRuntimeTownProfileStrategicPlanCompiler({
        kind: 'traceable-llm-strategic-planner',
        profileId: 'smoke-25',
        model: 'profile-planner-model',
        provider: {
          kind: 'scripted',
          providerId: ' ',
          responses: [],
        },
      }),
    ).toThrow('providerId must not be empty');
  });
});
