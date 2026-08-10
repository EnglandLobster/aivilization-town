import { createBranchPlan, type SubtaskPrioritizer } from '@aivilization/agent-runtime';
import { createScriptedLlmProvider } from '@aivilization/llm';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  LOCAL_RUNTIME_TOWN_LLM_POLICY_ID,
  attachLocalRuntimeTownLlmAgentStages,
  attachLocalRuntimeTownLlmMemoryStages,
  createLocalRuntimeTownLlmRuntime,
} from './index';

const agentId = asAgentId('agent-1');

describe('local runtime town LLM composition', () => {
  test('builds every structured cognition stage with traceable fallback and cost accounting', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-canonical-llm',
      responses: Array.from({ length: 2 }, () => ({
        providerId: 'scripted-canonical-llm',
        model: 'test-model',
        content: '{}',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5 },
      })),
    });
    const runtime = createLocalRuntimeTownLlmRuntime({
      provider: scripted.provider,
      model: 'test-model',
      requestIdPrefix: 'town-test',
      timeoutMs: 1_000,
      pricing: { inputTokenCostMicros: 2, outputTokenCostMicros: 3 },
    });

    expect(runtime.policyId).toBe(LOCAL_RUNTIME_TOWN_LLM_POLICY_ID);
    expect(runtime.providerId).toBe('scripted-canonical-llm');
    expect(typeof runtime.strategicPlanCompiler).toBe('function');
    expect(typeof runtime.subtaskPrioritizer).toBe('function');
    expect(typeof runtime.actionSequenceGenerator).toBe('function');
    expect(typeof runtime.globalSynthesizer).toBe('function');
    expect(typeof runtime.reactiveCorrector).toBe('function');
    expect(typeof runtime.replanningDecider).toBe('function');
    expect(typeof runtime.socialDialogueGenerator).toBe('function');
    expect(typeof runtime.socialSignalExtractor).toBe('function');
    expect(typeof runtime.reactionEvaluator).toBe('function');
    expect(typeof runtime.reflectiveInsightSynthesizer).toBe('function');
    expect(typeof runtime.socialModelSynthesizer).toBe('function');

    const compilation = await runtime.strategicPlanCompiler?.({
      objective: {
        id: 'objective-study',
        agentId,
        statement: 'Study for a better occupation.',
        priority: 3,
        source: 'agent',
        affinityTags: ['study'],
        createdAt: 100,
        updatedAt: 100,
      },
      issuedAt: 200,
    });

    expect(compilation).toMatchObject({
      planningTrace: {
        status: 'fallback',
        source: 'deterministic-fallback',
        requestId: 'town-test:strategic-planning:agent-1:objective-study:200',
        providerId: 'scripted-canonical-llm',
        model: 'test-model',
        failureReason: 'schema-invalid',
        usage: {
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
          estimatedCostMicros: 70,
        },
      },
    });
    expect(scripted.getRequests().map((request) => request.schemaName)).toEqual([
      'aivilization_branch_plan',
      'aivilization_branch_plan',
    ]);
  });

  test('accepts a real OpenAI-compatible provider config and explicit per-stage disablement', () => {
    const runtime = createLocalRuntimeTownLlmRuntime({
      providerConfig: {
        kind: 'openai-compatible',
        providerId: 'openai-compatible-runtime',
        endpoint: 'https://llm.example.test/v1/chat/completions',
        apiKey: 'test-secret',
        responseFormat: 'json-schema',
      },
      model: 'production-model',
      stages: {
        'social-dialogue': false,
        'social-signal-extraction': false,
        'memory-reflection': { model: 'reflection-model', maxAttempts: 3 },
      },
    });

    expect(runtime.providerId).toBe('openai-compatible-runtime');
    expect(runtime.socialDialogueGenerator).toBeUndefined();
    expect(runtime.socialSignalExtractor).toBeUndefined();
    expect(runtime.reflectiveInsightSynthesizer).toEqual(expect.any(Function));
  });

  test('decorates missing agent stages while preserving explicit caller hooks', () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-agent-llm',
      responses: [],
    });
    const runtime = createLocalRuntimeTownLlmRuntime({
      provider: scripted.provider,
      model: 'test-model',
    });
    const explicitPrioritizer: SubtaskPrioritizer = ({ candidates }) => ({
      candidates,
      trace: { status: 'deterministic', source: 'deterministic' },
    });
    const decorated = attachLocalRuntimeTownLlmAgentStages({
      runtime,
      agent: {
        agentId,
        observedStateSummary: 'energy=50',
        plan: createBranchPlan({
          objective: 'Study',
          branches: [
            {
              id: 'development',
              objective: 'Learn',
              subtasks: [{ id: 'study', description: 'Study', basePriority: 1 }],
            },
          ],
        }),
        signals: [],
        microPlanners: [],
        subtaskPrioritizer: explicitPrioritizer,
        simulate: ({ action }) => ({ status: 'accepted', action }),
      },
    });

    expect(decorated.subtaskPrioritizer).toBe(explicitPrioritizer);
    expect(decorated.actionSequenceGenerator).toEqual(expect.any(Function));
    expect(decorated.actionSequenceGenerator).not.toBe(runtime.actionSequenceGenerator);
    expect(decorated.globalSynthesizer).toBe(runtime.globalSynthesizer);
    expect(decorated.reactiveCorrector).toBe(runtime.reactiveCorrector);
    expect(decorated.replanningDecider).toBe(runtime.replanningDecider);
    expect(decorated.socialDialogueGenerator).toBe(runtime.socialDialogueGenerator);
    expect(decorated.socialSignalExtractor).toBe(runtime.socialSignalExtractor);
  });

  test('injects memory synthesis hooks while preserving explicit schedule overrides', () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-memory-llm',
      responses: [],
    });
    const runtime = createLocalRuntimeTownLlmRuntime({
      provider: scripted.provider,
      model: 'test-model',
    });
    const explicitReflection = () => ({
      insights: [],
      trace: { status: 'deterministic' as const, source: 'deterministic' as const },
    });
    const schedule = attachLocalRuntimeTownLlmMemoryStages({
      runtime,
      schedule: {
        retrievalLimit: 32,
        minPatternCount: 3,
        reflectiveInsightSynthesizer: explicitReflection,
      },
    });

    expect(schedule.reflectiveInsightSynthesizer).toBe(explicitReflection);
    expect(schedule.socialModelSynthesizer).toBe(runtime.socialModelSynthesizer);
  });

  test('fails fast on invalid shared retry and timeout policy', () => {
    const scripted = createScriptedLlmProvider({ providerId: 'scripted-invalid', responses: [] });

    expect(() =>
      createLocalRuntimeTownLlmRuntime({
        provider: scripted.provider,
        model: 'test-model',
        maxAttempts: 0,
      }),
    ).toThrow('llm.maxAttempts must be a positive integer');
    expect(() =>
      createLocalRuntimeTownLlmRuntime({
        provider: scripted.provider,
        model: 'test-model',
        timeoutMs: Number.NaN,
      }),
    ).toThrow('llm.timeoutMs must be a positive finite number');
    expect(() =>
      createLocalRuntimeTownLlmRuntime({
        provider: scripted.provider,
        model: 'test-model',
        pricing: { inputTokenCostMicros: -1, outputTokenCostMicros: 0 },
      }),
    ).toThrow('llm.pricing.inputTokenCostMicros must be a non-negative finite number');
  });
});
