import { createScriptedLlmProvider } from '@aivilization/llm';
import { asMemoryRecordId, createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createLlmStrategicPlanCompiler,
  createTraceableLlmStrategicPlanCompiler,
  llmStrategicBranchPlanSchema,
  proposeStrategicBranchPlanWithLlm,
} from './llmStrategicPlanner';

const agentId = asAgentId('agent-1');

describe('LLM strategic planner seam', () => {
  test('accepts a structured LLM branch-plan proposal after schema and branch-plan validation', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planner-model',
          finishReason: 'stop',
          usage: { inputTokens: 30, outputTokens: 45 },
          content: JSON.stringify({
            objective: 'Build a bakery business.',
            branches: [
              {
                id: 'production',
                objective: 'Prepare bakery goods for market.',
                subtasks: [
                  {
                    id: 'produce-bread',
                    description: 'Bake bread for the bakery shelf.',
                    basePriority: 13,
                    signalKeys: ['production', 'trade'],
                    intentionAffinityTags: ['production'],
                    memoryAffinityTags: ['production'],
                    profileAffinityTags: ['production'],
                  },
                  {
                    id: 'sell-bread',
                    description: 'Sell bread through the local market.',
                    basePriority: 11,
                    dependsOnSubtaskIds: ['produce-bread'],
                    signalKeys: ['trade'],
                    intentionAffinityTags: ['trade'],
                    memoryAffinityTags: ['trade'],
                    profileAffinityTags: ['trade'],
                  },
                ],
              },
            ],
          }),
        },
      ],
    });

    const result = await proposeStrategicBranchPlanWithLlm({
      objective: objective('Build a bakery business.', ['production', 'trade']),
      issuedAt: 100,
      provider: scripted.provider,
      model: 'planner-model',
      requestId: 'llm-plan-agent-1-100',
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
        objective: 'Build a bakery business.',
        branches: [
          {
            id: 'production',
            objective: 'Prepare bakery goods for market.',
            subtasks: [
              {
                id: 'produce-bread',
                description: 'Bake bread for the bakery shelf.',
                basePriority: 13,
              },
              {
                id: 'sell-bread',
                dependsOnSubtaskIds: ['produce-bread'],
                description: 'Sell bread through the local market.',
                basePriority: 11,
              },
            ],
          },
        ],
      },
      gateway: {
        status: 'succeeded',
        requestId: 'llm-plan-agent-1-100',
        usage: {
          inputTokens: 30,
          outputTokens: 45,
          totalTokens: 75,
          estimatedCostMicros: 195,
        },
      },
    });

    const [providerRequest] = scripted.getRequests();
    expect(providerRequest).toMatchObject({
      requestId: 'llm-plan-agent-1-100',
      model: 'planner-model',
      schemaName: 'aivilization_branch_plan',
    });
    expect(providerRequest?.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(providerRequest?.messages[1]?.content).toContain('Build a bakery business.');
    const [tool] = providerRequest?.tools ?? [];
    expect(providerRequest?.tools).toHaveLength(1);
    expect(tool?.name).toBe('submit_branch_plan');
    expect(tool?.description).toContain('Branch-Thinking');
    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['objective', 'branches'],
    });
  });

  test('includes long-term profile context in structured strategic planner requests', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planner-model',
          finishReason: 'stop',
          content: JSON.stringify({
            objective: 'Craft Chip for the electronics market.',
            branches: [
              {
                id: 'development',
                objective: 'Study before high-tech production.',
                subtasks: [
                  {
                    id: 'study',
                    description: 'Study before crafting chips.',
                    basePriority: 12,
                    signalKeys: ['production', 'study'],
                    intentionAffinityTags: ['study'],
                    memoryAffinityTags: ['study'],
                    profileAffinityTags: ['study'],
                  },
                ],
              },
            ],
          }),
        },
      ],
    });

    await proposeStrategicBranchPlanWithLlm({
      objective: objective('Craft Chip for the electronics market.', ['production']),
      issuedAt: 120,
      longTermProfile: studyBeforeProductionProfile(),
      provider: scripted.provider,
      model: 'planner-model',
      requestId: 'llm-plan-with-profile',
    });

    const requestContent = scripted.getRequests()[0]?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"longTermProfile"');
    expect(requestContent).toContain('"human-objective:study-before-production"');
    expect(requestContent).toContain(
      '"Human steering set long-horizon objective: Study before high-tech production."',
    );
    expect(requestContent).toContain('"cmd-study:strategic-objective"');
  });

  test('includes short-term memory context in structured strategic planner requests', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planner-model',
          finishReason: 'stop',
          content: JSON.stringify({
            objective: 'Recover after a failed market purchase.',
            branches: [
              {
                id: 'recovery',
                objective: 'Adapt the plan from recent failed market experience.',
                subtasks: [
                  {
                    id: 'check-funds',
                    description: 'Check funds before buying food.',
                    basePriority: 12,
                    signalKeys: ['money', 'market'],
                    memoryAffinityTags: ['market', 'failure'],
                  },
                ],
              },
            ],
          }),
        },
      ],
    });

    await proposeStrategicBranchPlanWithLlm({
      objective: objective('Recover after a failed market purchase.', ['market', 'recovery']),
      issuedAt: 140,
      shortTermMemoryContext: [createMarketFailureMemory()],
      provider: scripted.provider,
      model: 'planner-model',
      requestId: 'llm-plan-with-memory',
    });

    const requestContent = scripted.getRequests()[0]?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"shortTermMemoryContext"');
    expect(requestContent).toContain('"memory-market-failure"');
    expect(requestContent).toContain('Could not buy fish because the balance was too low.');
  });

  test('includes world decision context in structured strategic planner requests', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planner-model',
          finishReason: 'stop',
          content: JSON.stringify({
            objective: 'Craft Chip for the electronics market.',
            branches: [
              {
                id: 'production',
                objective: 'Use current inventory and market prices before producing.',
                subtasks: [
                  {
                    id: 'inspect-market',
                    description: 'Inspect Fish prices before choosing a production path.',
                    basePriority: 12,
                  },
                ],
              },
            ],
          }),
        },
      ],
    });

    await proposeStrategicBranchPlanWithLlm({
      objective: objective('Craft Chip for the electronics market.', ['production']),
      issuedAt: 140,
      observedStateSummary:
        'energy=45 satiety=30 health=90 education=31 balance=191696904 residentialTier=5 job=Stock Clerk inventory=Fish:46,Transistor:12',
      worldDecisionContext: createWorldDecisionContext(),
      provider: scripted.provider,
      model: 'planner-model',
      requestId: 'llm-plan-with-world-context',
    });

    const requestContent = scripted.getRequests()[0]?.messages[1]?.content ?? '';
    expect(requestContent).toContain('"observedStateSummary"');
    expect(requestContent).toContain(
      'energy=45 satiety=30 health=90 education=31 balance=191696904 residentialTier=5 job=Stock Clerk inventory=Fish:46,Transistor:12',
    );
    expect(requestContent).toContain('"worldDecisionContext"');
    expect(requestContent).toContain('"balance":191696904');
    expect(requestContent).toContain('"educationScore":31');
    expect(requestContent).toContain('"residentialTier":5');
    expect(requestContent).toContain('"Fish":46');
    expect(requestContent).toContain('"spotPrice":304.5');
  });

  test('falls back to deterministic strategic planning when LLM output is invalid', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planner-model',
          finishReason: 'stop',
          content: JSON.stringify({
            objective: 'Study for a credential.',
            branches: [],
          }),
        },
      ],
    });

    const result = await proposeStrategicBranchPlanWithLlm({
      objective: objective('Study for a credential.', ['study']),
      issuedAt: 200,
      provider: scripted.provider,
      model: 'planner-model',
      requestId: 'llm-plan-invalid',
    });

    expect(result).toMatchObject({
      status: 'fallback',
      source: 'deterministic-fallback',
      failure: {
        status: 'failed',
        reason: 'schema-invalid',
        requestId: 'llm-plan-invalid',
      },
      plan: {
        objective: 'Study for a credential.',
        branches: [
          {
            id: 'development',
            subtasks: [
              {
                id: 'study',
                description: 'Study toward the long-horizon objective.',
              },
            ],
          },
        ],
      },
    });
  });

  test('rejects branch-plan invariant violations inside the LLM schema parser', () => {
    expect(
      llmStrategicBranchPlanSchema.parse({
        objective: 'Coordinate dependent work.',
        branches: [
          {
            id: 'work',
            objective: 'Do the dependent task first.',
            subtasks: [
              {
                id: 'dependent-task',
                description: 'Run before its prerequisite.',
                basePriority: 8,
                dependsOnSubtaskIds: ['prerequisite-task'],
              },
              {
                id: 'prerequisite-task',
                description: 'Prepare the dependency.',
                basePriority: 7,
              },
            ],
          },
        ],
      }),
    ).toEqual({
      status: 'invalid',
      reason:
        'branch plan candidate invalid: dependency prerequisite-task must appear earlier in branch work',
    });
  });

  test('creates a StrategicPlanCompiler-compatible LLM compiler', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planner-model',
          finishReason: 'stop',
          content: JSON.stringify({
            objective: 'Recover energy.',
            branches: [
              {
                id: 'rest',
                objective: 'Sleep before taking more actions.',
                subtasks: [
                  {
                    id: 'sleep',
                    description: 'Take a sleep cycle.',
                    basePriority: 12,
                    signalKeys: ['sleep'],
                    intentionAffinityTags: ['sleep'],
                    memoryAffinityTags: ['sleep'],
                    profileAffinityTags: ['sleep'],
                  },
                ],
              },
            ],
          }),
        },
      ],
    });
    const compiler = createLlmStrategicPlanCompiler({
      provider: scripted.provider,
      model: 'planner-model',
      requestId: ({ objective, issuedAt }) => `${objective.id}:${issuedAt}`,
    });

    await expect(
      compiler({
        objective: objective('Recover energy.', ['sleep']),
        issuedAt: 300,
      }),
    ).resolves.toMatchObject({
      objective: 'Recover energy.',
      branches: [
        {
          id: 'rest',
          subtasks: [{ id: 'sleep', description: 'Take a sleep cycle.' }],
        },
      ],
    });
    expect(scripted.getRequests()[0]?.requestId).toBe('objective-1:300');
  });

  test('creates a traceable LLM compiler that preserves accepted provider attempts and usage', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planner-model',
          finishReason: 'stop',
          usage: { inputTokens: 12, outputTokens: 20 },
          content: JSON.stringify({
            objective: 'Recover satiety.',
            branches: [
              {
                id: 'satiety',
                objective: 'Eat before pursuing other goals.',
                subtasks: [
                  {
                    id: 'eat',
                    description: 'Eat food from inventory.',
                    basePriority: 14,
                    signalKeys: ['satiety'],
                    intentionAffinityTags: ['eat', 'satiety'],
                    memoryAffinityTags: ['eat', 'satiety'],
                    profileAffinityTags: ['eat', 'satiety'],
                  },
                ],
              },
            ],
          }),
        },
      ],
    });
    const compiler = createTraceableLlmStrategicPlanCompiler({
      provider: scripted.provider,
      model: 'planner-model',
      requestId: ({ objective, issuedAt }) => `${objective.agentId}:${objective.id}:${issuedAt}`,
      pricing: {
        inputTokenCostMicros: 2,
        outputTokenCostMicros: 3,
      },
    });

    await expect(
      compiler({
        objective: objective('Recover satiety.', ['eat', 'satiety']),
        issuedAt: 400,
        shortTermMemoryContext: [createMarketFailureMemory()],
        longTermProfile: studyBeforeProductionProfile(),
        worldDecisionContext: createWorldDecisionContext(),
      }),
    ).resolves.toMatchObject({
      plan: {
        objective: 'Recover satiety.',
        branches: [{ id: 'satiety', subtasks: [{ id: 'eat' }] }],
      },
      planningTrace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'agent-1:objective-1:400',
        providerId: 'scripted-planner',
        model: 'planner-model',
        usage: {
          inputTokens: 12,
          outputTokens: 20,
          totalTokens: 32,
          estimatedCostMicros: 84,
        },
        shortTermMemoryContext: { recordCount: 1 },
        longTermProfileContext: { entryCount: 1 },
        worldDecisionContext: {
          agentId,
          contextViewStage: 'strategic-planning',
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
            providerId: 'scripted-planner',
            model: 'planner-model',
            message: 'LLM structured response validated',
          },
        ],
      },
    });
  });

  test('creates a traceable LLM compiler that preserves fallback failure evidence', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planner-model',
          finishReason: 'stop',
          content: JSON.stringify({
            objective: 'Study safely.',
            branches: [],
          }),
        },
      ],
    });
    const compiler = createTraceableLlmStrategicPlanCompiler({
      provider: scripted.provider,
      model: 'planner-model',
      requestId: () => 'fallback-request',
    });

    await expect(
      compiler({
        objective: objective('Study safely.', ['study']),
        issuedAt: 500,
      }),
    ).resolves.toMatchObject({
      plan: {
        objective: 'Study safely.',
        branches: [{ id: 'development', subtasks: [{ id: 'study' }] }],
      },
      planningTrace: {
        status: 'fallback',
        source: 'deterministic-fallback',
        requestId: 'fallback-request',
        providerId: 'scripted-planner',
        model: 'planner-model',
        failureReason: 'schema-invalid',
        message: 'branch plan candidate invalid: branch plan requires at least one branch',
        attempts: [
          {
            attemptIndex: 1,
            status: 'schema-invalid',
            providerId: 'scripted-planner',
            model: 'planner-model',
          },
        ],
      },
    });
  });

  test('passes long-term profile context to fallback strategic compilers', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planner-model',
          finishReason: 'stop',
          content: JSON.stringify({
            objective: 'Craft Chip for the electronics market.',
            branches: [],
          }),
        },
      ],
    });
    let fallbackProfileKeys: readonly string[] = [];

    const result = await proposeStrategicBranchPlanWithLlm({
      objective: objective('Craft Chip for the electronics market.', ['production']),
      issuedAt: 520,
      longTermProfile: studyBeforeProductionProfile(),
      provider: scripted.provider,
      model: 'planner-model',
      requestId: 'llm-plan-profile-fallback',
      fallbackCompiler: ({ longTermProfile }) => {
        fallbackProfileKeys = longTermProfile?.values.map((entry) => entry.key) ?? [];
        return {
          objective: 'Fallback profile-aware plan.',
          branches: [
            {
              id: 'profile-development',
              objective: 'Use profile evidence during fallback.',
              subtasks: [{ id: 'study', description: 'Study from profile.', basePriority: 12 }],
            },
          ],
        };
      },
    });

    expect(result.status).toBe('fallback');
    expect(fallbackProfileKeys).toEqual(['human-objective:study-before-production']);
    expect(result.plan.branches.map((branch) => branch.id)).toEqual(['profile-development']);
  });
});

function objective(statement: string, affinityTags: readonly string[]) {
  return {
    id: 'objective-1',
    agentId,
    statement,
    priority: 3,
    source: 'agent' as const,
    affinityTags,
    createdAt: 100,
    updatedAt: 100,
  };
}

function studyBeforeProductionProfile() {
  return {
    agentId,
    beliefs: [],
    habits: [],
    mood: [],
    values: [
      {
        key: 'human-objective:study-before-production',
        statement: 'Human steering set long-horizon objective: Study before high-tech production.',
        confidence: 0.95,
        updatedAt: 100,
        provenanceRecordIds: [asMemoryRecordId('cmd-study:strategic-objective')],
      },
    ],
    personality: [],
    socialRecords: [],
  };
}

function createMarketFailureMemory() {
  return createShortTermMemoryRecord({
    id: 'memory-market-failure',
    agentId,
    kind: 'action',
    status: 'failed',
    summary: 'Could not buy fish because the balance was too low.',
    occurredAt: 120,
    importanceScore: 0.9,
    source: { eventIds: [] },
    tags: ['market', 'failure', 'fish', 'money'],
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
