import { createScriptedLlmProvider } from '@aivilization/llm';
import { asMemoryRecordId, createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type { AtomicActionProposal } from './actions';
import {
  createTraceableLlmReplanningDecider,
  proposeReplanningDecisionWithLlm,
} from './llmReplanningDecider';
import { createBranchPlan } from './planner';
import type { AdaptiveReplanningPolicy } from './replanning';
import type { WorldDecisionContext } from './worldDecisionContext';

const agentId = asAgentId('agent-1');

describe('LLM replanning decision seam', () => {
  test('accepts a memory-guided decision grounded in STM and world context', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-replanning-decider',
      responses: [
        {
          providerId: 'scripted-replanning-decider',
          model: 'replan-model',
          finishReason: 'stop',
          usage: { inputTokens: 90, outputTokens: 24 },
          content: JSON.stringify({
            decision: {
              kind: 'memory-guided-correction',
              trigger: 'simulator-rejection',
              reason: 'Recent hungry work failures suggest a cheap recovery action before replanning.',
              failedActionIds: ['work-hungry'],
              evidenceRecordIds: ['memory-work-failed-hungry'],
            },
          }),
        },
      ],
    });

    const result = await proposeReplanningDecisionWithLlm({
      agentId,
      issuedAt: 500,
      plan: createContextualPlan(),
      signals: [{ key: 'income', weight: 5 }],
      selectedSubtask: {
        branchId: 'income',
        subtaskId: 'work',
        description: 'work shift',
        score: 8,
      },
      simulationResults: [
        {
          status: 'needs-replan',
          action: createRejectedAction(),
          reason: 'satiety too low',
        },
      ],
      shortTermMemoryContext: [createRecentFailureMemory(), createRecentSuccessMemory()],
      policy: createPolicy(),
      longTermProfile: createLongTermProfile(),
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'replan-model',
      requestId: 'replanning-agent-1-500',
      pricing: { inputTokenCostMicros: 2, outputTokenCostMicros: 5 },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      source: 'llm',
      decision: {
        kind: 'memory-guided-correction',
        trigger: 'simulator-rejection',
        reason: 'Recent hungry work failures suggest a cheap recovery action before replanning.',
        failedActionIds: ['work-hungry'],
        evidenceRecordIds: ['memory-work-failed-hungry'],
      },
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'replanning-agent-1-500',
        providerId: 'scripted-replanning-decider',
        model: 'replan-model',
        decision: {
          kind: 'memory-guided-correction',
          failedActionIds: ['work-hungry'],
          evidenceRecordIds: ['memory-work-failed-hungry'],
        },
        usage: {
          inputTokens: 90,
          outputTokens: 24,
          totalTokens: 114,
          estimatedCostMicros: 300,
        },
        shortTermMemoryContext: { recordCount: 2 },
        longTermProfileContext: { entryCount: 1 },
        worldDecisionContext: {
          agentId,
          hasPhysiology: true,
          hasBalance: true,
          hasEducationScore: true,
          hasResidentialTier: true,
          inventoryItemCount: 1,
          marketSpotPriceCount: 1,
          hasLatestPriceIndex: true,
        },
      },
    });

    const request = scripted.getRequests()[0];
    expect(request).toMatchObject({
      requestId: 'replanning-agent-1-500',
      model: 'replan-model',
      schemaName: 'aivilization_replanning_decision',
    });
    const requestContent = request?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"simulationResults"');
    expect(requestContent).toContain('"deterministicFallbackDecision"');
    expect(requestContent).toContain('"shortTermMemoryContext"');
    expect(requestContent).toContain('"longTermProfile"');
    expect(requestContent).toContain('"worldDecisionContext"');
    expect(requestContent).toContain('"memory-work-failed-hungry"');
    expect(requestContent).toContain('"satiety":20');
    expect(requestContent).toContain('"balance":42');
    expect(requestContent).toContain('"Fish":2');
    expect(requestContent).toContain('"spotPrice":304.5');
  });

  test('falls back when the LLM cites STM evidence that was not provided', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-replanning-decider',
      responses: [
        {
          providerId: 'scripted-replanning-decider',
          model: 'replan-model',
          finishReason: 'stop',
          content: JSON.stringify({
            decision: {
              kind: 'memory-guided-correction',
              trigger: 'simulator-rejection',
              reason: 'Invented evidence should not be trusted.',
              failedActionIds: ['work-hungry'],
              evidenceRecordIds: ['missing-memory'],
            },
          }),
        },
      ],
    });

    const result = await proposeReplanningDecisionWithLlm({
      agentId,
      issuedAt: 510,
      plan: createContextualPlan(),
      signals: [],
      selectedSubtask: {
        branchId: 'income',
        subtaskId: 'work',
        description: 'work shift',
        score: 8,
      },
      simulationResults: [
        {
          status: 'needs-replan',
          action: createRejectedAction(),
          reason: 'satiety too low',
        },
      ],
      shortTermMemoryContext: [createRecentFailureMemory()],
      policy: createPolicy(),
      provider: scripted.provider,
      model: 'replan-model',
      requestId: 'replanning-invalid-evidence',
    });

    expect(result).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      decision: {
        kind: 'memory-guided-correction',
        trigger: 'simulator-rejection',
        reason: 'satiety too low',
        failedActionIds: ['work-hungry'],
        evidenceRecordIds: ['memory-work-failed-hungry'],
      },
      trace: {
        status: 'fallback',
        source: 'deterministic-fallback',
        requestId: 'replanning-invalid-evidence',
        failureReason: 'schema-invalid',
      },
    });
  });

  test('creates a traceable decider compatible with async planning cycles', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-replanning-decider',
      responses: [
        {
          providerId: 'scripted-replanning-decider',
          model: 'replan-model',
          finishReason: 'stop',
          content: JSON.stringify({
            decision: {
              kind: 'full-replan',
              trigger: 'repeated-failure',
              reason: 'Repeated hungry work failures need a new branch ordering.',
              failedActionIds: ['work-hungry'],
              evidenceRecordIds: ['memory-work-failed-hungry', 'memory-work-failed-again'],
              matchingFailureCount: 2,
            },
          }),
        },
      ],
    });
    const decider = createTraceableLlmReplanningDecider({
      provider: scripted.provider,
      model: 'replan-model',
      requestId: ({ agentId, issuedAt }) => `${agentId}:${issuedAt}:replanning`,
    });

    const result = await decider({
      agentId,
      issuedAt: 520,
      plan: createContextualPlan(),
      signals: [],
      selectedSubtask: {
        branchId: 'income',
        subtaskId: 'work',
        description: 'work shift',
        score: 8,
      },
      simulationResults: [
        {
          status: 'needs-replan',
          action: createRejectedAction(),
          reason: 'satiety too low',
        },
      ],
      shortTermMemoryContext: [createRecentFailureMemory(), createRepeatedFailureMemory()],
      policy: createPolicy(),
      worldDecisionContext: createWorldDecisionContext(),
    });

    expect(result.decision).toMatchObject({
      kind: 'full-replan',
      trigger: 'repeated-failure',
      failedActionIds: ['work-hungry'],
      evidenceRecordIds: ['memory-work-failed-hungry', 'memory-work-failed-again'],
      matchingFailureCount: 2,
    });
    expect(result.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'agent-1:520:replanning',
      decision: {
        kind: 'full-replan',
        trigger: 'repeated-failure',
      },
    });
  });
});

