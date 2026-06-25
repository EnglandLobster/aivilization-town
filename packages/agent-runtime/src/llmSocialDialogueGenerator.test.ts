import { createScriptedLlmProvider } from '@aivilization/llm';
import { asMemoryRecordId, createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type { AtomicActionProposal } from './actions';
import { createBranchPlan, type PrioritizedSubtask } from './planner';
import type { SocialDialoguePayload } from './socialDialogueGeneration';
import {
  createTraceableLlmSocialDialogueGenerator,
  proposeSocialDialogueWithLlm,
} from './llmSocialDialogueGenerator';
import type { WorldDecisionContext } from './worldDecisionContext';

const agentId = asAgentId('agent-1');
const targetAgentId = asAgentId('agent-2');

describe('LLM social dialogue generation seam', () => {
  test('accepts a valid LLM-generated conversation with world and memory context', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-dialogue',
      responses: [
        {
          providerId: 'scripted-social-dialogue',
          model: 'dialogue-model',
          finishReason: 'stop',
          usage: { inputTokens: 70, outputTokens: 28 },
          content: JSON.stringify({
            dialogue: {
              topic: 'sharing market price notes',
              relationDelta: 0.09,
              attitudeDelta: 0.04,
              rationale:
                'The agent has Fish in inventory, observed expensive prices, and wants a useful neighbor exchange.',
              turns: [
                {
                  speakerAgentId: 'agent-1',
                  utterance:
                    'I still have some Fish, but the market price looked high. Did you see a better stall?',
                  intent: 'ask-price-context',
                },
                {
                  speakerAgentId: 'agent-2',
                  utterance:
                    'The south stall was cheaper this morning; I can show you before it gets busy.',
                  intent: 'offer-help',
                },
              ],
            },
          }),
        },
      ],
    });

    const result = await proposeSocialDialogueWithLlm({
      agentId,
      issuedAt: 400,
      plan: createContextualPlan(),
      selectedSubtask,
      action,
      deterministicPayload,
      signals: [{ key: 'social', weight: 4 }],
      shortTermMemoryContext: [createRecentConversationMemory()],
      longTermProfile: createLongTermProfile(),
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'dialogue-model',
      requestId: 'social-dialogue-agent-1-400',
      pricing: { inputTokenCostMicros: 2, outputTokenCostMicros: 5 },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      source: 'llm',
      payload: {
        targetAgentId: 'agent-2',
        topic: 'sharing market price notes',
        relationDelta: 0.09,
        attitudeDelta: 0.04,
        turns: [
          {
            speakerAgentId: 'agent-1',
            utterance:
              'I still have some Fish, but the market price looked high. Did you see a better stall?',
            intent: 'ask-price-context',
          },
          {
            speakerAgentId: 'agent-2',
            utterance:
              'The south stall was cheaper this morning; I can show you before it gets busy.',
            intent: 'offer-help',
          },
        ],
      },
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'social-dialogue-agent-1-400',
        providerId: 'scripted-social-dialogue',
        model: 'dialogue-model',
        selectedSubtask: { branchId: 'social', subtaskId: 'check-in' },
        actionId: 'social-check-in',
        targetAgentId: 'agent-2',
        turnCount: 2,
        rationale:
          'The agent has Fish in inventory, observed expensive prices, and wants a useful neighbor exchange.',
        usage: {
          inputTokens: 70,
          outputTokens: 28,
          totalTokens: 98,
          estimatedCostMicros: 280,
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
      requestId: 'social-dialogue-agent-1-400',
      model: 'dialogue-model',
      schemaName: 'aivilization_social_dialogue_generation',
    });
    const requestContent = request?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"selectedSubtask"');
    expect(requestContent).toContain('"deterministicPayload"');
    expect(requestContent).toContain('"shortTermMemoryContext"');
    expect(requestContent).toContain('"longTermProfile"');
    expect(requestContent).toContain('"worldDecisionContext"');
    expect(requestContent).toContain('"balance":191696904');
    expect(requestContent).toContain('"Fish":46');
    expect(requestContent).toContain('"spotPrice":304.5');
  });

  test('falls back when an LLM conversation uses a speaker outside the participants', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-dialogue',
      responses: [
        {
          providerId: 'scripted-social-dialogue',
          model: 'dialogue-model',
          finishReason: 'stop',
          content: JSON.stringify({
            dialogue: {
              topic: 'invalid speaker',
              rationale: 'This response invents a third participant.',
              turns: [
                { speakerAgentId: 'agent-1', utterance: 'Hello.' },
                { speakerAgentId: 'agent-3', utterance: 'I am not a participant.' },
              ],
            },
          }),
        },
      ],
    });

    const result = await proposeSocialDialogueWithLlm({
      agentId,
      issuedAt: 410,
      plan: createContextualPlan(),
      selectedSubtask,
      action,
      deterministicPayload,
      signals: [],
      provider: scripted.provider,
      model: 'dialogue-model',
      requestId: 'social-dialogue-invalid-speaker',
    });

    expect(result).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      payload: deterministicPayload,
      trace: {
        status: 'fallback',
        source: 'deterministic-fallback',
        requestId: 'social-dialogue-invalid-speaker',
        failureReason: 'schema-invalid',
        turnCount: 2,
      },
    });
  });

  test('falls back when the provider fails', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-dialogue',
      responses: [new Error('dialogue provider offline')],
    });

    const result = await proposeSocialDialogueWithLlm({
      agentId,
      issuedAt: 420,
      plan: createContextualPlan(),
      selectedSubtask,
      action,
      deterministicPayload,
      signals: [],
      provider: scripted.provider,
      model: 'dialogue-model',
      requestId: 'social-dialogue-provider-failure',
    });

    expect(result).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      payload: deterministicPayload,
      trace: {
        status: 'fallback',
        source: 'deterministic-fallback',
        requestId: 'social-dialogue-provider-failure',
        failureReason: 'provider-error',
        message: 'dialogue provider offline',
      },
    });
  });

  test('creates a traceable generator compatible with planning cycles', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-dialogue',
      responses: [
        {
          providerId: 'scripted-social-dialogue',
          model: 'dialogue-model',
          finishReason: 'stop',
          content: JSON.stringify({
            dialogue: {
              topic: 'neighbor market note',
              rationale: 'Short coordination exchange.',
              turns: [
                { speakerAgentId: 'agent-1', utterance: 'I will check Fish prices after work.' },
                { speakerAgentId: 'agent-2', utterance: 'I can compare grain prices meanwhile.' },
              ],
            },
          }),
        },
      ],
    });
    const generator = createTraceableLlmSocialDialogueGenerator({
      provider: scripted.provider,
      model: 'dialogue-model',
      requestId: ({ agentId, issuedAt, action }) =>
        `${agentId}:${issuedAt}:${action.id}:social-dialogue`,
    });

    const result = await generator({
      agentId,
      issuedAt: 430,
      plan: createContextualPlan(),
      selectedSubtask,
      action,
      deterministicPayload,
      signals: [],
    });

    expect(result.payload).toMatchObject({
      topic: 'neighbor market note',
      turns: [
        { speakerAgentId: 'agent-1', utterance: 'I will check Fish prices after work.' },
        { speakerAgentId: 'agent-2', utterance: 'I can compare grain prices meanwhile.' },
      ],
    });
    expect(result.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'agent-1:430:social-check-in:social-dialogue',
      actionId: 'social-check-in',
    });
  });
});

