import {
  createBranchPlan,
  createBranchPlanProgress,
  InMemoryBranchPlanProgressRepository,
  InMemoryBranchPlanRepository,
  markSubtaskCompleted,
  type StrategicPlanContextSnapshot,
  type StrategicPlanCompilerInput,
} from '@aivilization/agent-runtime';
import {
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  type LongHorizonObjective,
} from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { createWorldProjection, type WorldAgentState } from '@aivilization/world';
import { describe, expect, test, vi } from 'vitest';
import {
  createAivilizationWorldCommandPoliciesSnapshot,
  createStrategicPlanContextSnapshot,
  createStrategicPlanRenewalPolicyManifest,
  createWorldDecisionContextFromProjection,
  detectStrategicPlanContextShift,
  renewActiveStrategicPlansForMajorContextShifts,
  supersedeActiveAutonomousObjectivesForMajorContextShifts,
  STRATEGIC_PLAN_RENEWAL_POLICY_VERSION,
} from './index';

const agentId = asAgentId('strategic-renewal-agent');

describe('strategic plan renewal', () => {
  test('classifies only versioned strategic regime changes as top-level replan triggers', () => {
    const previous = createSnapshot();
    const ordinaryTick = createSnapshot({ capturedAt: 200 });

    expect(detectStrategicPlanContextShift({ previous, current: ordinaryTick })).toEqual([]);
    expect(
      detectStrategicPlanContextShift({
        previous,
        current: createSnapshot({
          capturedAt: 300,
          physiologyRegimes: ['low-health'],
          job: 'Teacher',
          residentialTier: 2,
          eligibleOccupationNames: ['Cleaner', 'Teacher'],
          educationInvestmentRegime: 'reserve-breaking',
          strategicProfileEntryVersions: [
            'values:learning:300:0.9:Education is worth delaying work.',
          ],
          overallPriceIndex: 1.3,
        }),
      }),
    ).toEqual([
      'physiology-regime-changed',
      'occupation-changed',
      'residential-tier-changed',
      'occupation-eligibility-changed',
      'education-investment-regime-changed',
      'strategic-profile-changed',
      'market-price-regime-changed',
    ]);
    expect(createStrategicPlanRenewalPolicyManifest()).toMatchObject({
      policyVersion: STRATEGIC_PLAN_RENEWAL_POLICY_VERSION,
      marketPriceIndexRelativeShiftThreshold: 0.25,
      nonTriggers: [
        'location-change',
        'ordinary-inventory-change',
        'ordinary-balance-change',
        'completed-plan-awaiting-objective-finalization',
      ],
    });
  });

  test('records a missing baseline without needlessly recompiling the hierarchy', async () => {
    const repositories = createRepositories();
    const projection = createProjection({ health: 100 });
    const objective = createObjective();
    await repositories.intentionRepository.setObjective(agentId, objective);
    await repositories.planRepository.save({
      planId: objective.id,
      agentId,
      plan: createPlan('initial'),
      createdAt: 100,
      updatedAt: 100,
    });
    const compiler = vi.fn(() => createPlan('unexpected'));

    await expect(
      renewActiveStrategicPlansForMajorContextShifts({
        projection,
        policies: createAivilizationWorldCommandPoliciesSnapshot([0], 'renewal-test'),
        ...repositories,
        strategicPlanCompiler: compiler,
        issuedAt: 200,
      }),
    ).resolves.toMatchObject([
      {
        status: 'baseline-recorded',
        agentId,
        planId: objective.id,
        strategicContext: {
          policyVersion: STRATEGIC_PLAN_RENEWAL_POLICY_VERSION,
          physiologyRegimes: ['stable'],
        },
      },
    ]);
    expect(compiler).not.toHaveBeenCalled();
    await expect(
      repositories.planRepository.require({ planId: objective.id, agentId }),
    ).resolves.toMatchObject({
      plan: createPlan('initial'),
      strategicContext: {
        policyVersion: STRATEGIC_PLAN_RENEWAL_POLICY_VERSION,
        capturedAt: 200,
      },
      updatedAt: 200,
    });
  });

  test('recompiles and resets progress after a durable major context shift', async () => {
    const repositories = createRepositories();
    const policies = createAivilizationWorldCommandPoliciesSnapshot([0], 'renewal-test');
    const stableProjection = createProjection({ health: 100 });
    const crisisProjection = createProjection({ health: 10 });
    const objective = createObjective();
    const profile = await repositories.longTermProfileRepository.getOrCreate(agentId);
    const stableContext = createWorldDecisionContextFromProjection({
      projection: stableProjection,
      agentId,
      policies,
    });
    const strategicContext = createStrategicPlanContextSnapshot({
      worldDecisionContext: stableContext,
      longTermProfile: profile,
      capturedAt: 100,
    });
    await repositories.intentionRepository.setObjective(agentId, objective);
    await repositories.planRepository.save({
      planId: objective.id,
      agentId,
      plan: createPlan('initial'),
      strategicContext,
      createdAt: 100,
      updatedAt: 100,
    });
    await repositories.planProgressRepository.save(
      markSubtaskCompleted(
        createBranchPlanProgress({ planId: objective.id, agentId, createdAt: 100 }),
        { subtaskId: 'initial-action', completedAt: 150 },
      ),
    );
    const compiler = vi.fn((input: StrategicPlanCompilerInput) => {
      expect(input.worldDecisionContext?.agent.physiology.health).toBe(10);
      return createPlan('crisis');
    });

    await expect(
      renewActiveStrategicPlansForMajorContextShifts({
        projection: crisisProjection,
        policies,
        ...repositories,
        strategicPlanCompiler: compiler,
        issuedAt: 200,
      }),
    ).resolves.toMatchObject([
      {
        status: 'replanned',
        agentId,
        planId: objective.id,
        reasons: ['physiology-regime-changed'],
        progressReset: true,
        strategicContext: { physiologyRegimes: ['low-health'] },
      },
    ]);
    expect(compiler).toHaveBeenCalledTimes(1);
    await expect(
      repositories.planRepository.require({ planId: objective.id, agentId }),
    ).resolves.toMatchObject({
      plan: createPlan('crisis'),
      strategicContext: { physiologyRegimes: ['low-health'] },
      revision: {
        policyVersion: STRATEGIC_PLAN_RENEWAL_POLICY_VERSION,
        trigger: 'major-context-shift',
        reasons: ['physiology-regime-changed'],
        previousContext: { physiologyRegimes: ['stable'] },
        currentContext: { physiologyRegimes: ['low-health'] },
      },
      createdAt: 100,
      updatedAt: 200,
    });
    await expect(
      repositories.planProgressRepository.get({ planId: objective.id, agentId }),
    ).resolves.toMatchObject({
      completedSubtaskIds: [],
      blockedSubtasks: [],
      updatedAt: 200,
    });
  });

  test('does not reset a completed plan while its time-bearing world effect is pending', async () => {
    const repositories = createRepositories();
    const policies = createAivilizationWorldCommandPoliciesSnapshot([0], 'renewal-test');
    const stableProjection = createProjection({ health: 100 });
    const crisisProjection = createProjection({ health: 10 });
    const objective = createObjective();
    const profile = await repositories.longTermProfileRepository.getOrCreate(agentId);
    const strategicContext = createStrategicPlanContextSnapshot({
      worldDecisionContext: createWorldDecisionContextFromProjection({
        projection: stableProjection,
        agentId,
        policies,
      }),
      longTermProfile: profile,
      capturedAt: 100,
    });
    await repositories.intentionRepository.setObjective(agentId, objective);
    await repositories.planRepository.save({
      planId: objective.id,
      agentId,
      plan: createPlan('initial'),
      strategicContext,
      createdAt: 100,
      updatedAt: 100,
    });
    await repositories.planProgressRepository.save(
      markSubtaskCompleted(
        markSubtaskCompleted(
          createBranchPlanProgress({ planId: objective.id, agentId, createdAt: 100 }),
          { subtaskId: 'initial-action', completedAt: 150 },
        ),
        { subtaskId: 'initial-followup', completedAt: 150 },
      ),
    );
    const compiler = vi.fn(() => createPlan('unexpected'));

    await expect(
      renewActiveStrategicPlansForMajorContextShifts({
        projection: crisisProjection,
        policies,
        ...repositories,
        strategicPlanCompiler: compiler,
        issuedAt: 200,
      }),
    ).resolves.toEqual([]);
    expect(compiler).not.toHaveBeenCalled();
    await expect(
      repositories.planProgressRepository.get({ planId: objective.id, agentId }),
    ).resolves.toMatchObject({
      completedSubtaskIds: ['initial-action', 'initial-followup'],
      updatedAt: 150,
    });
  });

  test('supersedes an autonomous objective when recruitment changes the occupation', async () => {
    const repositories = createRepositories();
    const policies = createAivilizationWorldCommandPoliciesSnapshot([0], 'renewal-test');
    const objective = createObjective();
    const profile = await repositories.longTermProfileRepository.getOrCreate(agentId);
    const strategicContext = createStrategicPlanContextSnapshot({
      worldDecisionContext: createWorldDecisionContextFromProjection({
        projection: createProjection({ health: 100 }),
        agentId,
        policies,
      }),
      longTermProfile: profile,
      capturedAt: 100,
    });
    await repositories.intentionRepository.setObjective(agentId, objective);
    await repositories.planRepository.save({
      planId: objective.id,
      agentId,
      plan: createPlan('pre-recruitment-production'),
      strategicContext,
      createdAt: 100,
      updatedAt: 100,
    });
    const hiredProjection = createWorldProjection({
      agents: [{ ...createAgent(100), job: 'Cleaner', balance: 0 }],
    });

    await expect(
      supersedeActiveAutonomousObjectivesForMajorContextShifts({
        projection: hiredProjection,
        policies,
        intentionRepository: repositories.intentionRepository,
        longTermProfileRepository: repositories.longTermProfileRepository,
        planRepository: repositories.planRepository,
        issuedAt: 200,
      }),
    ).resolves.toEqual([
      {
        status: 'superseded',
        agentId,
        objectiveId: objective.id,
        reasons: ['occupation-changed'],
      },
    ]);
    const intentionState = await repositories.intentionRepository.getOrCreate(agentId);
    expect(intentionState.activeObjective).toBeUndefined();
    expect(intentionState).toMatchObject({
      completedObjectives: [
        {
          objective,
          completedAt: 200,
          reason: 'superseded-by-major-context-shift',
          planId: objective.id,
        },
      ],
    });
  });
});

