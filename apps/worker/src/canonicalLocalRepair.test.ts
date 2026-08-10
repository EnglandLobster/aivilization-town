import {
  createBranchPlan,
  type AtomicActionProposal,
  type CycleRepairPolicyInput,
} from '@aivilization/agent-runtime';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createCanonicalLocalRepairPolicy } from './canonicalLocalRepair';
import type { WorldCommandPolicies } from '@aivilization/world';

const agentId = asAgentId('agent-a');

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Apple: 10, Bread: 15 },
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
  sleep: { energyRecoveryPerSecond: 1, maxEnergy: 100 },
  jobApplication: {
    populationEducationScores: [0],
    quotaByResidentialTier: [1, 1, 1, 1, 1],
  },
};

describe('canonical local repair policy', () => {
  test('repairs insufficient satiety by eating the best available food from inventory', () => {
    const repair = createCanonicalLocalRepairPolicy({ policies });

    expect(
      repair(
        createRepairInput({
          rejectedAction: {
            id: 'produce-chip',
            description: 'produce Chip',
            commandType: 'AgentProduce',
            payload: { commodityName: 'Chip', quantity: 1, availableLaborSeconds: 3600 },
            priority: 8,
          },
          reason: 'insufficient-satiety: satiety requires 25, available 10',
          inventory: { Apple: 1, Bread: 1 },
          balance: 100,
        }),
      ),
    ).toEqual({
      id: 'local-repair-produce-chip-eat-Bread',
      description: 'Eat Bread before retrying produce Chip.',
      commandType: 'AgentEat',
      payload: { commodityName: 'Bread', quantity: 1 },
      priority: 9,
      resourceEstimate: { inventoryCosts: { Bread: 1 } },
    });
  });

  test('repairs missing required inventory by buying an affordable market item', () => {
    const repair = createCanonicalLocalRepairPolicy({ policies });

    expect(
      repair(
        createRepairInput({
          rejectedAction: {
            id: 'eat-apple',
            description: 'eat Apple',
            commandType: 'AgentEat',
            payload: { commodityName: 'Apple', quantity: 1 },
            priority: 5,
          },
          reason: 'insufficient Apple: required 1, available 0',
          inventory: {},
          balance: 20,
          spotPrices: [{ commodity: 'Apple', spotPrice: 9 }],
        }),
      ),
    ).toEqual({
      id: 'local-repair-eat-apple-buy-Apple',
      description: 'Buy 1 Apple before retrying eat Apple.',
      commandType: 'AgentTrade',
      payload: { side: 'buy', commodityName: 'Apple', quantity: 1 },
      priority: 6,
      resourceEstimate: { currencyCost: 9 },
    });
  });

  test('does not buy missing inventory when the market price exceeds balance', () => {
    const repair = createCanonicalLocalRepairPolicy({ policies });

    expect(
      repair(
        createRepairInput({
          rejectedAction: {
            id: 'eat-apple',
            description: 'eat Apple',
            commandType: 'AgentEat',
            payload: { commodityName: 'Apple', quantity: 1 },
          },
          reason: 'insufficient Apple: required 1, available 0',
          inventory: {},
          balance: 5,
          spotPrices: [{ commodity: 'Apple', spotPrice: 9 }],
        }),
      ),
    ).toBeUndefined();
  });
});

function createRepairInput(input: {
  readonly rejectedAction: AtomicActionProposal;
  readonly reason: string;
  readonly inventory: Readonly<Record<string, number>>;
  readonly balance: number;
  readonly spotPrices?: readonly { readonly commodity: string; readonly spotPrice: number }[];
}): CycleRepairPolicyInput {
  return {
    agentId,
    issuedAt: 100,
    plan: createBranchPlan({
      objective: 'Recover and continue production.',
      branches: [
        {
          id: 'production',
          objective: 'produce target goods',
          subtasks: [{ id: 'produce', description: 'produce target', basePriority: 8 }],
        },
      ],
    }),
    signals: [],
    selectedSubtask: {
      branchId: 'production',
      subtaskId: 'produce',
      description: 'produce target',
      score: 8,
    },
    rejectedAction: input.rejectedAction,
    reason: input.reason,
    worldDecisionContext: {
      agent: {
        agentId,
        locationId: 'workshop',
        physiology: { energy: 40, satiety: 10, health: 95 },
        educationScore: 10,
        balance: input.balance,
        residentialTier: 1,
        job: 'Cleaner',
        inventory: input.inventory,
      },
      market: {
        spotPrices: input.spotPrices ?? [],
        latestPriceIndex: {
          baselineAt: 1,
          recordedAt: 100,
          overall: 1,
          ratios: {},
        },
      },
    },
  };
}
