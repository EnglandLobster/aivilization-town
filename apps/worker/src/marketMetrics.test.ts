import { createAmmPool } from '@aivilization/economy';
import {
  InMemoryEventStore,
  asAgentId,
  asLoanId,
  asSimulationId,
  createEventEnvelope,
  createSimulationPartition,
} from '@aivilization/sim-core';
import {
  applyWorldEvent,
  createWorldProjection,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createEconomicCompositionPayload,
  createMarketPriceSnapshotsFromProjections,
  recordMarketMetricsToEventStream,
} from './index';

const simulationId = asSimulationId('sim-market-metrics');
const partition = createSimulationPartition({ simulationId, partitionKey: 'world-main' });

describe('worker market metrics', () => {
  test('records price indices from current AMM pools against a baseline projection idempotently', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const baselineProjection = createWorldProjection({
      agents: [],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
        createAmmPool({ commodity: 'Bread', commodityReserve: 100, currencyReserve: 1000 }),
        createAmmPool({ commodity: 'Wood', commodityReserve: 100, currencyReserve: 1000 }),
        createAmmPool({ commodity: 'Book', commodityReserve: 100, currencyReserve: 1000 }),
      ],
    });
    const currentProjection = createWorldProjection({
      agents: [],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 2000 }),
        createAmmPool({ commodity: 'Bread', commodityReserve: 100, currencyReserve: 8000 }),
        createAmmPool({ commodity: 'Wood', commodityReserve: 100, currencyReserve: 4000 }),
        createAmmPool({ commodity: 'Book', commodityReserve: 100, currencyReserve: 1000 }),
      ],
    });

    const input = {
      simulationId,
      baselineProjection,
      currentProjection,
      baselineAt: 0,
      issuedAt: 100,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'market-index:tick-1',
    };
    const result = recordMarketMetricsToEventStream(input);
    const replay = recordMarketMetricsToEventStream(input);

    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'MarketPriceIndexRecorded'],
      [2, 'EconomicCompositionRecorded'],
    ]);
    expect(result.projection.marketPriceIndices[0]).toMatchObject({
      baselineAt: 0,
      recordedAt: 100,
      food: 4,
      nonFood: 2,
      overall: 3,
      foodCount: 2,
      nonFoodCount: 2,
    });
    expect(result.projection.marketPriceIndices[0]?.ratios).toEqual({
      Apple: 2,
      Bread: 8,
      Wood: 4,
      Book: 1,
    });
    expect(result.appendResult).toMatchObject({
      streamVersion: 2,
      idempotentReplay: false,
    });
    expect(replay.appendResult.idempotentReplay).toBe(true);
    expect(eventStore.readStream(partition.eventStreamName)).toHaveLength(2);
  });

  test('derives index values from the authority pool override without mutating the partition projection', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    // The partition's own baseline/current pools are stale: they only reflect
    // this partition's own trades (Apple currency still 1000, spot price 10).
    const baselineProjection = createWorldProjection({
      agents: [],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
    });
    const currentProjection = createWorldProjection({
      agents: [],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
    });

    const result = recordMarketMetricsToEventStream({
      simulationId,
      baselineProjection,
      currentProjection,
      // The unified authority baseline and current pools: the authoritative
      // global market has doubled Apple's price to 20 (2000 / 100).
      baselineMarketOverride: {
        marketPools: {
          Apple: { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 },
        },
      },
      currentMarketOverride: {
        marketPools: {
          Apple: { commodity: 'Apple', commodityReserve: 100, currencyReserve: 2000 },
        },
      },
      baselineAt: 0,
      issuedAt: 100,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'market-index-override:tick-1',
    });

    // The recorded index reflects the authoritative override (ratio 2), not the
    // stale partition pool (which would be ratio 1).
    expect(result.projection.marketPriceIndices[0]?.ratios).toEqual({ Apple: 2 });

    // Pool-derived composition fields read the same override (2000), not the
    // stale partition pool (1000).
    expect(result.projection.economicComposition?.composition.ammPoolCurrency).toBe(2000);

    // Checkpoint invariant: the projection's own AMM pool is untouched by the
    // override, so the persisted snapshot still equals partition-stream replay.
    expect(result.projection.marketPools.Apple).toEqual({
      commodity: 'Apple',
      commodityReserve: 100,
      currencyReserve: 1000,
    });
  });

  test('regional pools aggregate to one liquidity-weighted snapshot per commodity', () => {
    // Regional markets produce several pools per commodity (downtown + harbor).
    // The price index is a single town-wide series and must not crash on the
    // duplicate commodity nor produce a duplicate entry; each commodity collapses
    // to one snapshot.
    const baselineProjection = createWorldProjection({ agents: [] });
    const currentProjection = createWorldProjection({ agents: [] });
    const snapshots = createMarketPriceSnapshotsFromProjections({
      baselineProjection,
      currentProjection,
      baselineMarketOverride: {
        marketPools: {
          'downtown::Fish': {
            commodity: 'Fish',
            commodityReserve: 100,
            currencyReserve: 1_000,
            regionId: 'downtown',
          },
          'harbor::Fish': {
            commodity: 'Fish',
            commodityReserve: 100,
            currencyReserve: 400,
            regionId: 'harbor',
          },
        },
      },
      currentMarketOverride: {
        marketPools: {
          'downtown::Fish': {
            commodity: 'Fish',
            commodityReserve: 100,
            currencyReserve: 1_500,
            regionId: 'downtown',
          },
          'harbor::Fish': {
            commodity: 'Fish',
            commodityReserve: 100,
            currencyReserve: 600,
            regionId: 'harbor',
          },
        },
      },
    });

    // Exactly one Fish snapshot, not two. Prices aggregate both regions by
    // commodity reserve: (1000+400)/(100+100)=7, then 10.5.
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.commodity).toBe('Fish');
    expect(snapshots[0]?.baselinePrice).toBeCloseTo(7);
    expect(snapshots[0]?.currentPrice).toBeCloseTo(10.5);
  });
});

