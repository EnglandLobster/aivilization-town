import {
  createBranchPlan,
  createBranchPlanProgress,
  InMemoryBranchPlanProgressRepository,
  InMemoryBranchPlanRepository,
} from '@aivilization/agent-runtime';
import {
  asMemoryRecordId,
  InMemoryAgentIntentionRepository,
  type LongTermAgentProfile,
} from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { materializeFullReplanForActiveObjective } from './index';

const agentId = asAgentId('agent-1');

describe('worker objective replanning materialization', () => {
  test('recompiles the active objective and resets progress for full replanning', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const objective = {
      id: 'objective-high-tech',
      agentId,
      statement: 'Craft high-tech goods while preserving health.',
      priority: 9,
      source: 'agent' as const,
      affinityTags: ['production', 'health'],
      createdAt: 40,
      updatedAt: 40,
    };
    const oldPlan = createBranchPlan({
      objective: objective.statement,
      branches: [
        {
          id: 'old-production',
          objective: 'old production branch',
          subtasks: [{ id: 'old-craft', description: 'old craft action', basePriority: 3 }],
        },
      ],
    });
    const replacementPlan = createBranchPlan({
      objective: objective.statement,
      branches: [
        {
          id: 'replanned-production',
          objective: 'replanned production branch',
          subtasks: [
            {
              id: 'recover-then-craft',
              description: 'recover physiological state before crafting',
              basePriority: 8,
            },
          ],
        },
      ],
    });
    await intentionRepository.setObjective(agentId, objective);
    await planRepository.save({
      planId: objective.id,
      agentId,
      plan: oldPlan,
      createdAt: 50,
      updatedAt: 50,
    });
    await planProgressRepository.save({
      ...createBranchPlanProgress({ planId: objective.id, agentId, createdAt: 50 }),
      blockedSubtasks: [
        {
          subtaskId: 'old-craft',
          reason: 'repeated-failure: missing resources',
          blockedAt: 90,
        },
      ],
      updatedAt: 90,
    });

    const result = await materializeFullReplanForActiveObjective({
      agentId,
      planId: objective.id,
      issuedAt: 200,
      intentionRepository,
      planRepository,
      planProgressRepository,
      replanningDecision: {
        kind: 'full-replan',
        trigger: 'repeated-failure',
        reason: 'missing resources',
        failedActionIds: ['craft-chip'],
        evidenceRecordIds: [],
        matchingFailureCount: 2,
      },
      strategicPlanCompiler: () => ({
        plan: replacementPlan,
        planningTrace: {
          status: 'deterministic',
          source: 'deterministic',
          message: 'replacement plan from test compiler',
        },
      }),
    });

    expect(result).toEqual({
      status: 'replanned',
      agentId,
      objectiveId: objective.id,
      planId: objective.id,
      progressReset: true,
      trigger: 'repeated-failure',
      failedActionIds: ['craft-chip'],
      evidenceRecordIds: [],
      matchingFailureCount: 2,
    });
    await expect(planRepository.require({ planId: objective.id, agentId })).resolves.toEqual({
      planId: objective.id,
      agentId,
      plan: replacementPlan,
      planningTrace: {
        status: 'deterministic',
        source: 'deterministic',
        message: 'replacement plan from test compiler',
      },
      createdAt: 50,
      updatedAt: 200,
    });
    await expect(planProgressRepository.get({ planId: objective.id, agentId })).resolves.toEqual({
      planId: objective.id,
      agentId,
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 200,
    });
  });

  test('passes long-term profile context into full replan strategic compilers', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const objective = {
      id: 'objective-high-tech',
      agentId,
      statement: 'Craft high-tech goods.',
      priority: 9,
      source: 'agent' as const,
      affinityTags: ['production'],
      createdAt: 40,
      updatedAt: 40,
    };
    const longTermProfile: LongTermAgentProfile = {
      agentId,
      beliefs: [],
      habits: [],
      mood: [],
      values: [
        {
          key: 'human-objective:study-before-production',
          statement:
            'Human steering set long-horizon objective: Study before high-tech production.',
          confidence: 0.95,
          updatedAt: 80,
          provenanceRecordIds: [asMemoryRecordId('cmd-study:strategic-objective')],
        },
      ],
      personality: [],
      socialRecords: [],
    };
    let compilerProfileKeys: readonly string[] = [];

    await intentionRepository.setObjective(agentId, objective);

    await materializeFullReplanForActiveObjective({
      agentId,
      planId: objective.id,
      issuedAt: 200,
      intentionRepository,
      planRepository,
      longTermProfile,
      replanningDecision: {
        kind: 'full-replan',
        trigger: 'major-context-shift',
        reason: 'market regime changed',
        failedActionIds: [],
        evidenceRecordIds: [],
        matchingFailureCount: 0,
      },
      strategicPlanCompiler: (input) => {
        compilerProfileKeys = input.longTermProfile?.values.map((entry) => entry.key) ?? [];
        return createBranchPlan({
          objective: input.objective.statement,
          branches: [
            {
              id: 'profile-aware-replan',
              objective: 'Use profile context in recovery planning.',
              subtasks: [
                {
                  id: 'study',
                  description: 'Study before production.',
                  basePriority: 12,
                },
              ],
            },
          ],
        });
      },
    });

    expect(compilerProfileKeys).toEqual(['human-objective:study-before-production']);
  });

  test('skips materialization when the active objective is missing', async () => {
    const result = await materializeFullReplanForActiveObjective({
      agentId,
      planId: 'missing-objective',
      issuedAt: 200,
      intentionRepository: new InMemoryAgentIntentionRepository(),
      planRepository: new InMemoryBranchPlanRepository(),
      replanningDecision: {
        kind: 'full-replan',
        trigger: 'major-context-shift',
        reason: 'market regime changed',
        failedActionIds: [],
        evidenceRecordIds: [],
        matchingFailureCount: 0,
      },
    });

    expect(result).toEqual({
      status: 'skipped',
      agentId,
      planId: 'missing-objective',
      reason: 'missing-active-objective',
    });
  });
});
