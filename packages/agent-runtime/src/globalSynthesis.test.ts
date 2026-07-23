import { asAgentId, type CoreCommandType } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createBranchPlan,
  createDeterministicGlobalSynthesisPolicyManifest,
  createDeterministicGlobalSynthesisResult,
  DETERMINISTIC_GLOBAL_SYNTHESIS_POLICY_VERSION,
  synthesizeActionCandidates,
  type AtomicActionProposal,
  type GlobalSynthesizerInput,
  type WorldDecisionContext,
} from './index';

const agentId = asAgentId('agent-global-synthesis');

describe('deterministic global synthesis', () => {
  test('reconciles strategic alignment and contextual urgency independently of input order', () => {
    const production = createAction({
      id: 'produce-chip',
      commandType: 'AgentProduce',
      branchId: 'production',
      subtaskId: 'produce',
      priority: 10,
      subtaskScore: 10,
      energyCost: 10,
    });
    const study = createAction({
      id: 'study-first',
      commandType: 'AgentStudy',
      branchId: 'development',
      subtaskId: 'study',
      priority: 1,
      subtaskScore: 30,
      currencyCost: 10,
    });

    const result = createDeterministicGlobalSynthesisResult(
      createInput([production, study], createWorldContext()),
    );

    expect(result.actions.map((action) => action.id)).toEqual(['study-first', 'produce-chip']);
    expect(result.trace).toMatchObject({
      status: 'deterministic',
      source: 'deterministic',
      message: DETERMINISTIC_GLOBAL_SYNTHESIS_POLICY_VERSION,
      choices: [
        {
          actionId: 'study-first',
          strategicAlignment: 0,
          branchUrgency: 1,
        },
        {
          actionId: 'produce-chip',
          strategicAlignment: 1,
          branchUrgency: 0,
        },
      ],
    });
  });

  test('gives physiological crises enough branch urgency to protect well-being', () => {
    const production = createAction({
      id: 'produce-chip',
      commandType: 'AgentProduce',
      branchId: 'production',
      subtaskId: 'produce',
      priority: 100,
      subtaskScore: 100,
      energyCost: 10,
    });
    const healthcare = createAction({
      id: 'see-doctor',
      commandType: 'AgentSeeDoctor',
      branchId: 'health',
      subtaskId: 'heal',
      priority: 1,
      subtaskScore: 1,
      currencyCost: 5,
    });

    const result = createDeterministicGlobalSynthesisResult(
      createInput(
        [production, healthcare],
        createWorldContext({ health: 10 }),
      ),
    );

    expect(result.actions.map((action) => action.id)).toEqual(['see-doctor', 'produce-chip']);
    expect(result.trace.choices?.[0]).toMatchObject({
      actionId: 'see-doctor',
      branchUrgency: 1.5,
    });
  });

  test('ranks individually infeasible actions below feasible cross-branch alternatives', () => {
    const unaffordableStudy = createAction({
      id: 'study-unaffordable',
      commandType: 'AgentStudy',
      branchId: 'development',
      subtaskId: 'study',
      priority: 100,
      subtaskScore: 100,
      currencyCost: 200,
    });
    const work = createAction({
      id: 'work-now',
      commandType: 'AgentWork',
      branchId: 'labor',
      subtaskId: 'work',
      priority: 1,
      subtaskScore: 1,
      energyCost: 10,
    });

    const result = createDeterministicGlobalSynthesisResult(
      createInput([unaffordableStudy, work], createWorldContext()),
    );

    expect(result.actions.map((action) => action.id)).toEqual(['work-now', 'study-unaffordable']);
    expect(result.trace.choices?.[1]).toMatchObject({
      actionId: 'study-unaffordable',
      priorityScore: -1,
    });
    expect(result.trace.choices?.[1]?.rationale).toContain('feasible=false');
  });

  test('publishes the versioned repository decision and deterministic tie breaks', () => {
    const right = createAction({
      id: 'z-action',
      commandType: 'AgentWork',
      branchId: 'labor',
      subtaskId: 'work',
    });
    const left = createAction({
      id: 'a-action',
      commandType: 'AgentWork',
      branchId: 'labor',
      subtaskId: 'work',
    });

    const result = createDeterministicGlobalSynthesisResult(
      createInput([right, left], createWorldContext()),
    );

    expect(result.actions.map((action) => action.id)).toEqual(['a-action', 'z-action']);
    expect(createDeterministicGlobalSynthesisPolicyManifest()).toMatchObject({
      policyVersion: DETERMINISTIC_GLOBAL_SYNTHESIS_POLICY_VERSION,
      tieBreak: 'action-id-ascending',
      resourceRule: 'individually-infeasible-actions-rank-below-feasible-actions',
    });
  });
});

