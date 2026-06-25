import { createScriptedLlmProvider } from '@aivilization/llm';
import { asMemoryRecordId, createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type { AtomicActionProposal } from './actions';
import { synthesizeActionCandidates } from './actionSynthesis';
import { createBranchPlan } from './planner';
import {
  createTraceableLlmGlobalSynthesizer,
  proposeGlobalSynthesisWithLlm,
} from './llmGlobalSynthesizer';
import type { WorldDecisionContext } from './worldDecisionContext';

const agentId = asAgentId('agent-1');

describe('LLM global synthesis seam', () => {
  test('accepts a complete LLM ranking over existing cross-branch actions with context', async () => {
    const actions = createCandidateActions();
    const deterministicSynthesisResult = synthesizeActionCandidates({
      actions,
      policy: { maxActions: 2 },
    });
    expect(deterministicSynthesisResult.acceptedActions.map((action) => action.id)).toEqual([
      'produce-widget',
      'eat-fish',
    ]);

    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-global-synthesis',
      responses: [
        {
          providerId: 'scripted-global-synthesis',
          model: 'synthesis-model',
          finishReason: 'stop',
          usage: { inputTokens: 90, outputTokens: 45 },
          content: JSON.stringify({
            rankedActions: [
              {
                actionId: 'eat-fish',
                priorityScore: 18,
                strategicAlignment: 4,
                branchUrgency: 9,
                rationale:
                  'Satiety is low and eating existing Fish prevents short-term failure before production work.',
              },
              {
                actionId: 'produce-widget',
                priorityScore: 12,
                strategicAlignment: 8,
                branchUrgency: 3,
                rationale:
                  'Production remains aligned with the objective but should follow immediate survival.',
              },
              {
                actionId: 'social-check-in',
                priorityScore: 3,
                strategicAlignment: 2,
                branchUrgency: 1,
                rationale:
                  'Social follow-up is useful but less urgent than survival and production.',
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeGlobalSynthesisWithLlm({
      agentId,
      issuedAt: 300,
      plan: createContextualPlan(),
      signals: [{ key: 'long-term-production', weight: 5 }],
      candidateActions: actions,
      deterministicSynthesisResult,
      actionSynthesisPolicy: { maxActions: 2 },
      shortTermMemoryContext: [createRecentFailureMemory()],
      longTermProfile: createLongTermProfile(),
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'synthesis-model',
      requestId: 'global-synthesis-agent-1-300',
      pricing: { inputTokenCostMicros: 2, outputTokenCostMicros: 5 },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      source: 'llm',
      actions: [
        {
          id: 'eat-fish',
          priority: 18,
          synthesisContext: {
            branchId: 'recovery',
            subtaskId: 'eat',
            strategicAlignment: 4,
            branchUrgency: 9,
          },
        },
        {
          id: 'produce-widget',
          priority: 12,
          synthesisContext: {
            branchId: 'production',
            subtaskId: 'produce',
            strategicAlignment: 8,
            branchUrgency: 3,
          },
        },
        {
          id: 'social-check-in',
          priority: 3,
          synthesisContext: {
            branchId: 'social',
            subtaskId: 'check-in',
            strategicAlignment: 2,
            branchUrgency: 1,
          },
        },
      ],
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'global-synthesis-agent-1-300',
        providerId: 'scripted-global-synthesis',
        model: 'synthesis-model',
        choices: [
          {
            actionId: 'eat-fish',
            priorityScore: 18,
            rationale:
              'Satiety is low and eating existing Fish prevents short-term failure before production work.',
          },
          {
            actionId: 'produce-widget',
            priorityScore: 12,
          },
          {
            actionId: 'social-check-in',
            priorityScore: 3,
          },
        ],
        usage: {
          inputTokens: 90,
          outputTokens: 45,
          totalTokens: 135,
          estimatedCostMicros: 405,
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
      requestId: 'global-synthesis-agent-1-300',
      model: 'synthesis-model',
      schemaName: 'aivilization_global_synthesis',
    });
    const requestContent = request?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"candidateActions"');
    expect(requestContent).toContain('"deterministicSynthesisResult"');
    expect(requestContent).toContain('"acceptedActions"');
    expect(requestContent).toContain('"rejectedActions"');
    expect(requestContent).toContain('"worldDecisionContext"');
    expect(requestContent).toContain('"shortTermMemoryContext"');
    expect(requestContent).toContain('"longTermProfile"');
    expect(requestContent).toContain('"satiety":30');
    expect(requestContent).toContain('"balance":191696904');
    expect(requestContent).toContain('"Fish":46');
    expect(requestContent).toContain('"spotPrice":304.5');
  });

  test('falls back when an LLM ranking references an unknown action', async () => {
    const actions = createCandidateActions();
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-global-synthesis',
      responses: [
        {
          providerId: 'scripted-global-synthesis',
          model: 'synthesis-model',
          finishReason: 'stop',
          content: JSON.stringify({
            rankedActions: [
              {
                actionId: 'teleport-to-food',
                priorityScore: 99,
                rationale: 'Invalid unknown action id.',
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeGlobalSynthesisWithLlm({
      agentId,
      issuedAt: 310,
      plan: createContextualPlan(),
      signals: [],
      candidateActions: actions,
      deterministicSynthesisResult: synthesizeActionCandidates({ actions }),
      provider: scripted.provider,
      model: 'synthesis-model',
      requestId: 'global-synthesis-unknown',
    });

    expect(result).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      actions,
      trace: {
        status: 'fallback',
        source: 'deterministic-fallback',
        requestId: 'global-synthesis-unknown',
        failureReason: 'schema-invalid',
      },
    });
  });

  test('falls back when an LLM ranking omits an existing candidate action', async () => {
    const actions = createCandidateActions();
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-global-synthesis',
      responses: [
        {
          providerId: 'scripted-global-synthesis',
          model: 'synthesis-model',
          finishReason: 'stop',
          content: JSON.stringify({
            rankedActions: [
              {
                actionId: 'eat-fish',
                priorityScore: 18,
                rationale: 'Incomplete ranking should fall back.',
              },
              {
                actionId: 'produce-widget',
                priorityScore: 12,
                rationale: 'Incomplete ranking should fall back.',
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeGlobalSynthesisWithLlm({
      agentId,
      issuedAt: 320,
      plan: createContextualPlan(),
      signals: [],
      candidateActions: actions,
      deterministicSynthesisResult: synthesizeActionCandidates({ actions }),
      provider: scripted.provider,
      model: 'synthesis-model',
      requestId: 'global-synthesis-incomplete',
    });

    expect(result.status).toBe('fallback');
    expect(result.actions).toEqual(actions);
    expect(result.trace).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      requestId: 'global-synthesis-incomplete',
      failureReason: 'schema-invalid',
    });
  });

  test('creates a traceable synthesizer compatible with async planning cycles', async () => {
    const actions = createCandidateActions();
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-global-synthesis',
      responses: [
        {
          providerId: 'scripted-global-synthesis',
          model: 'synthesis-model',
          finishReason: 'stop',
          content: JSON.stringify({
            rankedActions: [
              {
                actionId: 'eat-fish',
                priorityScore: 18,
                rationale: 'Eat first because satiety is low.',
              },
              {
                actionId: 'produce-widget',
                priorityScore: 12,
                rationale: 'Produce second after stabilizing satiety.',
              },
              {
                actionId: 'social-check-in',
                priorityScore: 3,
                rationale: 'Social action is lower urgency.',
              },
            ],
          }),
        },
      ],
    });
    const synthesizer = createTraceableLlmGlobalSynthesizer({
      provider: scripted.provider,
      model: 'synthesis-model',
      requestId: ({ agentId, issuedAt }) => `${agentId}:${issuedAt}:global-synthesis`,
    });

    const result = await synthesizer({
      agentId,
      issuedAt: 330,
      plan: createContextualPlan(),
      signals: [],
      candidateActions: actions,
      deterministicSynthesisResult: synthesizeActionCandidates({ actions }),
      worldDecisionContext: createWorldDecisionContext(),
    });

    expect(result.actions.map((action) => action.id)).toEqual([
      'eat-fish',
      'produce-widget',
      'social-check-in',
    ]);
    expect(result.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'agent-1:330:global-synthesis',
      choices: [
        { actionId: 'eat-fish', priorityScore: 18, rationale: 'Eat first because satiety is low.' },
        {
          actionId: 'produce-widget',
          priorityScore: 12,
          rationale: 'Produce second after stabilizing satiety.',
        },
        {
          actionId: 'social-check-in',
          priorityScore: 3,
          rationale: 'Social action is lower urgency.',
        },
      ],
    });
  });
});

function createCandidateActions(): readonly AtomicActionProposal[] {
  return [
    {
      id: 'produce-widget',
      description: 'produce Widget for the long-term production goal',
      commandType: 'AgentProduce',
      payload: { commodityName: 'Widget', quantity: 1, availableLaborSeconds: 120 },
      priority: 15,
      resourceEstimate: { actionSeconds: 120, energyCost: 10 },
      synthesisContext: {
        branchId: 'production',
        subtaskId: 'produce',
        subtaskScore: 9,
      },
    },
    {
      id: 'eat-fish',
      description: 'eat Fish from inventory',
      commandType: 'AgentEat',
      payload: { commodityName: 'Fish', quantity: 1 },
      priority: 4,
      resourceEstimate: { inventoryCosts: { Fish: 1 } },
      synthesisContext: {
        branchId: 'recovery',
        subtaskId: 'eat',
        subtaskScore: 8,
      },
    },
    {
      id: 'social-check-in',
      description: 'check in with a collaborator',
      commandType: 'AgentStartConversation',
      payload: { targetAgentId: 'agent-2', topic: 'production help', turns: [] },
      priority: 2,
      synthesisContext: {
        branchId: 'social',
        subtaskId: 'check-in',
        subtaskScore: 3,
      },
    },
  ];
}

function createContextualPlan() {
  return createBranchPlan({
    objective: 'Keep production moving without sacrificing survival.',
    branches: [
      {
        id: 'production',
        objective: 'Make high-value goods.',
        subtasks: [{ id: 'produce', description: 'produce Widget', basePriority: 9 }],
      },
      {
        id: 'recovery',
        objective: 'Maintain physiology.',
        subtasks: [{ id: 'eat', description: 'eat before working', basePriority: 8 }],
      },
      {
        id: 'social',
        objective: 'Maintain collaborators.',
        subtasks: [{ id: 'check-in', description: 'check in with collaborator', basePriority: 3 }],
      },
    ],
  });
}

function createRecentFailureMemory() {
  return createShortTermMemoryRecord({
    id: 'memory-production-failed-while-hungry',
    agentId,
    kind: 'action',
    status: 'failed',
    summary: 'Production failed when satiety dropped before a work action.',
    occurredAt: 280,
    importanceScore: 0.9,
    source: { eventIds: [] },
    tags: ['production', 'satiety', 'failure'],
  });
}

function createLongTermProfile() {
  return {
    agentId,
    beliefs: [
      {
        key: 'survival-before-production',
        statement: 'Stabilize survival needs before long production chains.',
        confidence: 0.8,
        updatedAt: 270,
        provenanceRecordIds: [asMemoryRecordId('reflection-survival-first')],
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
      inventory: { Fish: 46, Widget: 1 },
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
