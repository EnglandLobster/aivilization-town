import {
  asAgentId,
  createCommandEnvelope,
  replayEvents,
  type CoreCommandType,
} from '@aivilization/sim-core';
import type { ExternalTradePolicy } from '@aivilization/economy';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from './index';

const externalTradePolicy: ExternalTradePolicy = {
  policyVersion: 'external-trade-v1',
  balanceDecayRatioPerCadence: 0.01,
  cadenceMs: 1_000,
  priceImpactRatio: 0.2,
  balanceScale: 50,
  source: 'world external trade integration test fixture',
};

const basePolicies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
};

const policies: WorldCommandPolicies = {
  ...basePolicies,
  externalTrade: externalTradePolicy,
};

function createAgent(agentId: string, balance: number, inventory: Record<string, number> = {}) {
  return {
    agentId: asAgentId(agentId),
    locationId: null,
    physiology: { energy: 100, satiety: 100, health: 100 },
    educationScore: 0,
    balance,
    residentialTier: 1,
    job: null,
    inventory,
  };
}

function createEnterprise(enterpriseId: string, ownerAgentId: string) {
  return {
    enterpriseId,
    name: 'Farm',
    ownerAgentId: asAgentId(ownerAgentId),
    occupationName: 'Farmer',
    balance: 200,
    inventory: { Apple: 20 },
    maxEmployees: 2,
    employeeAgentIds: [],
    status: 'active' as const,
    foundedAt: 0,
    cumulativeSales: 0,
    cumulativePurchases: 0,
    cumulativeWages: 0,
  };
}

function createTradingProjection() {
  return createWorldProjection({
    agents: [createAgent('agent-1', 100, { Apple: 10 }), createAgent('agent-2', 100)],
    marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 }],
    moneySupply: 1_000,
    clock: { now: 0, tickDurationMs: 1_000 },
  });
}

function makeCommand(input: {
  readonly id: string;
  readonly actorId: string;
  readonly type: CoreCommandType;
  readonly payload: unknown;
  readonly issuedAt: number;
}) {
  return createCommandEnvelope({
    id: input.id,
    simulationId: 'sim-external-trade',
    actorId: input.actorId,
    type: input.type,
    payload: input.payload,
    issuedAt: input.issuedAt,
  });
}

function settle(
  projection: WorldProjection,
  command: ReturnType<typeof makeCommand>,
  nextSequence: number,
): { readonly events: WorldEvent[]; readonly projection: WorldProjection } {
  const events = dispatchWorldCommand({
    command,
    projection,
    policies,
    nextSequence,
  });
  return { events, projection: events.reduce(applyWorldEvent, projection) };
}

