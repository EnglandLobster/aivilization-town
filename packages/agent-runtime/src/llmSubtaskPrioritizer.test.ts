import { createScriptedLlmProvider } from '@aivilization/llm';
import { asMemoryRecordId, createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createBranchPlan, scorePrioritizedSubtaskCandidates } from './planner';
import {
  createTraceableLlmSubtaskPrioritizer,
  proposeSubtaskPrioritizationWithLlm,
} from './llmSubtaskPrioritizer';
import type { WorldDecisionContext } from './worldDecisionContext';

const agentId = asAgentId('agent-1');

describe('LLM contextual subtask prioritizer seam', () => {
  test('accepts an LLM ranking over existing candidates with world decision context', async () => {
    const plan = createContextualPlan();
    const candidates = scorePrioritizedSubtaskCandidates({
      plan,
      signals: [],
    });
    expect(candidates.map((candidate) => candidate.subtaskId)).toEqual(['work', 'eat']);

    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-prioritizer',
      responses: [
        {
          providerId: 'scripted-prioritizer',
          model: 'prioritizer-model',
          finishReason: 'stop',
          usage: { inputTokens: 40, outputTokens: 20 },
          content: JSON.stringify({
            rankedSubtasks: [
              {
                branchId: 'recovery',
                subtaskId: 'eat',
                priorityScore: 13,
                rationale:
                  'Satiety is low, Fish is already in inventory, and food action protects health before wage work.',
              },
              {
                branchId: 'income',
                subtaskId: 'work',
                priorityScore: 7,
                rationale:
                  'Work remains useful but should wait until immediate physiological risk is lower.',
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeSubtaskPrioritizationWithLlm({
      agentId,
      issuedAt: 100,
      plan,
      signals: [],
      candidates,
      observedStateSummary:
        'energy=48 satiety=30 health=92 education=31 balance=191696904 residentialTier=5 job=Stock Clerk inventory=Fish:46,Apple:2',
      shortTermMemoryContext: [createRecentRecoveryMemory()],
      longTermProfile: createLongTermProfile(),
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'prioritizer-model',
      requestId: 'prioritize-agent-1-100',
      maxAttempts: 1,
      pricing: { inputTokenCostMicros: 2, outputTokenCostMicros: 3 },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      source: 'llm',
      candidates: [
        {
          branchId: 'recovery',
          subtaskId: 'eat',
          score: 13,
          scoreBreakdown: {
            basePriorityScore: 2,
            contextualReasoningScore: 11,
          },
        },
        {
          branchId: 'income',
          subtaskId: 'work',
          score: 7,
          scoreBreakdown: {
            basePriorityScore: 6,
            contextualReasoningScore: 1,
          },
        },
      ],
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'prioritize-agent-1-100',
        providerId: 'scripted-prioritizer',
        model: 'prioritizer-model',
        choices: [
          {
            branchId: 'recovery',
            subtaskId: 'eat',
            priorityScore: 13,
          },
          {
            branchId: 'income',
            subtaskId: 'work',
            priorityScore: 7,
          },
        ],
        usage: {
          inputTokens: 40,
          outputTokens: 20,
          totalTokens: 60,
          estimatedCostMicros: 140,
        },
        shortTermMemoryContext: { recordCount: 1 },
        longTermProfileContext: { entryCount: 1 },
        worldDecisionContext: {
          agentId,
          hasPhysiology: true,
          hasBalance: true,
          hasEducationScore: true,
          hasResidentialTier: true,
          hasEconomicState: true,
          inventoryItemCount: 2,
          marketSpotPriceCount: 1,
          hasLatestPriceIndex: true,
          hasMarketPrices: true,
          completeEconomicContext: true,
        },
      },
    });

    const request = scripted.getRequests()[0];
    expect(request).toMatchObject({
      requestId: 'prioritize-agent-1-100',
      model: 'prioritizer-model',
      schemaName: 'aivilization_subtask_prioritization',
    });
    const requestContent = request?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"observedStateSummary"');
    expect(requestContent).toContain(
      '"energy=48 satiety=30 health=92 education=31 balance=191696904 residentialTier=5 job=Stock Clerk inventory=Fish:46,Apple:2"',
    );
    expect(requestContent).toContain('"worldDecisionContext"');
    expect(requestContent).toContain('"shortTermMemoryContext"');
    expect(requestContent).toContain('"longTermProfile"');
    expect(requestContent).toContain('"satiety":30');
    expect(requestContent).toContain('"balance":191696904');
    expect(requestContent).toContain('"educationScore":31');
    expect(requestContent).toContain('"residentialTier":5');
    expect(requestContent).toContain('"Fish":46');
    expect(requestContent).toContain('"spotPrice":304.5');
    expect(requestContent).toContain('"stage":"subtask-prioritization"');
    expect(requestContent).toContain('"salience"');
    expect(requestContent).toContain('"Stock Clerk"');
    expect(requestContent).not.toContain('"rules"');
    expect(requestContent).not.toContain('"effectiveEducationThreshold":20');
    expect(requestContent).not.toContain('"enterprises"');
    expect(requestContent).not.toContain('"society"');
    expect(requestContent).toContain('"subtaskId":"eat"');
    expect(requestContent).toContain('"subtaskId":"work"');
  });

  test('falls back to deterministic ordering when an LLM ranking references an unknown subtask', async () => {
    const plan = createContextualPlan();
    const candidates = scorePrioritizedSubtaskCandidates({
      plan,
      signals: [],
    });
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-prioritizer',
      responses: [
        {
          providerId: 'scripted-prioritizer',
          model: 'prioritizer-model',
          finishReason: 'stop',
          content: JSON.stringify({
            rankedSubtasks: [
              {
                branchId: 'recovery',
                subtaskId: 'teleport-to-buffet',
                priorityScore: 99,
                rationale: 'Invalid proposal that should be rejected by agent-runtime.',
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeSubtaskPrioritizationWithLlm({
      agentId,
      issuedAt: 120,
      plan,
      signals: [],
      candidates,
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'prioritizer-model',
      requestId: 'prioritize-invalid',
    });

    expect(result.status).toBe('fallback');
    expect(result.source).toBe('deterministic-fallback');
    expect(result.candidates.map((candidate) => candidate.subtaskId)).toEqual(['work', 'eat']);
    expect(result.trace).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      requestId: 'prioritize-invalid',
      failureReason: 'schema-invalid',
    });
  });

  test('creates a traceable prioritizer compatible with async planning cycles', async () => {
    const plan = createContextualPlan();
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-prioritizer',
      responses: [
        {
          providerId: 'scripted-prioritizer',
          model: 'prioritizer-model',
          finishReason: 'stop',
          content: JSON.stringify({
            rankedSubtasks: [
              {
                branchId: 'recovery',
                subtaskId: 'eat',
                priorityScore: 13,
                rationale: 'Eat first because satiety is critically low.',
              },
              {
                branchId: 'income',
                subtaskId: 'work',
                priorityScore: 7,
                rationale: 'Work second after recovery.',
              },
            ],
          }),
        },
      ],
    });
    const prioritizer = createTraceableLlmSubtaskPrioritizer({
      provider: scripted.provider,
      model: 'prioritizer-model',
      requestId: ({ agentId, issuedAt }) => `${agentId}:${issuedAt}:prioritize`,
    });

    const result = await prioritizer({
      agentId,
      issuedAt: 140,
      plan,
      signals: [],
      candidates: scorePrioritizedSubtaskCandidates({ plan, signals: [] }),
      worldDecisionContext: createWorldDecisionContext(),
    });

    expect(result.candidates[0]?.subtaskId).toBe('eat');
    expect(result.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'agent-1:140:prioritize',
      choices: [{ subtaskId: 'eat' }, { subtaskId: 'work' }],
    });
  });
});

function createContextualPlan() {
  return createBranchPlan({
    objective: 'Balance survival and income.',
    branches: [
      {
        id: 'income',
        objective: 'Earn currency for long-term goals.',
        subtasks: [
          {
            id: 'work',
            description: 'Work a wage shift.',
            basePriority: 6,
          },
        ],
      },
      {
        id: 'recovery',
        objective: 'Restore physiological stability.',
        subtasks: [
          {
            id: 'eat',
            description: 'Eat Fish before health decays.',
            basePriority: 2,
          },
        ],
      },
    ],
  });
}

function createRecentRecoveryMemory() {
  return createShortTermMemoryRecord({
    id: 'memory-eat-before-work',
    agentId,
    kind: 'action',
    status: 'succeeded',
    summary: 'Eating Fish before wage work prevented low-satiety failure.',
    occurredAt: 90,
    importanceScore: 0.8,
    source: { eventIds: [] },
    tags: ['eat', 'work', 'Fish'],
  });
}

function createLongTermProfile() {
  return {
    agentId,
    beliefs: [],
    habits: [
      {
        key: 'recover-before-work',
        statement: 'Recover satiety before starting wage work.',
        confidence: 0.82,
        updatedAt: 90,
        provenanceRecordIds: [asMemoryRecordId('reflection-recover-before-work')],
      },
    ],
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
        baselineAt: 0,
        recordedAt: 100,
        overall: 1.12,
        ratios: { Fish: 1.12 },
      },
    },
    rules: {
      criticalThresholds: { energy: 20, health: 35 },
      occupations: [
        {
          occupationName: 'Stock Clerk',
          jobTier: 2,
          baseWage: 260,
          effectiveEducationThreshold: 20,
          requiredResidentialTier: 2,
          prerequisiteCommodity: 'Beef',
          eligible: true,
          rejectionReasons: [],
          applicationQuota: {
            residentialTier: 5,
            limit: 5,
            currentApplications: 1,
            remaining: 4,
          },
        },
      ],
      production: [
        {
          commodity: 'Transistor',
          minResidentialTier: 5,
          inputs: { 'Copper Ingot': 1, 'Iron Ingot': 1 },
          energyCost: 60,
          satietyCost: 15,
          timeCostSeconds: 3,
          producible: true,
          rejectionReasons: [],
        },
      ],
    },
  };
}
