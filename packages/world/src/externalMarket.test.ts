import { createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
} from './index';

describe('external market liquidity', () => {
  test('replays every crossed cadence and restores depleted pool depth', () => {
    const projection = createWorldProjection({
      agents: [],
      marketPools: [{ commodity: 'Apple', commodityReserve: 10, currencyReserve: 100 }],
      moneySupply: 500,
    });
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 0,
      laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
      criticalThresholds: { energy: 0, health: 0 },
      externalMarket: {
        policyVersion: 'external-v1',
        cadenceMs: 1_000,
        commodityReserveFloor: 20,
        commodityReserveCeiling: 1_000,
        currencyReserveFloor: 200,
        currencyReserveCeiling: 10_000,
        maxAdjustmentRatioPerCadence: 0.5,
      },
    };
    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'advance-external-market',
        simulationId: 'sim-external',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 2_000 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'ExternalMarketRebalanced',
      'ExternalMarketRebalanced',
    ]);
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.marketPools.Apple).toMatchObject({
      commodityReserve: 20,
      currencyReserve: 200,
    });
    expect(updated.externalMarket).toEqual({
      commodityReserveNetImports: { Apple: 10 },
      currencyReserveNetImports: 100,
    });
    expect(updated.moneySupply).toBe(500);
  });
});
