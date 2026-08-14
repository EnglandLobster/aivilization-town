import { createAmmPool } from '@aivilization/economy';
import {
  asAgentId,
  asLocationId,
  asSimulationId,
  createEventEnvelope,
  replayEvents,
} from '@aivilization/sim-core';
import {
  applyWorldEvent,
  createBankState,
  createWorldProjection,
  type WorldCommandPolicies,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { createWorldDecisionContextFromProjection } from './worldDecisionContext';
import type { LocalSimulationSocietyDirectory } from './localSimulationSocietyDirectory';

const agentId = asAgentId('agent-a');

describe('worker world decision context', () => {
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

    expect(context.society).toMatchObject({
      directoryId: societyDirectory.directoryId,
      partitionBoundaries: [
        { partitionKey: 'world-east', lastAppliedSequence: 12 },
        { partitionKey: 'world-main', lastAppliedSequence: 9 },
      ],
      agents: [
        { agentId: 'agent-a', ownerPartitionKey: 'world-main' },
        {
          agentId: 'agent-b',
          ownerPartitionKey: 'world-east',
          job: 'Cashier',
          displayName: 'B',
        },
      ],
    });
    expect(JSON.stringify(context.society)).not.toContain('Apple');
    expect(JSON.stringify(context.society)).not.toContain('balance');
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
