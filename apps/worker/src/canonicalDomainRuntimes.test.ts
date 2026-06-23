import {
  createBranchPlan,
  type BranchPlanRecord,
  type DomainMicroPlanner,
  type PrioritizedSubtask,
} from '@aivilization/agent-runtime';
import type { LongHorizonObjective } from '@aivilization/memory';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldAgentState,
  type WorldCommandPolicies,
  type WorldProjection,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createCanonicalDomainRuntimeRegistrations,
  createDomainRuntimeResolver,
  resolveProductionTargetCommodityName,
} from './index';

const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');
const agentC = asAgentId('agent-c');

const domainOrder = [
  'study',
  'work',
  'trade',
  'sleep',
  'social',
  'production',
  'residential',
] as const;
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
  residentialTierUpgrade: {
    maxResidentialTier: 4,
    costs: [{ targetResidentialTier: 2, currencyCost: 100, inventoryCosts: { Wood: 1 } }],
  },
};

describe('canonical domain runtimes', () => {
  test('registers all canonical domains in deterministic order', () => {
    const registrations = createCanonicalDomainRuntimeRegistrations();

    expect(registrations.map((registration) => registration.domain)).toEqual(domainOrder);
  });

  test('resolves canonical contextual planners that support affinity-tag-only subtasks', async () => {
    const context = createRuntimeContext({ agent: createAgent({ agentId: agentA }) });
    const binding = await resolveCanonicalBinding(context);

    expect(binding.microPlanners.map((planner) => planner.domain)).toEqual(domainOrder);
    for (const domain of domainOrder) {
      expect(requirePlanner(binding.microPlanners, domain).supports(selectedSubtask(domain))).toBe(
        true,
      );
    }
    expect(requirePlanner(binding.microPlanners, 'study').supports(selectedSubtask('work'))).toBe(
      false,
    );
  });

  test('proposes configured study, sleep, work, trade, social, and production world commands', async () => {
    const context = createRuntimeContext({
      agent: createAgent({ agentId: agentA, job: 'Waiter' }),
    });
    const binding = await resolveCanonicalBinding(context, {
      study: { durationSeconds: 900, educationRatePerSecond: 2 },
      sleep: { durationSeconds: 7200 },
      work: { laborSeconds: 1200, defaultOccupationName: 'Cleaner' },
      trade: { side: 'sell', commodityName: 'Book', quantity: 2 },
      social: {
        targetAgentId: agentC,
        summary: 'Discuss town plans.',
        relationDelta: 3,
        attitudeDelta: 4,
      },
      production: { commodityName: 'Book', quantity: 1, availableLaborSeconds: 10 },
      residential: { targetResidentialTier: 2 },
    });

    expect(firstProposal(binding.microPlanners, 'study')).toMatchObject({
      id: 'canonical-study-step-a',
      commandType: 'AgentStudy',
      payload: { durationSeconds: 900, educationRatePerSecond: 2 },
      priority: 10,
      resourceEstimate: { actionSeconds: 900 },
    });
    expect(firstProposal(binding.microPlanners, 'sleep')).toMatchObject({
      id: 'canonical-sleep-step-d',
      commandType: 'AgentSleep',
      payload: { durationSeconds: 7200 },
      priority: 10,
      resourceEstimate: { actionSeconds: 7200 },
    });
    expect(firstProposal(binding.microPlanners, 'work')).toMatchObject({
      id: 'canonical-work-step-b',
      commandType: 'AgentWork',
      payload: { occupationName: 'Waiter', laborSeconds: 1200 },
      priority: 10,
      resourceEstimate: {
        actionSeconds: 1200,
        energyCost: 3.333333333333333,
        satietyCost: 3.333333333333333,
      },
    });
    expect(firstProposal(binding.microPlanners, 'trade')).toMatchObject({
      id: 'canonical-trade-step-c',
      commandType: 'AgentTrade',
      payload: { side: 'sell', commodityName: 'Book', quantity: 2 },
      priority: 10,
      resourceEstimate: { inventoryCosts: { Book: 2 } },
    });
    expect(firstProposal(binding.microPlanners, 'social')).toMatchObject({
      id: 'canonical-social-step-e',
      commandType: 'AgentSocialize',
      payload: {
        targetAgentId: agentC,
        summary: 'Discuss town plans.',
        relationDelta: 3,
        attitudeDelta: 4,
      },
      priority: 10,
    });
    expect(firstProposal(binding.microPlanners, 'production')).toMatchObject({
      id: 'canonical-production-step-f',
      commandType: 'AgentProduce',
      payload: { commodityName: 'Book', quantity: 1, availableLaborSeconds: 10 },
      priority: 10,
      resourceEstimate: {
        actionSeconds: 1.6,
        energyCost: 32,
        satietyCost: 8,
        inventoryCosts: { Wood: 1 },
      },
    });
    expect(firstProposal(binding.microPlanners, 'residential')).toMatchObject({
      id: 'canonical-residential-step-g',
      commandType: 'AgentUpgradeResidentialTier',
      payload: { targetResidentialTier: 2 },
      priority: 10,
      resourceEstimate: {
        currencyCost: 100,
        inventoryCosts: { Wood: 1 },
      },
    });
  });

  test('estimates trade buy currency cost from the projected AMM pool', async () => {
    const context = createRuntimeContext({
      agent: createAgent({ agentId: agentA, job: 'Waiter' }),
    });
    const binding = await resolveCanonicalBinding(context, {
      trade: { side: 'buy', commodityName: 'Apple', quantity: 1 },
    });
    const proposal = firstProposal(binding.microPlanners, 'trade');
    if (proposal === undefined) {
      throw new Error('expected trade proposal');
    }

    expect(proposal.resourceEstimate?.currencyCost).toBeCloseTo(10.101010101);
  });

  test('uses context-derived defaults for work, trade, and social proposals', async () => {
    const context = createRuntimeContext({
      agent: createAgent({ agentId: agentA, job: null }),
      projection: createProjection({
        agents: [
          createAgent({ agentId: agentA, job: null }),
          createAgent({ agentId: agentC }),
          createAgent({ agentId: agentB }),
        ],
        marketPools: [
          { commodity: 'Wood', commodityReserve: 100, currencyReserve: 1000 },
          { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 },
        ],
      }),
    });
    const binding = await resolveCanonicalBinding(context);

    expect(firstProposal(binding.microPlanners, 'work')).toMatchObject({
      commandType: 'AgentApplyJob',
      payload: { occupationName: 'Cleaner' },
    });
    expect(firstProposal(binding.microPlanners, 'trade')).toMatchObject({
      commandType: 'AgentTrade',
      payload: { side: 'buy', commodityName: 'Apple', quantity: 1 },
    });
    expect(firstProposal(binding.microPlanners, 'social')).toMatchObject({
      commandType: 'AgentSocialize',
      payload: {
        targetAgentId: agentB,
        summary: 'Socialized during planned activity.',
        relationDelta: 1,
        attitudeDelta: 1,
      },
    });
    expect(firstProposal(binding.microPlanners, 'production')).toMatchObject({
      commandType: 'AgentProduce',
      payload: { commodityName: 'Apple', quantity: 1, availableLaborSeconds: 3600 },
    });
    expect(firstProposal(binding.microPlanners, 'residential')).toMatchObject({
      commandType: 'AgentUpgradeResidentialTier',
      payload: { targetResidentialTier: 2 },
      resourceEstimate: {
        currencyCost: 100,
        inventoryCosts: { Wood: 1 },
      },
    });
  });

  test('infers production target from durable plan text when config omits commodity', async () => {
    const context = createRuntimeContext({
      agent: createAgent({ agentId: agentA, inventory: { Wood: 1 } }),
      activeObjective: createBookProductionObjective(agentA),
      planRecord: createBookProductionPlanRecord(agentA),
    });
    const binding = await resolveCanonicalBinding(context);

    expect(firstProposal(binding.microPlanners, 'production')).toMatchObject({
      commandType: 'AgentProduce',
      payload: { commodityName: 'Book', quantity: 1, availableLaborSeconds: 3600 },
      resourceEstimate: {
        actionSeconds: 1.6,
        energyCost: 32,
        satietyCost: 8,
        inventoryCosts: { Wood: 1 },
      },
    });
  });

  test('prefers longest producible commodity phrase and simple plural mentions', () => {
    const context = createRuntimeContext({
      agent: createAgent({ agentId: agentA }),
    });

    expect(
      resolveProductionTargetCommodityName({
        context,
        selectedSubtask: {
          branchId: 'lane-f',
          subtaskId: 'step-f',
          description: 'Bake Apple Pies for the bakery.',
          score: 10,
        },
      }),
    ).toBe('Apple Pie');
    expect(
      resolveProductionTargetCommodityName({
        context,
        selectedSubtask: {
          branchId: 'lane-f',
          subtaskId: 'step-f',
          description: 'Craft chips efficiently.',
          score: 10,
        },
      }),
    ).toBe('Chip');
  });
});

