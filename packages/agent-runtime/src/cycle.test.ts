import { asMemoryRecordId, createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId, asSimulationId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createBranchPlan,
  createBranchPlanProgress,
  markSubtaskCompleted,
  runAgentPlanningCycle,
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
          },
          reason: 'maxActions exhausted',
        },
      ],
    });
    expect(result.commandDrafts).toHaveLength(1);
    expect(result.commandDrafts[0]?.type).toBe('AgentWork');
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
});
