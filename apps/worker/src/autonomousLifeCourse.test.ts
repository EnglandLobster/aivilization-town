import { createCommodityMarketPoolSeeds } from '@aivilization/content';
import { asAgentId } from '@aivilization/sim-core';
import { createWorldProjection, type WorldAgentState } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createAivilizationWorldCommandPolicies,
  createAutonomousLifeCourseCandidates,
  createDefaultAutonomousObjectiveProposal,
  createWorldDecisionContextFromProjection,
} from './index';

describe('canonical autonomous life-course policy', () => {
  test('chooses an explicit eligible occupation instead of the generic Cleaner fallback', () => {
    const selectedOccupations = new Set<string>();
    for (let index = 1; index <= 32; index += 1) {
      const agent = createAgent({
        agentId: asAgentId(`career-agent-${index}`),
        educationScore: 80,
        balance: 500,
      });
      const proposal = createProposal({ agent });
      expect(proposal.decisionTrace.selectedCandidateId).toMatch(/^occupation-application:/u);
      selectedOccupations.add(
        proposal.decisionTrace.selectedCandidateId.replace('occupation-application:', ''),
      );
    }

    expect(selectedOccupations).toEqual(new Set(['Cleaner', 'Waiter']));
  });

  test('acquires the residential prerequisite and then upgrades on the next objective', () => {
    const agent = createAgent({ educationScore: 80, balance: 500 });
    const pendingApplication = createPendingApplication(agent);
    const acquisition = createProposal({ agent, jobApplications: [pendingApplication] });

    expect(acquisition.objective).toMatchObject({
      statement: 'Buy 1 Beef from the town market.',
      affinityTags: ['trade', 'market', 'buy', 'Beef', 'progression'],
    });
    expect(acquisition.decisionTrace.selectedCandidateId).toBe('residential-prerequisite:2:Beef');

    const readyAgent = { ...agent, inventory: { Beef: 1 } };
    const upgrade = createProposal({
      agent: readyAgent,
      jobApplications: [createPendingApplication(readyAgent)],
    });
    expect(upgrade.objective).toMatchObject({
      statement: 'Upgrade residential tier to 2.',
      affinityTags: ['residential', 'housing', 'home', 'upgrade', 'tier-2'],
    });
    expect(upgrade.decisionTrace.selectedCandidateId).toBe('residential-upgrade:2');
  });

  test('produces market supply when education and liquidity block immediate progression', () => {
    const agent = createAgent({ educationScore: 0, balance: 20 });
    const proposal = createProposal({
      agent,
      jobApplications: [createPendingApplication(agent)],
    });

    expect(proposal.decisionTrace.selectedCandidateId).toMatch(/^profitable-production:/u);
    expect(proposal.objective.affinityTags).toEqual(
      expect.arrayContaining(['production', 'produce', 'market']),
    );
    expect(proposal.objective.statement).toMatch(/^Produce /u);
  });

  test('prices study against only the time needed for the next education milestone', () => {
    const agent = createAgent({ educationScore: 0, balance: 55 });
    const proposal = createProposal({
      agent,
      jobApplications: [createPendingApplication(agent)],
    });

    expect(proposal.decisionTrace).toMatchObject({
      selectedCandidateId: 'education-investment:13',
    });
    expect(proposal.decisionTrace.rationale).toContain(
      'a 780-second study action adds at most 13 education',
    );
    expect(proposal.objective.affinityTags).toContain('education-target-13');
  });

  test('prepares a higher-tier prerequisite before reapplying to an entry occupation', () => {
    const agent = createAgent({
      residentialTier: 2,
      educationScore: 20,
      balance: 150,
    });
    const proposal = createProposal({ agent });

    expect(proposal.decisionTrace.selectedCandidateId).toBe(
      'occupation-prerequisite:Stock Clerk:Beef',
    );
    expect(proposal.objective).toMatchObject({
      statement: 'Buy 1 Beef from the town market.',
      affinityTags: ['trade', 'market', 'buy', 'Beef', 'progression'],
    });
  });

  test('continues prerequisite preparation while a lower-tier application consumes quota', () => {
    const agent = createAgent({
      residentialTier: 2,
      educationScore: 20,
      balance: 150,
    });
    const proposal = createProposal({
      agent,
      jobApplications: [createPendingApplication(agent)],
    });

    expect(proposal.decisionTrace.selectedCandidateId).toBe(
      'occupation-prerequisite:Stock Clerk:Beef',
    );
  });

  test('liquidates only prerequisite surplus while an application quota blocks career progression', () => {
    const agent = createAgent({
      residentialTier: 3,
      educationScore: 160,
      balance: 0,
      inventory: { Sushi: 2 },
    });
    const sale = createProposal({
      agent,
      jobApplications: createPendingApplications(agent, 3),
    });

    expect(sale.decisionTrace.selectedCandidateId).toBe('inventory-sale:Sushi');
    expect(sale.objective.statement).toBe(
      'Sell one Sushi through the town market to realize production income.',
    );

    const reserved = createProposal({
      agent: { ...agent, inventory: { Sushi: 1 } },
      jobApplications: createPendingApplications(agent, 3),
    });
    expect(reserved.decisionTrace.selectedCandidateId).toBe('progression-supply:Sushi');
  });

  test('creates higher-tier prerequisite supply candidates through the production chain', () => {
    const agent = createAgent({
      residentialTier: 5,
      educationScore: 500,
      balance: 500,
      job: 'Doctor',
    });
    const projection = createProjection(agent);
    const context = createWorldDecisionContextFromProjection({
      projection,
      agentId: agent.agentId,
      policies: createAivilizationWorldCommandPolicies('life-course-test')(projection),
    });

    const candidate = createAutonomousLifeCourseCandidates({
      agent,
      worldDecisionContext: context,
    }).find((entry) => entry.id === 'progression-supply:Transistor');

    expect(candidate).toMatchObject({
      id: 'progression-supply:Transistor',
    });
    expect(candidate?.affinityTags).toEqual(
      expect.arrayContaining(['production', 'supply', 'Transistor']),
    );
  });
});

