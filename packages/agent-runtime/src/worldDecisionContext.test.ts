import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createWorldDecisionContextTrace,
  type WorldDecisionContext,
} from './worldDecisionContext';

describe('world decision context trace', () => {
  test('summarizes inventory, job, and location field coverage', () => {
    const context: WorldDecisionContext = {
      agent: {
        agentId: asAgentId('agent-1'),
        locationId: 'market',
        physiology: { energy: 72, satiety: 41, health: 93 },
        educationScore: 31,
        balance: 191696904,
        residentialTier: 5,
        job: 'stock-clerk',
        inventory: { Fish: 46 },
      },
      market: {
        spotPrices: [{ commodity: 'Fish', spotPrice: 304.5 }],
      },
    };

    expect(createWorldDecisionContextTrace(context)).toMatchObject({
      agentId: asAgentId('agent-1'),
      hasLocationId: true,
      hasJob: true,
      hasInventory: true,
    });
  });
});
