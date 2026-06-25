import { asMemoryRecordId, createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId, asSimulationId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createBranchPlan,
  createBranchPlanProgress,
  markSubtaskCompleted,
  runAgentPlanningCycle,
  runAgentPlanningCycleWithPrioritization,
} from './index';

describe('agent planning cycle', () => {
  test('selects a subtask, gates actions through the simulator, and returns command drafts', () => {
    const plan = createBranchPlan({
      objective: 'survive',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 5 }],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      plan,
      signals: [],
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupation: 'Cleaner' },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.selectedSubtask.subtaskId).toBe('work');
    expect(result.needsReplan).toBe(false);
    expect(result.commandDrafts).toEqual([
      {
        simulationId: 'sim-1',
        actorId: 'agent-1',
        source: 'agent-runtime',
        type: 'AgentWork',
        payload: { occupation: 'Cleaner' },
        issuedAt: 100,
      },
    ]);
  });

  test('allows an async contextual prioritizer to rank a lower deterministic subtask first', async () => {
    const plan = createBranchPlan({
      objective: 'balance survival and income',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 6 }],
        },
        {
          id: 'recovery',
          objective: 'restore satiety',
          subtasks: [{ id: 'eat', description: 'eat Fish before work', basePriority: 2 }],
        },
      ],
    });
    const simulatedSubtasks: string[] = [];

    const result = await runAgentPlanningCycleWithPrioritization({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      plan,
      signals: [],
      subtaskPrioritizer: async ({ candidates }) => {
        await Promise.resolve();
        return {
          candidates: [
            {
              ...candidates[1]!,
              score: 13,
              scoreBreakdown: {
                ...candidates[1]!.scoreBreakdown,
                contextualReasoningScore: 11,
              },
            },
            candidates[0]!,
          ],
          trace: {
            status: 'accepted',
            source: 'llm',
            requestId: 'prioritize-agent-1-100',
            choices: [
              {
                branchId: 'recovery',
                subtaskId: 'eat',
                priorityScore: 13,
                rationale: 'Low satiety makes food recovery more urgent than work.',
              },
              {
                branchId: 'income',
                subtaskId: 'work',
                priorityScore: 6,
                rationale: 'Work remains useful after eating.',
              },
            ],
          },
        };
      },
      microPlanners: [
        {
          domain: 'eat',
          supports: ({ subtaskId }) => subtaskId === 'eat',
          propose: () => [
            {
              id: 'eat-fish',
              description: 'eat Fish',
              commandType: 'AgentEat',
              payload: { commodityName: 'Fish', quantity: 1 },
            },
          ],
        },
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-shift',
              description: 'work shift',
              commandType: 'AgentWork',
              payload: { occupationName: 'Stock Clerk', laborSeconds: 60 },
            },
          ],
        },
      ],
      simulate: ({ action, selectedSubtask }) => {
        simulatedSubtasks.push(
          `${action.id}:${selectedSubtask.branchId}/${selectedSubtask.subtaskId}`,
        );
        return { status: 'accepted', action };
      },
    });

    expect(result.selectedSubtask).toMatchObject({
      branchId: 'recovery',
      subtaskId: 'eat',
      score: 13,
    });
    expect(simulatedSubtasks).toEqual(['eat-fish:recovery/eat']);
    expect(result.prioritizationTrace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'prioritize-agent-1-100',
      choices: [{ subtaskId: 'eat' }, { subtaskId: 'work' }],
    });
    expect(result.commandDrafts.map((draft) => draft.type)).toEqual(['AgentEat']);
  });

  test('allows an async action sequence generator to replace deterministic micro-planner actions', async () => {
    const plan = createBranchPlan({
      objective: 'restore satiety before work',
      branches: [
        {
          id: 'recovery',
          objective: 'restore satiety',
          subtasks: [{ id: 'eat', description: 'eat the best available food', basePriority: 8 }],
        },
      ],
    });
    const simulatedActionContexts: string[] = [];

    const result = await runAgentPlanningCycleWithPrioritization({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 150,
      plan,
      signals: [],
      actionSequenceGenerator: async ({ deterministicActions, selectedSubtask }) => {
        await Promise.resolve();
        expect(deterministicActions.map((action) => action.id)).toEqual(['eat-apple']);
        expect(selectedSubtask).toMatchObject({ branchId: 'recovery', subtaskId: 'eat' });
        return {
          actions: [
            {
              id: 'llm-eat-fish',
              description: 'eat Fish from inventory',
              commandType: 'AgentEat',
              payload: { commodityName: 'Fish', quantity: 1 },
              priority: 14,
            },
          ],
          trace: {
            status: 'accepted',
            source: 'llm',
            selectedSubtask: { branchId: 'recovery', subtaskId: 'eat' },
            requestId: 'sequence-agent-1-150',
            actions: [
              {
                id: 'llm-eat-fish',
                commandType: 'AgentEat',
                rationale: 'Fish is already held and restores satiety before work.',
              },
            ],
          },
        };
      },
      microPlanners: [
        {
          domain: 'eat',
          supports: ({ subtaskId }) => subtaskId === 'eat',
          propose: () => [
            {
              id: 'eat-apple',
              description: 'eat Apple fallback',
              commandType: 'AgentEat',
              payload: { commodityName: 'Apple', quantity: 1 },
            },
          ],
        },
      ],
      simulate: ({ action, selectedSubtask }) => {
        simulatedActionContexts.push(
          `${action.id}:${selectedSubtask.branchId}/${selectedSubtask.subtaskId}`,
        );
        return { status: 'accepted', action };
      },
    });

    expect(result.candidateActions).toEqual([
      {
        id: 'llm-eat-fish',
        description: 'eat Fish from inventory',
        commandType: 'AgentEat',
        payload: { commodityName: 'Fish', quantity: 1 },
        priority: 14,
        synthesisContext: {
          branchId: 'recovery',
          subtaskId: 'eat',
          subtaskScore: 8,
        },
      },
    ]);
    expect(simulatedActionContexts).toEqual(['llm-eat-fish:recovery/eat']);
    expect(result.commandDrafts.map((draft) => draft.payload)).toEqual([
      { commodityName: 'Fish', quantity: 1 },
    ]);
    expect(result.actionSequenceTraces).toEqual([
      {
        status: 'accepted',
        source: 'llm',
        selectedSubtask: { branchId: 'recovery', subtaskId: 'eat' },
        requestId: 'sequence-agent-1-150',
        actions: [
          {
            id: 'llm-eat-fish',
            commandType: 'AgentEat',
            rationale: 'Fish is already held and restores satiety before work.',
          },
        ],
      },
    ]);
  });

  test('applies social dialogue generation before simulation and command drafting', async () => {
    const plan = createBranchPlan({
      objective: 'maintain a useful social relationship',
      branches: [
        {
          id: 'social',
          objective: 'coordinate with neighbor',
          subtasks: [
            {
              id: 'check-in',
              description: 'check in with a neighbor about market prices',
              basePriority: 7,
            },
          ],
        },
      ],
    });
    const simulatedTopics: string[] = [];
    const generatorInputs: unknown[] = [];

    const result = await runAgentPlanningCycleWithPrioritization({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 155,
      plan,
      signals: [{ key: 'social', weight: 2 }],
      shortTermMemoryContext: [
        createShortTermMemoryRecord({
          id: 'memory-neighbor-market-note',
          agentId: asAgentId('agent-1'),
          kind: 'social-interaction',
          status: 'succeeded',
          summary: 'Neighbor shared useful market notes yesterday.',
          occurredAt: 100,
          importanceScore: 0.7,
          source: { eventIds: [] },
          tags: ['social', 'market'],
        }),
      ],
      longTermProfile: {
        agentId: asAgentId('agent-1'),
        beliefs: [
          {
            key: 'neighbors-share-market-info',
            statement: 'Neighbors often share useful market information.',
            confidence: 0.8,
            updatedAt: 120,
            provenanceRecordIds: [asMemoryRecordId('reflection-neighbor-market-info')],
          },
        ],
        habits: [],
        mood: [],
        values: [],
        personality: [],
        socialRecords: [],
      },
      worldDecisionContext: {
        agent: {
          agentId: asAgentId('agent-1'),
          locationId: 'market',
          physiology: { energy: 40, satiety: 35, health: 90 },
          educationScore: 20,
          balance: 120,
          residentialTier: 1,
          job: 'Stock Clerk',
          inventory: { Fish: 2 },
        },
        market: { spotPrices: [{ commodity: 'Fish', spotPrice: 12 }] },
      },
      socialDialogueGenerator: async (input) => {
        await Promise.resolve();
        generatorInputs.push(input);
        expect(input.selectedSubtask).toMatchObject({
          branchId: 'social',
          subtaskId: 'check-in',
        });
        expect(input.shortTermMemoryContext?.[0]?.id).toBe('memory-neighbor-market-note');
        expect(input.longTermProfile?.beliefs[0]?.key).toBe('neighbors-share-market-info');
        expect(input.worldDecisionContext?.market.spotPrices[0]?.spotPrice).toBe(12);
        return {
          payload: {
            ...input.deterministicPayload,
            topic: 'sharing fresh fish prices',
            turns: [
              {
                speakerAgentId: asAgentId('agent-1'),
                utterance: 'I saw Fish at 12 coins and wanted to compare notes.',
                intent: 'share-price',
              },
              {
                speakerAgentId: asAgentId('agent-2'),
                utterance: 'That is useful; I saw the same stall before work.',
                intent: 'acknowledge-price',
              },
            ],
          },
          trace: {
            status: 'accepted',
            source: 'llm',
            selectedSubtask: { branchId: 'social', subtaskId: 'check-in' },
            actionId: 'social-check-in',
            targetAgentId: asAgentId('agent-2'),
            requestId: 'social-dialogue-cycle',
            turnCount: 2,
            rationale: 'Use current price context and social memory.',
          },
        };
      },
      microPlanners: [
        {
          domain: 'social',
          supports: ({ subtaskId }) => subtaskId === 'check-in',
          propose: () => [
            {
              id: 'social-check-in',
              description: 'start a neighbor conversation',
              commandType: 'AgentStartConversation',
              payload: {
                targetAgentId: asAgentId('agent-2'),
                topic: 'deterministic fallback topic',
                relationDelta: 0.05,
                attitudeDelta: 0.02,
                turns: [
                  { speakerAgentId: asAgentId('agent-1'), utterance: 'Fallback hello.' },
                  { speakerAgentId: asAgentId('agent-2'), utterance: 'Fallback reply.' },
                ],
              },
            },
          ],
        },
      ],
      simulate: ({ action }) => {
        simulatedTopics.push(String((action.payload as { topic?: string }).topic));
        return { status: 'accepted', action };
      },
    });

    expect(generatorInputs).toHaveLength(1);
    expect(simulatedTopics).toEqual(['sharing fresh fish prices']);
    expect(result.commandDrafts[0]?.payload).toMatchObject({
      topic: 'sharing fresh fish prices',
      turns: [
        { speakerAgentId: 'agent-1', utterance: 'I saw Fish at 12 coins and wanted to compare notes.' },
        { speakerAgentId: 'agent-2', utterance: 'That is useful; I saw the same stall before work.' },
      ],
    });
    expect(result.socialDialogueGenerationTraces).toEqual([
      {
        status: 'accepted',
        source: 'llm',
        selectedSubtask: { branchId: 'social', subtaskId: 'check-in' },
        actionId: 'social-check-in',
        targetAgentId: 'agent-2',
        requestId: 'social-dialogue-cycle',
        turnCount: 2,
        rationale: 'Use current price context and social memory.',
      },
    ]);
  });

  test('runs social dialogue generation before global synthesis ranking', async () => {
    const plan = createBranchPlan({
      objective: 'coordinate social and recovery actions',
      branches: [
        {
          id: 'social',
          objective: 'coordinate with neighbor',
          subtasks: [{ id: 'check-in', description: 'check in with neighbor', basePriority: 8 }],
        },
        {
          id: 'recovery',
          objective: 'restore satiety',
          subtasks: [{ id: 'eat', description: 'eat Fish', basePriority: 7 }],
        },
      ],
    });

    const result = await runAgentPlanningCycleWithPrioritization({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 156,
      plan,
      signals: [],
      actionSynthesis: { maxActions: 1, candidateSubtasks: { maxSubtasks: 2 } },
      socialDialogueGenerator: async (input) => {
        await Promise.resolve();
        return {
          payload: {
            ...input.deterministicPayload,
            topic: 'LLM enriched social topic',
            turns: [
              { speakerAgentId: asAgentId('agent-1'), utterance: 'Generated opening.' },
              { speakerAgentId: asAgentId('agent-2'), utterance: 'Generated reply.' },
            ],
          },
          trace: {
            status: 'accepted',
            source: 'llm',
            selectedSubtask: { branchId: 'social', subtaskId: 'check-in' },
            actionId: input.action.id,
            targetAgentId: asAgentId('agent-2'),
            turnCount: 2,
            rationale: 'Generated before global synthesis.',
          },
        };
      },
      globalSynthesizer: async ({ candidateActions }) => {
        await Promise.resolve();
        expect(candidateActions[0]?.payload).toMatchObject({
          topic: 'LLM enriched social topic',
          turns: [{ utterance: 'Generated opening.' }, { utterance: 'Generated reply.' }],
        });
        return {
          actions: candidateActions,
          trace: {
            status: 'accepted',
            source: 'llm',
            requestId: 'global-after-social-dialogue',
            choices: candidateActions.map((action, index) => ({
              actionId: action.id,
              priorityScore: 10 - index,
              rationale: 'Keep enriched social action visible to global synthesis.',
            })),
          },
        };
      },
      microPlanners: [
        {
          domain: 'social',
          supports: ({ subtaskId }) => subtaskId === 'check-in',
          propose: () => [
            {
              id: 'social-check-in',
              description: 'start a neighbor conversation',
              commandType: 'AgentStartConversation',
              payload: {
                targetAgentId: asAgentId('agent-2'),
                topic: 'deterministic fallback topic',
                relationDelta: 0.05,
                attitudeDelta: 0.02,
                turns: [
                  { speakerAgentId: asAgentId('agent-1'), utterance: 'Fallback hello.' },
                  { speakerAgentId: asAgentId('agent-2'), utterance: 'Fallback reply.' },
                ],
              },
            },
          ],
        },
        {
          domain: 'recovery',
          supports: ({ subtaskId }) => subtaskId === 'eat',
          propose: () => [
            {
              id: 'eat-fish',
              description: 'eat Fish',
              commandType: 'AgentEat',
              payload: { commodityName: 'Fish', quantity: 1 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.candidateActions[0]?.payload).toMatchObject({
      topic: 'LLM enriched social topic',
    });
    expect(result.globalSynthesisTrace?.requestId).toBe('global-after-social-dialogue');
  });

  test('synthesizes candidate actions before simulation and command drafting', () => {
    const plan = createBranchPlan({
      objective: 'survive',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 5 }],
        },
      ],
    });
    const simulatedActionIds: string[] = [];

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      plan,
      signals: [],
      actionSynthesis: { maxActions: 1 },
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'sleep-first',
              description: 'sleep before work',
              commandType: 'AgentSleep',
              payload: { durationSeconds: 60 },
              priority: 1,
              resourceEstimate: { actionSeconds: 60 },
            },
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 60 },
              priority: 3,
              resourceEstimate: { actionSeconds: 60, energyCost: 10 },
            },
            {
              id: 'study-after-work',
              description: 'study after work',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
              priority: 2,
              resourceEstimate: { actionSeconds: 60 },
            },
          ],
        },
      ],
      simulate: ({ action }) => {
        simulatedActionIds.push(action.id);
        return { status: 'accepted', action };
      },
    });

    expect(simulatedActionIds).toEqual(['work-1']);
    expect(result.candidateActions.map((action) => action.id)).toEqual(['work-1']);
    expect(result.actionSynthesisResult).toEqual({
      acceptedActions: [
        {
          id: 'work-1',
          description: 'work as Cleaner',
          commandType: 'AgentWork',
          payload: { occupationName: 'Cleaner', laborSeconds: 60 },
          priority: 3,
          resourceEstimate: { actionSeconds: 60, energyCost: 10 },
          synthesisContext: { branchId: 'income', subtaskId: 'work', subtaskScore: 5 },
        },
      ],
      rejectedActions: [
        {
          action: {
            id: 'study-after-work',
            description: 'study after work',
            commandType: 'AgentStudy',
            payload: { durationSeconds: 60, educationRatePerSecond: 1 },
            priority: 2,
            resourceEstimate: { actionSeconds: 60 },
            synthesisContext: { branchId: 'income', subtaskId: 'work', subtaskScore: 5 },
          },
          reason: 'maxActions exhausted',
        },
        {
          action: {
            id: 'sleep-first',
            description: 'sleep before work',
            commandType: 'AgentSleep',
            payload: { durationSeconds: 60 },
            priority: 1,
            resourceEstimate: { actionSeconds: 60 },
            synthesisContext: { branchId: 'income', subtaskId: 'work', subtaskScore: 5 },
          },
          reason: 'maxActions exhausted',
        },
      ],
    });
    expect(result.commandDrafts).toHaveLength(1);
    expect(result.commandDrafts[0]?.type).toBe('AgentWork');
  });

  test('attaches selected subtask context to proposed actions before synthesis', () => {
    const plan = createBranchPlan({
      objective: 'develop education',
      branches: [
        {
          id: 'development',
          objective: 'improve education',
          subtasks: [{ id: 'study', description: 'self study', basePriority: 5 }],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      plan,
      signals: [],
      microPlanners: [
        {
          domain: 'study',
          supports: ({ subtaskId }) => subtaskId === 'study',
          propose: () => [
            {
              id: 'study-1',
              description: 'study for one minute',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.actionSynthesisResult.acceptedActions[0]?.synthesisContext).toEqual({
      branchId: 'development',
      subtaskId: 'study',
      subtaskScore: 5,
    });
    expect(result.candidateActions[0]?.synthesisContext).toEqual({
      branchId: 'development',
      subtaskId: 'study',
      subtaskScore: 5,
    });
  });

  test('collects actions from multiple prioritized subtasks before global synthesis', () => {
    const plan = createBranchPlan({
      objective: 'balance income and development',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work a shift', basePriority: 6 }],
        },
        {
          id: 'development',
          objective: 'improve education',
          subtasks: [{ id: 'study', description: 'self study', basePriority: 5 }],
        },
      ],
    });
    const simulatedActions: string[] = [];

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      plan,
      signals: [],
      actionSynthesis: {
        maxActions: 2,
        candidateSubtasks: { maxSubtasks: 2 },
        branchLimits: { maxAcceptedActionsPerBranch: 1 },
      },
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 60 },
              priority: 5,
              resourceEstimate: { actionSeconds: 60, energyCost: 10 },
            },
          ],
        },
        {
          domain: 'study',
          supports: ({ subtaskId }) => subtaskId === 'study',
          propose: () => [
            {
              id: 'study-1',
              description: 'study after work',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
              priority: 4,
              resourceEstimate: { actionSeconds: 60 },
            },
          ],
        },
      ],
      simulate: ({ action, selectedSubtask }) => {
        simulatedActions.push(
          `${action.id}:${selectedSubtask.branchId}/${selectedSubtask.subtaskId}`,
        );
        return { status: 'accepted', action };
      },
    });

    expect(result.selectedSubtask).toMatchObject({ branchId: 'income', subtaskId: 'work' });
    expect(simulatedActions).toEqual(['work-1:income/work', 'study-1:development/study']);
    expect(result.actionSynthesisResult.acceptedActions.map((action) => action.id)).toEqual([
      'work-1',
      'study-1',
    ]);
    expect(
      result.actionSynthesisResult.acceptedActions.map((action) => action.synthesisContext),
    ).toEqual([
      { branchId: 'income', subtaskId: 'work', subtaskScore: 6 },
      { branchId: 'development', subtaskId: 'study', subtaskScore: 5 },
    ]);
    expect(result.commandDrafts.map((draft) => draft.type)).toEqual(['AgentWork', 'AgentStudy']);
  });

  test('allows async global synthesis to orchestrate actions across selected branch subtasks', async () => {
    const plan = createBranchPlan({
      objective: 'keep production moving without sacrificing survival',
      branches: [
        {
          id: 'production',
          objective: 'make goods',
          subtasks: [{ id: 'produce', description: 'produce Widget', basePriority: 9 }],
        },
        {
          id: 'recovery',
          objective: 'restore satiety',
          subtasks: [{ id: 'eat', description: 'eat Fish before work', basePriority: 8 }],
        },
      ],
    });

    const result = await runAgentPlanningCycleWithPrioritization({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 175,
      plan,
      signals: [],
      actionSynthesis: {
        maxActions: 1,
        candidateSubtasks: { maxSubtasks: 2 },
      },
      globalSynthesizer: async ({ candidateActions, deterministicSynthesisResult }) => {
        await Promise.resolve();
        expect(candidateActions.map((action) => action.id)).toEqual(['produce-widget', 'eat-fish']);
        expect(deterministicSynthesisResult.acceptedActions.map((action) => action.id)).toEqual([
          'produce-widget',
        ]);
        return {
          actions: [
            {
              ...candidateActions[1]!,
              priority: 20,
              synthesisContext: {
                ...candidateActions[1]!.synthesisContext,
                strategicAlignment: 4,
                branchUrgency: 9,
              },
            },
            {
              ...candidateActions[0]!,
              priority: 10,
              synthesisContext: {
                ...candidateActions[0]!.synthesisContext,
                strategicAlignment: 8,
                branchUrgency: 3,
              },
            },
          ],
          trace: {
            status: 'accepted',
            source: 'llm',
            requestId: 'global-synthesis-cycle',
            choices: [
              {
                actionId: 'eat-fish',
                priorityScore: 20,
                strategicAlignment: 4,
                branchUrgency: 9,
                rationale: 'Low satiety makes eating globally urgent before production.',
              },
              {
                actionId: 'produce-widget',
                priorityScore: 10,
                strategicAlignment: 8,
                branchUrgency: 3,
                rationale: 'Production remains aligned but can wait for recovery.',
              },
            ],
          },
        };
      },
      microPlanners: [
        {
          domain: 'production',
          supports: ({ subtaskId }) => subtaskId === 'produce',
          propose: () => [
            {
              id: 'produce-widget',
              description: 'produce Widget',
              commandType: 'AgentProduce',
              payload: { commodityName: 'Widget', quantity: 1, availableLaborSeconds: 60 },
              priority: 15,
            },
          ],
        },
        {
          domain: 'recovery',
          supports: ({ subtaskId }) => subtaskId === 'eat',
          propose: () => [
            {
              id: 'eat-fish',
              description: 'eat Fish',
              commandType: 'AgentEat',
              payload: { commodityName: 'Fish', quantity: 1 },
              priority: 4,
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.candidateActions.map((action) => action.id)).toEqual(['eat-fish']);
    expect(result.actionSynthesisResult.rejectedActions).toEqual([
      {
        action: {
          id: 'produce-widget',
          description: 'produce Widget',
          commandType: 'AgentProduce',
          payload: { commodityName: 'Widget', quantity: 1, availableLaborSeconds: 60 },
          priority: 10,
          synthesisContext: {
            branchId: 'production',
            subtaskId: 'produce',
            subtaskScore: 9,
            strategicAlignment: 8,
            branchUrgency: 3,
          },
        },
        reason: 'maxActions exhausted',
      },
    ]);
    expect(result.globalSynthesisTrace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      requestId: 'global-synthesis-cycle',
      choices: [{ actionId: 'eat-fish' }, { actionId: 'produce-widget' }],
    });
  });

  test('keeps deterministic resource budgets authoritative after global synthesis ranking', async () => {
    const plan = createBranchPlan({
      objective: 'balance production and survival',
      branches: [
        {
          id: 'production',
          objective: 'make goods',
          subtasks: [{ id: 'produce', description: 'produce Widget', basePriority: 9 }],
        },
        {
          id: 'recovery',
          objective: 'restore satiety',
          subtasks: [{ id: 'eat', description: 'eat Fish', basePriority: 8 }],
        },
      ],
    });

    const result = await runAgentPlanningCycleWithPrioritization({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 176,
      plan,
      signals: [],
      actionSynthesis: {
        maxActions: 1,
        budget: { energyBudget: 0 },
        candidateSubtasks: { maxSubtasks: 2 },
      },
      globalSynthesizer: async ({ candidateActions }) => {
        await Promise.resolve();
        return {
          actions: [
            { ...candidateActions[0]!, priority: 30 },
            { ...candidateActions[1]!, priority: 20 },
          ],
          trace: {
            status: 'accepted',
            source: 'llm',
            requestId: 'global-synthesis-budget-cycle',
            choices: [
              {
                actionId: 'produce-widget',
                priorityScore: 30,
                rationale: 'LLM ranks production first, but budget must remain authoritative.',
              },
              {
                actionId: 'eat-fish',
                priorityScore: 20,
                rationale: 'Fallback safe action after over-budget production.',
              },
            ],
          },
        };
      },
      microPlanners: [
        {
          domain: 'production',
          supports: ({ subtaskId }) => subtaskId === 'produce',
          propose: () => [
            {
              id: 'produce-widget',
              description: 'produce Widget',
              commandType: 'AgentProduce',
              payload: { commodityName: 'Widget', quantity: 1, availableLaborSeconds: 60 },
              priority: 15,
              resourceEstimate: { energyCost: 10 },
            },
          ],
        },
        {
          domain: 'recovery',
          supports: ({ subtaskId }) => subtaskId === 'eat',
          propose: () => [
            {
              id: 'eat-fish',
              description: 'eat Fish',
              commandType: 'AgentEat',
              payload: { commodityName: 'Fish', quantity: 1 },
              priority: 4,
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.candidateActions.map((action) => action.id)).toEqual(['eat-fish']);
    expect(result.actionSynthesisResult.rejectedActions).toEqual([
      {
        action: {
          id: 'produce-widget',
          description: 'produce Widget',
          commandType: 'AgentProduce',
          payload: { commodityName: 'Widget', quantity: 1, availableLaborSeconds: 60 },
          priority: 30,
          resourceEstimate: { energyCost: 10 },
          synthesisContext: {
            branchId: 'production',
            subtaskId: 'produce',
            subtaskScore: 9,
          },
        },
        reason: 'energy budget exceeded',
      },
    ]);
  });

  test('updates progress for every completed synthesized subtask', () => {
    const agentId = asAgentId('agent-1');
    const plan = createBranchPlan({
      objective: 'balance income and development',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work a shift', basePriority: 6 }],
        },
        {
          id: 'development',
          objective: 'improve education',
          subtasks: [{ id: 'study', description: 'self study', basePriority: 5 }],
        },
      ],
    });
    const progress = createBranchPlanProgress({
      planId: 'plan-1',
      agentId,
      createdAt: 50,
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 100,
      plan,
      progress,
      signals: [],
      actionSynthesis: {
        maxActions: 2,
        candidateSubtasks: { maxSubtasks: 2 },
        branchLimits: { maxAcceptedActionsPerBranch: 1 },
      },
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 60 },
              priority: 5,
              resourceEstimate: { actionSeconds: 60, energyCost: 10 },
            },
          ],
        },
        {
          domain: 'study',
          supports: ({ subtaskId }) => subtaskId === 'study',
          propose: () => [
            {
              id: 'study-1',
              description: 'study after work',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
              priority: 4,
              resourceEstimate: { actionSeconds: 60 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.progressUpdate).toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: ['study', 'work'],
      blockedSubtasks: [],
      updatedAt: 100,
    });
  });

  test('keeps in-progress synthesized subtasks out of completed progress', () => {
    const agentId = asAgentId('agent-1');
    const plan = createBranchPlan({
      objective: 'balance income and development',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work a shift', basePriority: 6 }],
        },
        {
          id: 'development',
          objective: 'improve education',
          subtasks: [{ id: 'study', description: 'self study', basePriority: 5 }],
        },
      ],
    });
    const progress = createBranchPlanProgress({
      planId: 'plan-1',
      agentId,
      createdAt: 50,
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 100,
      plan,
      progress,
      signals: [],
      actionSynthesis: {
        maxActions: 2,
        candidateSubtasks: { maxSubtasks: 2 },
        branchLimits: { maxAcceptedActionsPerBranch: 1 },
      },
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 60 },
              priority: 5,
              resourceEstimate: { actionSeconds: 60, energyCost: 10 },
            },
          ],
        },
        {
          domain: 'study',
          supports: ({ subtaskId }) => subtaskId === 'study',
          propose: () => [
            {
              id: 'study-1',
              description: 'study after work',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
              priority: 4,
              resourceEstimate: { actionSeconds: 60 },
            },
          ],
        },
      ],
      subtaskCompletion: ({ selectedSubtask }) =>
        selectedSubtask.subtaskId === 'study'
          ? { status: 'in-progress', reason: 'study requires another session' }
          : { status: 'completed' },
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.progressUpdate?.completedSubtaskIds).toEqual(['work']);
    expect(result.subtaskCompletionDecisions).toEqual([
      {
        selectedSubtask: {
          branchId: 'income',
          subtaskId: 'work',
          description: 'work a shift',
          score: 6,
        },
        decision: { status: 'completed' },
      },
      {
        selectedSubtask: {
          branchId: 'development',
          subtaskId: 'study',
          description: 'self study',
          score: 5,
        },
        decision: { status: 'in-progress', reason: 'study requires another session' },
      },
    ]);
    expect(result.subtaskCompletionDecision).toEqual({ status: 'completed' });
  });

  test('returns replan results when action synthesis rejects every proposal', () => {
    const plan = createBranchPlan({
      objective: 'study within available energy',
      branches: [
        {
          id: 'development',
          objective: 'improve education',
          subtasks: [{ id: 'study', description: 'study carefully', basePriority: 5 }],
        },
      ],
    });
    const simulatedActionIds: string[] = [];

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      plan,
      signals: [],
      actionSynthesis: { budget: { energyBudget: 0 } },
      microPlanners: [
        {
          domain: 'study',
          supports: ({ subtaskId }) => subtaskId === 'study',
          propose: () => [
            {
              id: 'study-expensive',
              description: 'study with high energy cost',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
              priority: 3,
              resourceEstimate: { actionSeconds: 60, energyCost: 1 },
            },
          ],
        },
      ],
      simulate: ({ action }) => {
        simulatedActionIds.push(action.id);
        return { status: 'accepted', action };
      },
    });

    expect(simulatedActionIds).toEqual([]);
    expect(result.needsReplan).toBe(true);
    expect(result.candidateActions).toEqual([]);
    expect(result.commandDrafts).toEqual([]);
    expect(result.actionSynthesisResult).toMatchObject({
      acceptedActions: [],
      rejectedActions: [
        {
          action: { id: 'study-expensive' },
          reason: 'energy budget exceeded',
        },
      ],
    });
    expect(result.simulationResults).toEqual([
      {
        status: 'needs-replan',
        action: {
          id: 'study-expensive',
          description: 'study with high energy cost',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 60, educationRatePerSecond: 1 },
          priority: 3,
          resourceEstimate: { actionSeconds: 60, energyCost: 1 },
          synthesisContext: { branchId: 'development', subtaskId: 'study', subtaskScore: 5 },
        },
        reason: 'action synthesis rejected action: energy budget exceeded',
      },
    ]);
    expect(result.replanningDecision).toEqual({
      kind: 'memory-guided-correction',
      trigger: 'simulator-rejection',
      reason: 'action synthesis rejected action: energy budget exceeded',
      failedActionIds: ['study-expensive'],
      evidenceRecordIds: [],
    });
    expect(result.subtaskCompletionDecision).toEqual({
      status: 'in-progress',
      reason: 'cycle requires replanning',
    });
  });

  test('does not create command drafts when simulator rejection cannot be repaired', () => {
    const plan = createBranchPlan({
      objective: 'survive',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 5 }],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      plan,
      signals: [],
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupation: 'Cleaner' },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
    });

    expect(result.needsReplan).toBe(true);
    expect(result.commandDrafts).toEqual([]);
    expect(result.simulationResults[0]).toEqual({
      status: 'needs-replan',
      action: {
        id: 'work-1',
        description: 'work as Cleaner',
        commandType: 'AgentWork',
        payload: { occupation: 'Cleaner' },
        synthesisContext: { branchId: 'income', subtaskId: 'work', subtaskScore: 5 },
      },
      reason: 'energy too low',
    });
  });

  test('returns no replanning decision after successful local repair', () => {
    const plan = createBranchPlan({
      objective: 'survive',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 5 }],
        },
      ],
    });
    const repairedAction = {
      id: 'eat-before-work',
      description: 'eat before work',
      commandType: 'AgentEat' as const,
      payload: { commodityName: 'Bread', quantity: 1 },
    };

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      plan,
      signals: [],
      replanningPolicy: { consecutiveFailureThreshold: 2 },
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 60 },
            },
          ],
        },
      ],
      repair: () => repairedAction,
      simulate: ({ action }) =>
        action.id === 'eat-before-work'
          ? { status: 'accepted', action }
          : { status: 'rejected', action, reason: 'satiety too low' },
    });

    expect(result.replanningDecision).toEqual({ kind: 'none' });
    expect(result.needsReplan).toBe(false);
  });

  test('uses reactive correction after local repair fails simulator validation', async () => {
    const agentId = asAgentId('agent-1');
    const plan = createBranchPlan({
      objective: 'survive while earning income',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 5 }],
        },
      ],
    });
    const localRepairAttempt = {
      id: 'work-short-shift',
      description: 'work a shorter shift',
      commandType: 'AgentWork' as const,
      payload: { occupationName: 'Cleaner', laborSeconds: 60 },
    };
    const reactiveAction = {
      id: 'eat-before-work',
      description: 'eat before retrying work',
      commandType: 'AgentEat' as const,
      payload: { commodityName: 'Bread', quantity: 1 },
    };
    const memory = createShortTermMemoryRecord({
      id: 'stm-satiety-failure',
      agentId,
      kind: 'action',
      status: 'failed',
      summary: 'Failed to work because satiety was too low; eating first repaired it.',
      occurredAt: 90,
      importanceScore: 0.9,
      source: { eventIds: [] },
      tags: ['work', 'satiety', 'eat'],
    });
    const reactiveInputs: unknown[] = [];

    const result = await runAgentPlanningCycleWithPrioritization({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 100,
      plan,
      signals: [],
      shortTermMemoryContext: [memory],
      longTermProfile: {
        agentId,
        beliefs: [
          {
            key: 'eat-before-work',
            statement: 'Eat before working when satiety is low.',
            confidence: 0.8,
            updatedAt: 95,
            provenanceRecordIds: [asMemoryRecordId('reflection-eat-before-work')],
          },
        ],
        habits: [],
        mood: [],
        values: [],
        personality: [],
        socialRecords: [],
      },
      worldDecisionContext: {
        agent: {
          agentId,
          locationId: 'market',
          physiology: { energy: 40, satiety: 15, health: 95 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 1 },
        },
        market: {
          spotPrices: [{ commodity: 'Bread', spotPrice: 5 }],
          latestPriceIndex: {
            baselineAt: 1,
            recordedAt: 100,
            overall: 1,
            ratios: { Bread: 1 },
          },
        },
      },
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 3600 },
            },
          ],
        },
      ],
      repair: () => localRepairAttempt,
      reactiveCorrector: async (input) => {
        await Promise.resolve();
        reactiveInputs.push(input);
        return {
          action: reactiveAction,
          trace: {
            status: 'accepted',
            source: 'llm',
            requestId: 'reactive-correction-cycle',
            decision: {
              kind: 'propose-action',
              rationale: 'STM shows eating before work repairs this failure.',
              evidenceRecordIds: ['stm-satiety-failure'],
              action: {
                id: 'eat-before-work',
                description: 'eat before retrying work',
                commandType: 'AgentEat',
              },
            },
          },
        };
      },
      simulate: ({ action }) => {
        if (action.id === 'eat-before-work') {
          return { status: 'accepted', action };
        }
        return {
          status: 'rejected',
          action,
          reason: action.id === 'work-short-shift' ? 'satiety remains too low' : 'satiety too low',
        };
      },
    });

    expect(reactiveInputs).toHaveLength(1);
    expect(reactiveInputs[0]).toMatchObject({
      selectedSubtask: { branchId: 'income', subtaskId: 'work' },
      rejectedAction: { id: 'work-1', commandType: 'AgentWork' },
      rejectionReason: 'satiety too low',
      localRepairAttempt,
      localRepairRejectionReason: 'satiety remains too low',
      shortTermMemoryContext: [memory],
      worldDecisionContext: { agent: { balance: 50, inventory: { Bread: 1 } } },
    });
    expect(result.needsReplan).toBe(false);
    expect(result.commandDrafts).toEqual([
      {
        simulationId: 'sim-1',
        actorId: 'agent-1',
        source: 'agent-runtime',
        type: 'AgentEat',
        payload: { commodityName: 'Bread', quantity: 1 },
        issuedAt: 100,
      },
    ]);
    expect(result.simulationResults[0]).toEqual({
      status: 'repaired',
      originalAction: {
        id: 'work-1',
        description: 'work as Cleaner',
        commandType: 'AgentWork',
        payload: { occupationName: 'Cleaner', laborSeconds: 3600 },
        synthesisContext: { branchId: 'income', subtaskId: 'work', subtaskScore: 5 },
      },
      repairedAction: reactiveAction,
      reason: 'satiety too low',
    });
    expect(result.actionRepairTraces).toEqual([
      {
        actionId: 'work-1',
        rejectionReason: 'satiety too low',
        selectedSubtask: { branchId: 'income', subtaskId: 'work' },
        localRepair: {
          status: 'rejected',
          attemptedAction: {
            id: 'work-short-shift',
            description: 'work a shorter shift',
            commandType: 'AgentWork',
          },
          rejectionReason: 'satiety remains too low',
        },
        reactiveCorrection: {
          status: 'accepted',
          source: 'llm',
          requestId: 'reactive-correction-cycle',
          decision: {
            kind: 'propose-action',
            rationale: 'STM shows eating before work repairs this failure.',
            evidenceRecordIds: ['stm-satiety-failure'],
            action: {
              id: 'eat-before-work',
              description: 'eat before retrying work',
              commandType: 'AgentEat',
            },
          },
          simulatorResult: { status: 'accepted' },
        },
        outcome: 'repaired',
      },
    ]);
  });

  test('keeps adaptive replanning authoritative when reactive correction fails validation', async () => {
    const agentId = asAgentId('agent-1');
    const plan = createBranchPlan({
      objective: 'survive while earning income',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 5 }],
        },
      ],
    });
    const reactiveAction = {
      id: 'eat-before-work',
      description: 'eat before retrying work',
      commandType: 'AgentEat' as const,
      payload: { commodityName: 'Bread', quantity: 1 },
    };

    const result = await runAgentPlanningCycleWithPrioritization({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 100,
      plan,
      signals: [],
      replanningPolicy: { consecutiveFailureThreshold: 2 },
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 3600 },
            },
          ],
        },
      ],
      reactiveCorrector: () =>
        Promise.resolve({
          action: reactiveAction,
          trace: {
            status: 'accepted',
            source: 'llm',
            decision: {
              kind: 'propose-action',
              rationale: 'Try to eat before work.',
              evidenceRecordIds: [],
              action: {
                id: 'eat-before-work',
                description: 'eat before retrying work',
                commandType: 'AgentEat',
              },
            },
          },
        }),
      simulate: ({ action }) =>
        action.id === 'eat-before-work'
          ? { status: 'rejected', action, reason: 'Bread missing' }
          : { status: 'rejected', action, reason: 'satiety too low' },
    });

    expect(result.needsReplan).toBe(true);
    expect(result.commandDrafts).toEqual([]);
    expect(result.replanningDecision).toEqual({
      kind: 'memory-guided-correction',
      trigger: 'simulator-rejection',
      reason: 'Bread missing',
      failedActionIds: ['work-1'],
      evidenceRecordIds: [],
    });
    expect(result.actionRepairTraces).toMatchObject([
      {
        actionId: 'work-1',
        localRepair: { status: 'skipped' },
        reactiveCorrection: { simulatorResult: { status: 'rejected', reason: 'Bread missing' } },
        outcome: 'needs-replan',
      },
    ]);
  });

  test('uses STM evidence for cycle-level memory-guided correction', () => {
    const agentId = asAgentId('agent-1');
    const progress = createBranchPlanProgress({ planId: 'plan-1', agentId, createdAt: 50 });
    const plan = createBranchPlan({
      objective: 'survive',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 5 }],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 100,
      plan,
      progress,
      signals: [],
      replanningPolicy: { consecutiveFailureThreshold: 2 },
      shortTermMemoryContext: [
        createShortTermMemoryRecord({
          id: 'stm-energy-failure',
          agentId,
          kind: 'action',
          status: 'failed',
          summary: 'Failed to work because energy was too low.',
          occurredAt: 90,
          importanceScore: 0.9,
          source: { eventIds: [] },
          tags: ['work', 'energy'],
        }),
      ],
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 60 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
    });

    expect(result.replanningDecision).toEqual({
      kind: 'memory-guided-correction',
      trigger: 'simulator-rejection',
      reason: 'energy too low',
      failedActionIds: ['work-1'],
      evidenceRecordIds: ['stm-energy-failure'],
    });
    expect(result.progressUpdate).toBeUndefined();
  });

  test('returns a progress update when full replanning blocks the selected subtask', () => {
    const agentId = asAgentId('agent-1');
    const progress = createBranchPlanProgress({ planId: 'plan-1', agentId, createdAt: 50 });
    const plan = createBranchPlan({
      objective: 'survive',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 5 }],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 100,
      plan,
      progress,
      signals: [],
      replanningPolicy: { consecutiveFailureThreshold: 1 },
      shortTermMemoryContext: [
        createShortTermMemoryRecord({
          id: 'stm-energy-failure',
          agentId,
          kind: 'action',
          status: 'failed',
          summary: 'Failed to work because energy was too low.',
          occurredAt: 90,
          importanceScore: 0.9,
          source: { eventIds: [] },
          tags: ['work', 'energy'],
        }),
      ],
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 60 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
    });

    expect(result.replanningDecision).toMatchObject({
      kind: 'full-replan',
      trigger: 'repeated-failure',
    });
    expect(result.progressUpdate).toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [
        {
          subtaskId: 'work',
          reason: 'repeated-failure: energy too low',
          blockedAt: 100,
        },
      ],
      updatedAt: 100,
    });
  });

  test('blocks failed synthesized subtask instead of top selected subtask on full replanning', () => {
    const agentId = asAgentId('agent-1');
    const progress = createBranchPlanProgress({ planId: 'plan-1', agentId, createdAt: 50 });
    const plan = createBranchPlan({
      objective: 'balance income and development',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 6 }],
        },
        {
          id: 'development',
          objective: 'improve education',
          subtasks: [{ id: 'study', description: 'self study', basePriority: 5 }],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 100,
      plan,
      progress,
      signals: [],
      actionSynthesis: {
        maxActions: 2,
        candidateSubtasks: { maxSubtasks: 2 },
        branchLimits: { maxAcceptedActionsPerBranch: 1 },
      },
      replanningPolicy: { consecutiveFailureThreshold: 1 },
      shortTermMemoryContext: [
        createShortTermMemoryRecord({
          id: 'stm-study-energy-failure',
          agentId,
          kind: 'action',
          status: 'failed',
          summary: 'Failed to study because energy was too low.',
          occurredAt: 90,
          importanceScore: 0.9,
          source: { eventIds: [] },
          tags: ['study', 'energy'],
        }),
      ],
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 60 },
              priority: 5,
              resourceEstimate: { actionSeconds: 60, energyCost: 10 },
            },
          ],
        },
        {
          domain: 'study',
          supports: ({ subtaskId }) => subtaskId === 'study',
          propose: () => [
            {
              id: 'study-1',
              description: 'study for one minute',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
              priority: 4,
              resourceEstimate: { actionSeconds: 60 },
            },
          ],
        },
      ],
      simulate: ({ action }) =>
        action.id === 'study-1'
          ? { status: 'rejected', action, reason: 'energy too low' }
          : { status: 'accepted', action },
    });

    expect(result.selectedSubtask).toMatchObject({ branchId: 'income', subtaskId: 'work' });
    expect(result.replanningDecision).toMatchObject({
      kind: 'full-replan',
      trigger: 'repeated-failure',
      failedActionIds: ['study-1'],
    });
    expect(result.progressUpdate).toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [
        {
          subtaskId: 'study',
          reason: 'repeated-failure: energy too low',
          blockedAt: 100,
        },
      ],
      updatedAt: 100,
    });
  });

  test('records replanning decisions for each synthesized producer subtask', () => {
    const agentId = asAgentId('agent-1');
    const plan = createBranchPlan({
      objective: 'balance income and development',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 6 }],
        },
        {
          id: 'development',
          objective: 'improve education',
          subtasks: [{ id: 'study', description: 'self study', basePriority: 5 }],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 100,
      plan,
      signals: [],
      actionSynthesis: {
        maxActions: 2,
        candidateSubtasks: { maxSubtasks: 2 },
        branchLimits: { maxAcceptedActionsPerBranch: 1 },
      },
      replanningPolicy: { consecutiveFailureThreshold: 1 },
      shortTermMemoryContext: [
        createShortTermMemoryRecord({
          id: 'stm-study-energy-failure',
          agentId,
          kind: 'action',
          status: 'failed',
          summary: 'Failed to study because energy was too low.',
          occurredAt: 90,
          importanceScore: 0.9,
          source: { eventIds: [] },
          tags: ['study', 'energy'],
        }),
      ],
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 60 },
              priority: 5,
              resourceEstimate: { actionSeconds: 60, energyCost: 10 },
            },
          ],
        },
        {
          domain: 'study',
          supports: ({ subtaskId }) => subtaskId === 'study',
          propose: () => [
            {
              id: 'study-1',
              description: 'study for one minute',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
              priority: 4,
              resourceEstimate: { actionSeconds: 60 },
            },
          ],
        },
      ],
      simulate: ({ action }) =>
        action.id === 'study-1'
          ? { status: 'rejected', action, reason: 'energy too low' }
          : { status: 'accepted', action },
    });

    expect(result.subtaskReplanningDecisions).toEqual([
      {
        selectedSubtask: {
          branchId: 'income',
          subtaskId: 'work',
          description: 'work shift',
          score: 6,
        },
        decision: { kind: 'none' },
      },
      {
        selectedSubtask: {
          branchId: 'development',
          subtaskId: 'study',
          description: 'self study',
          score: 5,
        },
        decision: {
          kind: 'full-replan',
          trigger: 'repeated-failure',
          reason: 'energy too low',
          failedActionIds: ['study-1'],
          evidenceRecordIds: ['stm-study-energy-failure'],
          matchingFailureCount: 1,
        },
      },
    ]);
  });

  test('escalates major context shifts to full replanning during a cycle', () => {
    const plan = createBranchPlan({
      objective: 'survive',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 5 }],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      plan,
      signals: [],
      replanningPolicy: {
        consecutiveFailureThreshold: 2,
        majorContextShift: {
          key: 'market-crash',
          reason: 'Food prices doubled since the plan was created.',
        },
      },
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 60 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.replanningDecision).toEqual({
      kind: 'full-replan',
      trigger: 'major-context-shift',
      reason: 'Food prices doubled since the plan was created.',
      failedActionIds: [],
      evidenceRecordIds: [],
      matchingFailureCount: 0,
    });
  });

  test('uses long-term profile influence during subtask selection', () => {
    const plan = createBranchPlan({
      objective: 'balance survival and development',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 3 }],
        },
        {
          id: 'development',
          objective: 'improve education',
          subtasks: [
            {
              id: 'study',
              description: 'self study',
              basePriority: 2,
              profileAffinityTags: ['study'],
            },
          ],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      plan,
      signals: [],
      longTermProfile: {
        agentId: asAgentId('agent-1'),
        beliefs: [],
        habits: [
          {
            key: 'study',
            statement: 'Studies after work.',
            confidence: 0.9,
            updatedAt: 20,
            provenanceRecordIds: [],
          },
        ],
        mood: [],
        values: [],
        personality: [],
        socialRecords: [],
      },
      microPlanners: [
        {
          domain: 'study',
          supports: ({ subtaskId }) => subtaskId === 'study',
          propose: () => [
            {
              id: 'study-1',
              description: 'self study',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
            },
          ],
        },
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupation: 'Cleaner' },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.selectedSubtask).toMatchObject({
      branchId: 'development',
      subtaskId: 'study',
      score: 3.8,
    });
    expect(result.commandDrafts[0]?.type).toBe('AgentStudy');
  });

  test('uses intention state during subtask selection', () => {
    const agentId = asAgentId('agent-1');
    const plan = createBranchPlan({
      objective: 'follow strategic steering',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 4 }],
        },
        {
          id: 'development',
          objective: 'study',
          subtasks: [
            {
              id: 'study',
              description: 'study now',
              basePriority: 1,
              intentionAffinityTags: ['study'],
            },
          ],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 150,
      plan,
      signals: [],
      intentionState: {
        agentId,
        updatedAt: 20,
        completedObjectives: [],
        activeObjective: {
          id: 'objective-study',
          agentId,
          statement: 'Study before production.',
          priority: 2,
          source: 'human',
          affinityTags: ['study'],
          createdAt: 10,
          updatedAt: 20,
        },
        scheduledIntentions: [],
      },
      microPlanners: [
        {
          domain: 'study',
          supports: ({ subtaskId }) => subtaskId === 'study',
          propose: () => [
            {
              id: 'study-1',
              description: 'self study',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 60, educationRatePerSecond: 1 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.selectedSubtask).toMatchObject({
      branchId: 'development',
      subtaskId: 'study',
      score: 5,
    });
    expect(result.commandDrafts[0]?.type).toBe('AgentStudy');
  });

  test('uses short-term memory influence during subtask selection', () => {
    const agentId = asAgentId('agent-1');
    const plan = createBranchPlan({
      objective: 'avoid repeating recent failures',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 4 }],
        },
        {
          id: 'recovery',
          objective: 'restore energy',
          subtasks: [
            {
              id: 'sleep',
              description: 'rest before working',
              basePriority: 1,
              memoryAffinityTags: ['energy'],
              profileAffinityTags: ['recovery'],
            },
          ],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 1000,
      plan,
      signals: [],
      longTermProfile: {
        agentId,
        beliefs: [],
        habits: [
          {
            key: 'rest-recovery',
            statement: 'Rest to recover from energy depletion.',
            confidence: 0.7,
            updatedAt: 900,
            provenanceRecordIds: [asMemoryRecordId('reflection-rest-1')],
          },
        ],
        mood: [],
        values: [],
        personality: [],
        socialRecords: [],
      },
      shortTermMemoryContext: [
        createShortTermMemoryRecord({
          id: 'recent-energy-failure',
          agentId,
          kind: 'action',
          status: 'failed',
          summary: 'Failed to work because energy was too low.',
          occurredAt: 1000,
          importanceScore: 0.8,
          source: { eventIds: [] },
          tags: ['work', 'energy'],
        }),
      ],
      microPlanners: [
        {
          domain: 'sleep',
          supports: ({ subtaskId }) => subtaskId === 'sleep',
          propose: () => [
            {
              id: 'sleep-1',
              description: 'sleep for one minute',
              commandType: 'AgentSleep',
              payload: { durationSeconds: 60 },
            },
          ],
        },
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 60 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.selectedSubtask).toMatchObject({
      branchId: 'recovery',
      subtaskId: 'sleep',
      score: 5.6,
    });
    expect(result.selectionEvidence).toEqual({
      selectedSubtaskId: 'sleep',
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 3.2,
      profileInfluenceScore: 1.4,
      memoryEvidenceRecordIds: ['recent-energy-failure'],
      profileEntryKeys: ['rest-recovery'],
      profileEvidenceRecordIds: ['reflection-rest-1'],
    });
    expect(result.subtaskCandidates).toEqual([
      {
        branchId: 'recovery',
        subtaskId: 'sleep',
        description: 'rest before working',
        score: 5.6,
        scoreBreakdown: {
          basePriorityScore: 1,
          signalInfluenceScore: 0,
          intentionInfluenceScore: 0,
          memoryInfluenceScore: 3.2,
          profileInfluenceScore: 1.4,
        },
      },
      {
        branchId: 'income',
        subtaskId: 'work',
        description: 'work shift',
        score: 4,
        scoreBreakdown: {
          basePriorityScore: 4,
          signalInfluenceScore: 0,
          intentionInfluenceScore: 0,
          memoryInfluenceScore: 0,
          profileInfluenceScore: 0,
        },
      },
    ]);
    expect(result.commandDrafts[0]?.type).toBe('AgentSleep');
  });

  test('uses branch plan progress to gate dependent subtasks during cycle selection', () => {
    const agentId = asAgentId('agent-1');
    const plan = createBranchPlan({
      objective: 'produce copper ingot',
      branches: [
        {
          id: 'production',
          objective: 'craft components',
          subtasks: [
            {
              id: 'gather-ore',
              description: 'gather copper ore',
              basePriority: 2,
            },
            {
              id: 'craft-ingot',
              description: 'craft copper ingot',
              basePriority: 10,
              dependsOnSubtaskIds: ['gather-ore'],
            },
          ],
        },
      ],
    });
    const progress = createBranchPlanProgress({ planId: 'plan-1', agentId, createdAt: 100 });
    const microPlanners = [
      {
        domain: 'gather',
        supports: ({ subtaskId }) => subtaskId === 'gather-ore',
        propose: () => [
          {
            id: 'gather-1',
            description: 'gather ore',
            commandType: 'AgentProduce',
            payload: {
              commodityName: 'Copper Ore',
              quantity: 1,
              availableLaborSeconds: 60,
            },
          },
        ],
      },
      {
        domain: 'craft',
        supports: ({ subtaskId }) => subtaskId === 'craft-ingot',
        propose: () => [
          {
            id: 'craft-1',
            description: 'craft ingot',
            commandType: 'AgentProduce',
            payload: {
              commodityName: 'Copper Ingot',
              quantity: 1,
              availableLaborSeconds: 60,
            },
          },
        ],
      },
    ] satisfies Parameters<typeof runAgentPlanningCycle>[0]['microPlanners'];

    const first = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 150,
      plan,
      progress,
      signals: [],
      microPlanners,
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });
    const second = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 250,
      plan,
      progress: markSubtaskCompleted(progress, {
        subtaskId: 'gather-ore',
        completedAt: 200,
      }),
      signals: [],
      microPlanners,
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(first.selectedSubtask.subtaskId).toBe('gather-ore');
    expect(first.commandDrafts[0]?.payload).toEqual({
      commodityName: 'Copper Ore',
      quantity: 1,
      availableLaborSeconds: 60,
    });
    expect(second.selectedSubtask.subtaskId).toBe('craft-ingot');
    expect(second.commandDrafts[0]?.payload).toEqual({
      commodityName: 'Copper Ingot',
      quantity: 1,
      availableLaborSeconds: 60,
    });
  });

  test('keeps successful actions in progress when the completion policy is not satisfied', () => {
    const agentId = asAgentId('agent-1');
    const progress = createBranchPlanProgress({ planId: 'plan-1', agentId, createdAt: 100 });
    const plan = createBranchPlan({
      objective: 'produce book',
      branches: [
        {
          id: 'production',
          objective: 'craft the target commodity',
          subtasks: [
            {
              id: 'produce-book',
              description: 'produce Book',
              basePriority: 5,
            },
          ],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId,
      issuedAt: 150,
      plan,
      progress,
      signals: [],
      microPlanners: [
        {
          domain: 'production',
          supports: ({ subtaskId }) => subtaskId === 'produce-book',
          propose: () => [
            {
              id: 'produce-wood-for-book',
              description: 'produce upstream Wood for Book',
              commandType: 'AgentProduce',
              payload: {
                commodityName: 'Wood',
                quantity: 1,
                availableLaborSeconds: 60,
              },
            },
          ],
        },
      ],
      subtaskCompletion: () => ({
        status: 'in-progress',
        reason: 'produced upstream material Wood for target Book',
      }),
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.subtaskCompletionDecision).toEqual({
      status: 'in-progress',
      reason: 'produced upstream material Wood for target Book',
    });
    expect(result.progressUpdate).toBeUndefined();
  });
});
