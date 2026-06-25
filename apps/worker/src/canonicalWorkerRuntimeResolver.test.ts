import {
  createBranchPlan,
  InMemoryBranchPlanRepository,
  type AtomicActionProposal,
  type ActionSequenceGenerator,
  type CycleRepairPolicy,
  type DomainMicroPlanner,
  type GlobalActionSynthesizer,
  type ReactiveCorrector,
  type ReplanningDecider,
  type SocialDialogueGenerator,
  type SubtaskPrioritizer,
} from '@aivilization/agent-runtime';
import { InMemoryAgentIntentionRepository, type LongHorizonObjective } from '@aivilization/memory';
import { asAgentId, asSimulationId, type AgentId } from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldAgentState,
  type WorldCommandPolicies,
  type WorldProjection,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  buildWorkerTickAgentsFromActivePlans,
  createCanonicalWorkerRuntimeResolver,
  createWorldCommandDryRunSimulator,
} from './index';

const simulationId = asSimulationId('sim-canonical-runtime');
const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Apple: 10 },
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
  sleep: { energyRecoveryPerSecond: 1, maxEnergy: 100 },
  jobApplication: {
    populationEducationScores: [0],
    quotaByResidentialTier: [1, 1, 1, 1, 1],
  },
};

describe('canonical worker runtime resolver', () => {
  test('builds tick agents from active plans with canonical planners and repair', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createProjection();
    const repair: CycleRepairPolicy = () => undefined;
    await intentionRepository.setObjective(agentA, createObjective({ agentId: agentA }));
    await planRepository.save(createPlanRecord({ agentId: agentA, domain: 'study' }));

    const agents = await buildWorkerTickAgentsFromActivePlans({
      projection,
      intentionRepository,
      planRepository,
      resolveRuntime: createCanonicalWorkerRuntimeResolver({
        simulationId,
        policies,
        repair,
      }),
    });

    expect(agents).toHaveLength(1);
    expect(agents[0]?.microPlanners.map((planner) => planner.domain)).toEqual(['study']);
    expect(agents[0]?.repair).toBe(repair);
    expect(agents[0]?.actionSynthesis).toMatchObject({
      budget: {
        energyBudget: 50,
        satietyBudget: 50,
        currencyBudget: 1000,
        inventoryBudget: {},
      },
    });
    const proposal = agents[0]?.microPlanners[0]?.propose({
      agentId: agentA,
      issuedAt: 0,
      plan: createPlanRecord({ agentId: agentA, domain: 'study' }).plan,
      selectedSubtask: {
        branchId: 'study-lane',
        subtaskId: 'planned-step',
        description: 'Attend planned activity.',
        score: 10,
      },
      signals: [],
    })[0];
    if (agents[0] === undefined || proposal === undefined) {
      throw new Error('expected canonical tick agent proposal');
    }
    expect(agents[0].simulate({ action: proposal, selectedSubtask: selectedSubtask() })).toEqual({
      status: 'accepted',
      action: proposal,
      traceEvents: [
        { type: 'EducationChanged', sequence: 1, summary: 'study' },
        { type: 'ShortTermMemoryRecorded', sequence: 2, summary: 'Studied for 1800 seconds.' },
      ],
    });
  });

  test('world dry-run simulator rejects actions with authoritative world reasons', () => {
    const projection = createProjection();
    const action: AtomicActionProposal = {
      id: 'buy-ghost',
      description: 'buy unavailable commodity',
      commandType: 'AgentTrade',
      payload: { side: 'buy', commodityName: 'Ghost', quantity: 1 },
    };
    const simulate = createWorldCommandDryRunSimulator({
      simulationId,
      agentId: agentA,
      projection,
      policies,
      issuedAt: 500,
      nextSequence: 10,
      commandIdPrefix: 'test-dry-run',
    });

    expect(simulate({ action, selectedSubtask: selectedSubtask() })).toEqual({
      status: 'rejected',
      action,
      reason: 'missing AMM pool for Ghost',
      traceEvents: [
        { type: 'ActionRejected', sequence: 10, summary: 'missing AMM pool for Ghost' },
        {
          type: 'ShortTermMemoryRecorded',
          sequence: 11,
          summary: 'AgentTrade failed: missing AMM pool for Ghost',
        },
      ],
    });
  });

  test('world dry-run simulator resolves policy sources against the configured projection', () => {
    const projection = createProjection();
    const resolvedAgentCounts: number[] = [];
    const simulate = createWorldCommandDryRunSimulator({
      simulationId,
      agentId: agentA,
      projection,
      policies: (currentProjection) => {
        resolvedAgentCounts.push(Object.keys(currentProjection.agents).length);
        return policies;
      },
      issuedAt: 500,
      nextSequence: 10,
      commandIdPrefix: 'test-dry-run',
    });
    const action: AtomicActionProposal = {
      id: 'sleep',
      description: 'sleep briefly',
      commandType: 'AgentSleep',
      payload: { durationSeconds: 10 },
    };

    expect(simulate({ action, selectedSubtask: selectedSubtask() })).toEqual({
      status: 'accepted',
      action,
      traceEvents: [
        { type: 'PhysiologyChanged', sequence: 10, summary: 'sleep' },
        { type: 'ShortTermMemoryRecorded', sequence: 11, summary: 'Slept for 10 seconds.' },
      ],
    });
    expect(resolvedAgentCounts).toEqual([2]);
  });

  test('world dry-run simulator rolls accepted events into later counterfactual actions', () => {
    const firstEat: AtomicActionProposal = {
      id: 'eat-apple-1',
      description: 'eat the only Apple',
      commandType: 'AgentEat',
      payload: { commodityName: 'Apple', quantity: 1 },
    };
    const secondEat: AtomicActionProposal = {
      id: 'eat-apple-2',
      description: 'eat the Apple again',
      commandType: 'AgentEat',
      payload: { commodityName: 'Apple', quantity: 1 },
    };
    const projection = createWorldProjection({
      agents: [
        {
          ...createAgent(agentA),
          inventory: { Apple: 1 },
        },
        createAgent(agentB),
      ],
      marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
    });
    const simulate = createWorldCommandDryRunSimulator({
      simulationId,
      agentId: agentA,
      projection,
      policies,
      issuedAt: 500,
      nextSequence: 10,
      commandIdPrefix: 'test-dry-run',
    });

    expect(simulate({ action: firstEat, selectedSubtask: selectedSubtask() })).toEqual({
      status: 'accepted',
      action: firstEat,
      traceEvents: [
        { type: 'InventoryChanged', sequence: 10, summary: 'eat Apple -1' },
        { type: 'PhysiologyChanged', sequence: 11, summary: 'eat' },
        { type: 'ShortTermMemoryRecorded', sequence: 12, summary: 'Ate 1 Apple.' },
      ],
    });
    expect(simulate({ action: secondEat, selectedSubtask: selectedSubtask() })).toEqual({
      status: 'rejected',
      action: secondEat,
      reason: 'insufficient Apple: required 1, available 0',
      traceEvents: [
        {
          type: 'ActionRejected',
          sequence: 10,
          summary: 'insufficient Apple: required 1, available 0',
        },
        {
          type: 'ShortTermMemoryRecorded',
          sequence: 11,
          summary: 'AgentEat failed: insufficient Apple: required 1, available 0',
        },
      ],
    });
    expect(projection.agents[agentA]?.inventory).toEqual({ Apple: 1 });
  });

  test('returns undefined when no canonical or additional registration matches', async () => {
    const projection = createProjection();
    const resolver = createCanonicalWorkerRuntimeResolver({ simulationId, policies });
    const binding = await resolver({
      agentId: agentA,
      agent: requireAgent(projection, agentA),
      projection,
      activeObjective: createObjective({ agentId: agentA }),
      planRecord: createPlanRecord({ agentId: agentA, domain: 'explore' }),
    });

    expect(binding).toBeUndefined();
  });

  test('attaches configured adaptive replanning policy to canonical runtime bindings', async () => {
    const projection = createProjection();
    const replanningPolicy = {
      consecutiveFailureThreshold: 2,
      majorContextShift: {
        key: 'profile-recovery-drill',
        reason: 'profile recovery drill requires a fresh plan',
      },
    } as const;
    const resolver = createCanonicalWorkerRuntimeResolver({
      simulationId,
      policies,
      replanningPolicy,
    });

    const binding = await resolver({
      agentId: agentA,
      agent: requireAgent(projection, agentA),
      projection,
      activeObjective: createObjective({ agentId: agentA }),
      planRecord: createPlanRecord({ agentId: agentA, domain: 'study' }),
    });

    expect(binding?.replanningPolicy).toEqual(replanningPolicy);
  });

  test('attaches configured agent-cycle LLM stage hooks to canonical runtime bindings', async () => {
    const projection = createProjection();
    const subtaskPrioritizer: SubtaskPrioritizer = ({ candidates }) => ({
      candidates,
      trace: { status: 'deterministic', source: 'deterministic' },
    });
    const actionSequenceGenerator: ActionSequenceGenerator = (input) =>
      Promise.resolve({
        actions: input.deterministicActions,
        trace: {
          status: 'deterministic',
          source: 'deterministic',
          selectedSubtask: {
            branchId: input.selectedSubtask.branchId,
            subtaskId: input.selectedSubtask.subtaskId,
          },
        },
      });
    const globalSynthesizer: GlobalActionSynthesizer = (input) =>
      Promise.resolve({
        actions: input.candidateActions,
        trace: { status: 'deterministic', source: 'deterministic' },
      });
    const reactiveCorrector: ReactiveCorrector = () =>
      Promise.resolve({
        action: undefined,
        trace: {
          status: 'accepted',
          source: 'llm',
          decision: {
            kind: 'no-correction',
            rationale: 'test corrector',
            evidenceRecordIds: [],
          },
        },
      });
    const replanningDecider: ReplanningDecider = (input) => ({
      decision: { kind: 'none' },
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: `test-replanning:${input.agentId}:${input.selectedSubtask.subtaskId}:${input.issuedAt}`,
        decision: { kind: 'none' },
      },
    });
    const socialDialogueGenerator: SocialDialogueGenerator = async (input) => {
      await Promise.resolve();
      return {
        payload: input.deterministicPayload,
        trace: {
          status: 'deterministic',
          source: 'deterministic',
          selectedSubtask: {
            branchId: input.selectedSubtask.branchId,
            subtaskId: input.selectedSubtask.subtaskId,
          },
          actionId: input.action.id,
          targetAgentId: input.deterministicPayload.targetAgentId,
          turnCount: input.deterministicPayload.turns.length,
          rationale: 'test social dialogue generator',
        },
      };
    };
    const resolver = createCanonicalWorkerRuntimeResolver({
      simulationId,
      policies,
      subtaskPrioritizer,
      actionSequenceGenerator,
      socialDialogueGenerator,
      globalSynthesizer,
      reactiveCorrector,
      replanningDecider,
    });

    const binding = await resolver({
      agentId: agentA,
      agent: requireAgent(projection, agentA),
      projection,
      activeObjective: createObjective({ agentId: agentA }),
      planRecord: createPlanRecord({ agentId: agentA, domain: 'study' }),
    });

    expect(binding?.subtaskPrioritizer).toBe(subtaskPrioritizer);
    expect(binding?.actionSequenceGenerator).toBe(actionSequenceGenerator);
    expect(binding?.socialDialogueGenerator).toBe(socialDialogueGenerator);
    expect(binding?.globalSynthesizer).toBe(globalSynthesizer);
    expect(binding?.reactiveCorrector).toBe(reactiveCorrector);
    expect(binding?.replanningDecider).toBe(replanningDecider);
  });

  test('appends matching additional domain registrations after canonical registrations', async () => {
    const projection = createProjection();
    const customPlanner: DomainMicroPlanner = {
      domain: 'custom',
      supports: () => true,
      propose: () => [
        {
          id: 'custom-action',
          description: 'custom action',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 1, educationRatePerSecond: 1 },
        },
      ],
    };
    const resolver = createCanonicalWorkerRuntimeResolver({
      simulationId,
      policies,
      additionalRegistrations: [{ domain: 'custom', microPlanners: [customPlanner] }],
    });

    const binding = await resolver({
      agentId: agentA,
      agent: requireAgent(projection, agentA),
      projection,
      activeObjective: createObjective({ agentId: agentA }),
      planRecord: createMultiDomainPlanRecord({ agentId: agentA }),
    });

    expect(binding?.microPlanners.map((planner) => planner.domain)).toEqual(['study', 'custom']);
  });

  test('keeps residential subtasks in progress until the inferred target tier is reached', async () => {
    const projection = createProjection();
    const resolver = createCanonicalWorkerRuntimeResolver({ simulationId, policies });
    const binding = await resolver({
      agentId: agentA,
      agent: requireAgent(projection, agentA),
      projection,
      activeObjective: createComplexTownObjective({ agentId: agentA }),
      planRecord: createComplexTownPlanRecord({ agentId: agentA }),
    });

    expect(
      binding?.subtaskCompletion?.({
        selectedSubtask: {
          branchId: 'residential-readiness',
          subtaskId: 'upgrade-residential-tier',
          description: 'Upgrade residential tier toward Chip production.',
          score: 10,
        },
        simulationResults: [
          {
            status: 'accepted',
            action: {
              id: 'upgrade-tier-2',
              description: 'Upgrade residential tier to 2.',
              commandType: 'AgentUpgradeResidentialTier',
              payload: { targetResidentialTier: 2 },
            },
          },
        ],
      }),
    ).toEqual({
      status: 'in-progress',
      reason: 'upgraded residential tier to 2 toward required tier 5',
    });
  });

  test('keeps observation-only subtasks in progress', async () => {
    const projection = createProjection();
    const resolver = createCanonicalWorkerRuntimeResolver({ simulationId, policies });
    const binding = await resolver({
      agentId: agentA,
      agent: requireAgent(projection, agentA),
      projection,
      activeObjective: createObjective({ agentId: agentA }),
      planRecord: createPlanRecord({ agentId: agentA, domain: 'social' }),
    });

    expect(
      binding?.subtaskCompletion?.({
        selectedSubtask: {
          branchId: 'social-lane',
          subtaskId: 'planned-step',
          description: 'Find someone nearby to talk with.',
          score: 10,
        },
        simulationResults: [
          {
            status: 'accepted',
            action: {
              id: 'observe-nearby-agents',
              description: 'Observe nearby agents before conversation.',
              commandType: 'AgentObserveLocation',
              payload: { focus: 'Find someone nearby to talk with.' },
            },
          },
        ],
      }),
    ).toEqual({
      status: 'in-progress',
      reason: 'observed current location before executing subtask',
    });
  });
});

