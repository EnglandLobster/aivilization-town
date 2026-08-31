import {
  AGENT_ACTION_COMMAND_TYPES,
  createBranchPlan,
  type BranchPlan,
  type BranchPlanRecord,
  type DomainMicroPlanner,
  type DomainMicroPlannerInput,
  type PrioritizedSubtask,
  type WorldDecisionContext,
} from '@aivilization/agent-runtime';
import {
  asMemoryRecordId,
  type LongHorizonObjective,
  type LongTermAgentProfile,
} from '@aivilization/memory';
import { asAgentId, asLocationId, type AgentId, type LocationId } from '@aivilization/sim-core';
import type { EducationSystemPolicy, SocialRelationState } from '@aivilization/society';
import {
  createBankState,
  createWorldProjection,
  type WorldAgentState,
  type WorldBankState,
  type WorldCommandPolicies,
  type WorldEducationExamApplicationState,
  type WorldEnterpriseState,
  type WorldLocationObservationState,
  type WorldProjection,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  CANONICAL_ACTION_PROPOSAL_COMMAND_TYPES,
  createCanonicalDomainRuntimeRegistrations,
  createDomainRuntimeResolver,
  createWorldDecisionContextFromProjection,
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
  'banking',
  'enterprise',
] as const;
const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Apple: 10, Bread: 15 },
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
  educationInvestment: { currencyCostPerHour: 20, inventoryCostsPerHour: {} },
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

const creditPolicy: NonNullable<WorldCommandPolicies['credit']> = {
  policyVersion: 'test-credit-v1',
  depositDailyInterestRate: 0.0001,
  loanDailyInterestRate: 0.001,
  loanTermDays: 10,
  accrualCadenceMs: 86_400_000,
  reserveRatio: 0.1,
  maxLoansPerAgent: 2,
  graceMissedPayments: 2,
  baseLoanLimit: 200,
  creditLimitRepaidBonusRatio: 0.1,
  creditLimitDefaultPenaltyRatio: 0.5,
  creditLimitMinMultiplier: 0.5,
  creditLimitMaxMultiplier: 2,
  source: 'test',
};

const enterprisePolicy: NonNullable<WorldCommandPolicies['enterprise']> = {
  policyVersion: 'test-enterprise-v1',
  minimumInitialCapital: 100,
  maximumInitialCapital: 1_000,
  maximumEmployees: 4,
};

const externalTradePolicy: NonNullable<WorldCommandPolicies['externalTrade']> = {
  policyVersion: 'test-external-trade-v1',
  balanceDecayRatioPerCadence: 0.01,
  cadenceMs: 1_000,
  priceImpactRatio: 0.2,
  balanceScale: 50,
  source: 'canonical domain runtime test',
};

function createEnterpriseState(input: {
  readonly enterpriseId: string;
  readonly ownerAgentId: AgentId;
  readonly jobPostingOpenSlots?: number;
  readonly balance?: number;
  readonly inventory?: Readonly<Record<string, number>>;
  readonly employeeAgentIds?: readonly AgentId[];
  readonly cumulativeSales?: number;
  readonly occupationName?: string;
}): WorldEnterpriseState {
  return {
    enterpriseId: input.enterpriseId,
    name: `Enterprise ${input.enterpriseId}`,
    ownerAgentId: input.ownerAgentId,
    occupationName: input.occupationName ?? 'Baker',
    balance: input.balance ?? 100,
    inventory: input.inventory ?? {},
    maxEmployees: 3,
    employeeAgentIds: input.employeeAgentIds ?? [],
    status: 'active',
    foundedAt: 0,
    cumulativeSales: input.cumulativeSales ?? 0,
    cumulativePurchases: 0,
    cumulativeWages: 0,
    ...(input.jobPostingOpenSlots === undefined
      ? {}
      : { jobPosting: { wageOffer: 12, openSlots: input.jobPostingOpenSlots } }),
  };
}

const educationSystemPolicy: EducationSystemPolicy = {
  policyVersion: 'education-system-v4',
  enabled: true,
  levelScoreThresholds: [20, 70, 180, 320, 450],
  compulsoryLevels: [1, 2],
  levelTuitionPerHour: { 0: 20, 1: 20, 2: 20, 3: 25, 4: 30, 5: 40 },
  employedStudyEfficiencyRatio: 0.3,
  examCycleDurationMs: 86_400_000,
  admissionQuotaByLevel: { 3: 0.5, 4: 0.25, 5: 0.1 },
  vocationalTrackShare: 0.5,
  source: 'test-education-system',
};

const educationSystemPolicies: WorldCommandPolicies = {
  ...policies,
  educationSystem: educationSystemPolicy,
};

