import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type { WorldDecisionContext } from '@aivilization/agent-runtime';
import { createMemorySynthesisContextView } from './memoryWorldDecisionContext';

describe('memory synthesis context view', () => {
  test('materializes the compact memory contract instead of relying on structural typing', () => {
    const agentId = asAgentId('agent-1');
    const full: WorldDecisionContext = {
      agent: {
        agentId,
        locationId: 'market',
        displayName: 'Ari',
        physiology: { energy: 70, satiety: 60, health: 90 },
        educationScore: 30,
        balance: 100,
        residentialTier: 2,
        job: null,
        inventory: { Fish: 2 },
        banking: {
          depositBalance: 10,
          activeLoans: [],
          repaidCount: 0,
          defaultedCount: 0,
          maxLoanAmount: 100,
          depositDailyInterestRate: 0.01,
          loanDailyInterestRate: 0.02,
        },
      },
      market: { spotPrices: [{ commodity: 'Fish', spotPrice: 12 }] },
      townPulse: [{ kind: 'arrival', atMs: 10 }],
      enterprises: [],
      rules: {
        occupations: [],
        production: [],
        consumption: [
          {
            commodityName: 'Fish',
            kind: 'consumable',
            utilityPoints: 5,
            inventoryQuantity: 2,
            activeDurableQuantity: 0,
          },
        ],
      },
    };

    const view = createMemorySynthesisContextView(full);
    expect(view).toEqual({
      contextViewVersion: 'world-decision-context-view-v11',
      contextViewStage: 'memory-synthesis',
      agent: {
        agentId,
        locationId: 'market',
        physiology: { energy: 70, satiety: 60, health: 90 },
        educationScore: 30,
        balance: 100,
        residentialTier: 2,
        job: null,
        inventory: { Fish: 2 },
      },
      market: { spotPrices: [{ commodity: 'Fish', spotPrice: 12 }] },
      rules: { occupations: [], production: [] },
    });
    expect('townPulse' in view).toBe(false);
    expect('enterprises' in view).toBe(false);
    expect('banking' in view.agent).toBe(false);
    expect('consumption' in (view.rules ?? {})).toBe(false);
  });
});
