import { createScriptedLlmProvider } from '@aivilization/llm';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  asMemoryRecordId,
  createShortTermMemoryRecord,
  createTraceableLlmReflectiveInsightSynthesizer,
  proposeReflectiveInsightsWithLlm,
} from './index';

const agentId = asAgentId('agent-1');
const otherAgentId = asAgentId('agent-2');

describe('LLM reflective insight synthesizer seam', () => {
  test('accepts grounded LLM insight proposals over short-term memory records', async () => {
    const records = [
      createMemory({
        id: 'trade-memory-1',
        status: 'succeeded',
        summary: 'Waited for a better apple price before buying.',
        tags: ['trade', 'market'],
        importanceScore: 0.8,
      }),
      createMemory({
        id: 'trade-memory-2',
        status: 'succeeded',
        summary: 'Delayed buying fish until the spot price dropped.',
        tags: ['trade', 'market'],
        importanceScore: 0.7,
      }),
      createMemory({
        id: 'other-agent-memory',
        agentId: otherAgentId,
        status: 'succeeded',
        summary: 'Other agent waited for prices.',
        tags: ['trade'],
      }),
    ];
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-reflection',
      responses: [
        {
          providerId: 'scripted-reflection',
          model: 'reflection-model',
          finishReason: 'stop',
          usage: { inputTokens: 50, outputTokens: 25 },
          content: JSON.stringify({
            insights: [
              {
                kind: 'value',
                topicKey: 'market-patience',
                statement: 'The agent values waiting for better market conditions.',
                confidence: 0.82,
                evidenceRecordIds: ['trade-memory-1', 'trade-memory-2'],
                tags: ['trade', 'market', 'value'],
                rationale:
                  'Both cited records describe delaying purchases because of price conditions.',
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeReflectiveInsightsWithLlm({
      agentId,
      records,
      minEvidenceCount: 2,
      generatedAt: 900,
      longTermProfile: {
        agentId,
        habits: [],
        beliefs: [],
        values: [
          {
            key: 'frugality',
            statement: 'Often avoids wasteful spending.',
            confidence: 0.6,
            updatedAt: 880,
            provenanceRecordIds: [],
          },
        ],
        mood: [],
        personality: [],
        socialRecords: [],
      },
      observedStateSummary:
        'energy=72 satiety=41 health=93 education=31 balance=191696904 residentialTier=5 job=stock-clerk inventory=Fish:46,Transistor:12',
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'reflection-model',
      requestId: 'reflection-agent-1-900',
      pricing: { inputTokenCostMicros: 2, outputTokenCostMicros: 3 },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      source: 'llm',
      insights: [
        {
          id: 'reflection-agent-1-value-market-patience-900',
          agentId,
          kind: 'value',
          topicKey: 'market-patience',
          confidence: 0.82,
          evidenceRecordIds: [
            asMemoryRecordId('trade-memory-1'),
            asMemoryRecordId('trade-memory-2'),
          ],
        },
      ],
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'reflection-agent-1-900',
        providerId: 'scripted-reflection',
        model: 'reflection-model',
        choices: [
          {
            kind: 'value',
            topicKey: 'market-patience',
            confidence: 0.82,
            evidenceRecordIds: [
              asMemoryRecordId('trade-memory-1'),
              asMemoryRecordId('trade-memory-2'),
            ],
          },
        ],
        usage: {
          inputTokens: 50,
          outputTokens: 25,
          totalTokens: 75,
          estimatedCostMicros: 175,
        },
        worldDecisionContext: {
          agentId,
          hasPhysiology: true,
          hasBalance: true,
          hasEducationScore: true,
          hasResidentialTier: true,
          inventoryItemCount: 2,
          marketSpotPriceCount: 1,
          hasLatestPriceIndex: true,
        },
      },
    });

    const request = scripted.getRequests()[0];
    expect(request).toMatchObject({
      requestId: 'reflection-agent-1-900',
      model: 'reflection-model',
      schemaName: 'aivilization_reflective_insight_synthesis',
    });
    const requestContent = request?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"records"');
    expect(requestContent).toContain('"trade-memory-1"');
    expect(requestContent).not.toContain('"other-agent-memory"');
    expect(requestContent).toContain('"deterministicFallbackInsights"');
    expect(requestContent).toContain('"allowedInsightKinds"');
    expect(requestContent).toContain('"longTermProfile"');
    expect(requestContent).toContain('"frugality"');
    expect(requestContent).toContain('"observedStateSummary"');
    expect(requestContent).toContain(
      'energy=72 satiety=41 health=93 education=31 balance=191696904 residentialTier=5 job=stock-clerk inventory=Fish:46,Transistor:12',
    );
    expect(requestContent).toContain('"worldDecisionContext"');
    expect(requestContent).toContain('"balance":191696904');
    expect(requestContent).toContain('"educationScore":31');
    expect(requestContent).toContain('"residentialTier":5');
    expect(requestContent).toContain('"Fish":46');
    expect(requestContent).toContain('"spotPrice":304.5');
  });

  test('falls back to deterministic reflection when the provider fails', async () => {
    const records = [
      createMemory({ id: 'study-1', status: 'succeeded', summary: 'Studied math.' }),
      createMemory({ id: 'study-2', status: 'succeeded', summary: 'Studied history.' }),
    ];
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-reflection',
      responses: [new Error('provider unavailable')],
    });

    const result = await proposeReflectiveInsightsWithLlm({
      agentId,
      records,
      minEvidenceCount: 2,
      generatedAt: 910,
      provider: scripted.provider,
      model: 'reflection-model',
      requestId: 'reflection-provider-failure',
    });

    expect(result.status).toBe('fallback');
    expect(result.source).toBe('deterministic-fallback');
    expect(result.insights.map((insight) => insight.id)).toEqual([
      'reflection-agent-1-habit-study-routine-910',
    ]);
    expect(result.trace).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      requestId: 'reflection-provider-failure',
      providerId: 'scripted-reflection',
      model: 'reflection-model',
      failureReason: 'provider-error',
      message: 'provider unavailable',
    });
  });

  test('falls back when an accepted LLM proposal cites memory outside the synthesis window', async () => {
    const records = [
      createMemory({ id: 'study-1', status: 'succeeded', summary: 'Studied math.' }),
      createMemory({ id: 'study-2', status: 'succeeded', summary: 'Studied history.' }),
    ];
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-reflection',
      responses: [
        {
          providerId: 'scripted-reflection',
          model: 'reflection-model',
          finishReason: 'stop',
          content: JSON.stringify({
            insights: [
              {
                kind: 'habit',
                topicKey: 'study-routine',
                statement: 'The agent has a stable study routine.',
                confidence: 0.8,
                evidenceRecordIds: ['outside-memory'],
                tags: ['study'],
                rationale: 'Invalid external evidence.',
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeReflectiveInsightsWithLlm({
      agentId,
      records,
      minEvidenceCount: 2,
      generatedAt: 920,
      provider: scripted.provider,
      model: 'reflection-model',
      requestId: 'reflection-invalid-evidence',
    });

    expect(result.status).toBe('fallback');
    expect(result.source).toBe('deterministic-fallback');
    expect(result.insights.map((insight) => insight.id)).toEqual([
      'reflection-agent-1-habit-study-routine-920',
    ]);
    expect(result.trace).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      requestId: 'reflection-invalid-evidence',
      failureReason: 'evidence-invalid',
    });
  });

  test('creates a traceable synthesizer compatible with memory consolidation', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-reflection',
      responses: [
        {
          providerId: 'scripted-reflection',
          model: 'reflection-model',
          finishReason: 'stop',
          content: JSON.stringify({
            insights: [
              {
                kind: 'value',
                topicKey: 'market-patience',
                statement: 'The agent values waiting for better market conditions.',
                confidence: 0.82,
                evidenceRecordIds: ['trade-memory-1'],
                tags: ['trade', 'market', 'value'],
                rationale: 'The cited record says the agent delayed buying until prices improved.',
              },
            ],
          }),
        },
      ],
    });
    const synthesizer = createTraceableLlmReflectiveInsightSynthesizer({
      provider: scripted.provider,
      model: 'reflection-model',
      requestId: ({ agentId, generatedAt }) => `${agentId}:${generatedAt}:reflection`,
    });

    const result = await synthesizer({
      agentId,
      records: [
        createMemory({
          id: 'trade-memory-1',
          status: 'succeeded',
          summary: 'Waited for a better apple price before buying.',
          tags: ['trade', 'market'],
        }),
      ],
      minEvidenceCount: 1,
      generatedAt: 930,
    });

    expect(result.insights[0]?.topicKey).toBe('market-patience');
    expect(result.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'agent-1:930:reflection',
      choices: [{ topicKey: 'market-patience' }],
    });
  });
});

function createMemory(input: {
  readonly id: string;
  readonly agentId?: typeof agentId;
  readonly status: 'succeeded' | 'failed' | 'repaired' | 'observed';
  readonly summary: string;
  readonly tags?: readonly string[];
  readonly importanceScore?: number;
}) {
  return createShortTermMemoryRecord({
    id: input.id,
    agentId: input.agentId ?? agentId,
    kind: 'action',
    status: input.status,
    summary: input.summary,
    occurredAt: Number(input.id.match(/\d+/)?.[0] ?? 1),
    importanceScore: input.importanceScore ?? 0.7,
    source: { eventIds: [] },
    tags: input.tags ?? ['study', 'education'],
  });
}

function createWorldDecisionContext() {
  return {
    agent: {
      agentId,
      locationId: 'market',
      physiology: { energy: 72, satiety: 41, health: 93 },
      educationScore: 31,
      balance: 191696904,
      residentialTier: 5,
      job: 'stock-clerk',
      inventory: { Fish: 46, Transistor: 12 },
    },
    market: {
      spotPrices: [{ commodity: 'Fish', spotPrice: 304.5 }],
      latestPriceIndex: {
        baselineAt: 100,
        recordedAt: 200,
        overall: 1.25,
        ratios: { Fish: 1.4 },
      },
    },
  };
}
