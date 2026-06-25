import { createScriptedLlmProvider } from '@aivilization/llm';
import { createShortTermMemoryRecord, type LongTermAgentProfile } from '@aivilization/memory';
import { asAgentId, asEventId, type AgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createTraceableLlmReactionEvaluator,
  llmReactionDecisionSchema,
  proposeReactionWithLlm,
} from './llmReactionEvaluator';

const agentId = asAgentId('agent-bystander');
const hourMs = 60 * 60 * 1000;

describe('LLM reaction evaluator seam', () => {
  test('accepts a structured LLM follow-up reaction proposal after validation', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-reaction-evaluator',
      responses: [
        {
          providerId: 'scripted-reaction-evaluator',
          model: 'reaction-model',
          finishReason: 'stop',
          usage: { inputTokens: 24, outputTokens: 16 },
          content: JSON.stringify({
            kind: 'follow-up',
            confidence: 0.82,
            rationale: 'The bystander heard a concrete party coordination opportunity.',
            description: 'Ask agent-a whether help is needed for the Valentine party.',
            priority: 5,
            reactionWindowMs: hourMs,
            affinityTags: ['social', 'party', 'agent-a'],
          }),
        },
      ],
    });

    const memory = createConversationMemory();
    const result = await proposeReactionWithLlm({
      agentId,
      issuedAt: 10 * hourMs,
      memory,
      longTermProfile: createProfile(agentId),
      memoryContext: [memory],
      provider: scripted.provider,
      model: 'reaction-model',
      requestId: 'reaction-agent-bystander-memory-conversation-party',
      maxAttempts: 1,
      pricing: {
        inputTokenCostMicros: 2,
        outputTokenCostMicros: 3,
      },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      source: 'llm',
      decision: {
        kind: 'follow-up',
        confidence: 0.82,
        description: 'Ask agent-a whether help is needed for the Valentine party.',
        priority: 5,
        reactionWindowMs: hourMs,
        affinityTags: ['social', 'party', 'agent-a'],
      },
      gateway: {
        status: 'succeeded',
        requestId: 'reaction-agent-bystander-memory-conversation-party',
        usage: {
          inputTokens: 24,
          outputTokens: 16,
          totalTokens: 40,
          estimatedCostMicros: 96,
        },
      },
    });

    const [providerRequest] = scripted.getRequests();
    expect(providerRequest).toMatchObject({
      requestId: 'reaction-agent-bystander-memory-conversation-party',
      model: 'reaction-model',
      schemaName: 'aivilization_reaction_decision',
    });
    expect(providerRequest?.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(providerRequest?.messages[1]?.content).toContain('memory-conversation-party');
    expect(providerRequest?.messages[1]?.content).toContain('agent-a values helping neighbors');
    const [tool] = providerRequest?.tools ?? [];
    expect(providerRequest?.tools).toHaveLength(1);
    expect(tool?.name).toBe('submit_reaction_decision');
    expect(tool?.description).toContain('reaction decision');
  });

  test('includes world decision context in structured reaction evaluator requests', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-reaction-evaluator',
      responses: [
        {
          providerId: 'scripted-reaction-evaluator',
          model: 'reaction-model',
          finishReason: 'stop',
          content: JSON.stringify({
            kind: 'ignore',
            confidence: 0.75,
            rationale: 'The current market context makes this observation non-urgent.',
          }),
        },
      ],
    });

    await proposeReactionWithLlm({
      agentId,
      issuedAt: 10 * hourMs,
      memory: createConversationMemory(),
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'reaction-model',
      requestId: 'reaction-with-world-context',
    });

    const requestContent = scripted.getRequests()[0]?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"worldDecisionContext"');
    expect(requestContent).toContain('"balance":191696904');
    expect(requestContent).toContain('"educationScore":31');
    expect(requestContent).toContain('"residentialTier":5');
    expect(requestContent).toContain('"Fish":46');
    expect(requestContent).toContain('"spotPrice":304.5');
  });

  test('falls back to deterministic reaction evaluation when LLM output is invalid', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-reaction-evaluator',
      responses: [
        {
          providerId: 'scripted-reaction-evaluator',
          model: 'reaction-model',
          finishReason: 'stop',
          content: JSON.stringify({
            kind: 'follow-up',
            confidence: 0.9,
            rationale: 'Invalid because description is empty.',
            description: '',
            priority: 5,
            reactionWindowMs: hourMs,
            affinityTags: ['social'],
          }),
        },
      ],
    });

    await expect(
      proposeReactionWithLlm({
        agentId,
        issuedAt: 10 * hourMs,
        memory: createConversationMemory(),
        provider: scripted.provider,
        model: 'reaction-model',
        requestId: 'reaction-invalid',
      }),
    ).resolves.toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      failure: {
        status: 'failed',
        reason: 'schema-invalid',
        requestId: 'reaction-invalid',
      },
      decision: {
        kind: 'follow-up',
        description:
          'Follow up on observed social event: Observed agent-a and agent-c discuss Valentine party at Town Square.',
      },
    });
  });

  test('rejects reaction invariant violations inside the LLM schema parser', () => {
    expect(
      llmReactionDecisionSchema.parse({
        kind: 'follow-up',
        confidence: 1.5,
        rationale: 'Too much certainty.',
        description: 'Ask about the party.',
        priority: 4,
        reactionWindowMs: hourMs,
        affinityTags: ['social'],
      }),
    ).toEqual({
      status: 'invalid',
      reason: 'reaction decision candidate invalid: reaction confidence must be within [0, 1]',
    });
  });

  test('creates a traceable LLM reaction evaluator that preserves accepted attempts and usage', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-reaction-evaluator',
      responses: [
        {
          providerId: 'scripted-reaction-evaluator',
          model: 'reaction-model',
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 12 },
          content: JSON.stringify({
            kind: 'ignore',
            confidence: 0.74,
            rationale: 'The observation is socially relevant but not actionable now.',
          }),
        },
      ],
    });
    const evaluator = createTraceableLlmReactionEvaluator({
      provider: scripted.provider,
      model: 'reaction-model',
      requestId: ({ agentId, memory }) => `${agentId}:${memory.id}`,
      pricing: {
        inputTokenCostMicros: 2,
        outputTokenCostMicros: 3,
      },
    });

    await expect(
      evaluator({
        agentId,
        issuedAt: 10 * hourMs,
        memory: createConversationMemory(),
      }),
    ).resolves.toMatchObject({
      decision: {
        kind: 'ignore',
        confidence: 0.74,
      },
      reactionTrace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'agent-bystander:memory-conversation-party',
        providerId: 'scripted-reaction-evaluator',
        model: 'reaction-model',
        usage: {
          inputTokens: 10,
          outputTokens: 12,
          totalTokens: 22,
          estimatedCostMicros: 56,
        },
        attempts: [
          {
            attemptIndex: 1,
            status: 'succeeded',
            providerId: 'scripted-reaction-evaluator',
            model: 'reaction-model',
            message: 'LLM structured response validated',
          },
        ],
      },
    });
  });
});

