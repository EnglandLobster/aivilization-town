import {
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
import type { SocialRelationState } from '@aivilization/society';
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
            utterance: 'Here is how town plans fits my plans, but I would rather listen to you first.',
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
        marketPools: [
          { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 },
        ],
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
        marketPools: [
          { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 },
        ],
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
    expect(payload.planningContext.targetSelection.candidates.map((candidate) => candidate.agentId)).toEqual(
      expect.arrayContaining([agentC, remoteAgentId]),
    );
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
  readonly socialRelations?: readonly SocialRelationState[];
}): WorldProjection {
  return createWorldProjection({
    agents: input.agents,
    ...(input.locations === undefined ? {} : { locations: input.locations }),
    ...(input.locationObservations === undefined
      ? {}
      : { locationObservations: input.locationObservations }),
    ...(input.socialRelations === undefined ? {} : { socialRelations: input.socialRelations }),
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
  readonly balance?: number;
}): WorldAgentState {
  return {
    agentId: input.agentId,
    locationId: input.locationId ?? null,
    physiology: { energy: 50, satiety: 50, health: 100 },
    educationScore: input.educationScore ?? 0,
    balance: input.balance ?? 1000,
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
