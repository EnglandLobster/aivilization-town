import { createScriptedLlmProvider } from '@aivilization/llm';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createShortTermMemoryRecord,
  createTraceableLlmSocialModelSynthesizer,
  proposeSocialModelWithLlm,
} from './index';

const agentId = asAgentId('agent-1');
const targetAgentId = asAgentId('agent-2');
const otherAgentId = asAgentId('agent-3');

describe('LLM social model synthesizer seam', () => {
  test('accepts grounded LLM social model proposals over social interaction memories', async () => {
    const records = [
      createSocialMemory({
        id: 'social-1',
        summary: 'Shared food after work.',
        relationDelta: 0.25,
        attitudeDelta: 0.2,
      }),
      createSocialMemory({
        id: 'social-2',
        summary: 'Coordinated study before a work shift.',
        occurredAt: 20,
        relationDelta: 0.35,
        attitudeDelta: 0.1,
      }),
      createSocialMemory({
        id: 'other-agent-social',
        agentId: otherAgentId,
        summary: 'Other agent had a social interaction.',
      }),
    ];
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-model',
      responses: [
        {
          providerId: 'scripted-social-model',
          model: 'social-model',
          finishReason: 'stop',
          usage: { inputTokens: 64, outputTokens: 32 },
          content: JSON.stringify({
            socialRecords: [
              {
                targetAgentId: 'agent-2',
                statement:
                  'agent-2 is becoming a reliable partner for food sharing and study coordination.',
                confidence: 0.83,
                evidenceRecordIds: ['social-1', 'social-2'],
                relationDelta: 0.6,
                attitudeDelta: 0.3,
                rationale:
                  'Both memories describe cooperative exchanges with the same target agent.',
              },
            ],
            socialReflections: [
              {
                targetAgentId: 'agent-2',
                statement:
                  'The relationship with agent-2 is moving toward practical mutual support.',
                confidence: 0.84,
                evidenceRecordIds: ['social-1', 'social-2'],
                relationDelta: 0.6,
                attitudeDelta: 0.3,
                tags: ['trust', 'coordination'],
                rationale:
                  'The interaction pattern combines material help with coordinated planning.',
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeSocialModelWithLlm({
      agentId,
      records,
      generatedAt: 500,
      longTermProfile: {
        agentId,
        beliefs: [],
        habits: [],
        mood: [],
        values: [],
        personality: [],
        socialRecords: [
          {
            key: 'agent-2',
            statement: 'agent-2 has helped once before.',
            confidence: 0.5,
            provenanceRecordIds: [],
            updatedAt: 450,
          },
        ],
      },
      observedStateSummary:
        'energy=72 satiety=41 health=93 education=31 balance=191696904 residentialTier=5 job=stock-clerk inventory=Fish:46,Transistor:12',
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'social-model',
      requestId: 'social-model-agent-1-500',
      pricing: { inputTokenCostMicros: 2, outputTokenCostMicros: 5 },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      source: 'llm',
      patches: [
        {
          id: 'ltm-patch-agent-1-social-agent-2-500',
          agentId,
          section: 'socialRecords',
          key: 'agent-2',
          statement:
            'agent-2 is becoming a reliable partner for food sharing and study coordination.',
          confidence: 0.83,
          provenanceRecordIds: ['social-1', 'social-2'],
          proposedAt: 500,
          relationDelta: 0.6,
          attitudeDelta: 0.3,
        },
      ],
      socialReflections: [
        {
          id: 'social-reflection-agent-1-agent-2-llm-0-500',
          agentId,
          targetAgentId,
          statement: 'The relationship with agent-2 is moving toward practical mutual support.',
          confidence: 0.84,
          evidenceRecordIds: ['social-1', 'social-2'],
          relationDelta: 0.6,
          attitudeDelta: 0.3,
          generatedAt: 500,
          tags: ['social', 'post-interaction-reflection', 'agent-2', 'trust', 'coordination'],
        },
      ],
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'social-model-agent-1-500',
        providerId: 'scripted-social-model',
        model: 'social-model',
        patches: [
          {
            key: 'agent-2',
            confidence: 0.83,
            provenanceRecordIds: ['social-1', 'social-2'],
            relationDelta: 0.6,
            attitudeDelta: 0.3,
          },
        ],
        reflections: [
          {
            targetAgentId,
            confidence: 0.84,
            evidenceRecordIds: ['social-1', 'social-2'],
          },
        ],
        usage: {
          inputTokens: 64,
          outputTokens: 32,
          totalTokens: 96,
          estimatedCostMicros: 288,
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
          hasEconomicState: true,
          hasMarketPrices: true,
          completeEconomicContext: true,
        },
      },
    });

    const request = scripted.getRequests()[0];
    expect(request).toMatchObject({
      requestId: 'social-model-agent-1-500',
      model: 'social-model',
      schemaName: 'aivilization_social_model_synthesis',
    });
    const requestContent = request?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"records"');
    expect(requestContent).toContain('"social-1"');
    expect(requestContent).toContain('"social-2"');
    expect(requestContent).not.toContain('"other-agent-social"');
    expect(requestContent).toContain('"longTermProfile"');
    expect(requestContent).toContain('"deterministicSocialModel"');
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

  test('falls back to deterministic social model synthesis when the provider fails', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-model',
      responses: [new Error('social model provider unavailable')],
    });

    const result = await proposeSocialModelWithLlm({
      agentId,
      records: [createSocialMemory({ id: 'social-1', summary: 'Shared food after work.' })],
      generatedAt: 510,
      provider: scripted.provider,
      model: 'social-model',
      requestId: 'social-model-provider-failure',
    });

    expect(result.status).toBe('fallback');
    expect(result.source).toBe('deterministic-fallback');
    expect(result.patches.map((patch) => patch.id)).toEqual([
      'ltm-patch-agent-1-social-agent-2-510',
    ]);
    expect(result.socialReflections.map((reflection) => reflection.id)).toEqual([
      'social-reflection-agent-1-agent-2-social-1-510',
    ]);
    expect(result.trace).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      requestId: 'social-model-provider-failure',
      providerId: 'scripted-social-model',
      model: 'social-model',
      failureReason: 'provider-error',
      message: 'social model provider unavailable',
    });
  });

  test('falls back when an LLM social model proposal cites evidence outside the window', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-model',
      responses: [
        {
          providerId: 'scripted-social-model',
          model: 'social-model',
          finishReason: 'stop',
          content: JSON.stringify({
            socialRecords: [
              {
                targetAgentId: 'agent-2',
                statement: 'Invalid external evidence.',
                confidence: 0.8,
                evidenceRecordIds: ['outside-memory'],
                relationDelta: 0.2,
                attitudeDelta: 0.1,
                rationale: 'Invalid citation.',
              },
            ],
            socialReflections: [],
          }),
        },
      ],
    });

    const result = await proposeSocialModelWithLlm({
      agentId,
      records: [createSocialMemory({ id: 'social-1', summary: 'Shared food after work.' })],
      generatedAt: 520,
      provider: scripted.provider,
      model: 'social-model',
      requestId: 'social-model-invalid-evidence',
    });

    expect(result.status).toBe('fallback');
    expect(result.source).toBe('deterministic-fallback');
    expect(result.patches.map((patch) => patch.id)).toEqual([
      'ltm-patch-agent-1-social-agent-2-520',
    ]);
    expect(result.trace).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      requestId: 'social-model-invalid-evidence',
      failureReason: 'evidence-invalid',
    });
  });

  test('creates a traceable synthesizer compatible with worker consolidation', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-model',
      responses: [
        {
          providerId: 'scripted-social-model',
          model: 'social-model',
          finishReason: 'stop',
          content: JSON.stringify({
            socialRecords: [
              {
                targetAgentId: 'agent-2',
                statement: 'agent-2 is a dependable neighbor.',
                confidence: 0.8,
                evidenceRecordIds: ['social-1'],
                relationDelta: 0.2,
                attitudeDelta: 0.1,
                rationale: 'The cited memory shows useful support.',
              },
            ],
            socialReflections: [],
          }),
        },
      ],
    });
    const synthesizer = createTraceableLlmSocialModelSynthesizer({
      provider: scripted.provider,
      model: 'social-model',
      requestId: ({ agentId, generatedAt }) => `${agentId}:${generatedAt}:social-model`,
    });

    const result = await synthesizer({
      agentId,
      records: [createSocialMemory({ id: 'social-1', summary: 'Shared food after work.' })],
      generatedAt: 530,
    });

    expect(result.patches[0]?.statement).toBe('agent-2 is a dependable neighbor.');
    expect(result.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'agent-1:530:social-model',
      patches: [{ key: 'agent-2' }],
    });
  });
});

function createSocialMemory(input: {
  readonly id: string;
  readonly agentId?: typeof agentId;
  readonly summary: string;
  readonly occurredAt?: number;
  readonly relationDelta?: number;
  readonly attitudeDelta?: number;
}) {
  return createShortTermMemoryRecord({
    id: input.id,
    agentId: input.agentId ?? agentId,
    kind: 'social-interaction',
    status: 'succeeded',
    summary: input.summary,
    occurredAt: input.occurredAt ?? 10,
    importanceScore: 0.8,
    source: { eventIds: [] },
    tags: ['conversation', 'community'],
    consolidationHint: {
      kind: 'social',
      targetAgentId,
      relationDelta: input.relationDelta ?? 0.25,
      attitudeDelta: input.attitudeDelta ?? 0.5,
      summary: input.summary,
    },
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