async function resolveCanonicalBinding(
  context: WorkerResolverTestContext,
  config: Parameters<typeof createCanonicalDomainRuntimeRegistrations>[0] = {},
) {
  const resolver = createDomainRuntimeResolver({
    registrations: createCanonicalDomainRuntimeRegistrations(config, policies),
    simulate: ({ action }) => ({ status: 'accepted', action }),
  });
  const binding = await resolver(context);
  if (binding === undefined) {
    throw new Error('expected canonical binding');
  }
  return binding;
}

function requirePlanner(
  planners: readonly DomainMicroPlanner[],
  domain: (typeof domainOrder)[number],
): DomainMicroPlanner {
  const planner = planners.find((candidate) => candidate.domain === domain);
  if (planner === undefined) {
    throw new Error(`missing planner ${domain}`);
  }
  return planner;
}

function firstProposal(
  planners: readonly DomainMicroPlanner[],
  domain: (typeof domainOrder)[number],
) {
  return requirePlanner(planners, domain).propose({ selectedSubtask: selectedSubtask(domain) })[0];
}

type WorkerResolverTestContext = {
  readonly agentId: AgentId;
  readonly agent: WorldAgentState;
  readonly projection: WorldProjection;
  readonly activeObjective: LongHorizonObjective;
  readonly planRecord: BranchPlanRecord;
};