function createConversationMemory() {
  return createShortTermMemoryRecord({
    id: 'memory-conversation-party',
    agentId,
    kind: 'observation',
    status: 'observed',
    summary: 'Observed agent-a and agent-c discuss Valentine party at Town Square.',
    occurredAt: 10 * hourMs,
    importanceScore: 0.7,
    source: { eventIds: [asEventId('event-conversation-1')] },
    tags: [
      'ambient-observation',
      'ConversationRecorded',
      'town-square',
      'agent-a',
      'agent-c',
      'valentine-party',
    ],
  });
}

function createProfile(agentId: AgentId): LongTermAgentProfile {
  return {
    agentId,
    beliefs: [
      {
        key: 'agent-a-helpfulness',
        statement: 'agent-a values helping neighbors',
        confidence: 0.8,
        updatedAt: 9 * hourMs,
        provenanceRecordIds: [],
      },
    ],
    habits: [],
    mood: [],
    values: [],
    personality: [],
    socialRecords: [],
  };
}

function createWorldDecisionContext() {
  return {
    agent: {
      agentId,
      locationId: 'market',
      physiology: { energy: 45, satiety: 30, health: 90 },
      educationScore: 31,
      balance: 191696904,
      residentialTier: 5,
      job: 'Stock Clerk',
      inventory: { Fish: 46, Transistor: 12 },
    },
    market: {
      spotPrices: [{ commodity: 'Fish', spotPrice: 304.5 }],
      latestPriceIndex: {
        baselineAt: 0,
        recordedAt: 100,
        overall: 1.12,
        ratios: { Fish: 1.12 },
      },
    },
  };
}
