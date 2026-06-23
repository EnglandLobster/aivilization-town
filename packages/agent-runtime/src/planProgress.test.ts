import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createBranchPlanProgress, markSubtaskBlocked, markSubtaskCompleted } from './index';

const agentId = asAgentId('agent-1');

describe('branch plan progress', () => {
  test('creates empty progress for a plan', () => {
    expect(
      createBranchPlanProgress({
        planId: 'plan-1',
        agentId,
        createdAt: 100,
      }),
    ).toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 100,
    });
  });

  test('marks completed subtasks once and keeps deterministic order', () => {
    const initial = createBranchPlanProgress({ planId: 'plan-1', agentId, createdAt: 100 });
    const updated = markSubtaskCompleted(
      markSubtaskCompleted(
        markSubtaskCompleted(initial, { subtaskId: 'craft-ingot', completedAt: 200 }),
        { subtaskId: 'gather-ore', completedAt: 250 },
      ),
      { subtaskId: 'craft-ingot', completedAt: 300 },
    );

    expect(updated).toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: ['craft-ingot', 'gather-ore'],
      blockedSubtasks: [],
      updatedAt: 300,
    });
    expect(initial.completedSubtaskIds).toEqual([]);
  });

  test('marks blocked subtasks with latest reason in deterministic order', () => {
    const initial = createBranchPlanProgress({ planId: 'plan-1', agentId, createdAt: 100 });
    const updated = markSubtaskBlocked(
      markSubtaskBlocked(
        markSubtaskBlocked(initial, {
          subtaskId: 'craft-ingot',
          reason: 'missing ore',
          blockedAt: 200,
        }),
        {
          subtaskId: 'apply-job',
          reason: 'education too low',
          blockedAt: 250,
        },
      ),
      {
        subtaskId: 'craft-ingot',
        reason: 'missing furnace',
        blockedAt: 300,
      },
    );

    expect(updated).toEqual({
      planId: 'plan-1',
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [
        { subtaskId: 'apply-job', reason: 'education too low', blockedAt: 250 },
        { subtaskId: 'craft-ingot', reason: 'missing furnace', blockedAt: 300 },
      ],
      updatedAt: 300,
    });
    expect(initial.blockedSubtasks).toEqual([]);
  });
});