function createRepositories() {
  return {
    intentionRepository: new InMemoryAgentIntentionRepository(),
    longTermProfileRepository: new InMemoryLongTermProfileRepository(),
    shortTermMemoryRepository: new InMemoryShortTermMemoryRepository(),
    planRepository: new InMemoryBranchPlanRepository(),
    planProgressRepository: new InMemoryBranchPlanProgressRepository(),
  };
}

function createSnapshot(
  partial: Partial<StrategicPlanContextSnapshot> = {},
): StrategicPlanContextSnapshot {
  return {
    policyVersion: STRATEGIC_PLAN_RENEWAL_POLICY_VERSION,
    capturedAt: 100,
    physiologyRegimes: ['stable'],
    job: null,
    residentialTier: 1,
    eligibleOccupationNames: ['Cleaner'],
    educationInvestmentRegime: 'affordable',
    strategicProfileEntryVersions: [],
    overallPriceIndex: 1,
    ...partial,
  };
}

function createProjection(input: { readonly health: number }) {
  return createWorldProjection({
    agents: [createAgent(input.health)],
  });
}

function createAgent(health: number): WorldAgentState {
  return {
    agentId,
    locationId: null,
    physiology: { energy: 100, satiety: 100, health },
    educationScore: 0,
    balance: 100,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}

function createObjective(): LongHorizonObjective {
  return {
    id: 'strategic-objective',
    agentId,
    statement: 'Build a sustainable livelihood.',
    priority: 2,
    source: 'agent',
    affinityTags: ['work', 'health'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createPlan(name: string) {
  return createBranchPlan({
    objective: 'Build a sustainable livelihood.',
    branches: [
      {
        id: `${name}-branch`,
        objective: `${name} objective`,
        subtasks: [
          {
            id: `${name}-action`,
            description: `${name} action`,
            basePriority: 10,
          },
          {
            id: `${name}-followup`,
            description: `${name} followup`,
            basePriority: 5,
          },
        ],
      },
    ],
  });
}