describe('canonical domain runtimes', () => {
  test('registers all canonical domains in deterministic order', () => {
    const registrations = createCanonicalDomainRuntimeRegistrations();

    expect(registrations.map((registration) => registration.domain)).toEqual(domainOrder);
  });

  test('registers governance only with policy and turns a signed threshold petition into a command', async () => {
    const agent = createAgent({ agentId: agentA, locationId: asLocationId('town-square') });
    const governanceSubtask: PrioritizedSubtask = {
      branchId: 'governance',
      subtaskId: 'lower-tax',
      description: 'Honor the tax petition.',
      score: 10,
    };
    const planRecord: BranchPlanRecord = {
      planId: 'objective-governance',
      agentId: agentA,
      plan: createBranchPlan({
        objective: 'Honor the town petition.',
        branches: [
          {
            id: 'governance',
            objective: 'Change town tax policy.',
            subtasks: [
              {
                id: 'lower-tax',
                description: 'Honor the tax petition.',
                basePriority: 10,
                intentionAffinityTags: ['governance'],
              },
            ],
          },
        ],
      }),
      createdAt: 100,
      updatedAt: 100,
    };
    const governancePolicies: WorldCommandPolicies = {
      ...policies,
      governance: {
        policyVersion: 'town-governance-v1',
        allowedBudgetServices: ['education'],
        maximumAllocationPerCadence: 1_000,
        maximumTreasuryReserve: 10_000,
        maximumSubsidyBalanceFloor: 1_000,
        maximumSubsidyPerCadence: 500,
      },
      tax: {
        policyVersion: 'tax-v1',
        neutralRate: 0.1,
        incomeTaxBrackets: [{ upToAmount: null, rate: 0.1 }],
        tradeTaxRate: 0.05,
        source: 'test',
      },
      publicBudget: {
        policyVersion: 'budget-v1',
        cadenceMs: 86_400_000,
        minimumTreasuryReserve: 100,
        allocations: [{ service: 'education', amountPerCadence: 25 }],
      },
    };
    const context = createRuntimeContext({
      agent,
      projection: createProjection({
        agents: [agent, createAgent({ agentId: agentB }), createAgent({ agentId: agentC })],
        locations: [townSquare()],
        marketPools: [],
      }),
      planRecord,
      worldDecisionContext: {
        agent: {
          agentId: agentA,
          locationId: agent.locationId,
          physiology: { ...agent.physiology },
          educationScore: agent.educationScore,
          balance: agent.balance,
          residentialTier: agent.residentialTier,
          job: agent.job,
          inventory: { ...agent.inventory },
        },
        market: { spotPrices: [] },
        governance: {
          revision: 4,
          tax: {
            neutralRate: 0.1,
            incomeTaxBrackets: [{ upToAmount: null, rate: 0.1 }],
            tradeTaxRate: 0.05,
          },
          publicBudget: {
            cadenceMs: 86_400_000,
            minimumTreasuryReserve: 100,
            allocations: [{ service: 'education', amountPerCadence: 25 }],
          },
          eligiblePetitions: [
            {
              petitionId: 'petition-tax',
              topic: 'tax-policy',
              statement: '请降低税率',
              thresholdReachedAt: 90,
            },
          ],
        },
      },
    });

    const binding = await resolveCanonicalBinding(context, {}, governancePolicies);
    const governancePlanner = binding.microPlanners.find(
      (candidate) => candidate.domain === 'governance',
    );
    if (governancePlanner === undefined) throw new Error('missing governance planner');
    expect(governancePlanner.supports(governanceSubtask)).toBe(true);
    expect(
      governancePlanner.propose(
        createMicroPlannerInput({ selectedSubtask: governanceSubtask, plan: planRecord.plan }),
      )[0],
    ).toMatchObject({
      commandType: 'SetTaxPolicy',
      payload: {
        neutralRate: 0.09,
        tradeTaxRate: 0.04,
        petitionId: 'petition-tax',
        expectedGovernanceRevision: 4,
      },
    });
  });

  test('every canonical action proposal command type is whitelisted for reactive correction', () => {
    // AGENT_CONTEXT_DESIGN.md §5 whitelist reconciliation: the canonical set
    // and the repair whitelist drifted independently (AgentGiveResource was
    // proposed but not whitelisted). This guards canonical ⊆ whitelist.
    const whitelist: readonly string[] = AGENT_ACTION_COMMAND_TYPES;
    const missing = CANONICAL_ACTION_PROPOSAL_COMMAND_TYPES.filter(
      (commandType) => !whitelist.includes(commandType),
    );

    expect(missing).toEqual([]);
    expect(new Set(CANONICAL_ACTION_PROPOSAL_COMMAND_TYPES).size).toBe(
      CANONICAL_ACTION_PROPOSAL_COMMAND_TYPES.length,
    );
  });

  test('routes an assigned social-matter delivery through the canonical social domain', async () => {
    const capableAgent = createAgent({
      agentId: agentA,
      inventory: { Apple: 2, Book: 3 },
      locationId: asLocationId('town-square'),
    });
    const projection = createProjection({
      agents: [
        capableAgent,
        createAgent({ agentId: agentB, locationId: asLocationId('town-square') }),
        createAgent({ agentId: agentC, locationId: asLocationId('town-square') }),
      ],
      locations: [townSquare()],
      marketPools: [],
    });
    const assignedMatter = createMatterDecisionContextForTest(capableAgent, [
      {
        matterId: 'matter-delivery',
        kind: 'help-request',
        status: 'assigned',
        role: 'assignee',
        initiatorAgentId: agentB,
        assigneeAgentId: agentA,
        topic: 'apple-help',
        statement: 'Please deliver apples.',
        requiredCommodity: { commodityName: 'Apple', quantity: 3 },
        responses: [{ responderAgentId: agentA, decision: 'accept', respondedAt: 10 }],
        deliveredQuantity: 1,
        createdAt: 0,
        expiresAt: 1_000,
      },
    ]);
    const assignedContext = createRuntimeContext({
      agent: capableAgent,
      projection,
      worldDecisionContext: assignedMatter,
    });
    const binding = await resolveCanonicalBinding(
      assignedContext,
      {},
      {
        ...policies,
        socialMatters: { policyVersion: 'social-matters-v1', defaultExpiryMs: 1_000 },
      },
    );
    expect(firstProposal(binding.microPlanners, 'social')).toMatchObject({
      commandType: 'AgentGiveResource',
      payload: { targetAgentId: agentB, commodityName: 'Apple', quantity: 2 },
    });
  });

  test('proposes a survival bridge loan only under the rigid banking gates', async () => {
    const needyAgent = createAgent({
      agentId: agentA,
      balance: 10,
      physiology: { energy: 25, satiety: 50, health: 100 },
    });
    const binding = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: needyAgent,
        projection: createProjection({
          agents: [needyAgent],
          marketPools: [],
          bank: createBankState({ reserves: 10_000 }),
        }),
      }),
      {},
      { ...policies, credit: creditPolicy },
    );

    // Gap = 50 - 10 = 40; no active loans; base limit 200 covers it.
    expect(firstProposal(binding.microPlanners, 'banking')).toMatchObject({
      commandType: 'AgentRequestLoan',
      payload: { amount: 40 },
      priority: 10,
    });
  });

  test('keeps the banking domain on observe without a physiological gap or credit', async () => {
    // Physiology healthy: no survival gap, no loan even with a thin balance.
    const healthyAgent = createAgent({
      agentId: agentA,
      balance: 10,
      physiology: { energy: 80, satiety: 80, health: 100 },
    });
    const healthy = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: healthyAgent,
        projection: createProjection({
          agents: [healthyAgent],
          marketPools: [],
          bank: createBankState({ reserves: 10_000 }),
        }),
      }),
      {},
      { ...policies, credit: creditPolicy },
    );
    expect(firstProposal(healthy.microPlanners, 'banking')).toMatchObject({
      commandType: 'AgentObserveLocation',
    });

    // No credit policy: the domain never nominates loans.
    const unbanked = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: createAgent({
          agentId: agentA,
          balance: 10,
          physiology: { energy: 25, satiety: 50, health: 100 },
        }),
        projection: createProjection({
          agents: [
            createAgent({
              agentId: agentA,
              balance: 10,
              physiology: { energy: 25, satiety: 50, health: 100 },
            }),
          ],
          marketPools: [],
          bank: createBankState({ reserves: 10_000 }),
        }),
      }),
      {},
      policies,
    );
    expect(firstProposal(unbanked.microPlanners, 'banking')).toMatchObject({
      commandType: 'AgentObserveLocation',
    });
  });

  test('proposes enterprise join for open postings and funding for owners', async () => {
    const worker = createAgent({ agentId: agentA, balance: 500 });
    const enterpriseProjection = {
      ...createProjection({
        agents: [worker, createAgent({ agentId: agentB })],
        marketPools: [],
        enterprises: [
          createEnterpriseState({
            enterpriseId: 'e-1',
            ownerAgentId: agentB,
            jobPostingOpenSlots: 2,
          }),
        ],
      }),
      jobApplications: [
        {
          applicationId: 'used-public-application',
          cycleNumber: 0,
          agentId: agentA,
          occupationName: 'Cleaner',
          residentialTier: 1,
          educationScore: 0,
          submittedAt: 0,
          status: 'pending' as const,
        },
      ],
    };
    const enterpriseDecisionContext = createWorldDecisionContextFromProjection({
      projection: enterpriseProjection,
      agentId: agentA,
      policies,
    });
    expect(
      enterpriseDecisionContext.rules?.occupations.find(
        (rule) => rule.occupationName === 'Cleaner',
      ),
    ).toMatchObject({
      eligible: false,
      rejectionReasons: ['application-quota-exhausted'],
    });
    const joinBinding = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: worker,
        projection: enterpriseProjection,
        worldDecisionContext: enterpriseDecisionContext,
      }),
      {},
      { ...policies, enterprise: enterprisePolicy },
    );
    expect(firstProposal(joinBinding.microPlanners, 'enterprise')).toMatchObject({
      commandType: 'AgentJoinEnterprise',
      payload: { enterpriseId: 'e-1' },
    });

    const directEmploymentSubtask: PrioritizedSubtask = {
      branchId: 'enterprise',
      subtaskId: 'pursue-enterprise-objective',
      description: 'Pursue enterprise objective: Take the open position at Enterprise e-1.',
      score: 85,
    };
    expect(
      requirePlanner(joinBinding.microPlanners, 'enterprise').propose(
        createMicroPlannerInput({ selectedSubtask: directEmploymentSubtask }),
      )[0],
    ).toMatchObject({
      commandType: 'AgentJoinEnterprise',
      payload: { enterpriseId: 'e-1' },
    });

    // No posting and not an owner: observe only.
    const outsider = createAgent({ agentId: agentA, balance: 500 });
    const observeBinding = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: outsider,
        projection: createProjection({
          agents: [outsider, createAgent({ agentId: agentB })],
          marketPools: [],
          enterprises: [createEnterpriseState({ enterpriseId: 'e-1', ownerAgentId: agentB })],
        }),
      }),
      {},
      { ...policies, enterprise: enterprisePolicy },
    );
    expect(firstProposal(observeBinding.microPlanners, 'enterprise')).toMatchObject({
      commandType: 'AgentObserveLocation',
    });

    // Owner above the funding floor funds the enterprise with the surplus.
    const owner = createAgent({ agentId: agentA, balance: 160 });
    const fundBinding = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: owner,
        projection: createProjection({
          agents: [owner],
          marketPools: [],
          enterprises: [createEnterpriseState({ enterpriseId: 'e-1', ownerAgentId: agentA })],
        }),
      }),
      { enterprise: { fundingOwnerBalanceFloor: 100 } },
      { ...policies, enterprise: enterprisePolicy },
    );
    expect(firstProposal(fundBinding.microPlanners, 'enterprise')).toMatchObject({
      commandType: 'AgentFundEnterprise',
      payload: { enterpriseId: 'e-1', amount: 60 },
    });
  });

  test('connects autonomous founding, enterprise operations, and employer payroll proposals', async () => {
    const founder = createAgent({ agentId: agentA, balance: 500, inventory: {} });
    const foundingObjective: LongHorizonObjective = {
      ...createObjective(agentA),
      statement: 'Found an enterprise to produce goods and create employment.',
      affinityTags: ['enterprise', 'enterprise-founder', 'found'],
    };
    const foundingBinding = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: founder,
        projection: createProjection({
          agents: [founder, createAgent({ agentId: agentB, balance: 100 })],
          marketPools: [],
        }),
        activeObjective: foundingObjective,
      }),
      {},
      { ...policies, enterprise: enterprisePolicy },
    );
    expect(firstProposal(foundingBinding.microPlanners, 'enterprise')).toMatchObject({
      commandType: 'AgentFoundEnterprise',
      payload: {
        occupationName: 'Cleaner',
        initialCapital: 400,
        maxEmployees: 3,
      },
    });

    const enterprise = createEnterpriseState({
      enterpriseId: 'e-1',
      ownerAgentId: agentA,
      occupationName: 'Cleaner',
      inventory: { Wood: 1, Book: 2 },
    });
    const operationObjective: LongHorizonObjective = {
      ...createObjective(agentA),
      statement: 'Produce and sell Book for enterprise E One.',
      affinityTags: ['enterprise', 'production', 'trade', 'sell', 'Book'],
    };
    const operationBinding = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: founder,
        projection: createProjection({
          agents: [founder],
          marketPools: [{ commodity: 'Book', commodityReserve: 100, currencyReserve: 1_000 }],
          enterprises: [enterprise],
        }),
        activeObjective: operationObjective,
      }),
      { production: { commodityName: 'Book' }, trade: { side: 'sell', commodityName: 'Book' } },
      { ...policies, enterprise: enterprisePolicy },
    );
    const productionProposal = firstProposal(operationBinding.microPlanners, 'production');
    expect(productionProposal).toMatchObject({
      commandType: 'AgentProduce',
      payload: { commodityName: 'Book', enterpriseId: 'e-1' },
    });
    expect(typeof productionProposal?.resourceEstimate?.actionSeconds).toBe('number');
    expect(productionProposal?.resourceEstimate).not.toHaveProperty('inventoryCosts');
    expect(firstProposal(operationBinding.microPlanners, 'trade')).toMatchObject({
      commandType: 'AgentTrade',
      payload: { side: 'sell', commodityName: 'Book', enterpriseId: 'e-1' },
    });

    const employee = createAgent({ agentId: agentB, job: 'Cleaner' });
    const payrollBinding = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: employee,
        projection: createProjection({
          agents: [founder, employee],
          marketPools: [],
          enterprises: [
            createEnterpriseState({
              enterpriseId: 'e-1',
              ownerAgentId: agentA,
              occupationName: 'Cleaner',
              employeeAgentIds: [agentB],
            }),
          ],
        }),
      }),
      {},
      { ...policies, enterprise: enterprisePolicy },
    );
    expect(firstProposal(payrollBinding.microPlanners, 'work')).toMatchObject({
      commandType: 'AgentWork',
      payload: { occupationName: 'Cleaner', enterpriseId: 'e-1' },
    });
  });

  test('proposes owner-only enterprise export/import when the external quote beats the visible AMM', async () => {
    const owner = createAgent({
      agentId: agentA,
      balance: 100,
      locationId: asLocationId('market'),
    });
    const projection = createProjection({
      agents: [owner],
      locations: [market()],
      marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 }],
      enterprises: [
        createEnterpriseState({
          enterpriseId: 'e-1',
          ownerAgentId: agentA,
          balance: 100,
          inventory: { Apple: 2 },
        }),
      ],
    });
    const externalObjective: LongHorizonObjective = {
      ...createObjective(agentA),
      statement: 'Use the enterprise external market opportunity for Apple.',
      affinityTags: ['trade', 'external', 'enterprise', 'Apple'],
    };

    const exportBinding = await resolveCanonicalBinding(
      createRuntimeContext({ agent: owner, projection, activeObjective: externalObjective }),
      { trade: { side: 'sell', commodityName: 'Apple', quantity: 1 } },
      { ...policies, externalTrade: externalTradePolicy },
    );
    expect(firstProposal(exportBinding.microPlanners, 'trade')).toMatchObject({
      commandType: 'AgentExportCommodity',
      payload: { commodityName: 'Apple', quantity: 1, asEnterpriseId: 'e-1' },
      resourceEstimate: { inventoryCosts: { Apple: 1 } },
    });

    const importBinding = await resolveCanonicalBinding(
      createRuntimeContext({ agent: owner, projection, activeObjective: externalObjective }),
      { trade: { side: 'buy', commodityName: 'Apple', quantity: 1 } },
      { ...policies, externalTrade: externalTradePolicy },
    );
    expect(firstProposal(importBinding.microPlanners, 'trade')).toMatchObject({
      commandType: 'AgentImportCommodity',
      payload: { commodityName: 'Apple', quantity: 1, asEnterpriseId: 'e-1' },
      resourceEstimate: { currencyCost: 10 },
    });
  });

  test('prices external proposals from the owner current regional market only', async () => {
    const eastMarket = asLocationId('east-market');
    const owner = createAgent({ agentId: agentA, balance: 100, locationId: eastMarket });
    const projection = createProjection({
      agents: [owner],
      locations: [
        {
          locationId: eastMarket,
          name: 'East Market',
          kind: 'market',
          activityAffinities: ['trade'],
          capacity: null,
          regionId: 'east',
        },
      ],
      // Put the inaccessible expensive pool first to catch accidental
      // Object.values()/bare-commodity selection.
      marketPools: [
        {
          commodity: 'Apple',
          commodityReserve: 100,
          currencyReserve: 10_000,
          regionId: 'west',
        },
        {
          commodity: 'Apple',
          commodityReserve: 100,
          currencyReserve: 1_000,
          regionId: 'east',
        },
      ],
      enterprises: [
        createEnterpriseState({
          enterpriseId: 'e-1',
          ownerAgentId: agentA,
          balance: 500,
        }),
      ],
    });
    const externalObjective: LongHorizonObjective = {
      ...createObjective(agentA),
      statement: 'Import Apple for the enterprise through the external market.',
      affinityTags: ['trade', 'buy', 'external', 'enterprise', 'Apple'],
    };
    const binding = await resolveCanonicalBinding(
      createRuntimeContext({ agent: owner, projection, activeObjective: externalObjective }),
      { trade: { side: 'buy', commodityName: 'Apple' } },
      {
        ...policies,
        regionalMarkets: { enabled: true },
        externalTrade: externalTradePolicy,
      },
    );

    expect(firstProposal(binding.microPlanners, 'trade')).toMatchObject({
      commandType: 'AgentImportCommodity',
      payload: { commodityName: 'Apple', asEnterpriseId: 'e-1' },
      resourceEstimate: { currencyCost: 10 },
    });
  });

  test('keeps external enterprise trade owner-gated and preserves legacy trade without policy', async () => {
    const outsider = createAgent({ agentId: agentA, balance: 100 });
    const externalObjective: LongHorizonObjective = {
      ...createObjective(agentA),
      statement: 'Export Apple through an enterprise external market.',
      affinityTags: ['trade', 'sell', 'external', 'enterprise', 'Apple'],
    };
    const projection = createProjection({
      agents: [outsider, createAgent({ agentId: agentB })],
      marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 }],
      enterprises: [
        createEnterpriseState({
          enterpriseId: 'e-1',
          ownerAgentId: agentB,
          inventory: { Apple: 2 },
        }),
      ],
    });
    const context = createRuntimeContext({
      agent: outsider,
      projection,
      activeObjective: externalObjective,
    });

    const noOwnership = await resolveCanonicalBinding(
      context,
      { trade: { side: 'sell', commodityName: 'Apple' } },
      { ...policies, externalTrade: externalTradePolicy },
    );
    expect(firstProposal(noOwnership.microPlanners, 'trade')).toMatchObject({
      commandType: 'AgentObserveLocation',
    });

    const noPolicy = await resolveCanonicalBinding(context, {
      trade: { side: 'sell', commodityName: 'Apple' },
    });
    expect(firstProposal(noPolicy.microPlanners, 'trade')).toMatchObject({
      commandType: 'AgentTrade',
    });
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
      resourceEstimate: { actionSeconds: 900, currencyCost: 5, inventoryCosts: {} },
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
            intent: 'open-contextual-topic',
          },
          {
            speakerAgentId: agentC,
            utterance: 'I will remember this conversation about town plans.',
            intent: 'invite-perspective',
          },
          {
            speakerAgentId: agentA,
            utterance:
              'Here is how town plans fits my plans, but I would rather listen to you first.',
            intent: 'share-goal-and-listen',
          },
          {
            speakerAgentId: agentC,
            utterance: "Let's work together on town plans.",
            intent: 'cooperate',
          },
          {
            speakerAgentId: agentA,
            utterance:
              'I can help with what I know, and I will share with you whatever I learn about town plans.',
            intent: 'coordinate',
          },
          {
            speakerAgentId: agentC,
            utterance: "Let's stay in touch as town plans develops.",
            intent: 'continue-relationship',
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

  test('proposes an education exam application once an exam-gated threshold is met', async () => {
    // Recorded level 2 with a score past the level-3 threshold (180): the next
    // step is the 中考 application, not more study.
    const context = createRuntimeContext({
      agent: createAgent({ agentId: agentA, educationScore: 200, educationLevel: 2 }),
    });
    const binding = await resolveCanonicalBinding(context, {}, educationSystemPolicies);

    expect(firstProposal(binding.microPlanners, 'study')).toMatchObject({
      id: 'canonical-study-step-a-exam-application',
      commandType: 'AgentApplyEducationExam',
      payload: { targetLevel: 3 },
      priority: 10,
    });
  });

  test('keeps proposing study below the threshold, after applying, or with the system disabled', async () => {
    // Below the next level threshold (100 < 180 at level 2): keep studying.
    const belowThreshold = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: createAgent({ agentId: agentA, educationScore: 100, educationLevel: 2 }),
      }),
      {},
      educationSystemPolicies,
    );
    expect(firstProposal(belowThreshold.microPlanners, 'study')).toMatchObject({
      commandType: 'AgentStudy',
    });

    // Already applied in the current exam cycle (clock now 0 => cycle 0).
    const appliedAgent = createAgent({ agentId: agentA, educationScore: 200, educationLevel: 2 });
    const alreadyApplied = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: appliedAgent,
        projection: createProjection({
          agents: [appliedAgent],
          marketPools: [],
          educationExamApplications: [
            {
              applicationId: 'command-earlier:application',
              cycleNumber: 0,
              agentId: agentA,
              targetLevel: 3,
              educationScore: 200,
              submittedAt: 0,
              status: 'pending',
            },
          ],
        }),
      }),
      {},
      educationSystemPolicies,
    );
    expect(firstProposal(alreadyApplied.microPlanners, 'study')).toMatchObject({
      commandType: 'AgentStudy',
    });

    // Education system disabled: legacy continuous-score study only.
    const disabled = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: createAgent({ agentId: agentA, educationScore: 200, educationLevel: 2 }),
      }),
      {},
      {
        ...educationSystemPolicies,
        educationSystem: { ...educationSystemPolicy, enabled: false },
      },
    );
    expect(firstProposal(disabled.microPlanners, 'study')).toMatchObject({
      commandType: 'AgentStudy',
    });
  });

  test('estimates study costs from the education-system settlement terms', async () => {
    // Compulsory level 1 with a funded treasury: the self-pay share is zero,
    // so a low-balance agent is not priced out by the legacy flat rate.
    const compulsoryAgent = createAgent({
      agentId: agentA,
      educationScore: 25,
      educationLevel: 1,
      balance: 5,
    });
    const compulsory = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: compulsoryAgent,
        projection: createProjection({
          agents: [compulsoryAgent],
          marketPools: [],
          treasury: 1000,
        }),
      }),
      { study: { durationSeconds: 1800 } },
      educationSystemPolicies,
    );
    expect(firstProposal(compulsory.microPlanners, 'study')).toMatchObject({
      commandType: 'AgentStudy',
      resourceEstimate: { actionSeconds: 1800, currencyCost: 0, inventoryCosts: {} },
    });

    // Non-compulsory level 4 pays the level tuition (30/hour over 1800s).
    const academicAgent = createAgent({
      agentId: agentA,
      educationScore: 400,
      educationLevel: 4,
      balance: 100,
    });
    const academic = await resolveCanonicalBinding(
      createRuntimeContext({
        agent: academicAgent,
        projection: createProjection({
          agents: [academicAgent],
          marketPools: [],
          treasury: 1000,
        }),
      }),
      { study: { durationSeconds: 1800 } },
      educationSystemPolicies,
    );
    expect(firstProposal(academic.microPlanners, 'study')).toMatchObject({
      commandType: 'AgentStudy',
      resourceEstimate: { actionSeconds: 1800, currencyCost: 15, inventoryCosts: {} },
    });
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

  test('derives an unconfigured trade side and commodity from the selected market objective', async () => {
    const context = createRuntimeContext({
      agent: createAgent({ agentId: agentA, inventory: { Book: 3 } }),
    });
    const binding = await resolveCanonicalBinding(context);
    const proposal = requirePlanner(binding.microPlanners, 'trade').propose(
      createMicroPlannerInput({
        selectedSubtask: {
          branchId: 'lane-c',
          subtaskId: 'step-c',
          description: 'Sell one Book through the town market.',
          score: 10,
        },
      }),
    )[0];

    expect(proposal).toMatchObject({
      commandType: 'AgentTrade',
      payload: { side: 'sell', commodityName: 'Book', quantity: 1 },
      resourceEstimate: { inventoryCosts: { Book: 1 } },
    });
  });

  test('lets one material-ready resident answer simulation-wide housing pressure', async () => {
    const builder = createAgent({
      agentId: agentA,
      locationId: asLocationId('residential-block'),
      inventory: { Wood: 2 },
    });
    const neighbor = createAgent({
      agentId: agentB,
      locationId: asLocationId('residential-block'),
      inventory: {},
    });
    const projection = createProjection({
      agents: [builder, neighbor],
      locations: [{ ...residentialBlock(), capacity: 2 }],
      marketPools: [],
    });
    const societyContext = createSocietyDecisionContextForTest({
      agent: builder,
      societyAgents: [
        {
          agentId: agentA,
          ownerPartitionKey: 'partition-a',
          locationId: asLocationId('residential-block'),
        },
        {
          agentId: agentB,
          ownerPartitionKey: 'partition-a',
          locationId: asLocationId('residential-block'),
        },
      ],
    });
    const worldDecisionContext: WorldDecisionContext = {
      ...societyContext,
      society: {
        ...societyContext.society!,
        housing: {
          population: 2,
          occupiedResidences: 2,
          unhousedPopulation: 0,
          totalResidentialCapacity: 2,
          vacancies: 0,
          occupancyRatio: 1,
          residences: [{ locationId: 'residential-block', capacity: 2, occupied: 2, vacancies: 0 }],
        },
      },
    };
    const binding = await resolveCanonicalBinding(
      createRuntimeContext({ agent: builder, projection, worldDecisionContext }),
      {},
      {
        ...policies,
        housingConstruction: {
          policyVersion: 'town-construction-v1',
          minimumOccupancyRatio: 0.8,
          capacityPerProject: 5,
          maximumLocationCapacity: 200,
          inventoryCosts: { Wood: 2 },
          builderSelection: 'lowest-agent-id-with-materials-per-partition',
          locationSelection: 'lowest-capacity-then-id',
        },
      },
    );

    expect(firstProposal(binding.microPlanners, 'residential')).toMatchObject({
      commandType: 'AgentBuildHousing',
      payload: { locationId: 'residential-block' },
      resourceEstimate: { inventoryCosts: { Wood: 2 } },
    });
  });

  test('lets an unhoused agent claim a visible vacancy before upgrading housing quality', async () => {
    const agent = createAgent({
      agentId: agentA,
      locationId: asLocationId('residential-block'),
    });
    const projection = createProjection({
      agents: [agent],
      locations: [{ ...residentialBlock(), capacity: 2 }],
      marketPools: [],
    });
    const societyContext = createSocietyDecisionContextForTest({
      agent,
      societyAgents: [
        {
          agentId: agentA,
          ownerPartitionKey: 'partition-a',
          locationId: asLocationId('residential-block'),
        },
      ],
    });
    const worldDecisionContext: WorldDecisionContext = {
      ...societyContext,
      agent: {
        ...societyContext.agent,
        residenceLocationId: null,
        housed: false,
      },
      society: {
        ...societyContext.society!,
        housing: {
          population: 1,
          occupiedResidences: 0,
          unhousedPopulation: 1,
          totalResidentialCapacity: 2,
          vacancies: 2,
          occupancyRatio: 0,
          residences: [{ locationId: 'residential-block', capacity: 2, occupied: 0, vacancies: 2 }],
        },
      },
    };
    const binding = await resolveCanonicalBinding(
      createRuntimeContext({ agent, projection, worldDecisionContext }),
      {},
      {
        ...policies,
        residentialAssignment: {
          policyVersion: 'residential-assignment-v1',
          arrivalSelection: 'most-vacancies-then-location-id',
        },
      },
    );

    expect(firstProposal(binding.microPlanners, 'residential')).toMatchObject({
      commandType: 'AgentChooseResidence',
      payload: { locationId: 'residential-block' },
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

  test.each(['at-capacity', 'unreachable'] as const)(
    'reassesses locally instead of moving to a destination reported as %s',
    async (status) => {
      const agent = createAgent({
        agentId: agentA,
        locationId: asLocationId('residential-block'),
      });
      const baseDecisionContext = createSocietyDecisionContextForTest({
        agent,
        societyAgents: [],
      });
      const context = createRuntimeContext({
        agent,
        projection: createProjection({
          agents: [agent],
          locations: [residentialBlock(), school()],
          marketPools: [],
        }),
        worldDecisionContext: {
          ...baseDecisionContext,
          mobility: {
            policyVersion: 'town-spatial-graph-v2',
            destinations: [
              status === 'at-capacity'
                ? {
                    status,
                    locationId: 'school',
                    name: 'School',
                    kind: 'education',
                    capacity: 1,
                    capacityUsage: 1,
                  }
                : {
                    status,
                    locationId: 'school',
                    name: 'School',
                    kind: 'education',
                  },
            ],
          },
        },
      });
      const binding = await resolveCanonicalBinding(context);

      expect(firstProposal(binding.microPlanners, 'study')).toMatchObject({
        id: 'canonical-study-step-a-wait-for-access',
        commandType: 'AgentObserveLocation',
        availability: {
          status: 'blocked',
          reason: `destination school is ${status}`,
        },
        payload: { focus: 'Access conditions for School' },
        priority: 10,
      });
    },
  );

  test('proposes zero-duration first placement before an unplaced agent studies', async () => {
    const agent = createAgent({
      agentId: agentA,
      locationId: null,
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
      payload: { durationSeconds: 1800, educationRatePerSecond: 1 / 60 },
      priority: 10,
    });
  });

  test('caps autonomous study duration at the tagged education milestone', async () => {
    const agent = createAgent({
      agentId: agentA,
      educationScore: 0,
    });
    const context = createRuntimeContext({
      agent,
      activeObjective: {
        ...createObjective(agentA),
        statement: 'Study toward education score 13.',
        affinityTags: ['study', 'education', 'education-target-13'],
      },
    });
    const binding = await resolveCanonicalBinding(context);

    const proposal = firstProposal(binding.microPlanners, 'study');
    expect(proposal).toMatchObject({
      commandType: 'AgentStudy',
      payload: { durationSeconds: 780, educationRatePerSecond: 1 / 60 },
      resourceEstimate: { actionSeconds: 780 },
    });
    expect(proposal?.resourceEstimate?.currencyCost).toBeCloseTo(13 / 3);
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
        topic: 'employment opportunities and local application strategy',
        turns: [
          {
            speakerAgentId: agentA,
            utterance:
              'Could we compare notes about employment opportunities and local application strategy today?',
            intent: 'open-contextual-topic',
          },
          {
            speakerAgentId: agentC,
            utterance:
              'Gladly — your perspective on employment opportunities and local application strategy would help me too.',
            intent: 'invite-perspective',
          },
          {
            speakerAgentId: agentA,
            utterance:
              'Here is how employment opportunities and local application strategy fits my plans, but I would rather listen to you first.',
            intent: 'share-goal-and-listen',
          },
          {
            speakerAgentId: agentC,
            utterance:
              "I can help you find steadier ground; let's work together on employment opportunities and local application strategy.",
            intent: 'offer-help',
          },
          {
            speakerAgentId: agentA,
            utterance:
              'Thank you — I will share with you every lead I find about employment opportunities and local application strategy.',
            intent: 'reciprocate-support',
          },
          {
            speakerAgentId: agentC,
            utterance:
              "Let's stay in touch as employment opportunities and local application strategy develops.",
            intent: 'continue-relationship',
          },
        ],
      },
    });
  });

  test('selects a society-directory co-located Agent owned by another partition', async () => {
    const agent = createAgent({
      agentId: agentA,
      locationId: asLocationId('town-square'),
    });
    const remoteAgentId = asAgentId('agent-remote');
    const context = createRuntimeContext({
      agent,
      projection: createProjection({
        agents: [agent],
        locations: [townSquare()],
        marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
      }),
      worldDecisionContext: createSocietyDecisionContextForTest({
        agent,
        societyAgents: [
          {
            agentId: agentA,
            ownerPartitionKey: 'world-main',
            locationId: asLocationId('town-square'),
          },
          {
            agentId: remoteAgentId,
            ownerPartitionKey: 'world-harbor',
            locationId: asLocationId('town-square'),
            job: 'Farmer',
          },
          {
            agentId: asAgentId('agent-far'),
            ownerPartitionKey: 'world-harbor',
            locationId: asLocationId('market'),
          },
        ],
      }),
    });
    const binding = await resolveCanonicalBinding(context);

    expect(firstProposal(binding.microPlanners, 'social')).toMatchObject({
      commandType: 'AgentStartConversation',
      payload: {
        targetAgentId: remoteAgentId,
        turns: [
          { speakerAgentId: agentA },
          { speakerAgentId: remoteAgentId },
          { speakerAgentId: agentA },
          { speakerAgentId: remoteAgentId },
          { speakerAgentId: agentA },
          { speakerAgentId: remoteAgentId },
        ],
        planningContext: {
          policyVersion: 'contextual-social-planning-v1',
          targetSelection: {
            selectedAgentId: remoteAgentId,
            candidates: [{ agentId: remoteAgentId }],
          },
        },
      },
    });
  });

  test('keeps an observed local candidate ahead of a directory-only candidate', async () => {
    const agent = createAgent({
      agentId: agentA,
      locationId: asLocationId('town-square'),
    });
    const remoteAgentId = asAgentId('agent-remote');
    const context = createRuntimeContext({
      agent,
      projection: createProjection({
        agents: [agent, createAgent({ agentId: agentC, locationId: asLocationId('town-square') })],
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
        marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
      }),
      worldDecisionContext: createSocietyDecisionContextForTest({
        agent,
        societyAgents: [
          {
            agentId: remoteAgentId,
            ownerPartitionKey: 'world-harbor',
            locationId: asLocationId('town-square'),
          },
        ],
      }),
    });
    const binding = await resolveCanonicalBinding(context);
    const proposal = firstProposal(binding.microPlanners, 'social');
    if (proposal === undefined) {
      throw new Error('expected a social proposal');
    }

    expect(proposal).toMatchObject({
      commandType: 'AgentStartConversation',
      payload: { targetAgentId: agentC },
    });
    const payload = proposal.payload as {
      readonly planningContext: {
        readonly targetSelection: {
          readonly candidates: readonly { readonly agentId: AgentId }[];
        };
      };
    };
    expect(
      payload.planningContext.targetSelection.candidates.map((candidate) => candidate.agentId),
    ).toEqual(expect.arrayContaining([agentC, remoteAgentId]));
  });

  test('turns an explicit resource-help social objective into an authoritative peer transfer', async () => {
    const agent = createAgent({
      agentId: agentA,
      locationId: asLocationId('town-square'),
      inventory: { Apple: 3 },
    });
    const context = createRuntimeContext({
      agent,
      activeObjective: {
        ...createObjective(agentA),
        statement: 'Give food to a neighbor who needs help.',
        affinityTags: ['social', 'resource-help'],
      },
      projection: createProjection({
        agents: [agent, createAgent({ agentId: agentB, locationId: asLocationId('town-square') })],
        locations: [townSquare()],
        locationObservations: [
          {
            agentId: agentA,
            locationId: asLocationId('town-square'),
            locationName: 'Town Square',
            observedAgentIds: [agentB],
            activityAffinities: ['socialize'],
            observedAt: 100,
            focus: 'resource help',
          },
        ],
        marketPools: [],
      }),
    });
    const binding = await resolveCanonicalBinding(context);

    expect(firstProposal(binding.microPlanners, 'social')).toMatchObject({
      commandType: 'AgentGiveResource',
      payload: {
        targetAgentId: agentB,
        commodityName: 'Apple',
        quantity: 1,
      },
      resourceEstimate: { inventoryCosts: { Apple: 1 } },
    });
  });

  test('turns adverse social identity objectives into observation before engagement', async () => {
    const agent = createAgent({ agentId: agentA, locationId: asLocationId('town-square') });
    const context = createRuntimeContext({
      agent,
      activeObjective: {
        ...createObjective(agentA),
        statement: 'Observe the social setting and verify commitments before rebuilding trust.',
        affinityTags: ['social', 'social-caution', 'observe', 'verify-commitment'],
      },
      projection: createProjection({
        agents: [agent, createAgent({ agentId: agentB, locationId: asLocationId('town-square') })],
        locations: [townSquare()],
        locationObservations: [
          {
            agentId: agentA,
            locationId: asLocationId('town-square'),
            locationName: 'Town Square',
            observedAgentIds: [agentB],
            activityAffinities: ['socialize'],
            observedAt: 100,
          },
        ],
        marketPools: [],
      }),
    });
    const binding = await resolveCanonicalBinding(context);

    expect(firstProposal(binding.microPlanners, 'social')).toMatchObject({
      commandType: 'AgentObserveLocation',
      payload: { focus: 'Verify commitments and social context around agent-b.' },
    });
  });

  test('uses long-term social profile evidence to choose conversation target and topic', async () => {
    const agent = createAgent({
      agentId: agentA,
      locationId: asLocationId('town-square'),
      job: 'Cleaner',
    });
    const context = createRuntimeContext({
      agent,
      longTermProfile: {
        agentId: agentA,
        beliefs: [],
        habits: [],
        mood: [],
        values: [
          {
            key: 'community-cooperation',
            statement: 'Agent values cooperative community routines.',
            confidence: 0.9,
            updatedAt: 90,
            provenanceRecordIds: [asMemoryRecordId('memory-social-value-1')],
          },
        ],
        personality: [],
        socialRecords: [
          {
            key: 'agent-c',
            statement: 'Agent C is a trusted work partner.',
            confidence: 0.8,
            updatedAt: 80,
            provenanceRecordIds: [asMemoryRecordId('memory-social-agent-c-1')],
            relationDelta: 0.4,
            attitudeDelta: 0.3,
          },
        ],
      },
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
            observedAgentIds: [agentB, agentC],
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
      commandType: 'AgentStartConversation',
      payload: {
        targetAgentId: agentC,
        topic: 'community cooperation',
        turns: [
          {
            speakerAgentId: agentA,
            utterance: 'I hoped we could compare notes about community cooperation.',
            intent: 'open-contextual-topic',
          },
          {
            speakerAgentId: agentC,
            utterance: 'Of course — I am curious about your perspective on community cooperation.',
            intent: 'invite-perspective',
          },
          {
            speakerAgentId: agentA,
            utterance:
              'My plans touch community cooperation, and I want to listen to you before I decide.',
            intent: 'share-goal-and-listen',
          },
          {
            speakerAgentId: agentC,
            utterance: "Let's work together on community cooperation.",
            intent: 'cooperate',
          },
          {
            speakerAgentId: agentA,
            utterance:
              'I can help with what I know, and I will share with you whatever I learn about community cooperation.',
            intent: 'coordinate',
          },
          {
            speakerAgentId: agentC,
            utterance: 'We should keep each other informed about community cooperation.',
            intent: 'continue-relationship',
          },
        ],
      },
    });
  });

  test('steers the deterministic dialogue toward repair when the existing relation is strained', async () => {
    const agent = createAgent({
      agentId: agentA,
      locationId: asLocationId('town-square'),
      job: 'Cleaner',
    });
    const context = createRuntimeContext({
      agent,
      projection: createProjection({
        agents: [
          agent,
          createAgent({ agentId: agentC, locationId: asLocationId('town-square'), job: 'Cook' }),
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
        marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
        socialRelations: [
          {
            sourceAgentId: agentA,
            targetAgentId: agentC,
            relationScore: -0.2,
            attitudeScore: -0.1,
            relationLabel: 'strained',
            interactionCount: 2,
            lastInteractionSummary: 'Argued about stall prices last week.',
          },
        ],
      }),
    });
    const binding = await resolveCanonicalBinding(context);

    const proposal = firstProposal(binding.microPlanners, 'social');
    if (proposal === undefined) {
      throw new Error('expected a canonical social proposal');
    }
    expect(proposal.commandType).toBe('AgentStartConversation');
    const turns = (
      proposal.payload as {
        readonly turns: readonly {
          readonly speakerAgentId: AgentId;
          readonly utterance: string;
          readonly intent?: string;
        }[];
      }
    ).turns;
    expect(turns).toHaveLength(6);
    expect(turns[3]).toMatchObject({
      speakerAgentId: agentC,
      intent: 'acknowledge-strain',
      utterance: 'Things have been tense between us, so I appreciate you bringing this up.',
    });
    expect(turns[4]).toMatchObject({
      speakerAgentId: agentA,
      intent: 'apologize-make-amends',
      utterance: 'I apologize for my part in it, and I want to make amends between us.',
    });
    expect(turns[5]?.speakerAgentId).toBe(agentC);
  });

  test('ranks observed social targets by goal relevance and economic complementarity with traceable scores', async () => {
    const actor = createAgent({
      agentId: agentA,
      job: null,
      balance: 20,
      educationScore: 10,
      locationId: asLocationId('town-square'),
    });
    const context = createRuntimeContext({
      agent: actor,
      activeObjective: createStockClerkObjective(agentA),
      projection: createProjection({
        agents: [
          actor,
          createAgent({
            agentId: agentB,
            job: null,
            educationScore: 0,
            locationId: asLocationId('town-square'),
          }),
          createAgent({
            agentId: agentC,
            job: 'Stock Clerk',
            educationScore: 110,
            locationId: asLocationId('town-square'),
          }),
        ],
        locations: [townSquare()],
        locationObservations: [
          {
            agentId: agentA,
            locationId: asLocationId('town-square'),
            locationName: 'Town Square',
            observedAgentIds: [agentB, agentC],
            activityAffinities: ['socialize'],
            observedAt: 100,
            focus: 'employment board',
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
      commandType: 'AgentStartConversation',
      payload: {
        targetAgentId: agentC,
        topic: 'employment opportunities and local application strategy',
        planningContext: {
          policyVersion: 'contextual-social-planning-v1',
          targetSelection: {
            selectedAgentId: agentC,
            candidates: [
              {
                agentId: agentC,
                score: {
                  goalRelevance: 1.875,
                  economicNeed: 1.5,
                  worldContext: 0.5,
                  total: 3.875,
                },
              },
              {
                agentId: agentB,
                score: { goalRelevance: 0, economicNeed: 0, worldContext: 0.5, total: 0.5 },
              },
            ],
            tieBreak: 'agent-id-ascending',
          },
          topicSelection: {
            source: 'economic-need',
            rationale: 'agent is currently unemployed',
          },
        },
      },
    });
  });

  test('uses extroverted personality evidence to prefer an observed novel contact', async () => {
    const actor = createAgent({
      agentId: agentA,
      job: 'Cleaner',
      locationId: asLocationId('town-square'),
    });
    const context = createRuntimeContext({
      agent: actor,
      longTermProfile: {
        agentId: agentA,
        beliefs: [],
        habits: [],
        mood: [],
        values: [],
        personality: [
          {
            key: 'extroverted',
            statement: 'Agent is sociable and enjoys meeting new people.',
            confidence: 0.9,
            updatedAt: 90,
            provenanceRecordIds: [asMemoryRecordId('memory-personality-extroverted-1')],
          },
        ],
        socialRecords: [
          {
            key: 'agent-c',
            statement: 'Agent C is already known.',
            confidence: 0,
            updatedAt: 80,
            provenanceRecordIds: [asMemoryRecordId('memory-social-agent-c-known-1')],
            relationDelta: 0,
            attitudeDelta: 0,
          },
        ],
      },
      projection: createProjection({
        agents: [
          actor,
          createAgent({
            agentId: agentB,
            job: null,
            locationId: asLocationId('town-square'),
          }),
          createAgent({
            agentId: agentC,
            job: null,
            locationId: asLocationId('town-square'),
          }),
        ],
        locations: [townSquare()],
        locationObservations: [
          {
            agentId: agentA,
            locationId: asLocationId('town-square'),
            locationName: 'Town Square',
            observedAgentIds: [agentB, agentC],
            activityAffinities: ['socialize'],
            observedAt: 100,
            focus: 'community introductions',
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
      commandType: 'AgentStartConversation',
      payload: {
        targetAgentId: agentB,
        planningContext: {
          targetSelection: {
            selectedAgentId: agentB,
            candidates: [
              { agentId: agentB, score: { personalityFit: 0.75, total: 1.25 } },
              { agentId: agentC, score: { personalityFit: 0, total: 0.5 } },
            ],
          },
        },
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

  test('applies education-driven production efficiency policy to resource estimates', async () => {
    const agent = {
      ...createAgent({ agentId: agentA, educationScore: 0, inventory: { Wood: 1 } }),
      physiology: { energy: 100, satiety: 100, health: 100 },
    };
    const context = createRuntimeContext({
      agent,
      activeObjective: createBookProductionObjective(agentA),
      planRecord: createBookProductionPlanRecord(agentA),
    });
    const binding = await resolveCanonicalBinding(
      context,
      { production: { commodityName: 'Book', quantity: 1, availableLaborSeconds: 4 } },
      {
        ...policies,
        production: {
          efficiency: {
            minEfficiency: 0.5,
            educationScoreForMaxEfficiency: 500,
          },
        },
      },
    );

    expect(firstProposal(binding.microPlanners, 'production')).toMatchObject({
      commandType: 'AgentProduce',
      payload: { commodityName: 'Book', quantity: 1, availableLaborSeconds: 4 },
      resourceEstimate: {
        actionSeconds: 3.2,
        energyCost: 64,
        satietyCost: 16,
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
      requirePlanner(binding.microPlanners, 'residential').propose(
        createMicroPlannerInput({
          agentId: context.agentId,
          plan: context.planRecord.plan,
          selectedSubtask: selected,
        }),
      )[0],
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
  runtimePolicies: WorldCommandPolicies = policies,
) {
  const resolver = createDomainRuntimeResolver({
    registrations: createCanonicalDomainRuntimeRegistrations(config, runtimePolicies),
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
  return requirePlanner(planners, domain).propose(
    createMicroPlannerInput({ selectedSubtask: selectedSubtask(domain) }),
  )[0];
}

function createMicroPlannerInput(input: {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly agentId?: AgentId;
  readonly plan?: BranchPlan;
}): DomainMicroPlannerInput {
  return {
    agentId: input.agentId ?? agentA,
    issuedAt: 0,
    plan: input.plan ?? createSingleSubtaskPlan(input.selectedSubtask),
    selectedSubtask: input.selectedSubtask,
    signals: [],
  };
}

function createSingleSubtaskPlan(selectedSubtask: PrioritizedSubtask): BranchPlan {
  return createBranchPlan({
    objective: 'test planner proposal',
    branches: [
      {
        id: selectedSubtask.branchId,
        objective: selectedSubtask.description,
        subtasks: [
          {
            id: selectedSubtask.subtaskId,
            description: selectedSubtask.description,
            basePriority: selectedSubtask.score,
          },
        ],
      },
    ],
  });
}

type WorkerResolverTestContext = {
  readonly agentId: AgentId;
  readonly agent: WorldAgentState;
  readonly projection: WorldProjection;
  readonly activeObjective: LongHorizonObjective;
  readonly planRecord: BranchPlanRecord;
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
};

function createRuntimeContext(input: {
  readonly agent: WorldAgentState;
  readonly projection?: WorldProjection;
  readonly activeObjective?: LongHorizonObjective;
  readonly planRecord?: BranchPlanRecord;
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
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
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  };
}

function createSocietyDecisionContextForTest(input: {
  readonly agent: WorldAgentState;
  readonly societyAgents: readonly {
    readonly agentId: AgentId;
    readonly ownerPartitionKey: string;
    readonly locationId: LocationId | null;
    readonly job?: string | null;
    readonly educationScore?: number;
  }[];
}): WorldDecisionContext {
  return {
    agent: {
      agentId: input.agent.agentId,
      locationId: input.agent.locationId,
      physiology: { ...input.agent.physiology },
      educationScore: input.agent.educationScore,
      balance: input.agent.balance,
      residentialTier: input.agent.residentialTier,
      job: input.agent.job,
      inventory: { ...input.agent.inventory },
    },
    market: { spotPrices: [] },
    society: {
      directoryId: `local-simulation-society-directory:sha256:${'d'.repeat(64)}`,
      simulationId: 'sim-1',
      partitionBoundaries: [],
      agents: input.societyAgents.map((entry) => ({
        agentId: entry.agentId,
        ownerPartitionKey: entry.ownerPartitionKey,
        ownerLastAppliedSequence: 0,
        locationId: entry.locationId,
        job: entry.job ?? null,
        residentialTier: 1,
        educationScore: entry.educationScore ?? 0,
      })),
    },
  };
}

function createMatterDecisionContextForTest(
  agent: WorldAgentState,
  matters: NonNullable<WorldDecisionContext['matters']>,
): WorldDecisionContext {
  return {
    agent: {
      agentId: agent.agentId,
      locationId: agent.locationId,
      physiology: { ...agent.physiology },
      educationScore: agent.educationScore,
      balance: agent.balance,
      residentialTier: agent.residentialTier,
      job: agent.job,
      inventory: { ...agent.inventory },
    },
    market: { spotPrices: [] },
    matters,
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
    readonly regionId?: string;
  }[];
  readonly marketPools: readonly {
    readonly commodity: string;
    readonly commodityReserve: number;
    readonly currencyReserve: number;
    readonly regionId?: string;
  }[];
  readonly treasury?: number;
  readonly educationExamApplications?: readonly WorldEducationExamApplicationState[];
  readonly locationObservations?: readonly WorldLocationObservationState[];
  readonly socialRelations?: readonly SocialRelationState[];
  readonly bank?: WorldBankState;
  readonly enterprises?: readonly WorldEnterpriseState[];
}): WorldProjection {
  return createWorldProjection({
    agents: input.agents,
    ...(input.bank === undefined ? {} : { bank: input.bank }),
    ...(input.enterprises === undefined ? {} : { enterprises: input.enterprises }),
    ...(input.locations === undefined ? {} : { locations: input.locations }),
    ...(input.locationObservations === undefined
      ? {}
      : { locationObservations: input.locationObservations }),
    ...(input.socialRelations === undefined ? {} : { socialRelations: input.socialRelations }),
    ...(input.treasury === undefined ? {} : { treasury: input.treasury }),
    ...(input.educationExamApplications === undefined
      ? {}
      : { educationExamApplications: input.educationExamApplications }),
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
  readonly educationLevel?: WorldAgentState['educationLevel'];
  readonly balance?: number;
  readonly physiology?: WorldAgentState['physiology'];
}): WorldAgentState {
  return {
    agentId: input.agentId,
    locationId: input.locationId ?? null,
    physiology: input.physiology ?? { energy: 50, satiety: 50, health: 100 },
    educationScore: input.educationScore ?? 0,
    balance: input.balance ?? 1000,
    residentialTier: input.residentialTier ?? 1,
    job: input.job ?? null,
    inventory: input.inventory ?? { Book: 3, Wood: 1 },
    ...(input.educationLevel === undefined ? {} : { educationLevel: input.educationLevel }),
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
