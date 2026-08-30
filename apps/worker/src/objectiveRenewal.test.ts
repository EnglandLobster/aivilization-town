import {
  createBranchPlan,
  InMemoryBranchPlanRepository,
  InMemoryBranchPlanProgressRepository,
  type StrategicPlanCompilerInput,
} from '@aivilization/agent-runtime';
import {
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  asMemoryRecordId,
  createShortTermMemoryRecord,
  type LongHorizonObjective,
  type LongTermAgentProfile,
  type ScheduledIntention,
} from '@aivilization/memory';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldAgentState,
  type WorldCommandPolicies,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createDefaultAutonomousObjective,
  createDefaultAutonomousObjectiveProposal,
  createWorldDecisionContextFromProjection,
  renewMissingActiveObjectives,
} from './index';

const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');

describe('worker objective renewal', () => {
  test('proposes a deterministic study objective for low-education agents', () => {
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);

    expect(
      createDefaultAutonomousObjective({
        agentId: agentA,
        agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
        projection,
        intentionState: {
          agentId: agentA,
          completedObjectives: [],
          scheduledIntentions: [],
          updatedAt: 0,
        },
        longTermProfile: createProfile(agentA),
        shortTermMemoryContext: [],
        issuedAt: 100,
      }),
    ).toEqual({
      id: 'auto-objective-agent-a-100-1',
      agentId: agentA,
      statement: 'Improve education to qualify for better town opportunities.',
      priority: 2,
      source: 'agent',
      affinityTags: ['study', 'education'],
      createdAt: 100,
      updatedAt: 100,
    });
  });

  test('keeps autonomous objective IDs unique across zero-interval ticks sharing one timestamp', () => {
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);
    const agent = projection.agents[agentA] ?? createAgent({ agentId: agentA });
    const first = createDefaultAutonomousObjective({
      agentId: agentA,
      agent,
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 100,
    });
    const second = createDefaultAutonomousObjective({
      agentId: agentA,
      agent,
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [
          {
            objective: first,
            completedAt: 100,
            reason: 'plan-completed',
            planId: first.id,
          },
        ],
        scheduledIntentions: [],
        updatedAt: 100,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 100,
    });

    expect([first.id, second.id]).toEqual([
      'auto-objective-agent-a-100-1',
      'auto-objective-agent-a-100-2',
    ]);

    const afterCompaction = createDefaultAutonomousObjective({
      agentId: agentA,
      agent,
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [
          {
            objective: second,
            completedAt: 100,
            reason: 'plan-completed',
            planId: second.id,
          },
        ],
        completedObjectiveCount: 100,
        scheduledIntentions: [],
        updatedAt: 100,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 100,
    });
    expect(afterCompaction.id).toBe('auto-objective-agent-a-100-101');
  });

  test('balances education against direct costs, foregone income, and the minimum reserve', () => {
    const policies = createEducationOpportunityCostPolicies();
    const investProjection = createProjection([
      createAgent({ agentId: agentA, educationScore: 12, balance: 100 }),
    ]);
    const investAgent = investProjection.agents[agentA] ?? createAgent({ agentId: agentA });
    const investObjective = createDefaultAutonomousObjective({
      agentId: agentA,
      agent: investAgent,
      projection: investProjection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 100,
      worldDecisionContext: createWorldDecisionContextFromProjection({
        projection: investProjection,
        agentId: agentA,
        policies,
      }),
    });

    expect(investObjective).toMatchObject({
      statement:
        'Balance education investment with immediate income to qualify for better town opportunities.',
      affinityTags: ['study', 'education', 'work', 'income'],
    });

    const earnProjection = createProjection([
      createAgent({ agentId: agentA, educationScore: 12, balance: 20 }),
    ]);
    const earnAgent = earnProjection.agents[agentA] ?? createAgent({ agentId: agentA });
    const earnProposal = createDefaultAutonomousObjectiveProposal({
      agentId: agentA,
      agent: earnAgent,
      projection: earnProjection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 100,
      worldDecisionContext: createWorldDecisionContextFromProjection({
        projection: earnProjection,
        agentId: agentA,
        policies,
      }),
    });

    expect(earnProposal.objective).toMatchObject({
      statement: 'Earn enough money to stay economically stable.',
      affinityTags: ['work', 'income'],
    });
    expect(earnProposal.decisionTrace).toMatchObject({
      selectedCandidateId: 'income-stability',
    });
  });

  test('creates deterministic buy/sell market objectives from live prices and inventory', () => {
    const buyer = createAgent({ agentId: agentA, educationScore: 150, balance: 200 });
    const buyProjection = createWorldProjection({
      agents: [buyer],
      marketPools: [
        { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 },
        { commodity: 'Book', commodityReserve: 100, currencyReserve: 1_000 },
      ],
    });
    const buyProposal = createDefaultAutonomousObjectiveProposal({
      agentId: agentA,
      agent: buyer,
      projection: buyProjection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 100,
      worldDecisionContext: createWorldDecisionContextFromProjection({
        projection: buyProjection,
        agentId: agentA,
      }),
    });

    expect(buyProposal.objective.statement).toMatch(
      /^Buy one (Apple|Book) through the town market/u,
    );
    expect(buyProposal.objective.affinityTags).toContain('trade');
    expect(buyProposal.objective.affinityTags).toContain('market');
    expect(buyProposal.objective.affinityTags).toContain('buy');
    expect(buyProposal.decisionTrace.selectedCandidateId).toBe('market-participation-buy');

    const seller = { ...buyer, inventory: { Book: 2 } };
    const sellProjection = createWorldProjection({
      agents: [seller],
      marketPools: [
        { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 },
        { commodity: 'Book', commodityReserve: 100, currencyReserve: 1_000 },
      ],
    });
    const sellProposal = createDefaultAutonomousObjectiveProposal({
      agentId: agentA,
      agent: seller,
      projection: sellProjection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 200,
      worldDecisionContext: createWorldDecisionContextFromProjection({
        projection: sellProjection,
        agentId: agentA,
      }),
    });

    expect(sellProposal.objective).toMatchObject({
      statement: 'Sell one Book through the town market while preserving economic stability.',
      affinityTags: ['trade', 'market', 'sell', 'Book'],
    });
    expect(sellProposal.decisionTrace).toMatchObject({
      selectedCandidateId: 'market-participation-sell',
      score: 12,
    });
  });

  test('creates an autonomous owner objective for a strictly advantageous enterprise external trade', () => {
    const owner = createAgent({ agentId: agentA, educationScore: 500, balance: 100 });
    const projection = createWorldProjection({
      agents: [owner],
      enterprises: [
        {
          enterpriseId: 'bakery',
          name: 'Bakery',
          ownerAgentId: agentA,
          occupationName: 'Baker',
          balance: 100,
          inventory: { Apple: 2 },
          maxEmployees: 3,
          employeeAgentIds: [],
          status: 'active',
          foundedAt: 0,
          cumulativeSales: 0,
          cumulativePurchases: 0,
          cumulativeWages: 0,
        },
      ],
      marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 }],
    });
    const policies: WorldCommandPolicies = {
      ...createRulesPolicies(),
      externalTrade: {
        policyVersion: 'test-external-trade-v1',
        balanceDecayRatioPerCadence: 0.01,
        cadenceMs: 1_000,
        priceImpactRatio: 0.2,
        balanceScale: 50,
        source: 'objective renewal external trade test',
      },
    };
    const proposal = createDefaultAutonomousObjectiveProposal({
      agentId: agentA,
      agent: owner,
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 100,
      worldDecisionContext: createWorldDecisionContextFromProjection({
        projection,
        agentId: agentA,
        policies,
      }),
    });

    expect(proposal.objective).toMatchObject({
      statement:
        'Export one Apple for Bakery through the external market while its quote beats the town market.',
      affinityTags: ['trade', 'market', 'sell', 'external', 'enterprise', 'Apple'],
      planningDomains: ['trade'],
    });
    expect(proposal.decisionTrace).toMatchObject({
      selectedCandidateId: 'enterprise-external-export',
      score: 85,
    });
  });

  test('renews missing active objectives and saves durable branch plans', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createProjection([
      createAgent({ agentId: agentA, educationScore: 12 }),
      createAgent({ agentId: agentB, educationScore: 50 }),
    ]);
    const existingObjective = createObjective(agentB, 'objective-existing');
    await intentionRepository.setObjective(agentB, existingObjective);

    await expect(
      renewMissingActiveObjectives({
        projection,
        intentionRepository,
        longTermProfileRepository,
        shortTermMemoryRepository,
        planRepository,
        issuedAt: 100,
      }),
    ).resolves.toEqual([
      {
        agentId: agentA,
        objectiveId: 'auto-objective-agent-a-100-1',
        planId: 'auto-objective-agent-a-100-1',
        decisionTrace: {
          agentId: agentA,
          objectiveId: 'auto-objective-agent-a-100-1',
          selectedCandidateId: 'education-growth',
          rationale: 'Education score is below the threshold for better town opportunities.',
          score: 40.88,
          shortTermMemoryContextIds: [],
          profileEntryKeys: [],
          profileEvidenceRecordIds: [],
          issuedAt: 100,
        },
      },
    ]);
    await expect(intentionRepository.getOrCreate(agentA)).resolves.toMatchObject({
      activeObjective: {
        id: 'auto-objective-agent-a-100-1',
        statement: 'Improve education to qualify for better town opportunities.',
      },
    });
    await expect(
      planRepository.require({
        planId: 'auto-objective-agent-a-100-1',
        agentId: agentA,
      }),
    ).resolves.toMatchObject({
      planId: 'auto-objective-agent-a-100-1',
      agentId: agentA,
      plan: {
        objective: 'Improve education to qualify for better town opportunities.',
      },
      createdAt: 100,
      updatedAt: 100,
    });
    await expect(intentionRepository.getOrCreate(agentB)).resolves.toMatchObject({
      activeObjective: existingObjective,
    });
  });

  test('uses recent failed memories to recover before pursuing education growth', () => {
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);

    const objective = createDefaultAutonomousObjective({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [
        createMemory({
          id: 'memory-work-failed',
          agentId: agentA,
          status: 'failed',
          summary: 'Work failed because the agent was too tired and low on energy.',
          tags: ['work', 'failed', 'energy'],
          importanceScore: 0.95,
        }),
      ],
      issuedAt: 100,
    });

    expect(objective).toMatchObject({
      id: 'auto-objective-agent-a-100-1',
      agentId: agentA,
      statement: 'Recover from recent setbacks before pursuing new growth.',
      priority: 3,
      source: 'agent',
      affinityTags: ['recover', 'maintain', 'sleep', 'energy'],
    });
  });

  test('uses recent hunger failures to recover through satiety affinity', () => {
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);

    const objective = createDefaultAutonomousObjective({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [
        createMemory({
          id: 'memory-hungry-failed',
          agentId: agentA,
          status: 'failed',
          summary: 'Production failed because the agent was hungry and low on satiety.',
          tags: ['production', 'failed', 'hungry', 'satiety'],
          importanceScore: 0.95,
        }),
      ],
      issuedAt: 100,
    });

    expect(objective).toMatchObject({
      statement: 'Recover from recent setbacks before pursuing new growth.',
      affinityTags: ['recover', 'maintain', 'eat', 'satiety'],
    });
  });

  test('proposes physiology maintenance with satiety affinity for hungry agents', () => {
    const projection = createProjection([
      createAgent({ agentId: agentA, educationScore: 150, balance: 200, satiety: 10 }),
    ]);

    const objective = createDefaultAutonomousObjective({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 100,
    });

    expect(objective).toMatchObject({
      statement: 'Recover satiety before pursuing growth.',
      affinityTags: ['maintain', 'eat', 'satiety'],
    });
  });

  test('explains recent failed memory recovery objective decisions', () => {
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);

    const proposal = createDefaultAutonomousObjectiveProposal({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [
        createMemory({
          id: 'memory-work-failed',
          agentId: agentA,
          status: 'failed',
          summary: 'Work failed because the agent was too tired and low on energy.',
          tags: ['work', 'failed', 'energy'],
          importanceScore: 0.95,
        }),
      ],
      issuedAt: 100,
    });

    expect(proposal.objective).toMatchObject({
      id: 'auto-objective-agent-a-100-1',
      statement: 'Recover from recent setbacks before pursuing new growth.',
    });
    expect(proposal.decisionTrace).toEqual({
      agentId: agentA,
      objectiveId: 'auto-objective-agent-a-100-1',
      selectedCandidateId: 'recent-setback-recovery',
      rationale: 'Recent failed memory suggests recovery before new growth.',
      score: 83.5,
      shortTermMemoryContextIds: ['memory-work-failed'],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
      issuedAt: 100,
    });
  });

  test('can choose a profile-aligned routine when no urgent pressure exists', () => {
    const projection = createProjection([
      createAgent({
        agentId: agentA,
        educationScore: 150,
        balance: 200,
      }),
    ]);

    const objective = createDefaultAutonomousObjective({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA, {
        habits: [
          {
            key: 'creative-routine',
            statement: 'Keeps a creative studio routine after basic needs are stable.',
            confidence: 0.9,
            updatedAt: 80,
            provenanceRecordIds: [],
          },
        ],
      }),
      shortTermMemoryContext: [],
      issuedAt: 100,
    });

    expect(objective).toMatchObject({
      id: 'auto-objective-agent-a-100-1',
      agentId: agentA,
      statement: 'Maintain a creative routine aligned with long-term profile.',
      priority: 1,
      source: 'agent',
      affinityTags: ['maintain', 'routine', 'profile', 'creative'],
    });
  });

  test('explains profile-aligned routine decisions with profile provenance', () => {
    const projection = createProjection([
      createAgent({
        agentId: agentA,
        educationScore: 150,
        balance: 200,
      }),
    ]);

    const proposal = createDefaultAutonomousObjectiveProposal({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA, {
        habits: [
          {
            key: 'creative-routine',
            statement: 'Keeps a creative studio routine after basic needs are stable.',
            confidence: 0.9,
            updatedAt: 80,
            provenanceRecordIds: [
              asMemoryRecordId('reflection-creative-1'),
              asMemoryRecordId('reflection-creative-2'),
            ],
          },
        ],
      }),
      shortTermMemoryContext: [],
      issuedAt: 100,
    });

    expect(proposal.objective).toMatchObject({
      id: 'auto-objective-agent-a-100-1',
      statement: 'Maintain a creative routine aligned with long-term profile.',
    });
    expect(proposal.decisionTrace).toEqual({
      agentId: agentA,
      objectiveId: 'auto-objective-agent-a-100-1',
      selectedCandidateId: 'profile-creative',
      rationale: 'Long-term profile suggests maintaining a creative routine.',
      score: 24,
      shortTermMemoryContextIds: [],
      profileEntryKeys: ['creative-routine'],
      profileEvidenceRecordIds: ['reflection-creative-1', 'reflection-creative-2'],
      issuedAt: 100,
    });
  });

  test('excludes corrected beliefs from profile-driven objective assertions', () => {
    const projection = createProjection([
      createAgent({
        agentId: agentA,
        educationScore: 150,
        balance: 200,
      }),
    ]);
    const belief = {
      key: 'social-knowledge:agent-b:studio-scene',
      statement: 'agent-b asserted about studio scene: "Everyone is creative." (unverified).',
      confidence: 0.9,
      updatedAt: 80,
      provenanceRecordIds: [asMemoryRecordId('claim-1')],
    };
    const baseInput = {
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      shortTermMemoryContext: [],
      issuedAt: 100,
    } as const;

    // An influencing hearsay belief still asserts into a routine candidate.
    const influencing = createDefaultAutonomousObjectiveProposal({
      ...baseInput,
      longTermProfile: createProfile(agentA, {
        beliefs: [
          {
            ...belief,
            provenance: { kind: 'hearsay', status: 'influencing' },
          },
        ],
      }),
    });
    expect(influencing.decisionTrace.selectedCandidateId).toBe('profile-creative');

    // Once corrected, the same belief stays durable but stops asserting.
    const corrected = createDefaultAutonomousObjectiveProposal({
      ...baseInput,
      longTermProfile: createProfile(agentA, {
        beliefs: [
          {
            ...belief,
            provenance: {
              kind: 'hearsay',
              status: 'corrected',
              correctedByRecordId: asMemoryRecordId('claim-2'),
            },
          },
        ],
      }),
    });
    expect(corrected.decisionTrace.selectedCandidateId).not.toBe('profile-creative');
    expect(corrected.decisionTrace.profileEntryKeys).not.toContain(
      'social-knowledge:agent-b:studio-scene',
    );
  });

  test('turns constructive and adverse social identity into different autonomous goals', () => {
    const projection = createProjection([
      createAgent({ agentId: agentA, educationScore: 150, balance: 200 }),
    ]);
    const baseInput = {
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      shortTermMemoryContext: [],
      issuedAt: 100,
    } as const;
    const constructive = createDefaultAutonomousObjectiveProposal({
      ...baseInput,
      longTermProfile: createProfile(agentA, {
        values: [
          {
            key: 'community-cooperation',
            statement: 'Values cooperative community routines.',
            confidence: 0.9,
            updatedAt: 80,
            provenanceRecordIds: [asMemoryRecordId('cooperation-1')],
          },
        ],
      }),
    });
    const adverse = createDefaultAutonomousObjectiveProposal({
      ...baseInput,
      longTermProfile: createProfile(agentA, {
        personality: [
          {
            key: 'socially-wary',
            statement: 'A guarded disposition after repeated betrayal.',
            confidence: 0.9,
            updatedAt: 80,
            provenanceRecordIds: [asMemoryRecordId('betrayal-1')],
          },
        ],
      }),
    });

    expect(constructive.objective).toMatchObject({
      statement: 'Strengthen a trusted relationship through cooperative social contact.',
      affinityTags: ['social', 'cooperate', 'relationship', 'community'],
    });
    expect(constructive.decisionTrace).toMatchObject({
      selectedCandidateId: 'social-identity-cooperation',
      profileEntryKeys: ['community-cooperation'],
      profileEvidenceRecordIds: ['cooperation-1'],
    });
    expect(adverse.objective).toMatchObject({
      statement: 'Observe the social setting and verify commitments before rebuilding trust.',
      affinityTags: ['social', 'social-caution', 'observe', 'verify-commitment'],
    });
    expect(adverse.decisionTrace).toMatchObject({
      selectedCandidateId: 'social-identity-caution',
      profileEntryKeys: ['socially-wary'],
      profileEvidenceRecordIds: ['betrayal-1'],
    });
  });

  test('uses active scheduled routine intentions when no stronger pressure exists', () => {
    const projection = createProjection([
      createAgent({
        agentId: agentA,
        educationScore: 150,
        balance: 200,
        energy: 90,
        satiety: 90,
        health: 100,
      }),
    ]);
    const scheduledIntention = createScheduledIntention({
      id: 'daily-routine:agent-a:0:morning-study',
      description: 'Attend the morning study routine at school.',
      affinityTags: ['routine', 'study', 'education', 'school'],
    });

    const proposal = createDefaultAutonomousObjectiveProposal({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [scheduledIntention],
        updatedAt: 100,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 150,
    });

    expect(proposal.objective).toMatchObject({
      id: 'auto-objective-agent-a-150-1',
      agentId: agentA,
      statement: 'Follow the current study routine: Attend the morning study routine at school.',
      priority: 1,
      source: 'agent',
      affinityTags: ['routine', 'study', 'education', 'school'],
    });
    expect(proposal.decisionTrace).toEqual({
      agentId: agentA,
      objectiveId: 'auto-objective-agent-a-150-1',
      selectedCandidateId: 'scheduled-routine-study',
      rationale: 'Active scheduled intention daily-routine:agent-a:0:morning-study is in window.',
      score: 28,
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
      scheduledIntentionIds: ['daily-routine:agent-a:0:morning-study'],
      issuedAt: 150,
    });
  });

  test('does not immediately repeat a just-completed objective when another candidate is viable', () => {
    const projection = createProjection([
      createAgent({
        agentId: agentA,
        educationScore: 12,
        balance: 20,
      }),
    ]);
    const completedStudyObjective: LongHorizonObjective = {
      id: 'completed-study',
      agentId: agentA,
      statement: 'Improve education to qualify for better town opportunities.',
      priority: 2,
      source: 'agent',
      affinityTags: ['study', 'education'],
      createdAt: 50,
      updatedAt: 50,
    };

    const objective = createDefaultAutonomousObjective({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [
          {
            objective: completedStudyObjective,
            completedAt: 90,
            reason: 'plan-completed',
            planId: completedStudyObjective.id,
          },
        ],
        scheduledIntentions: [],
        updatedAt: 90,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 100,
    });

    expect(objective).toMatchObject({
      id: 'auto-objective-agent-a-100-2',
      agentId: agentA,
      statement: 'Earn enough money to stay economically stable.',
      priority: 2,
      source: 'agent',
      affinityTags: ['work', 'income'],
    });
  });

  test('passes retrieved short-term memory context to custom objective proposers', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);
    await shortTermMemoryRepository.append(
      createMemory({
        id: 'memory-study-observed',
        agentId: agentA,
        status: 'observed',
        summary: 'The agent noticed the school was open and easy to reach.',
        tags: ['study', 'education'],
        importanceScore: 0.8,
      }),
    );
    const seenMemoryIds: string[][] = [];

    await renewMissingActiveObjectives({
      projection,
      intentionRepository,
      longTermProfileRepository,
      shortTermMemoryRepository,
      planRepository,
      issuedAt: 100,
      objectiveProposer: (input) => {
        seenMemoryIds.push(input.shortTermMemoryContext.map((record) => record.id));
        return createObjective(input.agentId, 'objective-from-custom-proposer');
      },
    });

    expect(seenMemoryIds).toEqual([['memory-study-observed']]);
  });

  test('passes retrieved short-term memory context to autonomous strategic plan compilers', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);
    await shortTermMemoryRepository.append(
      createMemory({
        id: 'memory-market-failure',
        agentId: agentA,
        status: 'failed',
        summary: 'The agent could not buy fish because cash was too low.',
        tags: ['market', 'failure', 'fish'],
        importanceScore: 0.9,
      }),
    );
    let compilerMemoryIds: readonly string[] = [];

    await renewMissingActiveObjectives({
      projection,
      intentionRepository,
      longTermProfileRepository,
      shortTermMemoryRepository,
      planRepository,
      issuedAt: 100,
      objectiveProposer: (input) =>
        createObjective(input.agentId, 'objective-from-custom-proposer', ['market', 'recovery']),
      strategicPlanCompiler: (input) => {
        compilerMemoryIds = input.shortTermMemoryContext?.map((record) => record.id) ?? [];
        return createBranchPlan({
          objective: input.objective.statement,
          branches: [
            {
              id: 'memory-aware-recovery',
              objective: 'Use recent failure memory while planning recovery.',
              subtasks: [
                {
                  id: 'check-funds',
                  description: 'Check funds before buying fish.',
                  basePriority: 12,
                },
              ],
            },
          ],
        });
      },
    });

    expect(compilerMemoryIds).toEqual(['memory-market-failure']);
  });

  test('returns and emits objective renewal decision traces', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);
    const traces: unknown[] = [];

    const result = await renewMissingActiveObjectives({
      projection,
      intentionRepository,
      longTermProfileRepository,
      shortTermMemoryRepository,
      planRepository,
      issuedAt: 100,
      objectiveProposer: (input) =>
        createObjective(input.agentId, 'objective-from-custom-proposer'),
      objectiveRenewalTraceSink: {
        record: (trace) => {
          traces.push(trace);
        },
      },
    });

    expect(result).toEqual([
      {
        agentId: agentA,
        objectiveId: 'objective-from-custom-proposer',
        planId: 'objective-from-custom-proposer',
        decisionTrace: {
          agentId: agentA,
          objectiveId: 'objective-from-custom-proposer',
          selectedCandidateId: 'custom-proposer',
          rationale: 'Objective was produced by a custom proposer without decision metadata.',
          score: 0,
          shortTermMemoryContextIds: [],
          profileEntryKeys: [],
          profileEvidenceRecordIds: [],
          issuedAt: 100,
        },
      },
    ]);
    expect(traces).toEqual([result[0]?.decisionTrace]);
  });

  test('publishes initial progress with every newly active autonomous plan', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);

    const [renewed] = await renewMissingActiveObjectives({
      projection,
      intentionRepository,
      longTermProfileRepository,
      shortTermMemoryRepository,
      planRepository,
      planProgressRepository,
      issuedAt: 100,
    });

    expect(renewed).toBeDefined();
    await expect(
      planProgressRepository.get({
        planId: renewed!.planId,
        agentId: renewed!.agentId,
      }),
    ).resolves.toMatchObject({
      planId: renewed!.planId,
      agentId: renewed!.agentId,
      updatedAt: 100,
    });
  });

  test('attaches traceable strategic compiler evidence to objective renewal traces', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);
    const traces: unknown[] = [];

    const result = await renewMissingActiveObjectives({
      projection,
      intentionRepository,
      longTermProfileRepository,
      shortTermMemoryRepository,
      planRepository,
      issuedAt: 100,
      objectiveProposer: (input) => createObjective(input.agentId, 'objective-from-llm-compiler'),
      strategicPlanCompiler: ({ objective }) => ({
        plan: createBranchPlan({
          objective: objective.statement,
          branches: [
            {
              id: 'llm-development',
              objective: 'Use an LLM-proposed education route.',
              subtasks: [
                {
                  id: 'study',
                  description: 'Study through the traceable compiler plan.',
                  basePriority: 12,
                },
              ],
            },
          ],
        }),
        planningTrace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'llm-plan-objective-from-llm-compiler',
          providerId: 'scripted-planner',
          model: 'planner-model',
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            estimatedCostMicros: 70,
          },
          attempts: [
            {
              attemptIndex: 1,
              status: 'succeeded',
              providerId: 'scripted-planner',
              model: 'planner-model',
              message: 'LLM structured response validated',
              usage: {
                inputTokens: 10,
                outputTokens: 20,
                totalTokens: 30,
                estimatedCostMicros: 70,
              },
            },
          ],
        },
      }),
      objectiveRenewalTraceSink: {
        record: (trace) => {
          traces.push(trace);
        },
      },
    });

    await expect(
      planRepository.require({
        planId: 'objective-from-llm-compiler',
        agentId: agentA,
      }),
    ).resolves.toMatchObject({
      plan: {
        branches: [
          {
            id: 'llm-development',
            subtasks: [{ id: 'study', description: 'Study through the traceable compiler plan.' }],
          },
        ],
      },
      planningTrace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'llm-plan-objective-from-llm-compiler',
        providerId: 'scripted-planner',
        model: 'planner-model',
      },
    });
    expect(result[0]?.decisionTrace).toMatchObject({
      objectiveId: 'objective-from-llm-compiler',
      strategicPlan: {
        status: 'accepted',
        source: 'llm',
        requestId: 'llm-plan-objective-from-llm-compiler',
        providerId: 'scripted-planner',
        model: 'planner-model',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          estimatedCostMicros: 70,
        },
      },
    });
    expect(traces).toEqual([result[0]?.decisionTrace]);
  });

  test('passes loaded long-term profile context into autonomous strategic plan compilers', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 150 })]);
    let compilerProfile: LongTermAgentProfile | undefined;

    await longTermProfileRepository.applyPatches(agentA, [
      {
        id: 'ltm-patch-agent-a-value-study-before-production-100',
        agentId: agentA,
        section: 'values',
        key: 'human-objective:study-before-production',
        statement: 'Human steering set long-horizon objective: Study before high-tech production.',
        confidence: 0.95,
        provenanceRecordIds: [asMemoryRecordId('cmd-study:strategic-objective')],
        proposedAt: 100,
      },
    ]);

    await renewMissingActiveObjectives({
      projection,
      intentionRepository,
      longTermProfileRepository,
      shortTermMemoryRepository,
      planRepository,
      issuedAt: 200,
      objectiveProposer: (input) => ({
        id: 'objective-profile-aware-production',
        agentId: input.agentId,
        statement: 'Craft Chip for the electronics market.',
        priority: 2,
        source: 'agent',
        affinityTags: ['production'],
        createdAt: 200,
        updatedAt: 200,
      }),
      strategicPlanCompiler: (input) => {
        compilerProfile = input.longTermProfile;
        return createBranchPlan({
          objective: input.objective.statement,
          branches: [
            {
              id: 'profile-aware-production',
              objective: 'Use profile context while planning production.',
              subtasks: [
                {
                  id: 'produce-target',
                  description: 'Produce with profile context.',
                  basePriority: 12,
                },
              ],
            },
          ],
        });
      },
    });

    expect(compilerProfile?.values).toEqual([
      expect.objectContaining({
        key: 'human-objective:study-before-production',
        provenanceRecordIds: ['cmd-study:strategic-objective'],
      }),
    ]);
  });

  test('passes world command rules into autonomous strategic plan compilers', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 150 })]);
    let compilerInput: StrategicPlanCompilerInput | undefined;

    await renewMissingActiveObjectives({
      projection,
      policies: createRulesPolicies(),
      intentionRepository,
      longTermProfileRepository,
      shortTermMemoryRepository,
      planRepository,
      issuedAt: 300,
      objectiveProposer: (input) => ({
        id: 'objective-rules-aware-production',
        agentId: input.agentId,
        statement: 'Craft Chip for the electronics market.',
        priority: 2,
        source: 'agent',
        affinityTags: ['production'],
        createdAt: 300,
        updatedAt: 300,
      }),
      strategicPlanCompiler: (input) => {
        compilerInput = input;
        return createBranchPlan({
          objective: input.objective.statement,
          branches: [
            {
              id: 'rules-aware-production',
              objective: 'Use world rules while planning production.',
              subtasks: [
                {
                  id: 'produce-target',
                  description: 'Produce with rules context.',
                  basePriority: 12,
                },
              ],
            },
          ],
        });
      },
    });

    const rules = compilerInput?.worldDecisionContext?.rules;
    if (rules === undefined) {
      throw new Error('expected strategic compiler world decision rules');
    }
    expect(rules.criticalThresholds).toEqual({ energy: 1, health: 1 });
    expect(
      rules.occupations.some(
        (rule) => rule.occupationName.length > 0 && rule.applicationQuota?.residentialTier === 1,
      ),
    ).toBe(true);
    expect(
      rules.production.some(
        (rule) => rule.commodity.length > 0 && Number.isFinite(rule.timeCostSeconds),
      ),
    ).toBe(true);
    expect(compilerInput?.observedStateSummary).toBe(
      'energy=50 satiety=80 health=100 education=150 balance=100 residentialTier=1 job=unemployed inventory=empty',
    );
  });
});

