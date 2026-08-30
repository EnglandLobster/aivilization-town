import type { ExternalTradePolicy } from '@aivilization/economy';
import { asAgentId } from '@aivilization/sim-core';
import type { WorldEnterpriseState } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createExternalTradePlanningQuotes,
  resolveEnterpriseExternalTradeOpportunity,
} from './externalTradePlanning';

const ownerId = asAgentId('owner');
const employeeId = asAgentId('employee');
const externalTradePolicy: ExternalTradePolicy = {
  policyVersion: 'external-trade-test-v1',
  balanceDecayRatioPerCadence: 0.01,
  cadenceMs: 1_000,
  priceImpactRatio: 0.2,
  balanceScale: 50,
  source: 'external trade planning test',
};
const marketPools = {
  Apple: { commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 },
};

describe('enterprise external trade planning', () => {
  test('selects an owner export only when its exact external total beats the visible AMM', () => {
    const quotes = createExternalTradePlanningQuotes({
      marketPools,
      balancesByCommodity: {},
      quantity: 1,
      externalTradePolicy,
    });
    const opportunity = resolveEnterpriseExternalTradeOpportunity({
      agentId: ownerId,
      enterprises: { bakery: enterprise({ inventory: { Apple: 2 } }) },
      marketPools,
      externalQuotes: quotes,
      quantity: 1,
      direction: 'export',
      commodityName: 'Apple',
    });

    expect(opportunity).toMatchObject({
      direction: 'export',
      enterpriseId: 'bakery',
      commodityName: 'Apple',
      quantity: 1,
      externalTotal: 10,
    });
    expect(opportunity?.relativeAdvantageRatio).toBeCloseTo(0.01, 10);
    expect(opportunity?.townMarketTotal).toBeCloseTo(9.90099, 5);
  });

  test('selects an affordable import and records the external cash requirement', () => {
    const quotes = createExternalTradePlanningQuotes({
      marketPools,
      balancesByCommodity: {},
      quantity: 1,
      externalTradePolicy,
    });
    const opportunity = resolveEnterpriseExternalTradeOpportunity({
      agentId: ownerId,
      enterprises: { bakery: enterprise({ balance: 10 }) },
      marketPools,
      externalQuotes: quotes,
      quantity: 1,
      direction: 'import',
      commodityName: 'Apple',
    });

    expect(opportunity).toMatchObject({
      direction: 'import',
      enterpriseId: 'bakery',
      externalTotal: 10,
    });
    expect(opportunity?.relativeAdvantageRatio).toBeCloseTo(0.01, 10);
    expect(opportunity?.townMarketTotal).toBeCloseTo(10.10101, 5);
  });

  test('fails closed for employees, missing resources, collapsed advantage, and invalid policy', () => {
    const quotes = createExternalTradePlanningQuotes({
      marketPools,
      balancesByCommodity: {},
      quantity: 1,
      externalTradePolicy,
    });
    const common = {
      enterprises: { bakery: enterprise({ inventory: { Apple: 1 }, balance: 10 }) },
      marketPools,
      externalQuotes: quotes,
      quantity: 1,
      commodityName: 'Apple',
    } as const;

    expect(
      resolveEnterpriseExternalTradeOpportunity({
        ...common,
        agentId: employeeId,
        direction: 'export',
      }),
    ).toBeUndefined();
    expect(
      resolveEnterpriseExternalTradeOpportunity({
        ...common,
        agentId: ownerId,
        direction: 'export',
        quantity: 2,
      }),
    ).toBeUndefined();
    expect(
      resolveEnterpriseExternalTradeOpportunity({
        ...common,
        agentId: ownerId,
        direction: 'import',
        quantity: 2,
      }),
    ).toBeUndefined();
    expect(
      resolveEnterpriseExternalTradeOpportunity({
        ...common,
        agentId: ownerId,
        direction: 'export',
        proposerPolicy: {
          policyVersion: 'strict-test-v1',
          minimumRelativeAdvantageRatio: 0.01,
        },
      }),
    ).toBeUndefined();
    expect(() =>
      resolveEnterpriseExternalTradeOpportunity({
        ...common,
        agentId: ownerId,
        direction: 'export',
        proposerPolicy: {
          policyVersion: 'invalid-test-v1',
          minimumRelativeAdvantageRatio: -1,
        },
      }),
    ).toThrow(/must be in \[0, 1\)/u);
  });
});

function enterprise(input: {
  readonly balance?: number;
  readonly inventory?: Readonly<Record<string, number>>;
}): WorldEnterpriseState {
  return {
    enterpriseId: 'bakery',
    name: 'Bakery',
    ownerAgentId: ownerId,
    occupationName: 'Baker',
    balance: input.balance ?? 100,
    inventory: input.inventory ?? {},
    maxEmployees: 3,
    employeeAgentIds: [employeeId],
    status: 'active',
    foundedAt: 0,
    cumulativeSales: 0,
    cumulativePurchases: 0,
    cumulativeWages: 0,
  };
}
