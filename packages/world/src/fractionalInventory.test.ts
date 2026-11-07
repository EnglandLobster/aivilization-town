import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import { sellToPool, evaluateExternalExportPrice } from '@aivilization/economy';
import { expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
  type WorldEvent,
} from './index';

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { 'Apple Pie': 10 },
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  externalTrade: {
    policyVersion: 'external-trade-v1',
    balanceDecayRatioPerCadence: 0.01,
    cadenceMs: 1000,
    priceImpactRatio: 0.2,
    balanceScale: 50,
    source: 'precision regression',
  },
  consumption: {
    policyVersion: 'consumption-v1',
    rules: { 'Apple Pie': { kind: 'consumable', utilityPoints: 5 } },
  },
};
test.each([
  'AgentEat',
  'AgentConsume',
  'AgentGiveResource',
  'AgentTrade',
  'AgentExportCommodity',
] as const)(
  'actual sharing remainder can be used through %s without creating inventory',
  (type) => {
    const initial = createWorldProjection({
      marketPools: [{ commodity: 'Apple Pie', commodityReserve: 100, currencyReserve: 1000 }],
      locations: [
        {
          locationId: asLocationId('square'),
          name: 'Square',
          kind: 'social',
          activityAffinities: ['socialize'],
          capacity: null,
        },
      ],
      agents: ['cook', 'neighbor'].map((id) => ({
        agentId: asAgentId(id),
        physiology: { energy: 100, satiety: 0, health: 100 },
        educationScore: 0,
        balance: 0,
        residentialTier: 1,
        job: null,
        inventory: id === 'cook' ? { 'Apple Pie': 1 } : {},
        locationId: asLocationId('square'),
      })),
    });
    let world = initial;
    const journal: WorldEvent[] = [];
    const send = (kind: typeof type | 'AgentGiveResource', quantity: number) => {
      const events = dispatchWorldCommand({
        projection: world,
        policies,
        nextSequence: journal.length + 1,
        command: createCommandEnvelope({
          id: `fraction-${journal.length}`,
          simulationId: 'fraction',
          source: 'agent-runtime',
          actorId: 'cook',
          issuedAt: 0,
          type: kind,
          payload: {
            commodityName: 'Apple Pie',
            quantity,
            ...(kind === 'AgentTrade' ? { side: 'sell' } : {}),
            ...(kind === 'AgentGiveResource' ? { targetAgentId: 'neighbor' } : {}),
          },
        }),
      });
      journal.push(...events);
      world = events.reduce(applyWorldEvent, world);
      return events;
    };
    send('AgentGiveResource', 0.4);
    send('AgentGiveResource', 0.4);
    const available = world.agents.cook!.inventory['Apple Pie']!;
    expect(available).toBe(0.19999999999999996);
    const before = world;
    const events = send(type, 0.2);
    expect(events.some((e) => e.type === 'ActionRejected')).toBe(false);
    expect(world.agents.cook!.inventory).toEqual({});
    if (type === 'AgentEat') expect(world.agents.cook!.physiology.satiety).toBe(available * 10);
    if (type === 'AgentGiveResource') expect(world.agents.neighbor!.inventory['Apple Pie']).toBe(1);
    if (type === 'AgentTrade') {
      const trade = events.find((e) => e.type === 'TradeExecuted')!;
      const expected = sellToPool(before.marketPools['Apple Pie']!, available);
      expect(trade.payload.commodityQuantity).toBe(available);
      expect(trade.payload.poolAfter).toEqual(expected.poolAfter);
      expect(trade.payload.currencyQuantity).toBe(-expected.currencyDelta);
    }
    if (type === 'AgentExportCommodity') {
      const trade = events.find((e) => e.type === 'ExternalTradeExecuted')!;
      const expected = evaluateExternalExportPrice({
        spotPrice: 10,
        quantity: available,
        netExportBalance: 0,
        policy: policies.externalTrade!,
      });
      expect(trade.payload.quantity).toBe(available);
      expect(trade.payload.totalCurrency).toBe(expected.total);
    }
    const inventoryEvent = events.find((e) => e.type === 'InventoryChanged');
    if (inventoryEvent) {
      expect(() =>
        applyWorldEvent(before, {
          ...inventoryEvent,
          payload: {
            ...inventoryEvent.payload,
            quantityResolution: { ...inventoryEvent.payload.quantityResolution!, settled: 0.2 },
          },
        }),
      ).toThrow('inventory-quantity-resolution-mismatch');
      const { quantityResolution, ...legacyPayload } = inventoryEvent.payload;
      expect(quantityResolution?.policyVersion).toBe('inventory-request-precision-v1');
      expect(
        applyWorldEvent(before, { ...inventoryEvent, payload: legacyPayload }).agents.cook!
          .inventory,
      ).toEqual({});
      expect(() =>
        applyWorldEvent(before, { ...inventoryEvent, payload: { ...legacyPayload, delta: -0.2 } }),
      ).toThrow('insufficient');
    }
    expect(journal.reduce(applyWorldEvent, initial)).toEqual(world);
    expect(send(type, 1e-20).some((e) => e.type === 'ActionRejected')).toBe(true);
  },
);