function createProjection(agents: readonly WorldAgentState[]) {
  return createWorldProjection({ agents });
}

function createAgent(input: {
  readonly agentId: AgentId;
  readonly energy?: number;
  readonly satiety?: number;
  readonly health?: number;
  readonly educationScore?: number;
  readonly balance?: number;
}): WorldAgentState {
  return {
    agentId: input.agentId,
    locationId: null,
    physiology: {
      energy: input.energy ?? 50,
      satiety: input.satiety ?? 80,
      health: input.health ?? 100,
    },
    educationScore: input.educationScore ?? 0,
    balance: input.balance ?? 100,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}

function createObjective(
  agentId: AgentId,
  id: string,
  affinityTags: readonly string[] = ['study'],
): LongHorizonObjective {
  return {
    id,
    agentId,
    statement: `Existing objective ${id}.`,
    priority: 1,
    source: 'human',
    affinityTags,
    createdAt: 50,
    updatedAt: 50,
  };
}

function createProfile(
  agentId: AgentId,
  partial: Partial<Omit<LongTermAgentProfile, 'agentId'>> = {},
): LongTermAgentProfile {
  return {
    agentId,
    beliefs: [],
    habits: [],
    mood: [],
    values: [],
    personality: [],
    socialRecords: [],
    ...partial,
  };
}

function createRulesPolicies(): WorldCommandPolicies {
  return {
    satietyRecoveryByCommodity: { Bread: 15 },
    maxSatiety: 100,
    wageCalculator: () => 10,
    laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
    criticalThresholds: { energy: 1, health: 1 },
    jobApplication: {
      populationEducationScores: [0, 100],
      quotaByResidentialTier: [1, 1, 1, 1, 1],
    },
  };
}

function createEducationOpportunityCostPolicies(): WorldCommandPolicies {
  return {
    satietyRecoveryByCommodity: {},
    maxSatiety: 100,
    wageCalculator: () => 250,
    laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
    criticalThresholds: { energy: 1, health: 1 },
    educationInvestment: { currencyCostPerHour: 20, inventoryCostsPerHour: {} },
  };
}

function createMemory(input: {
  readonly id: string;
  readonly agentId: AgentId;
  readonly status: 'succeeded' | 'failed' | 'repaired' | 'observed';
  readonly summary: string;
  readonly tags: readonly string[];
  readonly importanceScore: number;
}) {
  return createShortTermMemoryRecord({
    id: input.id,
    agentId: input.agentId,
    kind: 'action',
    status: input.status,
    summary: input.summary,
    occurredAt: 90,
    importanceScore: input.importanceScore,
    source: { eventIds: [] },
    tags: input.tags,
  });
}

function createScheduledIntention(input: {
  readonly id: string;
  readonly description: string;
  readonly affinityTags: readonly string[];
}): ScheduledIntention {
  return {
    id: input.id,
    agentId: agentA,
    description: input.description,
    priority: 2,
    startsAt: 100,
    endsAt: 200,
    status: 'planned',
    affinityTags: input.affinityTags,
    createdAt: 90,
    updatedAt: 90,
  };
}