function createRuntimeContext(input: {
  readonly agent: WorldAgentState;
  readonly projection?: WorldProjection;
  readonly activeObjective?: LongHorizonObjective;
  readonly planRecord?: BranchPlanRecord;
}): WorkerResolverTestContext {
  const projection =
    input.projection ??
    createProjection({
      agents: [input.agent, createAgent({ agentId: agentB }), createAgent({ agentId: agentC })],
      marketPools: [
        { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 },
        { commodity: 'Book', commodityReserve: 100, currencyReserve: 1000 },
      ],
    });

  return {
    agentId: input.agent.agentId,
    agent: input.agent,
    projection,
    activeObjective: input.activeObjective ?? createObjective(input.agent.agentId),
    planRecord: input.planRecord ?? createPlanRecord(input.agent.agentId),
  };
}

function createProjection(input: {
  readonly agents: readonly WorldAgentState[];
  readonly marketPools: readonly {
    readonly commodity: string;
    readonly commodityReserve: number;
    readonly currencyReserve: number;
  }[];
}): WorldProjection {
  return createWorldProjection({
    agents: input.agents,
    marketPools: input.marketPools,
  });
}

function createAgent(input: {
  readonly agentId: AgentId;
  readonly job?: string | null;
  readonly inventory?: WorldAgentState['inventory'];
}): WorldAgentState {
  return {
    agentId: input.agentId,
    physiology: { energy: 50, satiety: 50, health: 100 },
    educationScore: 0,
    balance: 1000,
    residentialTier: 1,
    job: input.job ?? null,
    inventory: input.inventory ?? { Book: 3, Wood: 1 },
  };
}

function createObjective(agentId: AgentId): LongHorizonObjective {
  return {
    id: 'objective-canonical-domains',
    agentId,
    statement: 'Run a balanced day.',
    priority: 3,
    source: 'human',
    affinityTags: ['daily-routine'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createPlanRecord(agentId: AgentId): BranchPlanRecord {
  return {
    planId: 'objective-canonical-domains',
    agentId,
    plan: createBranchPlan({
      objective: 'Run a balanced day.',
      branches: domainOrder.map((domain, index) => ({
        id: `lane-${String.fromCharCode(97 + index)}`,
        objective: 'Handle the planned activity.',
        subtasks: [
          {
            id: `step-${String.fromCharCode(97 + index)}`,
            description: 'Attend planned activity.',
            basePriority: 5,
            intentionAffinityTags: [domain],
          },
        ],
      })),
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function createBookProductionObjective(agentId: AgentId): LongHorizonObjective {
  return {
    id: 'objective-book-production',
    agentId,
    statement: 'Craft Book for the town library.',
    priority: 3,
    source: 'human',
    affinityTags: ['production'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createBookProductionPlanRecord(agentId: AgentId): BranchPlanRecord {
  return {
    planId: 'objective-book-production',
    agentId,
    plan: createBranchPlan({
      objective: 'Craft Book for the town library.',
      branches: [
        {
          id: 'lane-f',
          objective: 'Produce Book for the library shelves.',
          subtasks: [
            {
              id: 'step-f',
              description: 'Craft Book for the library.',
              basePriority: 5,
              intentionAffinityTags: ['production'],
            },
          ],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function selectedSubtask(domain: (typeof domainOrder)[number]): PrioritizedSubtask {
  const index = domainOrder.indexOf(domain);
  return {
    branchId: `lane-${String.fromCharCode(97 + index)}`,
    subtaskId: `step-${String.fromCharCode(97 + index)}`,
    description: 'Attend planned activity.',
    score: 10,
  };
}
