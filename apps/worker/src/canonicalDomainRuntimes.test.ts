import {
  createBranchPlan,
  type BranchPlanRecord,
  type DomainMicroPlanner,
  type PrioritizedSubtask,
} from '@aivilization/agent-runtime';
import type { LongHorizonObjective } from '@aivilization/memory';
import { asAgentId, asLocationId, type AgentId, type LocationId } from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldAgentState,
  type WorldCommandPolicies,
  type WorldLocationObservationState,
  type WorldProjection,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createCanonicalDomainRuntimeRegistrations,
  createDomainRuntimeResolver,
  resolveProductionTargetCommodityName,
  resolveResidentialTargetTier,
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
  'health',
  'eat',
] as const;
const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Apple: 10, Bread: 15 },
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
  sleep: { energyRecoveryPerSecond: 1, maxEnergy: 100 },
  seeDoctor: { healthRecoveryPerSecond: 1, maxHealth: 100 },
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

  test('proposes configured study, sleep, work, trade, social, production, residential, health, and eat world commands', async () => {
    const context = createRuntimeContext({
      agent: createAgent({ agentId: agentA, job: 'Waiter' }),
    });
    const binding = await resolveCanonicalBinding(context, {
      study: { durationSeconds: 900, educationRatePerSecond: 2 },
      sleep: { durationSeconds: 7200 },
      health: { durationSeconds: 1800 },
      eat: { commodityName: 'Apple', quantity: 2 },
      work: { laborSeconds: 1200, defaultOccupationName: 'Cleaner' },
      trade: { side: 'sell', commodityName: 'Book', quantity: 2 },
      social: {
        targetAgentId: agentC,
        topic: 'town plans',
        openingUtterance: 'Discuss town plans.',
        responseUtterance: 'I will remember this conversation about town plans.',
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
      commandType: 'AgentStartConversation',
      payload: {
        targetAgentId: agentC,
        topic: 'town plans',
        relationDelta: 3,
        attitudeDelta: 4,
        turns: [
          {
            speakerAgentId: agentA,
            utterance: 'Discuss town plans.',
            intent: 'social-plan',
          },
          {
            speakerAgentId: agentC,
            utterance: 'I will remember this conversation about town plans.',
            intent: 'acknowledge-topic',
          },
        ],
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
    expect(firstProposal(binding.microPlanners, 'health')).toMatchObject({
      id: 'canonical-health-step-h',
      commandType: 'AgentSeeDoctor',
      payload: { durationSeconds: 1800 },
      priority: 10,
      resourceEstimate: { actionSeconds: 1800 },
    });
    expect(firstProposal(binding.microPlanners, 'eat')).toMatchObject({
      id: 'canonical-eat-step-i',
      commandType: 'AgentEat',
      payload: { commodityName: 'Apple', quantity: 2 },
      priority: 10,
      resourceEstimate: { inventoryCosts: { Apple: 2 } },
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

  test('uses context-derived defaults for work, trade, social, and eat proposals', async () => {
    const context = createRuntimeContext({
      agent: createAgent({ agentId: agentA, job: null, inventory: { Book: 3, Bread: 1 } }),
      projection: createProjection({
        agents: [
          createAgent({ agentId: agentA, job: null, inventory: { Book: 3, Bread: 1 } }),
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
      commandType: 'AgentObserveLocation',
      payload: { focus: 'Attend planned activity.' },
    });
    expect(firstProposal(binding.microPlanners, 'production')).toMatchObject({
      commandType: 'AgentProduce',
      payload: { commodityName: 'Apple', quantity: 1, availableLaborSeconds: 3600 },
    });
    expect(firstProposal(binding.microPlanners, 'eat')).toMatchObject({
      commandType: 'AgentEat',
      payload: { commodityName: 'Bread', quantity: 1 },
      resourceEstimate: { inventoryCosts: { Bread: 1 } },
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

  test('proposes movement to the domain location before study when the agent is elsewhere', async () => {
    const agent = createAgent({
      agentId: agentA,
      locationId: asLocationId('residential-block'),
    });
    const context = createRuntimeContext({
      agent,
      projection: createProjection({
        agents: [agent, createAgent({ agentId: agentB }), createAgent({ agentId: agentC })],
        locations: [residentialBlock(), school()],
        marketPools: [
          { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 },
          { commodity: 'Book', commodityReserve: 100, currencyReserve: 1000 },
        ],
      }),
    });
    const binding = await resolveCanonicalBinding(context);

    expect(firstProposal(binding.microPlanners, 'study')).toMatchObject({
      id: 'canonical-study-step-a-move',
      commandType: 'AgentMoveTo',
      payload: { targetLocationId: 'school', reason: 'study' },
      priority: 10,
    });
  });

  test('proposes the domain action when the agent is already at the domain location', async () => {
    const agent = createAgent({
      agentId: agentA,
      locationId: asLocationId('school'),
    });
    const context = createRuntimeContext({
      agent,
      projection: createProjection({
        agents: [agent, createAgent({ agentId: agentB }), createAgent({ agentId: agentC })],
        locations: [residentialBlock(), school()],
        marketPools: [
          { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 },
          { commodity: 'Book', commodityReserve: 100, currencyReserve: 1000 },
        ],
      }),
    });
    const binding = await resolveCanonicalBinding(context);

    expect(firstProposal(binding.microPlanners, 'study')).toMatchObject({
      id: 'canonical-study-step-a',
      commandType: 'AgentStudy',
      payload: { durationSeconds: 1800, educationRatePerSecond: 1 },
      priority: 10,
    });
  });

  test('uses observed co-located agents before starting an unconfigured social conversation', async () => {
    const agent = createAgent({
      agentId: agentA,
      locationId: asLocationId('town-square'),
    });
    const context = createRuntimeContext({
      agent,
      projection: createProjection({
        agents: [
          agent,
          createAgent({ agentId: agentC, locationId: asLocationId('town-square') }),
          createAgent({ agentId: agentB, locationId: asLocationId('town-square') }),
        ],
        locations: [townSquare()],
        locationObservations: [
          {
            agentId: agentA,
            locationId: asLocationId('town-square'),
            locationName: 'Town Square',
            observedAgentIds: [agentC],
            activityAffinities: ['socialize'],
            observedAt: 100,
            focus: 'community routines',
          },
        ],
        marketPools: [
          { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 },
          { commodity: 'Book', commodityReserve: 100, currencyReserve: 1000 },
        ],
      }),
    });
    const binding = await resolveCanonicalBinding(context);

    expect(firstProposal(binding.microPlanners, 'social')).toMatchObject({
      id: 'canonical-social-step-e',
      commandType: 'AgentStartConversation',
      payload: {
        targetAgentId: agentC,
        topic: 'Attend planned activity.',
        turns: [
          {
            speakerAgentId: agentA,
            utterance: 'Socialized during planned activity.',
            intent: 'social-plan',
          },
          {
            speakerAgentId: agentC,
            utterance: 'I will remember this conversation about Attend planned activity.',
            intent: 'acknowledge-topic',
          },
        ],
      },
    });
  });

  test('proposes movement to the target agent location before socializing', async () => {
    const sourceAgent = createAgent({
      agentId: agentA,
      locationId: asLocationId('school'),
    });
    const targetAgent = createAgent({
      agentId: agentB,
      locationId: asLocationId('market'),
    });
    const context = createRuntimeContext({
      agent: sourceAgent,
      projection: createProjection({
        agents: [sourceAgent, targetAgent, createAgent({ agentId: agentC })],
        locations: [school(), market()],
        marketPools: [
          { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 },
          { commodity: 'Book', commodityReserve: 100, currencyReserve: 1000 },
        ],
      }),
    });
    const binding = await resolveCanonicalBinding(context, {
      social: { targetAgentId: agentB },
    });

    expect(firstProposal(binding.microPlanners, 'social')).toMatchObject({
      id: 'canonical-social-step-e-move',
      commandType: 'AgentMoveTo',
      payload: { targetLocationId: 'market', reason: 'social' },
      priority: 10,
    });
  });

  test('infers job application occupation from durable work plan text', async () => {
    const context = createRuntimeContext({
      agent: createAgent({
        agentId: agentA,
        job: null,
        residentialTier: 2,
        educationScore: 20,
        inventory: { Beef: 1 },
      }),
      activeObjective: createStockClerkObjective(agentA),
      planRecord: createStockClerkPlanRecord(agentA),
    });
    const binding = await resolveCanonicalBinding(context);

    expect(firstProposal(binding.microPlanners, 'work')).toMatchObject({
      commandType: 'AgentApplyJob',
      payload: { occupationName: 'Stock Clerk' },
      resourceEstimate: { inventoryCosts: { Beef: 1 } },
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

  test('routes domain support through structural plan metadata instead of target prose', async () => {
    const context = createRuntimeContext({
      agent: createAgent({ agentId: agentA, residentialTier: 1 }),
      activeObjective: createComplexTownObjective(agentA),
      planRecord: createComplexTownPlanRecord(agentA),
    });
    const binding = await resolveCanonicalBinding(context);
    const selected = complexResidentialSubtask();

    expect(requirePlanner(binding.microPlanners, 'residential').supports(selected)).toBe(true);
    expect(requirePlanner(binding.microPlanners, 'work').supports(selected)).toBe(false);
    expect(requirePlanner(binding.microPlanners, 'production').supports(selected)).toBe(false);
  });

  test('infers residential target tier from durable work and production target text', async () => {
    const context = createRuntimeContext({
      agent: createAgent({ agentId: agentA, residentialTier: 1 }),
      activeObjective: createComplexTownObjective(agentA),
      planRecord: createComplexTownPlanRecord(agentA),
    });
    const binding = await resolveCanonicalBinding(context);
    const selected = complexResidentialSubtask();

    expect(resolveResidentialTargetTier({ context, selectedSubtask: selected })).toBe(5);
    expect(
      requirePlanner(binding.microPlanners, 'residential').propose({
        selectedSubtask: selected,
      })[0],
    ).toMatchObject({
      id: 'canonical-residential-upgrade-residential-tier',
      commandType: 'AgentUpgradeResidentialTier',
      payload: { targetResidentialTier: 2 },
      resourceEstimate: {
        currencyCost: 100,
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
  readonly locations?: readonly {
    readonly locationId: LocationId;
    readonly name: string;
    readonly kind:
      | 'residence'
      | 'education'
      | 'healthcare'
      | 'food'
      | 'market'
      | 'production'
      | 'social';
    readonly activityAffinities: readonly string[];
    readonly capacity: number | null;
  }[];
  readonly marketPools: readonly {
    readonly commodity: string;
    readonly commodityReserve: number;
    readonly currencyReserve: number;
  }[];
  readonly locationObservations?: readonly WorldLocationObservationState[];
}): WorldProjection {
  return createWorldProjection({
    agents: input.agents,
    ...(input.locations === undefined ? {} : { locations: input.locations }),
    ...(input.locationObservations === undefined
      ? {}
      : { locationObservations: input.locationObservations }),
    marketPools: input.marketPools,
  });
}

function createAgent(input: {
  readonly agentId: AgentId;
  readonly job?: string | null;
  readonly locationId?: WorldAgentState['locationId'];
  readonly inventory?: WorldAgentState['inventory'];
  readonly residentialTier?: number;
  readonly educationScore?: number;
}): WorldAgentState {
  return {
    agentId: input.agentId,
    locationId: input.locationId ?? null,
    physiology: { energy: 50, satiety: 50, health: 100 },
    educationScore: input.educationScore ?? 0,
    balance: 1000,
    residentialTier: input.residentialTier ?? 1,
    job: input.job ?? null,
    inventory: input.inventory ?? { Book: 3, Wood: 1 },
  };
}

function residentialBlock() {
  return {
    locationId: asLocationId('residential-block'),
    name: 'Residential Block',
    kind: 'residence' as const,
    activityAffinities: ['sleep', 'socialize'],
    capacity: null,
  };
}

function school() {
  return {
    locationId: asLocationId('school'),
    name: 'School',
    kind: 'education' as const,
    activityAffinities: ['study', 'socialize'],
    capacity: null,
  };
}

function market() {
  return {
    locationId: asLocationId('market'),
    name: 'Market',
    kind: 'market' as const,
    activityAffinities: ['trade', 'socialize'],
    capacity: null,
  };
}

function townSquare() {
  return {
    locationId: asLocationId('town-square'),
    name: 'Town Square',
    kind: 'social' as const,
    activityAffinities: ['socialize'],
    capacity: null,
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

function createStockClerkObjective(agentId: AgentId): LongHorizonObjective {
  return {
    id: 'objective-stock-clerk',
    agentId,
    statement: 'Apply for Stock Clerk work.',
    priority: 3,
    source: 'human',
    affinityTags: ['work'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createStockClerkPlanRecord(agentId: AgentId): BranchPlanRecord {
  return {
    planId: 'objective-stock-clerk',
    agentId,
    plan: createBranchPlan({
      objective: 'Apply for Stock Clerk work.',
      branches: [
        {
          id: 'lane-b',
          objective: 'Enter Stock Clerk occupation.',
          subtasks: [
            {
              id: 'step-b',
              description: 'Apply for Stock Clerk.',
              basePriority: 5,
              intentionAffinityTags: ['work'],
            },
          ],
        },
      ],
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

function createComplexTownObjective(agentId: AgentId): LongHorizonObjective {
  return {
    id: 'objective-complex-town',
    agentId,
    statement:
      'Upgrade residential tier, apply for Stock Clerk work, then craft Chip for the electronics market.',
    priority: 3,
    source: 'human',
    affinityTags: ['residential', 'work', 'production'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createComplexTownPlanRecord(agentId: AgentId): BranchPlanRecord {
  return {
    planId: 'objective-complex-town',
    agentId,
    plan: createBranchPlan({
      objective:
        'Upgrade residential tier, apply for Stock Clerk work, then craft Chip for the electronics market.',
      branches: [
        {
          id: 'residential-readiness',
          objective: 'Prepare housing capacity for Stock Clerk work and Chip crafting.',
          subtasks: [
            {
              id: 'upgrade-residential-tier',
              description: 'Upgrade residential tier, apply for Stock Clerk work, then craft Chip.',
              basePriority: 5,
              intentionAffinityTags: ['residential'],
            },
          ],
        },
        {
          id: 'employment',
          objective: 'Enter Stock Clerk work.',
          subtasks: [
            {
              id: 'apply-for-work',
              description: 'Apply for Stock Clerk work.',
              basePriority: 5,
              intentionAffinityTags: ['work'],
            },
          ],
        },
        {
          id: 'production',
          objective: 'Craft Chip for the electronics market.',
          subtasks: [
            {
              id: 'produce-target',
              description: 'Craft Chip.',
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

function complexResidentialSubtask(): PrioritizedSubtask {
  return {
    branchId: 'residential-readiness',
    subtaskId: 'upgrade-residential-tier',
    description: 'Upgrade residential tier, apply for Stock Clerk work, then craft Chip.',
    score: 10,
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