function createProposal(input: {
  readonly agent: WorldAgentState;
  readonly jobApplications?: readonly ReturnType<typeof createPendingApplication>[];
}) {
  const projection = createProjection(input.agent, input.jobApplications);
  const policies = createAivilizationWorldCommandPolicies('life-course-test')(projection);
  return createDefaultAutonomousObjectiveProposal({
    agentId: input.agent.agentId,
    agent: input.agent,
    projection,
    intentionState: {
      agentId: input.agent.agentId,
      completedObjectives: [],
      scheduledIntentions: [],
      updatedAt: 0,
    },
    longTermProfile: {
      agentId: input.agent.agentId,
      beliefs: [],
      habits: [],
      mood: [],
      values: [],
      personality: [],
      socialRecords: [],
    },
    shortTermMemoryContext: [],
    issuedAt: 0,
    worldDecisionContext: createWorldDecisionContextFromProjection({
      projection,
      agentId: input.agent.agentId,
      policies,
    }),
  });
}

function createProjection(
  agent: WorldAgentState,
  jobApplications: readonly ReturnType<typeof createPendingApplication>[] = [],
) {
  return createWorldProjection({
    agents: [agent],
    marketPools: createCommodityMarketPoolSeeds({
      commodityReserve: 100,
      currencyReserve: 1_000,
    }),
    jobApplications,
  });
}

function createAgent(overrides: Partial<WorldAgentState> = {}): WorldAgentState {
  return {
    agentId: asAgentId('career-agent'),
    physiology: { energy: 100, satiety: 100, health: 100 },
    educationScore: 80,
    balance: 500,
    residentialTier: 1,
    job: null,
    inventory: {},
    locationId: null,
    ...overrides,
  };
}

function createPendingApplication(agent: WorldAgentState) {
  return {
    applicationId: `pending-${agent.agentId}`,
    cycleNumber: 0,
    agentId: agent.agentId,
    occupationName: 'Cleaner',
    residentialTier: agent.residentialTier,
    educationScore: agent.educationScore,
    submittedAt: 0,
    status: 'pending' as const,
  };
}

function createPendingApplications(agent: WorldAgentState, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...createPendingApplication(agent),
    applicationId: `pending-${agent.agentId}-${index}`,
  }));
}