function createRejectedAction(): AtomicActionProposal {
  return {
    id: 'work-hungry',
    description: 'work while hungry',
    commandType: 'AgentWork',
    payload: { occupationName: 'Stock Clerk', laborSeconds: 3600 },
    priority: 9,
    resourceEstimate: { actionSeconds: 3600, energyCost: 10, satietyCost: 10 },
    synthesisContext: { branchId: 'income', subtaskId: 'work', subtaskScore: 8 },
  };
}

function createContextualPlan() {
  return createBranchPlan({
    objective: 'Earn income without collapsing physiology.',
    branches: [
      {
        id: 'income',
        objective: 'Earn wages.',
        subtasks: [{ id: 'work', description: 'work shift', basePriority: 8 }],
      },
      {
        id: 'recovery',
        objective: 'Maintain satiety.',
        subtasks: [{ id: 'eat', description: 'eat before working', basePriority: 7 }],
      },
    ],
  });
}

function createRecentFailureMemory() {
  return createShortTermMemoryRecord({
    id: 'memory-work-failed-hungry',
    agentId,
    kind: 'action',
    status: 'failed',
    summary: 'Failed to work because satiety was too low; eating Fish first usually recovers.',
    occurredAt: 490,
    importanceScore: 0.9,
    source: { eventIds: [] },
    tags: ['work', 'satiety', 'Fish'],
  });
}

function createRepeatedFailureMemory() {
  return createShortTermMemoryRecord({
    id: 'memory-work-failed-again',
    agentId,
    kind: 'action',
    status: 'failed',
    summary: 'Another work attempt failed because satiety was too low.',
    occurredAt: 495,
    importanceScore: 0.88,
    source: { eventIds: [] },
    tags: ['work', 'satiety'],
  });
}

function createRecentSuccessMemory() {
  return createShortTermMemoryRecord({
    id: 'memory-eat-before-work-succeeded',
    agentId,
    kind: 'action',
    status: 'succeeded',
    summary: 'Ate Fish before a short work shift and avoided simulator rejection.',
    occurredAt: 497,
    importanceScore: 0.8,
    source: { eventIds: [] },
    tags: ['work', 'eat', 'Fish'],
  });
}

function createPolicy(): AdaptiveReplanningPolicy {
  return {
    consecutiveFailureThreshold: 2,
    failureTags: ['work', 'satiety'],
  };
}

function createLongTermProfile() {
  return {
    agentId,
    beliefs: [
      {
        key: 'recover-before-work',
        statement: 'Small recovery actions before work prevent repeated failures.',
        confidence: 0.8,
        updatedAt: 490,
        provenanceRecordIds: [asMemoryRecordId('reflection-recover-before-work')],
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
      physiology: { energy: 45, satiety: 20, health: 90 },
      educationScore: 31,
      balance: 42,
      residentialTier: 2,
      job: 'Stock Clerk',
      inventory: { Fish: 2 },
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