describe('worker economic composition metrics', () => {
  test('records every composition field from a projection with enterprise, treasury, bank and external market', () => {
    const agentA = asAgentId('agent-a');
    const agentB = asAgentId('agent-b');
    const pools = [
      createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      createAmmPool({ commodity: 'Wood', commodityReserve: 200, currencyReserve: 1000 }),
    ];
    const currentProjection = createWorldProjection({
      agents: [
        {
          agentId: agentA,
          physiology: { energy: 50, satiety: 80, health: 100 },
          educationScore: 10,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: { Apple: 10 },
        },
        {
          agentId: agentB,
          physiology: { energy: 50, satiety: 80, health: 100 },
          educationScore: 10,
          balance: 300,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      enterprises: [
        {
          enterpriseId: 'enterprise-1',
          name: 'Bakery',
          ownerAgentId: agentA,
          occupationName: 'Baker',
          balance: 700,
          inventory: {},
          maxEmployees: 2,
          employeeAgentIds: [],
          status: 'active',
          foundedAt: 0,
          cumulativeSales: 0,
          cumulativePurchases: 0,
          cumulativeWages: 0,
        },
        {
          enterpriseId: 'enterprise-2',
          name: 'Closed Sawmill',
          ownerAgentId: agentA,
          occupationName: 'Carpenter',
          balance: 0,
          inventory: {},
          maxEmployees: 1,
          employeeAgentIds: [],
          status: 'closed',
          foundedAt: 0,
          closedAt: 50,
          cumulativeSales: 0,
          cumulativePurchases: 0,
          cumulativeWages: 0,
        },
      ],
      marketPools: pools,
      moneySupply: 1650,
      treasury: 50,
      bank: {
        balance: 500,
        deposits: { [agentA]: 200, [agentB]: 100 },
        loans: {
          'loan-1': {
            loanId: asLoanId('loan-1'),
            borrowerAgentId: agentB,
            principal: 400,
            dailyInterestRate: 0.01,
            termDays: 10,
            issuedAt: 0,
            accruedInterest: 20,
            lastAccrualAt: 0,
            missedPayments: 0,
            status: 'active',
          },
          'loan-2': {
            loanId: asLoanId('loan-2'),
            borrowerAgentId: agentA,
            principal: 0,
            dailyInterestRate: 0.01,
            termDays: 10,
            issuedAt: 0,
            accruedInterest: 0,
            lastAccrualAt: 0,
            missedPayments: 0,
            status: 'repaid',
          },
        },
        creditHistoryByAgent: {},
      },
      bankruptEnterpriseTotal: 1,
    });
    // One external-market rebalance injected 250 net currency into the pools.
    const withExternalMarket = applyWorldEvent(
      currentProjection,
      createEventEnvelope({
        id: 'event-external-rebalance',
        simulationId,
        type: 'ExternalMarketRebalanced',
        payload: {
          policyVersion: 'external-market-v1',
          commodityName: 'Apple',
          poolAfter: pools[0]!,
          commodityReserveDelta: 0,
          currencyReserveDelta: 250,
          settledAt: 90,
        },
        occurredAt: 90,
        sequence: 1,
      }),
    );

    const payload = createEconomicCompositionPayload({
      projection: withExternalMarket,
      recordedAt: 100,
    });

    expect(payload).toMatchObject({
      recordedAt: 100,
      moneySupply: 1650,
      composition: {
        agents: 400,
        enterprises: 700,
        treasury: 50,
        bank: 500,
        ammPoolCurrency: 2000,
        // Apple 100 × spot 10 + Wood 200 × spot 5.
        ammPoolCommodityValue: 2000,
        externalNetInflow: 250,
      },
      enterprises: { total: 2, active: 1, insolvent: 0, bankruptTotal: 1 },
      deposits: 300,
      loansOutstanding: 420,
    });
    // Net worth: agent-a 100 + 10 Apple × 10 = 200, agent-b 300 → Gini 0.1.
    expect(payload.gini).toBeCloseTo(0.1, 12);
  });

  test('defaults absent treasury, bank and external market to zero and gini to zero without agents', () => {
    const projection = createWorldProjection({
      agents: [],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
    });

    expect(createEconomicCompositionPayload({ projection, recordedAt: 7 })).toEqual({
      recordedAt: 7,
      moneySupply: 0,
      composition: {
        agents: 0,
        enterprises: 0,
        treasury: 0,
        bank: 0,
        ammPoolCurrency: 1000,
        ammPoolCommodityValue: 1000,
        externalNetInflow: 0,
      },
      enterprises: { total: 0, active: 0, insolvent: 0, bankruptTotal: 0 },
      gini: 0,
      deposits: 0,
      loansOutstanding: 0,
    });
  });

  test('appends the composition event in the same batch as the price index and applies it', () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const pools = [
      createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
    ];
    const baselineProjection = createWorldProjection({ agents: [], marketPools: pools });
    const currentProjection: WorldProjection = createWorldProjection({
      agents: [],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 2000 }),
      ],
      moneySupply: 500,
    });

    const result = recordMarketMetricsToEventStream({
      simulationId,
      baselineProjection,
      currentProjection,
      baselineAt: 0,
      issuedAt: 100,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'market-metrics:tick-2',
    });

    const compositionEvent = result.events[1];
    expect(compositionEvent).toMatchObject({
      id: 'market-metrics:tick-2:event:economic-composition',
      type: 'EconomicCompositionRecorded',
      sequence: 2,
      occurredAt: 100,
    });
    expect(result.projection.economicComposition).toEqual({
      recordedAt: 100,
      moneySupply: 500,
      composition: {
        agents: 0,
        enterprises: 0,
        treasury: 0,
        bank: 0,
        ammPoolCurrency: 2000,
        ammPoolCommodityValue: 2000,
        externalNetInflow: 0,
      },
      enterprises: { total: 0, active: 0, insolvent: 0, bankruptTotal: 0 },
      gini: 0,
      deposits: 0,
      loansOutstanding: 0,
    });
  });
});
