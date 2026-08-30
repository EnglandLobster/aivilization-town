import { createAmmPool } from '@aivilization/economy';
import {
  asAgentId,
  asLocationId,
  asSimulationId,
  createEventEnvelope,
  replayEvents,
  type AgentId,
} from '@aivilization/sim-core';
import type { SocialRelationState } from '@aivilization/society';
import {
  applyWorldEvent,
  createBankState,
  createWorldProjection,
  type WorldCommandPolicies,
  type WorldProjection,
  type WorldSocialMatterState,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createAivilizationTownCalendarPolicy,
  createAivilizationTownLifecyclePolicy,
  createAivilizationTownWellbeingPolicy,
} from './experimentalFeatures';
import { createWorldDecisionContextFromProjection } from './worldDecisionContext';
import type { LocalSimulationSocietyDirectory } from './localSimulationSocietyDirectory';

const agentId = asAgentId('agent-a');

describe('worker world decision context', () => {
  test('exposes the sanitized own display name in the identity view', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          locationId: null,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: 'cook',
          inventory: {},
          registration: {
            registrationId: 'register-agent-a',
            policyVersion: 'runtime-agent-registration-v3',
            creatorId: 'participant-7',
            source: 'human',
            displayName: '  Li\u0000\u200b Na  ',
            registeredAt: 0,
            provenance: 'post-bootstrap-command',
          },
        },
      ],
    });

    const context = createWorldDecisionContextFromProjection({ projection, agentId });

    expect(context.agent.displayName).toBe('Li Na');
  });

  test('caps over-long registration names and omits the field without a registration', () => {
    const longName = 'V'.repeat(80);
    const withLongName = createWorldProjection({
      agents: [
        {
          agentId,
          locationId: null,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
          registration: {
            registrationId: 'register-agent-a',
            policyVersion: 'runtime-agent-registration-v3',
            creatorId: 'participant-7',
            source: 'human',
            displayName: longName,
            registeredAt: 0,
            provenance: 'post-bootstrap-command',
          },
        },
      ],
    });
    const withoutRegistration = createWorldProjection({
      agents: [
        {
          agentId,
          locationId: null,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    expect(
      createWorldDecisionContextFromProjection({ projection: withLongName, agentId }).agent
        .displayName,
    ).toBe('V'.repeat(64));
    expect(
      createWorldDecisionContextFromProjection({ projection: withoutRegistration, agentId }).agent
        .displayName,
    ).toBeUndefined();
  });

  test('binds a versioned cross-partition society directory without copying private state', () => {
    const projection = createWorldProjection({
      locations: [
        {
          locationId: asLocationId('market'),
          name: 'Market',
          kind: 'market',
          activityAffinities: ['trade'],
          capacity: null,
        },
      ],
      agents: [
        {
          agentId,
          locationId: asLocationId('market'),
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: { Apple: 2 },
        },
      ],
    });
    const societyDirectory: LocalSimulationSocietyDirectory = {
      schemaVersion: 'local-simulation-society-directory-v1',
      directoryId: `local-simulation-society-directory:sha256:${'a'.repeat(64)}`,
      manifestId: 'town-runtime',
      simulationId: asSimulationId('sim-1'),
      partitionBoundaries: [
        {
          partitionKey: 'world-east',
          lastAppliedSequence: 12,
          snapshotSequence: 12,
          simulationTime: 1_000,
        },
        {
          partitionKey: 'world-main',
          lastAppliedSequence: 9,
          snapshotSequence: 9,
          simulationTime: 1_000,
        },
      ],
      agents: [
        {
          agentId,
          ownerPartitionKey: 'world-main',
          ownerLastAppliedSequence: 9,
          publicState: {
            locationId: asLocationId('market'),
            job: null,
            residentialTier: 1,
            educationScore: 31,
          },
        },
        {
          agentId: asAgentId('agent-b'),
          ownerPartitionKey: 'world-east',
          ownerLastAppliedSequence: 12,
          publicState: {
            locationId: asLocationId('market'),
            job: 'Cashier',
            residentialTier: 2,
            educationScore: 60,
            displayName: 'B',
          },
        },
      ],
    };

    const context = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      societyDirectory,
    });

    // Context-view v2 trim (§7 step 2 budget binding): local partition stays
    // complete; the unrelated foreign agent-b is no longer visible.
    expect(context.society).toMatchObject({
      directoryId: societyDirectory.directoryId,
      partitionBoundaries: [
        { partitionKey: 'world-east', lastAppliedSequence: 12 },
        { partitionKey: 'world-main', lastAppliedSequence: 9 },
      ],
      agents: [{ agentId: 'agent-a', ownerPartitionKey: 'world-main' }],
    });
    expect(context.society?.agents.some((societyAgent) => societyAgent.agentId === 'agent-b')).toBe(
      false,
    );
    expect(JSON.stringify(context.society)).not.toContain('Apple');
    expect(JSON.stringify(context.society)).not.toContain('balance');
  });

  test('keeps foreign-partition directory entries only when a relation record exists', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          locationId: null,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      socialRelations: [
        createRelation({
          sourceAgentId: agentId,
          targetAgentId: asAgentId('agent-b'),
          relationScore: 0.7,
          relationLabel: 'friend',
        }),
      ],
    });
    const societyDirectory = createSocietyDirectoryFixture();

    const context = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      societyDirectory,
    });

    expect(context.society?.agents.map((societyAgent) => societyAgent.agentId)).toEqual([
      'agent-a',
      'agent-b',
    ]);
    expect(context.agent.relations).toEqual([
      {
        agentId: asAgentId('agent-b'),
        displayName: 'B',
        direction: 'outgoing',
        relationLabel: 'friend',
        relationScore: 0.7,
        attitudeScore: 0.1,
        interactionCount: 3,
      },
    ]);
  });

  test('exposes strongest directed relations without narrative summaries and drops stale counterparts', () => {
    const projection = createWorldProjection({
      agents: [
        createLocalAgent(agentId),
        createLocalAgent(asAgentId('agent-b')),
        createLocalAgent(asAgentId('agent-c')),
        createLocalAgent(asAgentId('agent-d')),
      ],
      socialRelations: [
        createRelation({
          sourceAgentId: agentId,
          targetAgentId: asAgentId('agent-b'),
          relationScore: 0.8,
          relationLabel: 'close-friend',
        }),
        createRelation({
          sourceAgentId: asAgentId('agent-c'),
          targetAgentId: agentId,
          relationScore: -0.6,
          relationLabel: 'strained',
        }),
        createRelation({
          sourceAgentId: agentId,
          targetAgentId: asAgentId('agent-d'),
          relationScore: 0.2,
          relationLabel: 'acquaintance',
        }),
        // Stale record: the counterpart left the town (neither local agents
        // nor the directory lists it) and must not resurrect as a ghost.
        createRelation({
          sourceAgentId: agentId,
          targetAgentId: asAgentId('agent-ghost'),
          relationScore: 0.9,
          relationLabel: 'best-friend',
        }),
      ],
    });

    const context = createWorldDecisionContextFromProjection({ projection, agentId });

    expect(context.agent.relations).toEqual([
      {
        agentId: asAgentId('agent-b'),
        direction: 'outgoing',
        relationLabel: 'close-friend',
        relationScore: 0.8,
        attitudeScore: 0.1,
        interactionCount: 3,
      },
      {
        agentId: asAgentId('agent-c'),
        direction: 'incoming',
        relationLabel: 'strained',
        relationScore: -0.6,
        attitudeScore: 0.1,
        interactionCount: 3,
      },
      {
        agentId: asAgentId('agent-d'),
        direction: 'outgoing',
        relationLabel: 'acquaintance',
        relationScore: 0.2,
        attitudeScore: 0.1,
        interactionCount: 3,
      },
    ]);
    expect(JSON.stringify(context.agent.relations)).not.toContain('lastInteractionSummary');
    expect(JSON.stringify(context.agent.relations)).not.toContain('chatted at the market');
  });

  test('caps the relations section at the eight strongest entries', () => {
    const socialRelations = Array.from({ length: 10 }, (_, index) =>
      createRelation({
        sourceAgentId: agentId,
        targetAgentId: asAgentId(`agent-r${index}`),
        relationScore: 0.1 + index * 0.05,
        relationLabel: 'friend',
      }),
    );
    const projection = createWorldProjection({
      agents: [
        createLocalAgent(agentId),
        ...Array.from({ length: 10 }, (_, index) => createLocalAgent(asAgentId(`agent-r${index}`))),
      ],
      socialRelations,
    });

    const context = createWorldDecisionContextFromProjection({ projection, agentId });

    expect(context.agent.relations).toHaveLength(8);
    // Weakest two (r0, r1) are dropped; strongest first.
    expect(context.agent.relations?.map((relation) => relation.agentId)).toEqual([
      asAgentId('agent-r9'),
      asAgentId('agent-r8'),
      asAgentId('agent-r7'),
      asAgentId('agent-r6'),
      asAgentId('agent-r5'),
      asAgentId('agent-r4'),
      asAgentId('agent-r3'),
      asAgentId('agent-r2'),
    ]);
  });

  test('caps the enterprises section with tiered relevance at eight entries', () => {
    const enterpriseCount = 12;
    const enterprises = Array.from({ length: enterpriseCount }, (_, index) => ({
      enterpriseId: `e-${String(index).padStart(2, '0')}`,
      name: `Enterprise ${index}`,
      // e-00 is owned by the agent (tier 0); e-03/e-04 post openings (tier 1);
      // the rest are plain context (tier 2).
      ownerAgentId: index === 0 ? agentId : asAgentId(`owner-${String(index).padStart(2, '0')}`),
      occupationName: 'Baker',
      balance: 100,
      inventory: {},
      maxEmployees: 3,
      employeeAgentIds: [],
      status: 'active' as const,
      foundedAt: 0,
      cumulativeSales: 0,
      cumulativePurchases: 0,
      cumulativeWages: 0,
      ...(index === 3 || index === 4 ? { jobPosting: { wageOffer: 12, openSlots: 1 } } : {}),
    }));
    const agents = [
      createLocalAgent(agentId),
      ...enterprises
        .filter((enterprise) => enterprise.ownerAgentId !== agentId)
        .map((enterprise) => createLocalAgent(enterprise.ownerAgentId)),
    ];
    const projection = createWorldProjection({
      agents,
      enterprises,
    });

    const context = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 250,
        laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
        criticalThresholds: { energy: 20, health: 35 },
        enterprise: {
          policyVersion: 'test-enterprise-v1',
          minimumInitialCapital: 100,
          maximumInitialCapital: 1000,
          maximumEmployees: 4,
        },
      },
    });

    // Cap 8: own enterprise first, then the two postings, then the six
    // lowest-id plain enterprises.
    expect(context.enterprises).toHaveLength(8);
    expect(context.enterprises?.map((enterprise) => enterprise.enterpriseId)).toEqual([
      'e-00',
      'e-03',
      'e-04',
      'e-01',
      'e-02',
      'e-05',
      'e-06',
      'e-07',
    ]);
  });

  test('exposes recent town-pulse news newest first within the simulation-day window', () => {
    const dayMs = 86_400_000;
    const now = 5 * dayMs;
    const projection = createWorldProjection({
      agents: [createLocalAgent(agentId)],
      clock: { now, tickDurationMs: 1000 },
      townPulse: [
        {
          sequence: 1,
          occurredAt: now - 4 * dayMs, // outside the 3-day window: stale
          kind: 'weather-change',
          detail: 'clear->rain',
        },
        {
          sequence: 2,
          occurredAt: now - 2 * dayMs,
          kind: 'death',
          subjectAgentId: asAgentId('agent-old'),
          subjectDisplayName: '  Old​ Resident  ',
          detail: 'old-age',
        },
        {
          sequence: 3,
          occurredAt: now - dayMs,
          kind: 'petition-threshold',
          detail: 'town-welfare',
        },
        {
          sequence: 4,
          occurredAt: now - dayMs,
          kind: 'arrival',
          subjectAgentId: asAgentId('agent-new'),
          subjectDisplayName: 'Newcomer',
        },
      ],
    });

    const context = createWorldDecisionContextFromProjection({ projection, agentId });

    expect(context.townPulse).toEqual([
      // Same timestamp: higher event sequence wins the tiebreak.
      {
        kind: 'arrival',
        atMs: now - dayMs,
        subjectAgentId: asAgentId('agent-new'),
        subjectDisplayName: 'Newcomer',
      },
      { kind: 'petition-threshold', atMs: now - dayMs, detail: 'town-welfare' },
      {
        kind: 'death',
        atMs: now - 2 * dayMs,
        subjectAgentId: asAgentId('agent-old'),
        subjectDisplayName: 'Old Resident',
        detail: 'old-age',
      },
    ]);
  });

  test('omits the town pulse section when the ring is empty', () => {
    const projection = createWorldProjection({
      agents: [createLocalAgent(agentId)],
      clock: { now: 0, tickDurationMs: 1000 },
    });

    const context = createWorldDecisionContextFromProjection({ projection, agentId });

    expect(context.townPulse).toBeUndefined();
  });

  test('caps foreign-partition society entries at sixteen strongest relations', () => {
    const foreignCount = 20;
    const socialRelations = Array.from({ length: foreignCount }, (_, index) =>
      createRelation({
        sourceAgentId: agentId,
        targetAgentId: asAgentId(`agent-f${String(index).padStart(2, '0')}`),
        relationScore: 0.05 + index * 0.01,
        relationLabel: 'friend',
      }),
    );
    const projection = createWorldProjection({
      agents: [createLocalAgent(agentId)],
      socialRelations,
    });
    const societyDirectory = createSocietyDirectoryFixture({
      foreignAgentIds: socialRelations.map((relation) => relation.targetAgentId),
    });

    const context = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      societyDirectory,
    });

    // Local self plus the 16 strongest foreign relations (f20..f05 by score);
    // the four weakest foreign relations are trimmed.
    const visibleForeignIds = (context.society?.agents ?? [])
      .map((societyAgent) => societyAgent.agentId)
      .filter((visibleAgentId) => visibleAgentId !== 'agent-a');
    expect(visibleForeignIds).toHaveLength(16);
    expect(visibleForeignIds).not.toContain(asAgentId('agent-f00'));
    expect(visibleForeignIds).not.toContain(asAgentId('agent-f01'));
    expect(visibleForeignIds).not.toContain(asAgentId('agent-f02'));
    expect(visibleForeignIds).not.toContain(asAgentId('agent-f03'));
    expect(visibleForeignIds).toContain(asAgentId('agent-f19'));
    // The relations section itself stays capped at eight.
    expect(context.agent.relations).toHaveLength(8);
  });

  test('captures dynamic agent state and sorted AMM spot prices from projection', () => {
    const projection = createWorldProjection({
      locations: [
        {
          locationId: asLocationId('market'),
          name: 'Market',
          kind: 'market',
          activityAffinities: ['market', 'trade'],
          capacity: null,
        },
      ],
      agents: [
        {
          agentId,
          locationId: asLocationId('market'),
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 191696904,
          residentialTier: 5,
          job: 'Stock Clerk',
          inventory: { Transistor: 12, Fish: 46, Empty: 0 },
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Transistor', commodityReserve: 5, currencyReserve: 500 }),
        createAmmPool({ commodity: 'Fish', commodityReserve: 10, currencyReserve: 3045 }),
      ],
      marketPriceIndices: [
        {
          baselineAt: 0,
          recordedAt: 50,
          food: 1.05,
          nonFood: 1.1,
          overall: 1.08,
          foodCount: 1,
          nonFoodCount: 1,
          ratios: { Fish: 1.05, Transistor: 1.1 },
        },
        {
          baselineAt: 0,
          recordedAt: 100,
          food: 1.12,
          nonFood: 1.2,
          overall: 1.16,
          foodCount: 1,
          nonFoodCount: 1,
          ratios: { Fish: 1.12, Transistor: 1.2 },
        },
      ],
    });

    expect(createWorldDecisionContextFromProjection({ projection, agentId })).toEqual({
      agent: {
        agentId,
        locationId: 'market',
        physiology: { energy: 45, satiety: 30, health: 90 },
        educationScore: 31,
        balance: 191696904,
        residentialTier: 5,
        upkeepArrears: 0,
        job: 'Stock Clerk',
        inventory: { Fish: 46, Transistor: 12 },
      },
      market: {
        spotPrices: [
          { commodity: 'Fish', spotPrice: 304.5 },
          { commodity: 'Transistor', spotPrice: 100 },
        ],
        latestPriceIndex: {
          baselineAt: 0,
          recordedAt: 100,
          overall: 1.16,
          ratios: { Fish: 1.12, Transistor: 1.2 },
        },
      },
    });
  });

  test('reads spot prices from the authoritative market override when provided', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      // The partition projection's own pool has drifted after this partition's
      // own trades: spot price 5 (500 / 100).
      marketPools: [
        createAmmPool({ commodity: 'Fish', commodityReserve: 100, currencyReserve: 500 }),
      ],
    });

    const context = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      // The unified authority pool is deeper and prices Fish at 10 (2000 / 200).
      marketOverride: {
        marketPools: {
          Fish: { commodity: 'Fish', commodityReserve: 200, currencyReserve: 2_000 },
        },
      },
    });

    // The agent plans against the authoritative global price, not the stale
    // partition pool.
    expect(context.market.spotPrices).toEqual([{ commodity: 'Fish', spotPrice: 10 }]);
  });

  test('captures occupation and production rules from command policies', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      jobApplications: [
        {
          applicationId: 'application-b-cleaner',
          cycleNumber: 0,
          agentId: asAgentId('agent-b'),
          occupationName: 'Cleaner',
          residentialTier: 1,
          educationScore: 0,
          submittedAt: 10,
          status: 'pending',
        },
      ],
    });
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: { Apple: 15 },
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
      jobApplication: {
        populationEducationScores: [10, 31, 70, 150],
        quotaByResidentialTier: [1, 2, 3, 4, 5],
      },
      production: {
        efficiency: {
          minEfficiency: 0.5,
          educationScoreForMaxEfficiency: 500,
        },
      },
    };

    const context = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies,
    });

    expect(context.rules?.criticalThresholds).toEqual({ energy: 20, health: 35 });
    const cleanerRule = context.rules?.occupations.find(
      (rule) => rule.occupationName === 'Cleaner',
    );
    expect(cleanerRule).toMatchObject({
      occupationName: 'Cleaner',
      jobTier: 1,
      effectiveEducationThreshold: 10,
      requiredResidentialTier: 1,
      prerequisiteCommodity: null,
      eligible: true,
      applicationQuota: {
        residentialTier: 1,
        limit: 1,
        currentApplications: 0,
        remaining: 1,
      },
      rejectionReasons: [],
    });
    const stockClerkRule = context.rules?.occupations.find(
      (rule) => rule.occupationName === 'Stock Clerk',
    );
    expect(stockClerkRule).toMatchObject({
      occupationName: 'Stock Clerk',
      jobTier: 2,
      effectiveEducationThreshold: 20,
      requiredResidentialTier: 2,
      prerequisiteCommodity: 'Beef',
      eligible: false,
    });
    expect(stockClerkRule?.rejectionReasons).toEqual(
      expect.arrayContaining(['residential-tier-too-low', 'missing-prerequisite']),
    );
    const appleRule = context.rules?.production.find((rule) => rule.commodity === 'Apple');
    expect(appleRule).toMatchObject({
      commodity: 'Apple',
      minResidentialTier: 1,
      inputs: {},
      satietyCost: 0,
      producible: true,
      rejectionReasons: [],
    });
    expect(appleRule?.energyCost).toBeCloseTo(3.7664783427);
    expect(appleRule?.timeCostSeconds).toBeCloseTo(0.1883239171);
    const transistorRule = context.rules?.production.find(
      (rule) => rule.commodity === 'Transistor',
    );
    expect(transistorRule).toMatchObject({
      commodity: 'Transistor',
      minResidentialTier: 5,
      producible: false,
    });
    expect(transistorRule?.rejectionReasons).toEqual(
      expect.arrayContaining(['residential-tier-too-low']),
    );
  });

  test('exposes the fiscal regime only when command policies carry a tax policy', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
      tax: {
        policyVersion: 'tax-regime-v1',
        neutralRate: 0.1,
        incomeTaxBrackets: [
          { upToAmount: 300, rate: 0 },
          { upToAmount: null, rate: 0.12 },
        ],
        tradeTaxRate: 0.05,
        source: 'test',
      },
    };

    const withTax = createWorldDecisionContextFromProjection({ projection, agentId, policies });
    expect(withTax.fiscal).toEqual({
      neutralRate: 0.1,
      incomeTaxBrackets: [
        { upToAmount: 300, rate: 0 },
        { upToAmount: null, rate: 0.12 },
      ],
      tradeTaxRate: 0.05,
    });

    const policiesWithoutTax: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
    };
    const withoutTax = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies: policiesWithoutTax,
    });
    expect(withoutTax.fiscal).toBeUndefined();
  });

  test('exposes the education level and stage only when the education system is enabled', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 100,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      educationExamApplications: [
        {
          applicationId: 'exam-app-1',
          cycleNumber: 0,
          agentId,
          targetLevel: 3,
          educationScore: 200,
          submittedAt: 0,
          status: 'pending',
        },
      ],
      educationExamCycles: [
        {
          cycleNumber: 0,
          cycleStartedAt: 0,
          cycleEndedAt: 86_400_000,
          completedAt: 86_400_000,
          policyVersion: 'education-system-v2',
          applicationCount: 4,
          admittedCount: 2,
          rejectedCount: 2,
          applicationsByLevel: { 3: 4 },
          admittedByLevel: { 3: 2 },
          cutoffScoresByLevel: { 3: 250 },
        },
      ],
    });
    const educationSystem = {
      policyVersion: 'education-system-v2',
      enabled: true,
      levelScoreThresholds: [20, 70, 180, 320, 450],
      compulsoryLevels: [1, 2],
      levelTuitionPerHour: { 0: 20, 1: 20, 2: 20, 3: 25, 4: 30, 5: 40 },
      employedStudyEfficiencyRatio: 0.3,
      examCycleDurationMs: 86_400_000,
      admissionQuotaByLevel: { 3: 0.5, 4: 0.25, 5: 0.1 },
      vocationalTrackShare: 0.5,
      source: 'test',
    } as const;
    const basePolicies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
    };

    // score 100 derives level 2 (初中), which completes the compulsory stage.
    const withSystem = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies: { ...basePolicies, educationSystem },
    });
    expect(withSystem.agent.educationLevel).toBe(2);
    expect(withSystem.agent.educationStage).toBe('初中(义务教育)');
    expect(withSystem.agent.compulsoryEducationIncomplete).toBe(false);
    expect(withSystem.agent.examAttempts).toBe(0);
    // The next exam gate above level 2 is the 中考 (target 3): the context
    // reports the current cycle's parked applications plus the latest completed
    // cycle's admission rate (2/4) and cutoff.
    expect(withSystem.agent.nextEducationExam).toEqual({
      targetLevel: 3,
      currentCycleApplications: 1,
      previousCycleAdmissionRate: 0.5,
      previousCycleCutoffScore: 250,
    });
    // Rational investment view (education-system-v4): the 中考 gate into level 3
    // costs 80 more score points (~1.33h at the canonical 1/60 rate while
    // unemployed) at the free compulsory tuition, and unlocks tier-5 wages.
    expect(withSystem.agent.educationReturn).toMatchObject({
      currentLevel: 2,
      currentStage: '初中(义务教育)',
      nextLevel: 3,
      requiredScore: 180,
      currentScore: 100,
      isExamGated: true,
      examAdmission: {
        quota: 0.5,
        lastCycleAdmissionRate: 0.5,
        lastCycleCutoffScore: 250,
      },
      tuitionPerHour: 20,
      compulsoryFree: true,
      wageUpliftEstimate: { currentTierWage: 301, nextLevelMinTierWage: 429 },
    });
    expect(withSystem.agent.educationReturn?.expectedStudyHoursRemaining).toBeCloseTo(4 / 3);

    // A level-1 agent (score 25) has not finished the compulsory stage.
    const primaryProjection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 25,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });
    const primary = createWorldDecisionContextFromProjection({
      projection: primaryProjection,
      agentId,
      policies: { ...basePolicies, educationSystem },
    });
    expect(primary.agent.educationLevel).toBe(1);
    expect(primary.agent.educationStage).toBe('小学(义务教育)');
    expect(primary.agent.compulsoryEducationIncomplete).toBe(true);
    // Level 1 → level 2 is inside the compulsory stage: no exam gate, no
    // admission outlook, and the wage uplift stops at the tier-3 ladder step.
    expect(primary.agent.educationReturn).toMatchObject({
      currentLevel: 1,
      nextLevel: 2,
      requiredScore: 70,
      currentScore: 25,
      isExamGated: false,
      tuitionPerHour: 20,
      compulsoryFree: true,
      wageUpliftEstimate: { currentTierWage: 260, nextLevelMinTierWage: 301 },
    });
    expect(primary.agent.educationReturn?.examAdmission).toBeUndefined();
    expect(primary.agent.educationReturn?.expectedStudyHoursRemaining).toBeCloseTo(0.75);

    // An explicitly recorded level (and vocational track) wins over the score.
    const trackedProjection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 400,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
          educationLevel: 3,
          educationTrack: 'vocational',
        },
      ],
    });
    const tracked = createWorldDecisionContextFromProjection({
      projection: trackedProjection,
      agentId,
      policies: { ...basePolicies, educationSystem },
    });
    expect(tracked.agent.educationStage).toBe('高中(中职)');

    // Disabled or absent policy keeps the context education-system-free.
    const withoutSystem = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies: basePolicies,
    });
    expect(withoutSystem.agent.educationLevel).toBeUndefined();
    expect(withoutSystem.agent.educationStage).toBeUndefined();
    expect(withoutSystem.agent.compulsoryEducationIncomplete).toBeUndefined();
    expect(withoutSystem.agent.examAttempts).toBeUndefined();
    expect(withoutSystem.agent.nextEducationExam).toBeUndefined();
    expect(withoutSystem.agent.educationReturn).toBeUndefined();
    const disabled = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies: { ...basePolicies, educationSystem: { ...educationSystem, enabled: false } },
    });
    expect(disabled.agent.educationLevel).toBeUndefined();
    expect(disabled.agent.examAttempts).toBeUndefined();
    expect(disabled.agent.nextEducationExam).toBeUndefined();
    expect(disabled.agent.educationReturn).toBeUndefined();
  });

  test('mirrors the vocational-track job bonus in occupation rules', () => {
    const createProjection = (track: 'academic' | 'vocational') =>
      createWorldProjection({
        agents: [
          {
            agentId,
            physiology: { energy: 45, satiety: 30, health: 90 },
            educationScore: 150,
            educationLevel: 3,
            educationTrack: track,
            balance: 100,
            residentialTier: 3,
            job: null,
            inventory: { Sushi: 1 },
          },
        ],
      });
    const educationSystem = {
      policyVersion: 'education-system-v4',
      enabled: true,
      levelScoreThresholds: [20, 70, 180, 320, 450],
      compulsoryLevels: [1, 2],
      levelTuitionPerHour: { 0: 20, 1: 20, 2: 20, 3: 25, 4: 30, 5: 40 },
      employedStudyEfficiencyRatio: 0.3,
      examCycleDurationMs: 86_400_000,
      admissionQuotaByLevel: { 3: 0.5, 4: 0.25, 5: 0.1 },
      vocationalTrackShare: 0.5,
      vocationalTrackJobTierBonus: { 2: 20, 3: 10 },
      source: 'test',
    } as const;
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
      educationSystem,
      jobApplication: {
        // Cashier eligibilityShare 0.56 puts the knowledge threshold at 160:
        // raw 150 fails, the 中职 tier-3 bonus (+10) makes the agent eligible.
        populationEducationScores: [160],
        quotaByResidentialTier: [1, 1, 1],
      },
    };

    const vocational = createWorldDecisionContextFromProjection({
      projection: createProjection('vocational'),
      agentId,
      policies,
    });
    const cashierRule = vocational.rules?.occupations.find(
      (rule) => rule.occupationName === 'Cashier',
    );
    expect(cashierRule).toMatchObject({
      jobTier: 3,
      effectiveEducationThreshold: 160,
      effectiveEducationScore: 160,
      eligible: true,
      rejectionReasons: [],
    });
    // Tier-1 occupations carry no bonus, so no effective-score override.
    const cleanerRule = vocational.rules?.occupations.find(
      (rule) => rule.occupationName === 'Cleaner',
    );
    expect(cleanerRule?.effectiveEducationScore).toBeUndefined();

    const academic = createWorldDecisionContextFromProjection({
      projection: createProjection('academic'),
      agentId,
      policies,
    });
    const academicCashierRule = academic.rules?.occupations.find(
      (rule) => rule.occupationName === 'Cashier',
    );
    expect(academicCashierRule?.effectiveEducationScore).toBeUndefined();
    expect(academicCashierRule?.eligible).toBe(false);
    expect(academicCashierRule?.rejectionReasons).toContain('education-too-low');
  });

  test('exposes the banking position only when command policies carry a credit policy', () => {
    const bank = createBankState({ reserves: 10_000 });
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
      bank: {
        ...bank,
        deposits: { [agentId]: 250 },
        creditHistoryByAgent: { [agentId]: { repaidCount: 1, defaultedCount: 0 } },
      },
      clock: { now: 86_400_000, tickDurationMs: 1000 },
    });
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
      credit: {
        policyVersion: 'credit-v1',
        depositDailyInterestRate: 0.001,
        loanDailyInterestRate: 0.01,
        loanTermDays: 30,
        accrualCadenceMs: 86_400_000,
        reserveRatio: 0.2,
        maxLoansPerAgent: 1,
        graceMissedPayments: 3,
        baseLoanLimit: 5000,
        creditLimitRepaidBonusRatio: 0.2,
        creditLimitDefaultPenaltyRatio: 0.5,
        creditLimitMinMultiplier: 0.1,
        creditLimitMaxMultiplier: 3,
        source: 'test',
      },
    };

    const withCredit = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies,
    });
    expect(withCredit.agent.banking).toMatchObject({
      depositBalance: 250,
      activeLoans: [],
      repaidCount: 1,
      defaultedCount: 0,
      depositDailyInterestRate: 0.001,
      loanDailyInterestRate: 0.01,
    });
    // One repaid loan scales the credit limit by the +20% repaid bonus.
    expect(withCredit.agent.banking?.maxLoanAmount).toBeCloseTo(6000);

    const policiesWithoutCredit: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
    };
    const withoutCredit = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies: policiesWithoutCredit,
    });
    expect(withoutCredit.agent.banking).toBeUndefined();
  });

  test('exposes indicative external-trade prices only when policies carry an external trade policy', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 20,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: { Apple: 25 },
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 }),
      ],
      clock: { now: 0, tickDurationMs: 1000 },
    });
    // One settled export creates the slice with a net-export balance of 25.
    const traded = applyWorldEvent(
      projection,
      createEventEnvelope({
        id: 'event-export',
        simulationId: 'sim-1',
        type: 'ExternalTradeExecuted',
        payload: {
          trader: { agentId },
          direction: 'export' as const,
          commodityName: 'Apple',
          quantity: 25,
          unitPrice: 10,
          totalCurrency: 250,
          balanceBefore: 0,
          balanceAfter: 25,
          spotPrice: 10,
          policyVersion: 'external-trade-v1',
        },
        occurredAt: 0,
        sequence: 1,
      }),
    );

    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
      externalTrade: {
        policyVersion: 'external-trade-v1',
        balanceDecayRatioPerCadence: 0.01,
        cadenceMs: 3_600_000,
        priceImpactRatio: 0.2,
        balanceScale: 50,
        source: 'test',
      },
    };
    const withTrade = createWorldDecisionContextFromProjection({
      projection: traded,
      agentId,
      policies,
    });
    // Balance 25 → √25/50 × 0.2 = 2% below spot on exports; imports (net-export
    // balance) settle at spot.
    expect(withTrade.externalTrade).toHaveLength(1);
    expect(withTrade.externalTrade?.[0]).toMatchObject({
      commodityName: 'Apple',
      netExportBalance: 25,
      importUnitPrice: 10,
    });
    expect(withTrade.externalTrade?.[0]?.exportUnitPrice).toBeCloseTo(9.8);

    const policiesWithoutTrade: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
    };
    const withoutTrade = createWorldDecisionContextFromProjection({
      projection: traded,
      agentId,
      policies: policiesWithoutTrade,
    });
    expect(withoutTrade.externalTrade).toBeUndefined();
  });

  test('exposes final-consumption options, active durables, and enterprises to planning', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 20,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: { Book: 2, Chip: 1 },
          durableGoods: [
            {
              lotId: 'chip-lot',
              commodityName: 'Chip',
              quantity: 2,
              utilityPoints: 50,
              acquiredAt: 100,
              expiresAt: 1_000,
            },
          ],
        },
      ],
      enterprises: [
        {
          enterpriseId: 'book-co',
          name: 'Book Co',
          ownerAgentId: agentId,
          occupationName: 'Writer',
          balance: 500,
          inventory: { Book: 3 },
          maxEmployees: 4,
          employeeAgentIds: [agentId],
          status: 'active',
          foundedAt: 0,
          cumulativeSales: 120,
          cumulativePurchases: 30,
          cumulativeWages: 40,
          jobPosting: { wageOffer: 55, openSlots: 3 },
          wageArrears: 25,
        },
      ],
    });
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 10,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 1, health: 1 },
      consumption: {
        policyVersion: 'consumption-v1',
        rules: {
          Book: { kind: 'consumable', utilityPoints: 5 },
          Chip: { kind: 'durable', utilityPoints: 25, lifetimeSeconds: 86_400 },
        },
      },
      enterprise: {
        policyVersion: 'enterprise-v1',
        minimumInitialCapital: 100,
        maximumInitialCapital: 10_000,
        maximumEmployees: 10,
      },
    };

    const context = createWorldDecisionContextFromProjection({ projection, agentId, policies });
    expect(context.agent.durableGoods).toEqual([
      expect.objectContaining({ lotId: 'chip-lot', commodityName: 'Chip', quantity: 2 }),
    ]);
    expect(context.rules?.consumption).toEqual([
      expect.objectContaining({
        commodityName: 'Book',
        kind: 'consumable',
        inventoryQuantity: 2,
        activeDurableQuantity: 0,
      }),
      expect.objectContaining({
        commodityName: 'Chip',
        kind: 'durable',
        lifetimeSeconds: 86_400,
        inventoryQuantity: 1,
        activeDurableQuantity: 2,
      }),
    ]);
    expect(context.enterprises).toEqual([
      expect.objectContaining({
        enterpriseId: 'book-co',
        ownerAgentId: agentId,
        balance: 500,
        inventory: { Book: 3 },
        jobPosting: { wageOffer: 55, openSlots: 3 },
        wageArrears: 25,
      }),
    ]);
  });

  test('exposes the lifestyle tier only when command policies carry a lifestyle policy', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Apple: 2 },
        },
        {
          agentId: asAgentId('agent-rich'),
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 20_000,
          residentialTier: 5,
          job: 'CEO',
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
    });
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
      lifestyle: {
        policyVersion: 'lifestyle-v1',
        netWorthBoundaries: [500, 2000, 10000],
        strugglingNonSurvivalSpendCapRatio: 0.3,
        source: 'test',
      },
    };

    // Net worth = 100 balance + 2 Apples at spot 10 = 120 → struggling.
    const withPolicy = createWorldDecisionContextFromProjection({ projection, agentId, policies });
    expect(withPolicy.agent.lifestyle).toBe('struggling');

    const rich = createWorldDecisionContextFromProjection({
      projection,
      agentId: asAgentId('agent-rich'),
      policies,
    });
    expect(rich.agent.lifestyle).toBe('affluent');

    const policiesWithoutLifestyle: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
    };
    const withoutPolicy = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies: policiesWithoutLifestyle,
    });
    expect(withoutPolicy.agent.lifestyle).toBeUndefined();
  });

  test('exposes the wellbeing value and band only when command policies carry a wellbeing policy', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
          wellbeing: 85,
        },
        {
          agentId: asAgentId('agent-legacy'),
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
      wellbeing: createAivilizationTownWellbeingPolicy(),
    };

    // The settled durable value is read verbatim; the band is derived, never
    // recomputed from factors.
    const settled = createWorldDecisionContextFromProjection({ projection, agentId, policies });
    expect(settled.agent.wellbeing).toEqual({ value: 85, band: 'thriving' });

    // Legacy agents without a settled value fall back to the policy initial.
    const legacy = createWorldDecisionContextFromProjection({
      projection,
      agentId: asAgentId('agent-legacy'),
      policies,
    });
    expect(legacy.agent.wellbeing).toEqual({ value: 50, band: 'steady' });

    const policiesWithoutWellbeing: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
    };
    const withoutPolicy = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies: policiesWithoutWellbeing,
    });
    expect(withoutPolicy.agent.wellbeing).toBeUndefined();
  });

  test('exposes the lifecycle view only when command policies carry a lifecycle policy', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
          lifeStage: 'elderly',
          retiredAtMs: 86_400_000,
        },
        {
          agentId: asAgentId('agent-legacy'),
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
      clock: { now: 2 * 86_400_000, tickDurationMs: 3_600_000 },
    });
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
      lifecycle: createAivilizationTownLifecyclePolicy(),
    };

    // Stage and retirement come verbatim from the projection; the age is
    // derived with the registration rule (legacy agents count from time 0:
    // age = 2 + 21 = 23 days).
    const settled = createWorldDecisionContextFromProjection({ projection, agentId, policies });
    expect(settled.agent.lifecycle).toEqual({ stage: 'elderly', ageDays: 23, retired: true });

    const legacy = createWorldDecisionContextFromProjection({
      projection,
      agentId: asAgentId('agent-legacy'),
      policies,
    });
    expect(legacy.agent.lifecycle).toEqual({ stage: 'adult', ageDays: 23, retired: false });

    const policiesWithoutLifecycle: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
    };
    const withoutPolicy = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies: policiesWithoutLifecycle,
    });
    expect(withoutPolicy.agent.lifecycle).toBeUndefined();
  });

  test('exposes the calendar phase only when command policies carry a calendar policy', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
      clock: { now: 0, tickDurationMs: 1000 },
    });
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 20, health: 35 },
      calendar: createAivilizationTownCalendarPolicy(),
    };

    // No TownDayPhaseChanged has settled yet: the context falls back to the
    // pure clock function (night, day 0, ending at 0.175 of the day).
    const beforeEvents = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies,
    });
    expect(beforeEvents.calendar).toEqual({
      dayIndex: 0,
      phase: 'night',
      phaseEndsAtMs: 15_120_000,
      nextPhase: 'dawn',
      dayLengthMs: 86_400_000,
    });

    // After a settled transition the slice drives the view (day fraction 0.35
    // → 'day', ending at 0.8, followed by 'dusk').
    const withSlice = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
      clock: { now: 30_240_000, tickDurationMs: 1000 },
      calendar: { dayIndex: 0, phase: 'day', since: 25_920_000 },
    });
    const withEvents = createWorldDecisionContextFromProjection({
      projection: withSlice,
      agentId,
      policies,
    });
    expect(withEvents.calendar).toEqual({
      dayIndex: 0,
      phase: 'day',
      phaseEndsAtMs: 69_120_000,
      nextPhase: 'dusk',
      dayLengthMs: 86_400_000,
    });

    const withoutPolicy = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 250,
        laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
        criticalThresholds: { energy: 20, health: 35 },
      },
    });
    expect(withoutPolicy.calendar).toBeUndefined();
  });

  test('exposes direct study costs, foregone wages, and the post-study reserve', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 80, satiety: 80, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Books: 2 },
        },
      ],
    });
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 250,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 1, health: 1 },
      educationInvestment: {
        currencyCostPerHour: 20,
        inventoryCostsPerHour: { Books: 2 },
      },
    };

    expect(
      createWorldDecisionContextFromProjection({ projection, agentId, policies }).rules
        ?.educationOpportunityCost,
    ).toEqual({
      policyVersion: 'education-opportunity-cost-v2',
      studyDurationSeconds: 1800,
      educationRatePerSecond: 1 / 60,
      expectedEducationGain: 30,
      directCurrencyCost: 10,
      directInventoryCosts: { Books: 1 },
      workLaborSeconds: 3600,
      currentOccupationName: 'Cleaner',
      foregoneLaborIncome: 125,
      totalCurrencyOpportunityCost: 135,
      minimumBalanceReserve: 50,
      balanceAfterDirectCost: 90,
      directlyAffordable: true,
      preservesMinimumBalanceReserve: true,
    });
  });

  test('exposes wages, residential gaps, and production market economics for life-course decisions', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 30,
          balance: 250,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 }),
        createAmmPool({ commodity: 'Beef', commodityReserve: 100, currencyReserve: 1_000 }),
      ],
    });
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: { Apple: 25 },
      maxSatiety: 100,
      wageCalculator: (occupationName) => (occupationName === 'Cleaner' ? 251 : 300),
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 1, health: 1 },
      jobApplication: {
        populationEducationScores: [30],
        quotaByResidentialTier: [1, 1, 2, 3, 4, 5],
      },
      residentialTierUpgrade: {
        maxResidentialTier: 6,
        costs: [
          {
            targetResidentialTier: 2,
            currencyCost: 200,
            minEducationScore: 20,
            inventoryCosts: { Beef: 1 },
          },
        ],
      },
    };

    const context = createWorldDecisionContextFromProjection({ projection, agentId, policies });

    expect(
      context.rules?.occupations.find((occupation) => occupation.occupationName === 'Cleaner'),
    ).toMatchObject({ currentWage: 251 });
    expect(context.rules?.residentialUpgrade).toEqual({
      targetResidentialTier: 2,
      currencyCost: 200,
      minEducationScore: 20,
      inventoryCosts: { Beef: 1 },
      missingInventory: { Beef: 1 },
      eligible: false,
      rejectionReasons: ['insufficient-inventory'],
    });
    expect(
      context.rules?.production.find((production) => production.commodity === 'Apple'),
    ).toMatchObject({
      outputSpotPrice: 10,
      inputSpotCost: 0,
      grossMargin: 10,
      grossMarginPerSecond: 100,
    });

    const readyProjection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 30,
          balance: 250,
          residentialTier: 1,
          job: null,
          inventory: { Beef: 1 },
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 }),
        createAmmPool({ commodity: 'Beef', commodityReserve: 100, currencyReserve: 1_000 }),
      ],
    });
    expect(
      createWorldDecisionContextFromProjection({
        projection: readyProjection,
        agentId,
        policies,
      }).rules?.residentialUpgrade,
    ).toMatchObject({ eligible: true, missingInventory: {}, rejectionReasons: [] });
  });

  test('region-aware override exposes only the agent region pools when pools are region-tagged', () => {
    const downtownMarket = asLocationId('downtown-market');
    const projection = createWorldProjection({
      locations: [
        {
          locationId: downtownMarket,
          name: 'Downtown Market',
          kind: 'market',
          activityAffinities: ['trade'],
          capacity: null,
          regionId: 'downtown',
        },
      ],
      agents: [
        {
          agentId,
          locationId: downtownMarket,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const context = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      // The authority holds two regional Fish pools: downtown spot 10, harbor
      // spot 4. An agent standing downtown must only see the downtown price.
      marketOverride: {
        marketPools: {
          'downtown::Fish': {
            commodity: 'Fish',
            commodityReserve: 200,
            currencyReserve: 2_000,
            regionId: 'downtown',
          },
          'harbor::Fish': {
            commodity: 'Fish',
            commodityReserve: 200,
            currencyReserve: 800,
            regionId: 'harbor',
          },
        },
      },
    });

    expect(context.market.spotPrices).toEqual([{ commodity: 'Fish', spotPrice: 10 }]);
  });

  test('exposes the projection weather to agent planning context only when present', () => {
    const createAgentProjection = (weather?: { current: 'rainy'; since: number }) =>
      createWorldProjection({
        agents: [
          {
            agentId,
            locationId: null,
            physiology: { energy: 45, satiety: 30, health: 90 },
            educationScore: 31,
            balance: 100,
            residentialTier: 1,
            job: null,
            inventory: {},
          },
        ],
        ...(weather === undefined ? {} : { weather }),
      });

    expect(
      createWorldDecisionContextFromProjection({
        projection: createAgentProjection(),
        agentId,
      }).weather,
    ).toBeUndefined();
    expect(
      createWorldDecisionContextFromProjection({
        projection: createAgentProjection({ current: 'rainy', since: 3_600_000 }),
        agentId,
      }).weather,
    ).toEqual({ current: 'rainy', since: 3_600_000 });
  });

  test('derives town conditions into planning context only when the catalog policy is present', () => {
    const conditionPolicy: NonNullable<WorldCommandPolicies['conditions']> = {
      policyVersion: 'town-conditions-v1',
      soaked: {
        outdoorSeverityByWeather: { rainy: 'moderate', stormy: 'severe' },
        need: 'shelter',
      },
      cold: {
        outdoorSeverityByWeather: { snowy: 'severe', foggy: 'moderate' },
        shelteredSeverity: 'mild',
        shelteredMaxResidentialTier: 1,
        need: 'warm-up',
      },
      overtired: { triggerBelow: 30, severeBelow: 10, need: 'sleep' },
      hungry: { triggerBelow: 30, severeBelow: 10, need: 'eat' },
      stressed: { triggerBelow: 40, severeBelow: 20, need: 'see-doctor' },
    };
    const basePolicies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 0,
      laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
      criticalThresholds: { energy: 0, health: 0 },
    };
    const projection = createWorldProjection({
      locations: [
        {
          locationId: asLocationId('main-square'),
          name: 'Main Square',
          kind: 'social',
          activityAffinities: ['socialize'],
          capacity: null,
        },
      ],
      agents: [
        {
          agentId,
          locationId: asLocationId('main-square'),
          physiology: { energy: 5, satiety: 80, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      weather: { current: 'rainy', since: 3_600_000 },
    });

    // Flag off (no conditions policy): the context stays condition-free.
    expect(
      createWorldDecisionContextFromProjection({ projection, agentId, policies: basePolicies })
        .conditions,
    ).toBeUndefined();

    // Flag on: rainy weather at the open-air square soaks the agent, and the
    // exhausted energy axis grades overtired as severe.
    expect(
      createWorldDecisionContextFromProjection({
        projection,
        agentId,
        policies: { ...basePolicies, conditions: conditionPolicy },
      }).conditions,
    ).toEqual([
      { kind: 'soaked', severity: 'moderate', need: 'shelter' },
      { kind: 'overtired', severity: 'severe', need: 'sleep' },
    ]);
  });
});

describe('worker social-matter decision context', () => {
  const policies: WorldCommandPolicies = {
    satietyRecoveryByCommodity: {},
    maxSatiety: 100,
    wageCalculator: () => 0,
    laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
    criticalThresholds: { energy: 0, health: 0 },
    socialMatters: { policyVersion: 'social-matters-v1', defaultExpiryMs: 14_400_000 },
  };

  test('gates the view by policy and exposes only relevant unresolved matters', () => {
    const projection = createProjectionWithMatters([
      createMatterState({
        matterId: 'assigned-to-me',
        initiatorAgentId: asAgentId('agent-b'),
        status: 'assigned',
        assigneeAgentId: agentId,
        responses: [{ responderAgentId: agentId, decision: 'accept', respondedAt: 20 }],
        expiresAt: 200,
      }),
      createMatterState({
        matterId: 'my-request',
        initiatorAgentId: agentId,
        status: 'collecting',
        topic: `  Need\u0000   ${'food '.repeat(30)} `,
        statement: 'S'.repeat(400),
        responses: [
          { responderAgentId: asAgentId('agent-c'), decision: 'accept', respondedAt: 30 },
          ...Array.from({ length: 9 }, (_, index) => ({
            responderAgentId: asAgentId(`agent-r${index}`),
            decision: 'reject' as const,
            respondedAt: 40 + index,
          })),
        ],
        expiresAt: 300,
      }),
      createMatterState({
        matterId: 'responded-by-me',
        initiatorAgentId: asAgentId('agent-b'),
        status: 'open',
        responses: [{ responderAgentId: agentId, decision: 'defer', respondedAt: 40 }],
        expiresAt: 400,
      }),
      createMatterState({
        matterId: 'available-help',
        initiatorAgentId: asAgentId('agent-b'),
        status: 'open',
        expiresAt: 500,
      }),
      createMatterState({
        matterId: 'unrelated-commitment',
        initiatorAgentId: asAgentId('agent-b'),
        kind: 'commitment',
        status: 'latent',
        assigneeAgentId: asAgentId('agent-c'),
        expiresAt: 600,
      }),
      createMatterState({
        matterId: 'closed-matter',
        initiatorAgentId: agentId,
        status: 'closed',
        closure: 'fulfilled',
        expiresAt: 700,
      }),
    ]);

    expect(
      createWorldDecisionContextFromProjection({ projection, agentId }).matters,
    ).toBeUndefined();
    const matters = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies,
    }).matters;

    expect(matters?.map(({ matterId, role }) => ({ matterId, role }))).toEqual([
      { matterId: 'assigned-to-me', role: 'assignee' },
      { matterId: 'my-request', role: 'initiator' },
      { matterId: 'responded-by-me', role: 'responder' },
      { matterId: 'available-help', role: 'available' },
    ]);
    expect(matters?.[1]?.responses[0]).toMatchObject({
      responderAgentId: 'agent-c',
      decision: 'accept',
    });
    expect(matters?.[1]?.responses).toHaveLength(8);
    expect(matters?.[1]?.topic).not.toContain('\u0000');
    expect(Array.from(matters?.[1]?.topic ?? '')).toHaveLength(120);
    expect(Array.from(matters?.[1]?.statement ?? '')).toHaveLength(320);
    expect(matters?.[2]?.myResponse).toBe('defer');
  });

  test('sorts available matters by expiry and applies the hard cap', () => {
    const projection = createProjectionWithMatters(
      Array.from({ length: 10 }, (_, index) =>
        createMatterState({
          matterId: `matter-${index}`,
          initiatorAgentId: asAgentId('agent-b'),
          status: 'open',
          expiresAt: 1_000 - index,
        }),
      ),
    );

    expect(
      createWorldDecisionContextFromProjection({ projection, agentId, policies }).matters?.map(
        (matter) => matter.matterId,
      ),
    ).toEqual([
      'matter-9',
      'matter-8',
      'matter-7',
      'matter-6',
      'matter-5',
      'matter-4',
      'matter-3',
      'matter-2',
    ]);
  });

  test('retains a remote matter counterpart in the bounded society view without a relation', () => {
    const remoteInitiator = asAgentId('agent-b');
    const projection = createProjectionWithMatters([
      createMatterState({
        matterId: 'remote-assignment',
        initiatorAgentId: remoteInitiator,
        status: 'assigned',
        assigneeAgentId: agentId,
        responses: [{ responderAgentId: agentId, decision: 'accept', respondedAt: 20 }],
        expiresAt: 500,
      }),
    ]);

    const context = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies,
      societyDirectory: createSocietyDirectoryFixture({ foreignAgentIds: [remoteInitiator] }),
    });

    expect(context.agent.relations).toBeUndefined();
    expect(context.society?.agents.map((agent) => agent.agentId)).toContain(remoteInitiator);
  });
});

