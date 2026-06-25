import { createScriptedLlmProvider } from '@aivilization/llm';
import { createShortTermMemoryRecord, type LongTermAgentProfile } from '@aivilization/memory';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createTraceableLlmDailyPlanCompiler,
  llmDailyPlanSchema,
  proposeDailyPlanWithLlm,
} from './llmDailyPlanner';

const agentId = asAgentId('agent-a');
const hourMs = 60 * 60 * 1000;

describe('LLM daily planner seam', () => {
  test('accepts a structured LLM daily plan proposal after schema and daily-plan validation', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-daily-planner',
      responses: [
        {
          providerId: 'scripted-daily-planner',
          model: 'daily-planner-model',
          finishReason: 'stop',
          usage: { inputTokens: 40, outputTokens: 60 },
          content: JSON.stringify({
            id: 'daily-plan:agent-a:0',
            agentId,
            dayStart: 0,
            generatedAt: 8 * hourMs,
            summary: 'Study in the morning, work midday, then coordinate the party.',
            items: [
              {
                id: 'morning-study',
                description: 'Study music theory before work.',
                priority: 3,
                startsAtOffsetMs: 8 * hourMs,
                endsAtOffsetMs: 10 * hourMs,
                affinityTags: ['study', 'education'],
                source: 'long-term-profile',
              },
              {
                id: 'party-follow-up',
                description: 'Coordinate the Valentine party with Maria.',
                priority: 4,
                startsAtOffsetMs: 18 * hourMs,
                endsAtOffsetMs: 20 * hourMs,
                affinityTags: ['social', 'party'],
                source: 'memory-context',
                evidenceRecordIds: ['memory-social-party'],
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeDailyPlanWithLlm({
      agentId,
      issuedAt: 8 * hourMs,
      agent: {
        job: 'Stock Clerk',
        locationId: 'home',
        physiology: { energy: 70, satiety: 80, health: 100 },
      },
      longTermProfile: createProfile(agentId),
      memoryContext: [createPartyMemory()],
      provider: scripted.provider,
      model: 'daily-planner-model',
      requestId: 'daily-plan-agent-a-8',
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
        id: 'daily-plan:agent-a:0',
        summary: 'Study in the morning, work midday, then coordinate the party.',
        items: [
          { id: 'morning-study', source: 'long-term-profile' },
          {
            id: 'party-follow-up',
            source: 'memory-context',
            evidenceRecordIds: ['memory-social-party'],
          },
        ],
      },
      gateway: {
        status: 'succeeded',
        requestId: 'daily-plan-agent-a-8',
        usage: {
          inputTokens: 40,
          outputTokens: 60,
          totalTokens: 100,
          estimatedCostMicros: 260,
        },
      },
    });

    const [providerRequest] = scripted.getRequests();
    expect(providerRequest).toMatchObject({
      requestId: 'daily-plan-agent-a-8',
      model: 'daily-planner-model',
      schemaName: 'aivilization_daily_plan',
    });
    expect(providerRequest?.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(providerRequest?.messages[1]?.content).toContain('memory-social-party');
    expect(providerRequest?.messages[1]?.content).toContain('Stock Clerk');
    const [tool] = providerRequest?.tools ?? [];
    expect(providerRequest?.tools).toHaveLength(1);
    expect(tool?.name).toBe('submit_daily_plan');
    expect(tool?.description).toContain('high-level daily agenda');
  });

  test('includes world decision context in structured daily planner requests', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-daily-planner',
      responses: [
        {
          providerId: 'scripted-daily-planner',
          model: 'daily-planner-model',
          finishReason: 'stop',
          content: JSON.stringify({
            id: 'daily-plan:agent-a:0',
            agentId,
            dayStart: 0,
            generatedAt: 8 * hourMs,
            summary: 'Use market prices and current inventory for the day.',
            items: [
              {
                id: 'market-aware-work',
                description: 'Review Fish prices before choosing production or trade.',
                priority: 4,
                startsAtOffsetMs: 8 * hourMs,
                endsAtOffsetMs: 10 * hourMs,
                affinityTags: ['trade', 'market'],
                source: 'world-state',
              },
            ],
          }),
        },
      ],
    });

    await proposeDailyPlanWithLlm({
      agentId,
      issuedAt: 8 * hourMs,
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'daily-planner-model',
      requestId: 'daily-plan-with-world-context',
    });

    const requestContent = scripted.getRequests()[0]?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"worldDecisionContext"');
    expect(requestContent).toContain('"balance":191696904');
    expect(requestContent).toContain('"educationScore":31');
    expect(requestContent).toContain('"residentialTier":5');
    expect(requestContent).toContain('"Fish":46');
    expect(requestContent).toContain('"spotPrice":304.5');
  });

  test('falls back to deterministic daily planning when LLM output is invalid', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-daily-planner',
      responses: [
        {
          providerId: 'scripted-daily-planner',
          model: 'daily-planner-model',
          finishReason: 'stop',
          content: JSON.stringify({
            id: 'daily-plan:agent-a:0',
            agentId,
            dayStart: 0,
            generatedAt: 8 * hourMs,
            summary: 'Invalid empty plan.',
            items: [],
          }),
        },
      ],
    });

    const result = await proposeDailyPlanWithLlm({
      agentId,
      issuedAt: 8 * hourMs,
      agent: { job: 'Stock Clerk' },
      provider: scripted.provider,
      model: 'daily-planner-model',
      requestId: 'daily-plan-invalid',
    });

    expect(result).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      failure: {
        status: 'failed',
        reason: 'schema-invalid',
        requestId: 'daily-plan-invalid',
      },
      plan: {
        id: 'daily-plan:agent-a:0',
      },
    });
    expect(result.plan.items.find((item) => item.id === 'job-work-shift')).toMatchObject({
      id: 'job-work-shift',
      source: 'world-state',
    });
  });

  test('rejects daily-plan invariant violations inside the LLM schema parser', () => {
    expect(
      llmDailyPlanSchema.parse({
        id: 'daily-plan:agent-a:0',
        agentId,
        dayStart: 0,
        generatedAt: 100,
        summary: 'Invalid plan.',
        items: [
          {
            id: 'backwards-item',
            description: 'This item ends before it starts.',
            priority: 1,
            startsAtOffsetMs: 10 * hourMs,
            endsAtOffsetMs: 9 * hourMs,
            affinityTags: ['invalid'],
            source: 'baseline-routine',
          },
        ],
      }),
    ).toEqual({
      status: 'invalid',
      reason:
        'daily plan candidate invalid: daily plan item backwards-item end offset must be greater than start offset',
    });
  });

  test('creates a traceable LLM daily compiler that preserves accepted attempts and usage', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-daily-planner',
      responses: [
        {
          providerId: 'scripted-daily-planner',
          model: 'daily-planner-model',
          finishReason: 'stop',
          usage: { inputTokens: 12, outputTokens: 22 },
          content: JSON.stringify({
            id: 'daily-plan:agent-a:0',
            agentId,
            dayStart: 0,
            generatedAt: 8 * hourMs,
            summary: 'Recover energy, study, then socialize.',
            items: [
              {
                id: 'energy-recovery',
                description: 'Rest before studying.',
                priority: 4,
                startsAtOffsetMs: 6 * hourMs,
                endsAtOffsetMs: 8 * hourMs,
                affinityTags: ['sleep', 'energy'],
                source: 'world-state',
              },
            ],
          }),
        },
      ],
    });
    const compiler = createTraceableLlmDailyPlanCompiler({
      provider: scripted.provider,
      model: 'daily-planner-model',
      requestId: ({ agentId, issuedAt }) => `${agentId}:${issuedAt}`,
      pricing: {
        inputTokenCostMicros: 2,
        outputTokenCostMicros: 3,
      },
    });

    await expect(
      compiler({
        agentId,
        issuedAt: 8 * hourMs,
        agent: {
          physiology: { energy: 30, satiety: 90, health: 100 },
        },
        worldDecisionContext: createWorldDecisionContext(),
      }),
    ).resolves.toMatchObject({
      plan: {
        id: 'daily-plan:agent-a:0',
        items: [{ id: 'energy-recovery' }],
      },
      planningTrace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'agent-a:28800000',
        providerId: 'scripted-daily-planner',
        model: 'daily-planner-model',
        usage: {
          inputTokens: 12,
          outputTokens: 22,
          totalTokens: 34,
          estimatedCostMicros: 90,
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
        attempts: [
          {
            attemptIndex: 1,
            status: 'succeeded',
            providerId: 'scripted-daily-planner',
            model: 'daily-planner-model',
            message: 'LLM structured response validated',
          },
        ],
      },
    });
  });
});

function createProfile(
  agentId: AgentId,
  partial: Partial<Omit<LongTermAgentProfile, 'agentId'>> = {},
): LongTermAgentProfile {
  return {
    agentId,
    beliefs: [],
    habits: [],
    mood: [],
    values: [],
    personality: [],
    socialRecords: [],
    ...partial,
  };
}

function createPartyMemory() {
  return createShortTermMemoryRecord({
    id: 'memory-social-party',
    agentId,
    kind: 'social-interaction',
    status: 'observed',
    summary: 'Maria invited agent-a to coordinate the Valentine party at the town square.',
    occurredAt: 7 * hourMs,
    importanceScore: 0.9,
    source: { eventIds: [] },
    tags: ['social', 'party', 'agent-maria', 'town-square'],
  });
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