function createProjection(): WorldProjection {
  return createWorldProjection({
    agents: [createAgent(agentA), createAgent(agentB)],
    marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
  });
}

function createAgent(agentId: AgentId): WorldAgentState {
  return {
    agentId,
    locationId: null,
    physiology: { energy: 50, satiety: 50, health: 100 },
    educationScore: 0,
    balance: 1000,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}

function requireAgent(projection: WorldProjection, agentId: AgentId): WorldAgentState {
  const agent = projection.agents[agentId];
  if (agent === undefined) {
    throw new Error(`missing agent ${agentId}`);
  }
  return agent;
}

function createObjective(input: { readonly agentId: AgentId }): LongHorizonObjective {
  return {
    id: 'objective-canonical-runtime',
    agentId: input.agentId,
    statement: 'Run a planned day.',
    priority: 3,
    source: 'human',
    affinityTags: ['study'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createComplexTownObjective(input: { readonly agentId: AgentId }): LongHorizonObjective {
  return {
    id: 'objective-complex-town',
    agentId: input.agentId,
    statement:
      'Upgrade residential tier, apply for Stock Clerk work, then craft Chip for the electronics market.',
    priority: 3,
    source: 'human',
    affinityTags: ['residential', 'work', 'production'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createPlanRecord(input: { readonly agentId: AgentId; readonly domain: string }) {
  return {
    planId: 'objective-canonical-runtime',
    agentId: input.agentId,
    plan: createBranchPlan({
      objective: 'Run a planned day.',
      branches: [
        {
          id: `${input.domain}-lane`,
          objective: 'Handle planned activity.',
          subtasks: [
            {
              id: 'planned-step',
              description: 'Attend planned activity.',
              basePriority: 5,
              intentionAffinityTags: [input.domain],
            },
          ],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function createMultiDomainPlanRecord(input: { readonly agentId: AgentId }) {
  return {
    planId: 'objective-canonical-runtime',
    agentId: input.agentId,
    plan: createBranchPlan({
      objective: 'Run a planned day.',
      branches: [
        {
          id: 'study-lane',
          objective: 'Handle planned activity.',
          subtasks: [
            {
              id: 'planned-step',
              description: 'Attend planned activity.',
              basePriority: 5,
              intentionAffinityTags: ['study', 'custom'],
            },
          ],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function createComplexTownPlanRecord(input: { readonly agentId: AgentId }) {
  return {
    planId: 'objective-complex-town',
    agentId: input.agentId,
    plan: createBranchPlan({
      objective:
        'Upgrade residential tier, apply for Stock Clerk work, then craft Chip for the electronics market.',
      branches: [
        {
          id: 'residential-readiness',
          objective: 'Prepare residential capacity for Chip production.',
          subtasks: [
            {
              id: 'upgrade-residential-tier',
              description: 'Upgrade residential tier toward Chip production.',
              basePriority: 5,
              intentionAffinityTags: ['residential'],
            },
          ],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function selectedSubtask() {
  return {
    branchId: 'study-lane',
    subtaskId: 'planned-step',
    description: 'Attend planned activity.',
    score: 10,
  };
}