const selectedSubtask: PrioritizedSubtask = {
  branchId: 'social',
  subtaskId: 'check-in',
  description: 'Check in with a neighbor about market conditions.',
  score: 7,
};

const deterministicPayload: SocialDialoguePayload = {
  targetAgentId,
  topic: 'neighborhood food prices',
  relationDelta: 0.05,
  attitudeDelta: 0.02,
  turns: [
    {
      speakerAgentId: agentId,
      utterance: 'Do you know whether fish stayed affordable today?',
      intent: 'ask-about-prices',
    },
    {
      speakerAgentId: targetAgentId,
      utterance: 'I heard it was still manageable near the market.',
      intent: 'share-market-rumor',
    },
  ],
};

const action: AtomicActionProposal<'AgentStartConversation', SocialDialoguePayload> = {
  id: 'social-check-in',
  description: 'Start a conversation with a neighbor.',
  commandType: 'AgentStartConversation',
  payload: deterministicPayload,
  priority: 7,
};

function createContextualPlan() {
  return createBranchPlan({
    objective: 'Maintain social ties while making economical survival choices.',
    branches: [
      {
        id: 'social',
        objective: 'Maintain relationships',
        subtasks: [
          {
            id: 'check-in',
            description: 'Check in with a neighbor about market conditions.',
            basePriority: 7,
          },
        ],
      },
    ],
  });
}

function createRecentConversationMemory() {
  return createShortTermMemoryRecord({
    id: 'memory-neighbor-helped-with-prices',
    agentId,
    kind: 'social-interaction',
    status: 'succeeded',
    summary: 'A neighbor recently helped compare market prices.',
    occurredAt: 350,
    importanceScore: 0.8,
    source: { eventIds: [] },
    tags: ['social', 'market', 'prices'],
  });
}

function createLongTermProfile() {
  return {
    agentId,
    beliefs: [
      {
        key: 'neighbors-share-useful-market-information',
        statement: 'Neighbors often share useful market information.',
        confidence: 0.75,
        updatedAt: 320,
        provenanceRecordIds: [asMemoryRecordId('reflection-neighbor-market-info')],
      },
    ],
    habits: [],
    mood: [],
    values: [],
    personality: [],
    socialRecords: [],
  };
}

function createWorldDecisionContext(): WorldDecisionContext {
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
        baselineAt: 1,
        recordedAt: 100,
        overall: 1.5,
        ratios: { Fish: 1.5 },
      },
    },
  };
}
