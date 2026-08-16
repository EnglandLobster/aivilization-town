import { createScriptedLlmProvider } from '@aivilization/llm';
import { asMemoryRecordId, createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type { AtomicActionProposal } from './actions';
import { createBranchPlan, type PrioritizedSubtask } from './planner';
import {
  createTraceableLlmActionSequenceGenerator,
  proposeActionSequenceWithLlm,
} from './llmActionSequenceGenerator';
import type { WorldDecisionContext } from './worldDecisionContext';

const agentId = asAgentId('agent-1');

describe('LLM action sequence generation seam', () => {
  test('accepts a valid LLM-generated action sequence with world and memory context', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-action-sequence',
      responses: [
        {
          providerId: 'scripted-action-sequence',
          model: 'sequence-model',
          finishReason: 'stop',
          usage: { inputTokens: 80, outputTokens: 30 },
          content: JSON.stringify({
            actions: [
              {
                id: 'llm-eat-fish',
                description: 'Eat Fish from inventory before returning to wage work.',
                commandType: 'AgentEat',
                payload: { commodityName: 'Fish', quantity: 1 },
                priority: 14,
                resourceEstimate: { inventoryCosts: { Fish: 1 } },
                rationale:
                  'Satiety is low, Fish is already held, and eating protects near-term health before income actions.',
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeActionSequenceWithLlm({
      agentId,
      issuedAt: 200,
      plan: createContextualPlan(),
      selectedSubtask: selectedEatSubtask,
      signals: [{ key: 'survival', weight: 4 }],
      deterministicActions: deterministicEatActions,
      shortTermMemoryContext: [createRecentFailureMemory()],
      longTermProfile: createLongTermProfile(),
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'sequence-model',
      requestId: 'sequence-agent-1-200',
      pricing: { inputTokenCostMicros: 2, outputTokenCostMicros: 5 },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      source: 'llm',
      actions: [
        {
          id: 'llm-eat-fish',
          description: 'Eat Fish from inventory before returning to wage work.',
          commandType: 'AgentEat',
          payload: { commodityName: 'Fish', quantity: 1 },
          priority: 14,
          resourceEstimate: { inventoryCosts: { Fish: 1 } },
        },
      ],
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'sequence-agent-1-200',
        providerId: 'scripted-action-sequence',
        model: 'sequence-model',
        selectedSubtask: { branchId: 'recovery', subtaskId: 'eat' },
        actions: [
          {
            id: 'llm-eat-fish',
            commandType: 'AgentEat',
            rationale:
              'Satiety is low, Fish is already held, and eating protects near-term health before income actions.',
          },
        ],
        usage: {
          inputTokens: 80,
          outputTokens: 30,
          totalTokens: 110,
          estimatedCostMicros: 310,
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
      requestId: 'sequence-agent-1-200',
      model: 'sequence-model',
      schemaName: 'aivilization_action_sequence_generation',
    });
    const requestContent = request?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"selectedSubtask"');
    expect(requestContent).toContain('"deterministicActions"');
    expect(requestContent).toContain('"shortTermMemoryContext"');
    expect(requestContent).toContain('"longTermProfile"');
    expect(requestContent).toContain('"worldDecisionContext"');
    expect(requestContent).toContain('"satiety":30');
    expect(requestContent).toContain('"balance":191696904');
    expect(requestContent).toContain('"Fish":46');
    expect(requestContent).toContain('"spotPrice":304.5');
  });

  test('persona framing: golden parse with an identity-bearing context', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-action-sequence',
      responses: [
        {
          providerId: 'scripted-action-sequence',
          model: 'sequence-model',
          finishReason: 'stop',
          content: JSON.stringify({
            actions: [
              {
                id: 'llm-eat-fish',
                description: 'Eat Fish from inventory.',
                commandType: 'AgentEat',
                payload: { commodityName: 'Fish', quantity: 1 },
                rationale: 'Satiety is low; eating first protects health.',
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeActionSequenceWithLlm({
      agentId,
      issuedAt: 240,
      plan: createContextualPlan(),
      selectedSubtask: selectedEatSubtask,
      signals: [],
      deterministicActions: deterministicEatActions,
      worldDecisionContext: createPersonaWorldDecisionContext(),
      provider: scripted.provider,
      model: 'sequence-model',
      requestId: 'sequence-persona-golden-parse',
    });

    expect(result).toMatchObject({ status: 'accepted', source: 'llm' });
    const systemMessage = scripted.getRequests()[0]?.messages[0]?.content ?? '';
    expect(systemMessage).toContain('You are acting as Li Na — adult Stock Clerk of this town.');
    expect(systemMessage).toContain('You are the AIvilization Action Sequence Generation module');
    expect(systemMessage).toContain('must not contradict the JSON state');
  });

  test('persona framing stays neutral when the context carries no display name', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-action-sequence',
      responses: [
        {
          providerId: 'scripted-action-sequence',
          model: 'sequence-model',
          finishReason: 'stop',
          content: JSON.stringify({
            actions: [
              {
                id: 'llm-eat-fish',
                description: 'Eat Fish from inventory.',
                commandType: 'AgentEat',
                payload: { commodityName: 'Fish', quantity: 1 },
                rationale: 'Satiety is low; eating first protects health.',
              },
            ],
          }),
        },
      ],
    });

    await proposeActionSequenceWithLlm({
      agentId,
      issuedAt: 250,
      plan: createContextualPlan(),
      selectedSubtask: selectedEatSubtask,
      signals: [],
      deterministicActions: deterministicEatActions,
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'sequence-model',
      requestId: 'sequence-neutral-framing',
    });

    const systemMessage = scripted.getRequests()[0]?.messages[0]?.content ?? '';
    expect(systemMessage).not.toContain('You are acting as');
    expect(systemMessage).not.toContain('must not contradict the JSON state');
    expect(systemMessage).toContain('You are the AIvilization Action Sequence Generation module');
  });

  test('falls back when an LLM action sequence emits an unknown command type', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-action-sequence',
      responses: [
        {
          providerId: 'scripted-action-sequence',
          model: 'sequence-model',
          finishReason: 'stop',
          content: JSON.stringify({
            actions: [
              {
                id: 'llm-teleport',
                description: 'Teleport to food.',
                commandType: 'AgentTeleport',
                payload: { target: 'restaurant' },
                rationale: 'Invalid command type that must not pass runtime validation.',
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeActionSequenceWithLlm({
      agentId,
      issuedAt: 210,
      plan: createContextualPlan(),
      selectedSubtask: selectedEatSubtask,
      signals: [],
      deterministicActions: deterministicEatActions,
      provider: scripted.provider,
      model: 'sequence-model',
      requestId: 'sequence-unknown-command',
    });

    expect(result).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      actions: deterministicEatActions,
      trace: {
        status: 'fallback',
        source: 'deterministic-fallback',
        requestId: 'sequence-unknown-command',
        failureReason: 'schema-invalid',
      },
    });
  });

  test('falls back when an LLM action sequence emits an invalid resource estimate', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-action-sequence',
      responses: [
        {
          providerId: 'scripted-action-sequence',
          model: 'sequence-model',
          finishReason: 'stop',
          content: JSON.stringify({
            actions: [
              {
                id: 'llm-eat-fish',
                description: 'Eat Fish with an invalid estimate.',
                commandType: 'AgentEat',
                payload: { commodityName: 'Fish', quantity: 1 },
                resourceEstimate: { actionSeconds: 'soon' },
                rationale: 'Invalid resource estimate must not pass runtime validation.',
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeActionSequenceWithLlm({
      agentId,
      issuedAt: 220,
      plan: createContextualPlan(),
      selectedSubtask: selectedEatSubtask,
      signals: [],
      deterministicActions: deterministicEatActions,
      provider: scripted.provider,
      model: 'sequence-model',
      requestId: 'sequence-invalid-estimate',
    });

    expect(result.status).toBe('fallback');
    expect(result.actions).toEqual(deterministicEatActions);
    expect(result.trace).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      requestId: 'sequence-invalid-estimate',
      failureReason: 'schema-invalid',
    });
  });

  test('creates a traceable generator compatible with async planning cycles', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-action-sequence',
      responses: [
        {
          providerId: 'scripted-action-sequence',
          model: 'sequence-model',
          finishReason: 'stop',
          content: JSON.stringify({
            actions: [
              {
                id: 'llm-eat-fish',
                description: 'Eat Fish from inventory.',
                commandType: 'AgentEat',
                payload: { commodityName: 'Fish', quantity: 1 },
                rationale: 'Eat first because satiety is low.',
              },
            ],
          }),
        },
      ],
    });
    const generator = createTraceableLlmActionSequenceGenerator({
      provider: scripted.provider,
      model: 'sequence-model',
      requestId: ({ agentId, issuedAt, selectedSubtask }) =>
        `${agentId}:${issuedAt}:${selectedSubtask.subtaskId}:sequence`,
    });

    const result = await generator({
      agentId,
      issuedAt: 230,
      plan: createContextualPlan(),
      selectedSubtask: selectedEatSubtask,
      signals: [],
      deterministicActions: deterministicEatActions,
      worldDecisionContext: createWorldDecisionContext(),
    });

    expect(result.actions[0]).toMatchObject({
      id: 'llm-eat-fish',
      commandType: 'AgentEat',
      payload: { commodityName: 'Fish', quantity: 1 },
    });
    expect(result.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'agent-1:230:eat:sequence',
      actions: [{ id: 'llm-eat-fish', commandType: 'AgentEat' }],
    });
  });
});

const selectedEatSubtask: PrioritizedSubtask = {
  branchId: 'recovery',
  subtaskId: 'eat',
  description: 'Eat Fish before health decays.',
  score: 8,
};

const deterministicEatActions: readonly AtomicActionProposal[] = [
  {
    id: 'canonical-eat-step',
    description: 'Eat Apple for deterministic fallback.',
    commandType: 'AgentEat',
    payload: { commodityName: 'Apple', quantity: 1 },
    priority: 8,
    resourceEstimate: { inventoryCosts: { Apple: 1 } },
  },
];

function createContextualPlan() {
  return createBranchPlan({
    objective: 'Balance survival and income.',
    branches: [
      {
        id: 'recovery',
        objective: 'Restore physiological stability.',
        subtasks: [
          {
            id: 'eat',
            description: 'Eat Fish before health decays.',
            basePriority: 8,
          },
        ],
      },
    ],
  });
}

function createRecentFailureMemory() {
  return createShortTermMemoryRecord({
    id: 'memory-low-satiety-work-failure',
    agentId,
    kind: 'action',
    status: 'failed',
    summary: 'Work was rejected after satiety dropped too low.',
    occurredAt: 180,
    importanceScore: 0.9,
    source: { eventIds: [] },
    tags: ['work', 'satiety', 'failure'],
  });
}

function createLongTermProfile() {
  return {
    agentId,
    beliefs: [
      {
        key: 'protect-health-before-income',
        statement: 'Protect health before risky income actions.',
        confidence: 0.8,
        updatedAt: 170,
        provenanceRecordIds: [asMemoryRecordId('reflection-health-first')],
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

function createPersonaWorldDecisionContext(): WorldDecisionContext {
  return {
    ...createWorldDecisionContext(),
    agent: {
      ...createWorldDecisionContext().agent,
      displayName: 'Li Na',
      lifecycle: { stage: 'adult', ageDays: 9_125, retired: false },
    },
  };
}
