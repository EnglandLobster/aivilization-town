import {
  normalizeDailyPlanCompilerOutput,
  normalizeReactionEvaluatorOutput,
  normalizeStrategicPlanCompilerOutput,
} from '@aivilization/agent-runtime';
import { createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId, asEventId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createLocalRuntimeTownProfileDailyPlanCompiler,
  createLocalRuntimeTownProfileReactionEvaluator,
  createLocalRuntimeTownProfileStrategicPlanCompiler,
} from './localRuntimeTownProfileLlmPlanning';

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

  test('creates a traceable daily compiler from scripted provider config', async () => {
    const compiler = createLocalRuntimeTownProfileDailyPlanCompiler({
      kind: 'traceable-llm-daily-planner',
      profileId: 'smoke-25',
      model: 'profile-daily-model',
      maxAttempts: 2,
      timeoutMs: 1_000,
      pricing: {
        inputTokenCostMicros: 2,
        outputTokenCostMicros: 3,
      },
      provider: {
        kind: 'scripted',
        providerId: 'scripted-profile-daily-planner',
        responses: [
          {
            providerId: 'scripted-profile-daily-planner',
            model: 'profile-daily-model',
            content: JSON.stringify({
              id: 'daily-plan:agent-1:0',
              agentId: 'agent-1',
              dayStart: 0,
              generatedAt: 333,
              summary: 'Coordinate the day around a party memory.',
              items: [
                {
                  id: 'party-follow-up',
                  description: 'Coordinate party invitations at town square.',
                  priority: 5,
                  startsAtOffsetMs: 8 * 60 * 60 * 1000,
                  endsAtOffsetMs: 10 * 60 * 60 * 1000,
                  affinityTags: ['social', 'party', 'town-square'],
                  source: 'memory-context',
                },
              ],
            }),
            finishReason: 'stop',
            usage: {
              inputTokens: 9,
              outputTokens: 13,
            },
          },
        ],
      },
    });

    expect(compiler).not.toBeUndefined();
    if (compiler === undefined) {
      throw new Error('expected LLM daily compiler');
    }
    const compiled = normalizeDailyPlanCompilerOutput(
      await compiler({
        agentId: asAgentId('agent-1'),
        issuedAt: 333,
      }),
    );

    expect(compiled.plan.items).toEqual([
      expect.objectContaining({
        id: 'party-follow-up',
        description: 'Coordinate party invitations at town square.',
        priority: 5,
      }),
    ]);
    expect(compiled.planningTrace).toEqual({
      status: 'accepted',
      source: 'llm',
      requestId: 'profile-llm-daily-plan:smoke-25:agent-1:333',
      providerId: 'scripted-profile-daily-planner',
      model: 'profile-daily-model',
      attempts: [
        {
          attemptIndex: 1,
          status: 'succeeded',
          providerId: 'scripted-profile-daily-planner',
          model: 'profile-daily-model',
          message: 'LLM structured response validated',
          usage: {
            inputTokens: 9,
            outputTokens: 13,
            totalTokens: 22,
            estimatedCostMicros: 57,
          },
        },
      ],
      usage: {
        inputTokens: 9,
        outputTokens: 13,
        totalTokens: 22,
        estimatedCostMicros: 57,
      },
    });
  });

  test('creates a traceable reaction evaluator from scripted provider config', async () => {
    const evaluator = createLocalRuntimeTownProfileReactionEvaluator({
      kind: 'traceable-llm-reaction-evaluator',
      profileId: 'smoke-25',
      model: 'profile-reaction-model',
      maxAttempts: 2,
      timeoutMs: 1_000,
      pricing: {
        inputTokenCostMicros: 2,
        outputTokenCostMicros: 3,
      },
      provider: {
        kind: 'scripted',
        providerId: 'scripted-profile-reaction',
        responses: [
          {
            providerId: 'scripted-profile-reaction',
            model: 'profile-reaction-model',
            content: JSON.stringify({
              kind: 'ignore',
              confidence: 0.77,
              rationale: 'The agent heard the event but should not follow up now.',
            }),
            finishReason: 'stop',
            usage: {
              inputTokens: 5,
              outputTokens: 7,
            },
          },
        ],
      },
    });

    expect(evaluator).not.toBeUndefined();
    if (evaluator === undefined) {
      throw new Error('expected LLM reaction evaluator');
    }
    const evaluated = normalizeReactionEvaluatorOutput(
      await evaluator({
        agentId: asAgentId('agent-1'),
        issuedAt: 333,
        memory: createShortTermMemoryRecord({
          id: 'memory-party-observation',
          agentId: asAgentId('agent-1'),
          kind: 'observation',
          status: 'observed',
          summary: 'Observed agent-2 and agent-3 discuss a party.',
          occurredAt: 320,
          importanceScore: 0.7,
          source: { eventIds: [asEventId('event-party')] },
          tags: ['ambient-observation', 'ConversationRecorded', 'party'],
        }),
      }),
    );

    expect(evaluated).toEqual({
      decision: {
        kind: 'ignore',
        confidence: 0.77,
        rationale: 'The agent heard the event but should not follow up now.',
      },
      reactionTrace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'profile-llm-reaction:smoke-25:agent-1:memory-party-observation:333',
        providerId: 'scripted-profile-reaction',
        model: 'profile-reaction-model',
        attempts: [
          {
            attemptIndex: 1,
            status: 'succeeded',
            providerId: 'scripted-profile-reaction',
            model: 'profile-reaction-model',
            message: 'LLM structured response validated',
            usage: {
              inputTokens: 5,
              outputTokens: 7,
              totalTokens: 12,
              estimatedCostMicros: 31,
            },
          },
        ],
        usage: {
          inputTokens: 5,
          outputTokens: 7,
          totalTokens: 12,
          estimatedCostMicros: 31,
        },
      },
    });
  });

  test('keeps deterministic planning as the default when config is absent', () => {
    expect(createLocalRuntimeTownProfileStrategicPlanCompiler(undefined)).toBeUndefined();
    expect(createLocalRuntimeTownProfileDailyPlanCompiler(undefined)).toBeUndefined();
    expect(createLocalRuntimeTownProfileReactionEvaluator(undefined)).toBeUndefined();
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
