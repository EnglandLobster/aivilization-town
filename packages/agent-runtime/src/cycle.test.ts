import { createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId, asSimulationId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createBranchPlan, runAgentPlanningCycle } from './index';

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
      score: 4.2,
    });
    expect(result.commandDrafts[0]?.type).toBe('AgentSleep');
  });
});
