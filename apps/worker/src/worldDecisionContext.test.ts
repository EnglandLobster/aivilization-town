import { createAmmPool } from '@aivilization/economy';
import { asAgentId, asLocationId } from '@aivilization/sim-core';
import { createWorldProjection } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { createWorldDecisionContextFromProjection } from './worldDecisionContext';

const agentId = asAgentId('agent-a');

describe('worker world decision context', () => {
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
});
