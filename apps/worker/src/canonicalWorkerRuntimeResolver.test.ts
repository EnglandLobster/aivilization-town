import {
  createBranchPlan,
  InMemoryBranchPlanRepository,
  type AtomicActionProposal,
  type CycleRepairPolicy,
  type DomainMicroPlanner,
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
      selectedSubtask: {
        branchId: 'study-lane',
        subtaskId: 'planned-step',
        description: 'Attend planned activity.',
        score: 10,
      },
    })[0];
    if (agents[0] === undefined || proposal === undefined) {
      throw new Error('expected canonical tick agent proposal');
    }
    expect(agents[0].simulate({ action: proposal, selectedSubtask: selectedSubtask() })).toEqual({
      status: 'accepted',
      action: proposal,
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
    });
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

function selectedSubtask() {
  return {
    branchId: 'study-lane',
    subtaskId: 'planned-step',
    description: 'Attend planned activity.',
    score: 10,
  };
}