describe('worker housing decision context', () => {
  const basePolicies: WorldCommandPolicies = {
    satietyRecoveryByCommodity: {},
    maxSatiety: 100,
    wageCalculator: () => 250,
    laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
    criticalThresholds: { energy: 20, health: 35 },
  };

  test('exposes region, land value index, and effective upkeep rate from the authoritative sources', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 2,
          job: null,
          inventory: {},
        },
      ],
    });
    const projection = replayEvents(
      initial,
      [
        createEventEnvelope({
          id: 'event-land-value',
          simulationId: 'sim-1',
          commandId: 'command-time',
          type: 'RegionalLandValueUpdated',
          payload: {
            regionId: 'town-center',
            previousIndex: 0,
            nextIndex: 8,
            rawIndex: 8,
            agentCount: 1,
            marketLiquidity: 0,
            policyVersion: 'land-value-v1',
            settledAt: 86_400_000,
            reason: 'land-value-cadence' as const,
          },
          occurredAt: 86_400_000,
          sequence: 1,
        }),
      ],
      applyWorldEvent,
    );
    const policies: WorldCommandPolicies = {
      ...basePolicies,
      residentialUpkeep: {
        policyVersion: 'residential-upkeep-v2',
        costs: [{ residentialTier: 2, currencyCostPerHour: 10 }],
        landValueCoefficientPerHour: 0.5,
      },
      landValue: {
        policyVersion: 'land-value-v1',
        updateCadenceMs: 86_400_000,
        baseline: 0,
        populationWeight: 2,
        liquidityWeight: 1,
        smoothingFactor: 0.4,
        minIndex: 0,
        maxIndex: 100,
      },
    };

    const context = createWorldDecisionContextFromProjection({ projection, agentId, policies });
    expect(context.agent.regionId).toBe('town-center');
    expect(context.agent.regionalLandValueIndex).toBe(8);
    expect(context.agent.residentialUpkeepRatePerHour).toBe(14);

    // Without an active land value policy the settlement prices flat, so the
    // context must hide the persisted index and report the flat rate too.
    const policiesWithoutLandValue: WorldCommandPolicies = {
      ...basePolicies,
      residentialUpkeep: {
        policyVersion: 'residential-upkeep-v2',
        costs: [{ residentialTier: 2, currencyCostPerHour: 10 }],
        landValueCoefficientPerHour: 0.5,
      },
    };
    const flatContext = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies: policiesWithoutLandValue,
    });
    expect(flatContext.agent.regionId).toBe('town-center');
    expect(flatContext.agent.regionalLandValueIndex).toBeUndefined();
    expect(flatContext.agent.residentialUpkeepRatePerHour).toBe(10);
  });

  test('omits housing price signals when policies carry no residential upkeep', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId,
          physiology: { energy: 45, satiety: 30, health: 90 },
          educationScore: 31,
          balance: 100,
          residentialTier: 2,
          job: null,
          inventory: {},
        },
      ],
    });

    const context = createWorldDecisionContextFromProjection({
      projection,
      agentId,
      policies: basePolicies,
    });
    expect(context.agent.regionId).toBeUndefined();
    expect(context.agent.regionalLandValueIndex).toBeUndefined();
    expect(context.agent.residentialUpkeepRatePerHour).toBeUndefined();
  });
});

