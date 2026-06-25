import {
  createBranchPlan,
  normalizeDailyPlanCompilerOutput,
  normalizeReactionEvaluatorOutput,
  normalizeStrategicPlanCompilerOutput,
  scorePrioritizedSubtaskCandidates,
  synthesizeActionCandidates,
} from '@aivilization/agent-runtime';
import { createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId, asEventId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createLocalRuntimeTownProfileActionSequenceGenerator,
  createLocalRuntimeTownProfileDailyPlanCompiler,
  createLocalRuntimeTownProfileGlobalSynthesizer,
  createLocalRuntimeTownProfileReactionEvaluator,
  createLocalRuntimeTownProfileReactiveCorrector,
  createLocalRuntimeTownProfileStrategicPlanCompiler,
  createLocalRuntimeTownProfileSubtaskPrioritizer,
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

  test('creates traceable agent-cycle LLM stages from scripted provider config', async () => {
    const plan = createBranchPlan({
      objective: 'Balance recovery and income.',
      branches: [
        {
          id: 'income',
          objective: 'Earn currency.',
          subtasks: [{ id: 'work', description: 'Work a cleaner shift.', basePriority: 4 }],
        },
        {
          id: 'recovery',
          objective: 'Restore satiety.',
          subtasks: [{ id: 'eat', description: 'Eat available Fish.', basePriority: 2 }],
        },
      ],
    });
    const candidates = scorePrioritizedSubtaskCandidates({ plan, signals: [] });

    const prioritizer = createLocalRuntimeTownProfileSubtaskPrioritizer({
      kind: 'traceable-llm-subtask-prioritizer',
      profileId: 'smoke-25',
      model: 'profile-prioritizer-model',
      pricing: { inputTokenCostMicros: 2, outputTokenCostMicros: 3 },
      provider: {
        kind: 'scripted',
        providerId: 'scripted-profile-prioritizer',
        responses: [
          {
            providerId: 'scripted-profile-prioritizer',
            model: 'profile-prioritizer-model',
            content: JSON.stringify({
              rankedSubtasks: [
                {
                  branchId: 'recovery',
                  subtaskId: 'eat',
                  priorityScore: 12,
                  rationale: 'Eat first because satiety is low.',
                },
                {
                  branchId: 'income',
                  subtaskId: 'work',
                  priorityScore: 6,
                  rationale: 'Work after recovery.',
                },
              ],
            }),
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ],
      },
    });
    expect(prioritizer).not.toBeUndefined();
    if (prioritizer === undefined) {
      throw new Error('expected LLM subtask prioritizer');
    }
    const prioritized = await prioritizer({
      agentId: asAgentId('agent-1'),
      issuedAt: 333,
      plan,
      signals: [],
      candidates,
    });
    expect(prioritized.candidates[0]?.subtaskId).toBe('eat');
    expect(prioritized.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'profile-llm-subtask-priority:smoke-25:agent-1:333',
      providerId: 'scripted-profile-prioritizer',
      model: 'profile-prioritizer-model',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCostMicros: 35,
      },
    });

    const selectedSubtask = prioritized.candidates[0];
    if (selectedSubtask === undefined) {
      throw new Error('expected selected subtask');
    }
    const deterministicEatAction = {
      id: 'eat-fish',
      description: 'Eat Fish.',
      commandType: 'AgentEat' as const,
      payload: { commodityName: 'Fish', quantity: 1 },
    };
    const actionSequenceGenerator = createLocalRuntimeTownProfileActionSequenceGenerator({
      kind: 'traceable-llm-action-sequence-generator',
      profileId: 'smoke-25',
      model: 'profile-action-sequence-model',
      provider: {
        kind: 'scripted',
        providerId: 'scripted-profile-action-sequence',
        responses: [
          {
            providerId: 'scripted-profile-action-sequence',
            model: 'profile-action-sequence-model',
            content: JSON.stringify({
              actions: [
                {
                  id: 'llm-eat-fish',
                  description: 'Eat Fish before working.',
                  commandType: 'AgentEat',
                  payload: { commodityName: 'Fish', quantity: 1 },
                  rationale: 'Use inventory to repair satiety.',
                },
              ],
            }),
            finishReason: 'stop',
            usage: { inputTokens: 11, outputTokens: 6 },
          },
        ],
      },
    });
    expect(actionSequenceGenerator).not.toBeUndefined();
    if (actionSequenceGenerator === undefined) {
      throw new Error('expected LLM action sequence generator');
    }
    const generatedSequence = await actionSequenceGenerator({
      agentId: asAgentId('agent-1'),
      issuedAt: 333,
      plan,
      selectedSubtask,
      signals: [],
      deterministicActions: [deterministicEatAction],
    });
    expect(generatedSequence.actions[0]?.id).toBe('llm-eat-fish');
    expect(generatedSequence.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'profile-llm-action-sequence:smoke-25:agent-1:recovery:eat:333',
      providerId: 'scripted-profile-action-sequence',
      model: 'profile-action-sequence-model',
    });

    const globalSynthesizer = createLocalRuntimeTownProfileGlobalSynthesizer({
      kind: 'traceable-llm-global-synthesizer',
      profileId: 'smoke-25',
      model: 'profile-global-model',
      provider: {
        kind: 'scripted',
        providerId: 'scripted-profile-global',
        responses: [
          {
            providerId: 'scripted-profile-global',
            model: 'profile-global-model',
            content: JSON.stringify({
              rankedActions: [
                {
                  actionId: 'work-shift',
                  priorityScore: 9,
                  rationale: 'Work after eating is globally coherent.',
                },
                {
                  actionId: 'llm-eat-fish',
                  priorityScore: 8,
                  rationale: 'Eating remains important but can be synthesized second here.',
                },
              ],
            }),
            finishReason: 'stop',
            usage: { inputTokens: 12, outputTokens: 7 },
          },
        ],
      },
    });
    expect(globalSynthesizer).not.toBeUndefined();
    if (globalSynthesizer === undefined) {
      throw new Error('expected LLM global synthesizer');
    }
    const candidateActions = [
      generatedSequence.actions[0] ?? deterministicEatAction,
      {
        id: 'work-shift',
        description: 'Work as Cleaner.',
        commandType: 'AgentWork' as const,
        payload: { occupationName: 'Cleaner', laborSeconds: 300 },
      },
    ];
    const globalResult = await globalSynthesizer({
      agentId: asAgentId('agent-1'),
      issuedAt: 333,
      plan,
      signals: [],
      candidateActions,
      deterministicSynthesisResult: synthesizeActionCandidates({ actions: candidateActions }),
    });
    expect(globalResult.actions.map((action) => action.id)).toEqual(['work-shift', 'llm-eat-fish']);
    expect(globalResult.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'profile-llm-global-synthesis:smoke-25:agent-1:333',
      providerId: 'scripted-profile-global',
      model: 'profile-global-model',
    });

    const reactiveCorrector = createLocalRuntimeTownProfileReactiveCorrector({
      kind: 'traceable-llm-reactive-corrector',
      profileId: 'smoke-25',
      model: 'profile-reactive-model',
      provider: {
        kind: 'scripted',
        providerId: 'scripted-profile-reactive',
        responses: [
          {
            providerId: 'scripted-profile-reactive',
            model: 'profile-reactive-model',
            content: JSON.stringify({
              decision: {
                kind: 'propose-action',
                rationale: 'Eat Fish after work rejection due to hunger.',
                evidenceRecordIds: ['memory-hungry-work'],
                action: {
                  id: 'reactive-eat-fish',
                  description: 'Eat Fish before retrying.',
                  commandType: 'AgentEat',
                  payload: { commodityName: 'Fish', quantity: 1 },
                },
              },
            }),
            finishReason: 'stop',
            usage: { inputTokens: 13, outputTokens: 8 },
          },
        ],
      },
    });
    expect(reactiveCorrector).not.toBeUndefined();
    if (reactiveCorrector === undefined) {
      throw new Error('expected LLM reactive corrector');
    }
    const correction = await reactiveCorrector({
      agentId: asAgentId('agent-1'),
      issuedAt: 333,
      plan,
      selectedSubtask,
      signals: [],
      rejectedAction: candidateActions[1]!,
      rejectionReason: 'satiety too low',
      allowedCommandTypes: ['AgentEat', 'AgentWork'],
    });
    expect(correction.action?.id).toBe('reactive-eat-fish');
    expect(correction.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'profile-llm-reactive-correction:smoke-25:agent-1:work-shift:333',
      providerId: 'scripted-profile-reactive',
      model: 'profile-reactive-model',
      decision: {
        kind: 'propose-action',
        evidenceRecordIds: ['memory-hungry-work'],
      },
    });
  });

  test('keeps deterministic planning as the default when config is absent', () => {
    expect(createLocalRuntimeTownProfileStrategicPlanCompiler(undefined)).toBeUndefined();
    expect(createLocalRuntimeTownProfileDailyPlanCompiler(undefined)).toBeUndefined();
    expect(createLocalRuntimeTownProfileReactionEvaluator(undefined)).toBeUndefined();
    expect(createLocalRuntimeTownProfileSubtaskPrioritizer(undefined)).toBeUndefined();
    expect(createLocalRuntimeTownProfileActionSequenceGenerator(undefined)).toBeUndefined();
    expect(createLocalRuntimeTownProfileGlobalSynthesizer(undefined)).toBeUndefined();
    expect(createLocalRuntimeTownProfileReactiveCorrector(undefined)).toBeUndefined();
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
