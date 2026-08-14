import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
} from './index';

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  consumption: {
    policyVersion: 'consumption-v1',
    rules: {
      Book: { kind: 'consumable', utilityPoints: 5 },
      Chip: { kind: 'durable', utilityPoints: 20, lifetimeSeconds: 60 },
    },
  },
};

describe('final consumption and durable goods', () => {
  test('removes final goods and expires durable utility lots on simulation time', () => {
    let projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('consumer'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: { Book: 2, Chip: 1 },
        },
      ],
    });
    const dispatch = (
      id: string,
      type: 'AgentConsume' | 'AdvanceSimulationTime',
      payload: unknown,
    ) => {
      const events = dispatchWorldCommand({
        command: createCommandEnvelope({
          id,
          simulationId: 'sim-consumption',
          source: 'agent-runtime',
          ...(type === 'AgentConsume' ? { actorId: 'consumer' } : {}),
          type,
          payload,
          issuedAt: projection.clock.now,
        }),
        projection,
        policies,
        nextSequence: 1,
      });
      projection = events.reduce(applyWorldEvent, projection);
      return events;
    };

    dispatch('consume-book', 'AgentConsume', { commodityName: 'Book', quantity: 1 });
    dispatch('use-chip', 'AgentConsume', { commodityName: 'Chip', quantity: 1 });
    expect(projection.agents.consumer?.inventory).toEqual({ Book: 1 });
    expect(projection.agents.consumer?.durableGoods).toHaveLength(1);

    const expiry = dispatch('advance', 'AdvanceSimulationTime', { deltaMs: 60_000 });
    expect(expiry.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'DurableGoodExpired',
    ]);
    expect(projection.agents.consumer?.durableGoods).toEqual([]);
  });
});