function createInput(
  candidateActions: readonly AtomicActionProposal[],
  worldDecisionContext: WorldDecisionContext,
): GlobalSynthesizerInput {
  const actionSynthesisPolicy = {
    maxActions: 1,
    candidateSubtasks: { maxSubtasks: 9 },
    budget: {
      availableActionSeconds: 3_600,
      energyBudget: 100,
      satietyBudget: 100,
      currencyBudget: 100,
      inventoryBudget: {},
    },
  };
  return {
    agentId,
    issuedAt: 100,
    plan: createPlan(),
    signals: [],
    candidateActions,
    deterministicSynthesisResult: synthesizeActionCandidates({
      actions: candidateActions,
      policy: actionSynthesisPolicy,
    }),
    actionSynthesisPolicy,
    worldDecisionContext,
  };
}

function createPlan() {
  return createBranchPlan({
    objective: 'Build a sustainable high-technology livelihood.',
    branches: [
      {
        id: 'production',
        objective: 'Produce advanced goods.',
        subtasks: [{ id: 'produce', description: 'Produce Chip.', basePriority: 20 }],
      },
      {
        id: 'development',
        objective: 'Invest in education.',
        subtasks: [{ id: 'study', description: 'Study first.', basePriority: 10 }],
      },
      {
        id: 'health',
        objective: 'Preserve health.',
        subtasks: [{ id: 'heal', description: 'See a doctor.', basePriority: 5 }],
      },
      {
        id: 'labor',
        objective: 'Earn income.',
        subtasks: [{ id: 'work', description: 'Work now.', basePriority: 5 }],
      },
    ],
  });
}

function createAction(input: {
  readonly id: string;
  readonly commandType: CoreCommandType;
  readonly branchId: string;
  readonly subtaskId: string;
  readonly priority?: number;
  readonly subtaskScore?: number;
  readonly energyCost?: number;
  readonly currencyCost?: number;
}): AtomicActionProposal {
  return {
    id: input.id,
    description: input.id,
    commandType: input.commandType,
    payload: {},
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    resourceEstimate: {
      actionSeconds: 60,
      ...(input.energyCost === undefined ? {} : { energyCost: input.energyCost }),
      ...(input.currencyCost === undefined ? {} : { currencyCost: input.currencyCost }),
    },
    synthesisContext: {
      branchId: input.branchId,
      subtaskId: input.subtaskId,
      ...(input.subtaskScore === undefined ? {} : { subtaskScore: input.subtaskScore }),
    },
  };
}

function createWorldContext(
  physiology: Partial<WorldDecisionContext['agent']['physiology']> = {},
): WorldDecisionContext {
  return {
    agent: {
      agentId,
      locationId: 'town-square',
      physiology: {
        energy: physiology.energy ?? 100,
        satiety: physiology.satiety ?? 100,
        health: physiology.health ?? 100,
      },
      educationScore: 0,
      balance: 100,
      residentialTier: 1,
      job: null,
      inventory: {},
    },
    market: { spotPrices: [] },
  };
}
