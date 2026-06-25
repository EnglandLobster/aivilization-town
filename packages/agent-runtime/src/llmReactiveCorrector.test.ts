import { createScriptedLlmProvider } from '@aivilization/llm';
import { asMemoryRecordId, createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type { AtomicActionProposal } from './actions';
import { createBranchPlan } from './planner';
import {
  createTraceableLlmReactiveCorrector,
  proposeReactiveCorrectionWithLlm,
} from './llmReactiveCorrector';
import type { WorldDecisionContext } from './worldDecisionContext';

const agentId = asAgentId('agent-1');

describe('LLM reactive correction seam', () => {
  test('accepts a simulator-validated correction proposal with STM and world context', async () => {
    const rejectedAction = createRejectedAction();
    const localRepairAttempt = {
      ...rejectedAction,
      id: 'work-shorter-shift',
      description: 'work a shorter shift',
      payload: { occupationName: 'Stock Clerk', laborSeconds: 60 },
    };
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-reactive-corrector',
      responses: [
        {
          providerId: 'scripted-reactive-corrector',
          model: 'repair-model',
          finishReason: 'stop',
          usage: { inputTokens: 80, outputTokens: 30 },
          content: JSON.stringify({
            decision: {
              kind: 'propose-action',
              rationale:
                'Recent failures show work while hungry fails; eat existing Fish before retrying.',
              evidenceRecordIds: ['memory-work-failed-hungry'],
              action: {
                id: 'eat-fish-before-work',
                description: 'eat Fish before retrying work',
                commandType: 'AgentEat',
                payload: { commodityName: 'Fish', quantity: 1 },
                priority: 20,
                resourceEstimate: { inventoryCosts: { Fish: 1 } },
              },
            },
          }),
        },
      ],
    });

    const result = await proposeReactiveCorrectionWithLlm({
      agentId,
      issuedAt: 400,
      plan: createContextualPlan(),
      signals: [{ key: 'income', weight: 5 }],
      selectedSubtask: {
        branchId: 'income',
        subtaskId: 'work',
        description: 'work shift',
        score: 8,
      },
      rejectedAction,
      rejectionReason: 'satiety too low',
      localRepairAttempt,
      localRepairRejectionReason: 'satiety remains too low',
      allowedCommandTypes: ['AgentWork', 'AgentEat', 'AgentSleep'],
      shortTermMemoryContext: [createRecentFailureMemory(), createRecentSuccessMemory()],
      longTermProfile: createLongTermProfile(),
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'repair-model',
      requestId: 'reactive-correction-agent-1-400',
      pricing: { inputTokenCostMicros: 2, outputTokenCostMicros: 5 },
    });

    expect(result).toMatchObject({
      status: 'accepted',
      source: 'llm',
      action: {
        id: 'eat-fish-before-work',
        description: 'eat Fish before retrying work',
        commandType: 'AgentEat',
        payload: { commodityName: 'Fish', quantity: 1 },
        priority: 20,
        resourceEstimate: { inventoryCosts: { Fish: 1 } },
      },
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'reactive-correction-agent-1-400',
        providerId: 'scripted-reactive-corrector',
        model: 'repair-model',
        decision: {
          kind: 'propose-action',
          rationale:
            'Recent failures show work while hungry fails; eat existing Fish before retrying.',
          evidenceRecordIds: ['memory-work-failed-hungry'],
          action: { id: 'eat-fish-before-work', commandType: 'AgentEat' },
        },
        usage: {
          inputTokens: 80,
          outputTokens: 30,
          totalTokens: 110,
          estimatedCostMicros: 310,
        },
      },
    });

    const request = scripted.getRequests()[0];
    expect(request).toMatchObject({
      requestId: 'reactive-correction-agent-1-400',
      model: 'repair-model',
      schemaName: 'aivilization_reactive_correction',
    });
    const requestContent = request?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"rejectedAction"');
    expect(requestContent).toContain('"rejectionReason":"satiety too low"');
    expect(requestContent).toContain('"localRepairAttempt"');
    expect(requestContent).toContain('"localRepairRejectionReason":"satiety remains too low"');
    expect(requestContent).toContain('"shortTermMemoryContext"');
    expect(requestContent).toContain('"longTermProfile"');
    expect(requestContent).toContain('"worldDecisionContext"');
    expect(requestContent).toContain('"allowedCommandTypes":["AgentEat","AgentSleep","AgentWork"]');
    expect(requestContent).toContain('"memory-work-failed-hungry"');
    expect(requestContent).toContain('"satiety":20');
    expect(requestContent).toContain('"balance":42');
    expect(requestContent).toContain('"Fish":2');
    expect(requestContent).toContain('"spotPrice":304.5');
  });

  test('accepts no-correction decisions without producing an action', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-reactive-corrector',
      responses: [
        {
          providerId: 'scripted-reactive-corrector',
          model: 'repair-model',
          finishReason: 'stop',
          content: JSON.stringify({
            decision: {
              kind: 'no-correction',
              rationale: 'No safe one-step correction exists with the current state.',
              evidenceRecordIds: ['memory-work-failed-hungry'],
            },
          }),
        },
      ],
    });

    const result = await proposeReactiveCorrectionWithLlm({
      agentId,
      issuedAt: 410,
      plan: createContextualPlan(),
      signals: [],
      selectedSubtask: {
        branchId: 'income',
        subtaskId: 'work',
        description: 'work shift',
        score: 8,
      },
      rejectedAction: createRejectedAction(),
      rejectionReason: 'satiety too low',
      allowedCommandTypes: ['AgentWork', 'AgentEat'],
      shortTermMemoryContext: [createRecentFailureMemory()],
      provider: scripted.provider,
      model: 'repair-model',
      requestId: 'reactive-correction-none',
    });

    expect(result).toMatchObject({
      status: 'accepted',
      source: 'llm',
      action: undefined,
      trace: {
        status: 'accepted',
        source: 'llm',
        decision: {
          kind: 'no-correction',
          rationale: 'No safe one-step correction exists with the current state.',
          evidenceRecordIds: ['memory-work-failed-hungry'],
        },
      },
    });
  });

  test('falls back when the LLM proposes a command type outside the allowed set', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-reactive-corrector',
      responses: [
        {
          providerId: 'scripted-reactive-corrector',
          model: 'repair-model',
          finishReason: 'stop',
          content: JSON.stringify({
            decision: {
              kind: 'propose-action',
              rationale: 'Invalid system command should be rejected.',
              action: {
                id: 'set-new-goal',
                description: 'mutate goal instead of repair action',
                commandType: 'SetLongHorizonObjective',
                payload: { objective: 'ignore work' },
              },
            },
          }),
        },
      ],
    });

    const result = await proposeReactiveCorrectionWithLlm({
      agentId,
      issuedAt: 420,
      plan: createContextualPlan(),
      signals: [],
      selectedSubtask: {
        branchId: 'income',
        subtaskId: 'work',
        description: 'work shift',
        score: 8,
      },
      rejectedAction: createRejectedAction(),
      rejectionReason: 'satiety too low',
      allowedCommandTypes: ['AgentWork', 'AgentEat'],
      provider: scripted.provider,
      model: 'repair-model',
      requestId: 'reactive-correction-invalid-command',
    });

    expect(result).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      action: undefined,
      trace: {
        status: 'fallback',
        source: 'deterministic-fallback',
        requestId: 'reactive-correction-invalid-command',
        failureReason: 'schema-invalid',
      },
    });
  });

  test('creates a traceable corrector compatible with async planning cycles', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-reactive-corrector',
      responses: [
        {
          providerId: 'scripted-reactive-corrector',
          model: 'repair-model',
          finishReason: 'stop',
          content: JSON.stringify({
            decision: {
              kind: 'propose-action',
              rationale: 'Eat before work because satiety is critically low.',
              action: {
                id: 'eat-fish-before-work',
                description: 'eat Fish before retrying work',
                commandType: 'AgentEat',
                payload: { commodityName: 'Fish', quantity: 1 },
              },
            },
          }),
        },
      ],
    });
    const corrector = createTraceableLlmReactiveCorrector({
      provider: scripted.provider,
      model: 'repair-model',
      requestId: ({ agentId, issuedAt }) => `${agentId}:${issuedAt}:reactive-correction`,
    });

    const result = await corrector({
      agentId,
      issuedAt: 430,
      plan: createContextualPlan(),
      signals: [],
      selectedSubtask: {
        branchId: 'income',
        subtaskId: 'work',
        description: 'work shift',
        score: 8,
      },
      rejectedAction: createRejectedAction(),
      rejectionReason: 'satiety too low',
      allowedCommandTypes: ['AgentEat', 'AgentWork'],
      worldDecisionContext: createWorldDecisionContext(),
    });

    expect(result.action).toMatchObject({
      id: 'eat-fish-before-work',
      commandType: 'AgentEat',
    });
    expect(result.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'agent-1:430:reactive-correction',
      decision: {
        kind: 'propose-action',
        action: { id: 'eat-fish-before-work', commandType: 'AgentEat' },
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
    occurredAt: 390,
    importanceScore: 0.9,
    source: { eventIds: [] },
    tags: ['work', 'satiety', 'Fish'],
  });
}

function createRecentSuccessMemory() {
  return createShortTermMemoryRecord({
    id: 'memory-eat-before-work-succeeded',
    agentId,
    kind: 'action',
    status: 'succeeded',
    summary: 'Ate Fish before a short work shift and avoided simulator rejection.',
    occurredAt: 395,
    importanceScore: 0.8,
    source: { eventIds: [] },
    tags: ['work', 'eat', 'Fish'],
  });
}

function createLongTermProfile() {
  return {
    agentId,
    beliefs: [
      {
        key: 'recover-before-work',
        statement: 'Small recovery actions before work prevent repeated failures.',
        confidence: 0.8,
        updatedAt: 390,
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
