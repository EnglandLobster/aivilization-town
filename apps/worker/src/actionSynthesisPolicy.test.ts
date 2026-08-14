import type { AgentId } from '@aivilization/sim-core';
import { asAgentId } from '@aivilization/sim-core';
import type { WorldAgentState } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { deriveActionSynthesisPolicyFromWorldState } from './index';

const agentId = asAgentId('agent-policy');

describe('world-state action synthesis policy', () => {
  test('derives budgets from physiology, balance, inventory, and configured reserves', () => {
    expect(
      deriveActionSynthesisPolicyFromWorldState({
        agent: createAgent({
          physiology: { energy: 25, satiety: 7, health: 100 },
          balance: 14,
          inventory: { Bread: 2, Rock: 0 },
        }),
        config: {
          maxActions: 2,
          planningWindowSeconds: 3600,
          minEnergyReserve: 5,
          minSatietyReserve: 2,
          minBalanceReserve: 10,
        },
      }),
    ).toEqual({
      maxActions: 2,
      budget: {
        availableActionSeconds: 3600,
        energyBudget: 20,
        satietyBudget: 5,
        currencyBudget: 4,
        inventoryBudget: { Bread: 2 },
      },
    });
  });

  test('clamps exhausted budgets to zero', () => {
    expect(
      deriveActionSynthesisPolicyFromWorldState({
        agent: createAgent({
          physiology: { energy: 3, satiety: 1, health: 100 },
          balance: 4,
          inventory: {},
        }),
        config: {
          minEnergyReserve: 5,
          minSatietyReserve: 2,
          minBalanceReserve: 10,
        },
      }),
    ).toEqual({
      budget: {
        energyBudget: 0,
        satietyBudget: 0,
        currencyBudget: 0,
        inventoryBudget: {},
      },
    });
  });

  test('propagates configured candidate subtask window into action synthesis policy', () => {
    expect(
      deriveActionSynthesisPolicyFromWorldState({
        agent: createAgent({
          physiology: { energy: 80, satiety: 80, health: 100 },
          balance: 100,
          inventory: { Apple: 1 },
        }),
        config: {
          maxActions: 2,
          candidateSubtasks: { maxSubtasks: 2 },
        },
      }),
    ).toMatchObject({
      maxActions: 2,
      candidateSubtasks: { maxSubtasks: 2 },
    });
  });

  test('propagates the lifestyle constraint into the synthesis policy', () => {
    expect(
      deriveActionSynthesisPolicyFromWorldState({
        agent: createAgent({ balance: 100 }),
        lifestyle: {
          tier: 'struggling',
          nonSurvivalSpendCapRatio: 0.3,
          survivalCommodities: ['Apple'],
        },
      }),
    ).toMatchObject({
      lifestyle: {
        tier: 'struggling',
        nonSurvivalSpendCapRatio: 0.3,
        survivalCommodities: ['Apple'],
      },
    });
  });
});

function createAgent(input: {
  readonly agentId?: AgentId;
  readonly physiology?: WorldAgentState['physiology'];
  readonly balance?: number;
  readonly inventory?: WorldAgentState['inventory'];
}): WorldAgentState {
  return {
    agentId: input.agentId ?? agentId,
    locationId: null,
    physiology: input.physiology ?? { energy: 50, satiety: 50, health: 100 },
    educationScore: 0,
    balance: input.balance ?? 100,
    residentialTier: 1,
    job: null,
    inventory: input.inventory ?? {},
  };
}
