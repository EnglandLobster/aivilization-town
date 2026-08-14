import { createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
} from './index';

describe('public budget settlement', () => {
  test('spends only above the treasury reserve and records service totals', () => {
    const projection = createWorldProjection({ agents: [], treasury: 150, moneySupply: 150 });
    const policies: WorldCommandPolicies = {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 0,
      laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
      criticalThresholds: { energy: 0, health: 0 },
      publicBudget: {
        policyVersion: 'budget-v1',
        cadenceMs: 1_000,
        minimumTreasuryReserve: 100,
        allocations: [
          { service: 'education', amountPerCadence: 30 },
          { service: 'healthcare', amountPerCadence: 30 },
        ],
      },
    };
    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'advance-budget',
        simulationId: 'sim-budget',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1_000 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'PublicBudgetSpent',
      'PublicBudgetSpent',
    ]);
    expect(events[1]).toMatchObject({ payload: { service: 'education', amount: 30 } });
    expect(events[2]).toMatchObject({ payload: { service: 'healthcare', amount: 20 } });
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.treasury).toBe(100);
    expect(updated.moneySupply).toBe(150);
    expect(updated.publicBudget).toEqual({
      cumulativeSpendingByService: { education: 30, healthcare: 20 },
      serviceBalances: { education: 30, healthcare: 20 },
      lastSettledAt: 1_000,
    });
  });
});