describe('external trade commands', () => {
  test('agent export injects currency from the external sector and raises the net-export balance', () => {
    const projection = createTradingProjection();
    const { events, projection: updated } = settle(
      projection,
      makeCommand({
        id: 'export-1',
        actorId: 'agent-1',
        type: 'AgentExportCommodity',
        payload: { commodityName: 'Apple', quantity: 5 },
        issuedAt: 0,
      }),
      1,
    );

    expect(events.map((event) => event.type)).toEqual([
      'ExternalTradeExecuted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      trader: { agentId: 'agent-1' },
      direction: 'export',
      commodityName: 'Apple',
      quantity: 5,
      unitPrice: 10,
      totalCurrency: 50,
      balanceBefore: 0,
      balanceAfter: 5,
      spotPrice: 10,
      policyVersion: 'external-trade-v1',
    });

    expect(updated.agents['agent-1']?.balance).toBe(150);
    expect(updated.agents['agent-1']?.inventory).toEqual({ Apple: 5 });
    // Export = injection: the external sector pays into circulation.
    expect(updated.moneySupply).toBe(1_050);
    expect(updated.externalTrade).toEqual({
      balancesByCommodity: { Apple: 5 },
      lastDecayAt: 0,
    });
  });

  test('a second export at a positive net-export balance earns a lower unit price', () => {
    const projection = createTradingProjection();
    const first = settle(
      projection,
      makeCommand({
        id: 'export-1',
        actorId: 'agent-1',
        type: 'AgentExportCommodity',
        payload: { commodityName: 'Apple', quantity: 5 },
        issuedAt: 0,
      }),
      1,
    );
    const second = settle(
      first.projection,
      makeCommand({
        id: 'export-2',
        actorId: 'agent-1',
        type: 'AgentExportCommodity',
        payload: { commodityName: 'Apple', quantity: 5 },
        issuedAt: 100,
      }),
      first.events.length + 1,
    );

    const firstPrice = (first.events[0]?.payload as { unitPrice: number }).unitPrice;
    const secondPayload = second.events[0]?.payload as {
      unitPrice: number;
      totalCurrency: number;
      balanceBefore: number;
      balanceAfter: number;
    };
    // √5/50 × 0.2 ≈ 0.89% below spot.
    expect(secondPayload.balanceBefore).toBe(5);
    expect(secondPayload.balanceAfter).toBe(10);
    expect(secondPayload.unitPrice).toBeLessThan(firstPrice);
    expect(secondPayload.unitPrice).toBeCloseTo(9.9106, 3);
    expect(second.projection.moneySupply).toBeCloseTo(1_000 + 50 + 49.5528, 3);
  });

  test('agent import burns currency to the external sector and lowers the balance', () => {
    const projection = createTradingProjection();
    const first = settle(
      projection,
      makeCommand({
        id: 'import-1',
        actorId: 'agent-2',
        type: 'AgentImportCommodity',
        payload: { commodityName: 'Apple', quantity: 4 },
        issuedAt: 0,
      }),
      1,
    );
    expect(first.events[0]?.payload).toMatchObject({
      trader: { agentId: 'agent-2' },
      direction: 'import',
      unitPrice: 10,
      totalCurrency: 40,
      balanceBefore: 0,
      balanceAfter: -4,
    });
    expect(first.projection.agents['agent-2']?.balance).toBe(60);
    expect(first.projection.agents['agent-2']?.inventory).toEqual({ Apple: 4 });
    // Import = burn: payment leaves circulation to the external sector.
    expect(first.projection.moneySupply).toBe(960);
    expect(first.projection.externalTrade?.balancesByCommodity).toEqual({ Apple: -4 });

    // A second import at a net-import balance pays more than spot.
    const second = settle(
      first.projection,
      makeCommand({
        id: 'import-2',
        actorId: 'agent-2',
        type: 'AgentImportCommodity',
        payload: { commodityName: 'Apple', quantity: 4 },
        issuedAt: 100,
      }),
      first.events.length + 1,
    );
    const payload = second.events[0]?.payload as { unitPrice: number; totalCurrency: number };
    expect(payload.unitPrice).toBeGreaterThan(10);
    // √4/50 × 0.2 = 0.008 → unit 10.08.
    expect(payload.unitPrice).toBeCloseTo(10.08, 5);
    expect(second.projection.externalTrade?.balancesByCommodity).toEqual({ Apple: -8 });
  });

  test('enterprise export settles on the enterprise cash, inventory and sales ledger', () => {
    const projection = createWorldProjection({
      agents: [createAgent('agent-1', 100, { Apple: 10 })],
      enterprises: [createEnterprise('farm', 'agent-1')],
      marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 }],
      moneySupply: 1_000,
    });
    const { events, projection: updated } = settle(
      projection,
      makeCommand({
        id: 'export-enterprise',
        actorId: 'agent-1',
        type: 'AgentExportCommodity',
        payload: { commodityName: 'Apple', quantity: 2, asEnterpriseId: 'farm' },
        issuedAt: 0,
      }),
      1,
    );

    expect(events[0]?.payload).toMatchObject({
      trader: { enterpriseId: 'farm' },
      direction: 'export',
      totalCurrency: 20,
      balanceAfter: 2,
    });
    expect(updated.enterprises.farm).toMatchObject({
      balance: 220,
      inventory: { Apple: 18 },
      cumulativeSales: 20,
      retainedEarnings: 20,
    });
    // The acting agent's own accounts are untouched.
    expect(updated.agents['agent-1']?.balance).toBe(100);
    expect(updated.agents['agent-1']?.inventory).toEqual({ Apple: 10 });
    expect(updated.moneySupply).toBe(1_020);
  });

  test('rejects insufficient inventory, funds, missing pools, unauthorized enterprises and bad payloads', () => {
    const projection = createWorldProjection({
      agents: [createAgent('agent-1', 100, { Apple: 1 }), createAgent('agent-2', 5)],
      enterprises: [createEnterprise('farm', 'agent-1')],
      marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 }],
      moneySupply: 1_000,
    });

    const insufficientInventory = dispatchWorldCommand({
      command: makeCommand({
        id: 'export-too-much',
        actorId: 'agent-1',
        type: 'AgentExportCommodity',
        payload: { commodityName: 'Apple', quantity: 2 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(insufficientInventory[0]?.payload).toMatchObject({
      commandType: 'AgentExportCommodity',
      reason: 'insufficient Apple: required 2, available 1',
    });
    expect(insufficientInventory.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);

    const insufficientFunds = dispatchWorldCommand({
      command: makeCommand({
        id: 'import-too-expensive',
        actorId: 'agent-2',
        type: 'AgentImportCommodity',
        payload: { commodityName: 'Apple', quantity: 1 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(insufficientFunds[0]?.payload).toMatchObject({
      commandType: 'AgentImportCommodity',
      reason: 'insufficient balance: required 10, available 5',
    });

    const missingPool = dispatchWorldCommand({
      command: makeCommand({
        id: 'export-unknown-commodity',
        actorId: 'agent-1',
        type: 'AgentExportCommodity',
        payload: { commodityName: 'Unobtainium', quantity: 1 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(missingPool[0]?.payload).toMatchObject({
      reason: 'missing AMM pool for Unobtainium',
    });

    const unauthorized = dispatchWorldCommand({
      command: makeCommand({
        id: 'export-as-stranger',
        actorId: 'agent-2',
        type: 'AgentExportCommodity',
        payload: { commodityName: 'Apple', quantity: 1, asEnterpriseId: 'farm' },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(unauthorized[0]?.payload).toMatchObject({
      reason: 'agent is not authorized for enterprise',
    });

    const malformed = dispatchWorldCommand({
      command: makeCommand({
        id: 'export-bad-payload',
        actorId: 'agent-1',
        type: 'AgentExportCommodity',
        payload: { commodityName: 'Apple', quantity: 0 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(malformed[0]?.payload).toMatchObject({
      reason: 'AgentExportCommodity quantity must be positive',
    });
  });

  test('rejects both commands when the external trade policy is absent', () => {
    const projection = createTradingProjection();
    const events = dispatchWorldCommand({
      command: makeCommand({
        id: 'export-no-policy',
        actorId: 'agent-1',
        type: 'AgentExportCommodity',
        payload: { commodityName: 'Apple', quantity: 1 },
        issuedAt: 0,
      }),
      projection,
      policies: basePolicies,
      nextSequence: 1,
    });
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentExportCommodity',
      reason: 'missing external trade policy',
    });
  });

  test('decays the rolling balances once per crossed cadence, compounding', () => {
    const projection = createTradingProjection();
    const exported = settle(
      projection,
      makeCommand({
        id: 'export-1',
        actorId: 'agent-1',
        type: 'AgentExportCommodity',
        payload: { commodityName: 'Apple', quantity: 5 },
        issuedAt: 0,
      }),
      1,
    );
    const advance = createCommandEnvelope({
      id: 'advance-decay',
      simulationId: 'sim-external-trade',
      source: 'system',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs: 2_000 },
      issuedAt: 2_000,
    });
    const events = dispatchWorldCommand({
      command: advance,
      projection: exported.projection,
      policies,
      nextSequence: exported.events.length + 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'ExternalTradeBalancesDecayed',
      'ExternalTradeBalancesDecayed',
    ]);
    const decayEvents = events.filter(
      (event): event is Extract<WorldEvent, { readonly type: 'ExternalTradeBalancesDecayed' }> =>
        event.type === 'ExternalTradeBalancesDecayed',
    );
    expect(decayEvents[0]?.payload).toMatchObject({
      policyVersion: 'external-trade-v1',
      balancesBefore: { Apple: 5 },
      decayedAt: 1_000,
    });
    expect(decayEvents[0]?.payload.balancesAfter.Apple).toBeCloseTo(4.95);
    expect(decayEvents[1]?.payload.balancesAfter.Apple).toBeCloseTo(4.9005);

    const updated = events.reduce(applyWorldEvent, exported.projection);
    expect(updated.externalTrade?.balancesByCommodity.Apple).toBeCloseTo(4.9005);
    expect(updated.externalTrade?.lastDecayAt).toBe(2_000);
  });

  test('decay is a no-op until the first external trade creates the slice', () => {
    const projection = createTradingProjection();
    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'advance-quiet',
        simulationId: 'sim-external-trade',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 2_000 },
        issuedAt: 2_000,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(events.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.externalTrade).toBeUndefined();
    expect(updated.moneySupply).toBe(1_000);
  });

  test('replays a mixed trade/decay stream deterministically after a JSON round-trip', () => {
    const initial = createTradingProjection();
    const commands = [
      makeCommand({
        id: 'export-1',
        actorId: 'agent-1',
        type: 'AgentExportCommodity',
        payload: { commodityName: 'Apple', quantity: 5 },
        issuedAt: 0,
      }),
      makeCommand({
        id: 'import-1',
        actorId: 'agent-2',
        type: 'AgentImportCommodity',
        payload: { commodityName: 'Apple', quantity: 2 },
        issuedAt: 500,
      }),
      createCommandEnvelope({
        id: 'advance-1',
        simulationId: 'sim-external-trade',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1_000 },
        issuedAt: 1_000,
      }),
      makeCommand({
        id: 'export-2',
        actorId: 'agent-1',
        type: 'AgentExportCommodity',
        payload: { commodityName: 'Apple', quantity: 1 },
        issuedAt: 1_000,
      }),
    ];

    const allEvents: WorldEvent[] = [];
    let projection = initial;
    let nextSequence = 1;
    for (const command of commands) {
      const events = dispatchWorldCommand({ command, projection, policies, nextSequence });
      allEvents.push(...events);
      projection = events.reduce(applyWorldEvent, projection);
      nextSequence += events.length;
    }

    const persisted = JSON.parse(JSON.stringify(allEvents)) as WorldEvent[];
    const replayed = replayEvents(initial, persisted, applyWorldEvent);
    expect(replayed).toEqual(projection);
    // 50 minted by the first export, 20 burned by the import; the cadence
    // boundary decays the balance 3 → 2.97, then the last export prices off
    // that decayed balance (√2.97/50×0.2 ≈ 0.69% below spot) minting ≈ 9.931.
    expect(replayed.moneySupply).toBeCloseTo(1_000 + 50 - 20 + 9.9311, 3);
    expect(replayed.externalTrade?.balancesByCommodity.Apple).toBeCloseTo(3.97);
    expect(replayed.agents['agent-1']?.inventory).toEqual({ Apple: 4 });
    expect(replayed.agents['agent-2']?.inventory).toEqual({ Apple: 2 });
  });
});
