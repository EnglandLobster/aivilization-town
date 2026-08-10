import { asMemoryRecordId, createShortTermMemoryRecord } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyReplanningDecisionToProgress,
  createBranchPlanProgress,
  decideAdaptiveReplanning,
} from './index';

const agentId = asAgentId('agent-1');
const selectedSubtask = {
  branchId: 'income',
  subtaskId: 'work',
  description: 'work shift',
  score: 5,
};
const workAction = {
  id: 'work-1',
  description: 'work as Cleaner',
  commandType: 'AgentWork' as const,
  payload: { occupationName: 'Cleaner', laborSeconds: 60 },
};
const eatAction = {
  id: 'eat-before-work',
  description: 'eat before work',
  commandType: 'AgentEat' as const,
  payload: { commodityName: 'Bread', quantity: 1 },
};

describe('adaptive replanning decision', () => {
  test('returns none when actions are accepted or locally repaired', () => {
    expect(
      decideAdaptiveReplanning({
        selectedSubtask,
        simulationResults: [
          { status: 'accepted', action: workAction },
          {
            status: 'repaired',
            originalAction: workAction,
            repairedAction: eatAction,
            reason: 'satiety too low',
          },
        ],
        shortTermMemoryContext: [],
        consecutiveFailureThreshold: 2,
      }),
    ).toEqual({ kind: 'none' });
  });

  test('uses STM evidence for memory-guided correction after a current unrepaired failure', () => {
    expect(
      decideAdaptiveReplanning({
        selectedSubtask,
        simulationResults: [
          {
            status: 'needs-replan',
            action: workAction,
            reason: 'energy too low',
          },
        ],
        shortTermMemoryContext: [
          createShortTermMemoryRecord({
            id: 'stm-energy-failure',
            agentId,
            kind: 'action',
            status: 'failed',
            summary: 'Failed to work because energy was too low.',
            occurredAt: 1000,
            importanceScore: 0.9,
            source: { eventIds: [] },
            tags: ['work', 'energy'],
          }),
        ],
        consecutiveFailureThreshold: 2,
      }),
    ).toEqual({
      kind: 'memory-guided-correction',
      trigger: 'simulator-rejection',
      reason: 'energy too low',
      failedActionIds: ['work-1'],
      evidenceRecordIds: ['stm-energy-failure'],
    });
  });

  test('escalates repeated matching failures to full replanning', () => {
    expect(
      decideAdaptiveReplanning({
        selectedSubtask,
        simulationResults: [
          {
            status: 'needs-replan',
            action: workAction,
            reason: 'energy too low',
          },
        ],
        shortTermMemoryContext: [
          createShortTermMemoryRecord({
            id: 'stm-energy-failure-1',
            agentId,
            kind: 'action',
            status: 'failed',
            summary: 'Failed to work because energy was too low.',
            occurredAt: 1000,
            importanceScore: 0.9,
            source: { eventIds: [] },
            tags: ['work', 'energy'],
          }),
          createShortTermMemoryRecord({
            id: 'stm-energy-failure-2',
            agentId,
            kind: 'action',
            status: 'failed',
            summary: 'Another work attempt failed from low energy.',
            occurredAt: 1100,
            importanceScore: 0.9,
            source: { eventIds: [] },
            tags: ['work', 'energy'],
          }),
        ],
        consecutiveFailureThreshold: 2,
      }),
    ).toEqual({
      kind: 'full-replan',
      trigger: 'repeated-failure',
      reason: 'energy too low',
      failedActionIds: ['work-1'],
      evidenceRecordIds: ['stm-energy-failure-1', 'stm-energy-failure-2'],
      matchingFailureCount: 2,
    });
  });

  test('escalates major context shifts to full replanning even without current failure', () => {
    expect(
      decideAdaptiveReplanning({
        selectedSubtask,
        simulationResults: [{ status: 'accepted', action: workAction }],
        shortTermMemoryContext: [],
        consecutiveFailureThreshold: 2,
        majorContextShift: {
          key: 'market-crash',
          reason: 'Food prices doubled since the plan was created.',
        },
      }),
    ).toEqual({
      kind: 'full-replan',
      trigger: 'major-context-shift',
      reason: 'Food prices doubled since the plan was created.',
      failedActionIds: [],
      evidenceRecordIds: [],
      matchingFailureCount: 0,
    });
  });

  test('does not update progress for memory-guided correction', () => {
    const progress = createBranchPlanProgress({
      planId: 'plan-1',
      agentId,
      createdAt: 100,
    });

    expect(
      applyReplanningDecisionToProgress({
        progress,
        selectedSubtask,
        decision: {
          kind: 'memory-guided-correction',
          trigger: 'simulator-rejection',
          reason: 'energy too low',
          failedActionIds: ['work-1'],
          evidenceRecordIds: [asMemoryRecordId('stm-energy-failure')],
        },
        at: 200,
      }),
    ).toBeUndefined();
    expect(progress.blockedSubtasks).toEqual([]);
  });

  test('marks selected subtask completed when no replanning is needed', () => {
    const progress = createBranchPlanProgress({
      planId: 'plan-1',
      agentId,
      createdAt: 100,
    });

    expect(
      applyReplanningDecisionToProgress({
        progress,
        selectedSubtask,
        decision: { kind: 'none' },
        at: 200,
      }),
    ).toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: ['work'],
      blockedSubtasks: [],
      updatedAt: 200,
    });
    expect(progress.completedSubtaskIds).toEqual([]);
  });

  test('marks selected subtask blocked for full replanning decisions', () => {
    const progress = createBranchPlanProgress({
      planId: 'plan-1',
      agentId,
      createdAt: 100,
    });

    expect(
      applyReplanningDecisionToProgress({
        progress,
        selectedSubtask,
        decision: {
          kind: 'full-replan',
          trigger: 'repeated-failure',
          reason: 'energy too low',
          failedActionIds: ['work-1'],
          evidenceRecordIds: [
            asMemoryRecordId('stm-energy-failure-1'),
            asMemoryRecordId('stm-energy-failure-2'),
          ],
          matchingFailureCount: 2,
        },
        at: 300,
      }),
    ).toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [
        {
          subtaskId: 'work',
          reason: 'repeated-failure: energy too low',
          blockedAt: 300,
        },
      ],
      updatedAt: 300,
    });
    expect(progress.blockedSubtasks).toEqual([]);
  });
});