function createLocalAgent(localAgentId: AgentId) {
  return {
    agentId: localAgentId,
    locationId: null,
    physiology: { energy: 45, satiety: 30, health: 90 },
    educationScore: 31,
    balance: 100,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}

function createProjectionWithMatters(matters: readonly WorldSocialMatterState[]): WorldProjection {
  return {
    ...createWorldProjection({ agents: [createLocalAgent(agentId)] }),
    socialMatters: Object.fromEntries(matterEntries(matters)),
  };
}

function matterEntries(
  matters: readonly WorldSocialMatterState[],
): readonly (readonly [string, WorldSocialMatterState])[] {
  return matters.map((matter) => [matter.matterId, matter] as const);
}

function createMatterState(
  input: Pick<WorldSocialMatterState, 'matterId' | 'initiatorAgentId' | 'status' | 'expiresAt'> &
    Partial<
      Pick<
        WorldSocialMatterState,
        'kind' | 'closure' | 'topic' | 'statement' | 'assigneeAgentId' | 'responses'
      >
    >,
): WorldSocialMatterState {
  return {
    matterId: input.matterId,
    kind: input.kind ?? 'help-request',
    status: input.status,
    ...(input.closure === undefined ? {} : { closure: input.closure }),
    initiatorAgentId: input.initiatorAgentId,
    topic: input.topic ?? `Topic ${input.matterId}`,
    statement: input.statement ?? `Statement ${input.matterId}`,
    ...(input.assigneeAgentId === undefined ? {} : { assigneeAgentId: input.assigneeAgentId }),
    responses: input.responses ?? [],
    createdAt: 10,
    expiresAt: input.expiresAt,
  };
}

function createRelation(input: {
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly relationScore: number;
  readonly relationLabel: SocialRelationState['relationLabel'];
}): SocialRelationState {
  return {
    sourceAgentId: input.sourceAgentId,
    targetAgentId: input.targetAgentId,
    relationScore: input.relationScore,
    attitudeScore: 0.1,
    relationLabel: input.relationLabel,
    interactionCount: 3,
    lastInteractionSummary: 'chatted at the market',
  };
}

function createSocietyDirectoryFixture(
  input: { readonly foreignAgentIds?: readonly AgentId[] } = {},
): LocalSimulationSocietyDirectory {
  const foreignAgentIds = input.foreignAgentIds ?? [asAgentId('agent-b')];
  return {
    schemaVersion: 'local-simulation-society-directory-v1',
    directoryId: `local-simulation-society-directory:sha256:${'a'.repeat(64)}`,
    manifestId: 'town-runtime',
    simulationId: asSimulationId('sim-1'),
    partitionBoundaries: [
      {
        partitionKey: 'world-east',
        lastAppliedSequence: 12,
        snapshotSequence: 12,
        simulationTime: 1_000,
      },
      {
        partitionKey: 'world-main',
        lastAppliedSequence: 9,
        snapshotSequence: 9,
        simulationTime: 1_000,
      },
    ],
    agents: [
      {
        agentId,
        ownerPartitionKey: 'world-main',
        ownerLastAppliedSequence: 9,
        publicState: {
          locationId: asLocationId('market'),
          job: null,
          residentialTier: 1,
          educationScore: 31,
        },
      },
      ...foreignAgentIds.map((foreignAgentId) => ({
        agentId: foreignAgentId,
        ownerPartitionKey: 'world-east',
        ownerLastAppliedSequence: 12,
        publicState: {
          locationId: asLocationId('market'),
          job: 'Commuter',
          residentialTier: 2,
          educationScore: 60,
          ...(foreignAgentId === asAgentId('agent-b') ? { displayName: 'B' } : {}),
        },
      })),
    ],
  };
}
