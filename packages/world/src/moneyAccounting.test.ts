import { asAgentId, asLoanId, createEventEnvelope, replayEvents } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createBankState,
  createWorldProjection,
  type WorldEvent,
  type WorldProjection,
} from './index';

/**
 * Money accounting invariants.
 *
 * Every currency movement in the world is exactly one of:
 * - mint (injection): moneySupply increases (registration seed, minted wage, subsidy)
 * - burn (destruction): moneySupply decreases (upkeep, medical, education, upgrade fee)
 * - transfer: moneySupply unchanged (trades move currency between agents and pools;
 *   employer/treasury wages move currency between accounts)
 *
 * These tests pin the invariant `moneySupply == initial + Σminted − Σburned` so the
 * price index and inflation analysis rest on a correct money quantity.
 */

function createAgent(agentId: string, balance: number, residentialTier = 1) {
  return {
    agentId: asAgentId(agentId),
    physiology: { energy: 100, satiety: 80, health: 100 },
    educationScore: 0,
    balance,
    residentialTier,
    job: null,
    inventory: {},
  };
}

function sumAgentBalances(projection: WorldProjection): number {
  return Object.values(projection.agents).reduce((total, agent) => total + agent.balance, 0);
}

describe('money accounting invariants', () => {
  test('minted wage increases money supply; employer/treasury wages are transfers', () => {
    const initial = createWorldProjection({
      agents: [createAgent('agent-1', 100)],
      moneySupply: 1000,
    });

    const events: WorldEvent[] = [
      createEventEnvelope({
        id: 'event-wage-mint',
        simulationId: 'sim-1',
        type: 'WagePaid',
        payload: {
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          amount: 50,
          fundingSource: 'mint' as const,
        },
        occurredAt: 1,
        sequence: 1,
      }),
      createEventEnvelope({
        id: 'event-wage-legacy',
        simulationId: 'sim-1',
        type: 'WagePaid',
        payload: {
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          amount: 50,
        },
        occurredAt: 2,
        sequence: 2,
      }),
      createEventEnvelope({
        id: 'event-wage-employer',
        simulationId: 'sim-1',
        type: 'WagePaid',
        payload: {
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          amount: 40,
          fundingSource: 'employer' as const,
        },
        occurredAt: 3,
        sequence: 3,
      }),
      createEventEnvelope({
        id: 'event-wage-treasury',
        simulationId: 'sim-1',
        type: 'WagePaid',
        payload: {
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          amount: 40,
          fundingSource: 'treasury' as const,
        },
        occurredAt: 4,
        sequence: 4,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.balance).toBe(280);
    // Only the two minted wages move the supply; employer/treasury wages are transfers.
    expect(projection.moneySupply).toBe(1100);
  });

  test('residential tier upgrade fee is burned from the money supply', () => {
    const initial = createWorldProjection({
      agents: [createAgent('agent-1', 500)],
      moneySupply: 1000,
    });

    const events: WorldEvent[] = [
      createEventEnvelope({
        id: 'event-upgrade',
        simulationId: 'sim-1',
        type: 'ResidentialTierUpgraded',
        payload: {
          agentId: asAgentId('agent-1'),
          previousResidentialTier: 1,
          nextResidentialTier: 2,
          currencyCost: 200,
          consumedInventory: {},
        },
        occurredAt: 1,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.balance).toBe(300);
    expect(projection.agents['agent-1']?.residentialTier).toBe(2);
    expect(projection.moneySupply).toBe(800);
  });

  test('taxes are transfers into the treasury: supply unchanged, treasury grows', () => {
    const initial = createWorldProjection({
      agents: [createAgent('agent-1', 100)],
      moneySupply: 1000,
    });

    const events: WorldEvent[] = [
      // transfer −40: income tax debits the agent and credits the treasury
      createEventEnvelope({
        id: 'event-income-tax',
        simulationId: 'sim-1',
        type: 'IncomeTaxCharged',
        payload: {
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          taxableAmount: 500,
          amount: 40,
          previousBalance: 100,
          nextBalance: 60,
        },
        occurredAt: 1,
        sequence: 1,
      }),
      // transfer −4: trade tax on sale proceeds
      createEventEnvelope({
        id: 'event-trade-tax',
        simulationId: 'sim-1',
        type: 'TradeTaxCharged',
        payload: {
          agentId: asAgentId('agent-1'),
          commodityName: 'Apple',
          saleProceeds: 80,
          amount: 4,
          previousBalance: 60,
          nextBalance: 56,
        },
        occurredAt: 2,
        sequence: 2,
      }),
      // transfer +10: a treasury-funded subsidy drains the treasury without minting
      createEventEnvelope({
        id: 'event-subsidy-treasury',
        simulationId: 'sim-1',
        type: 'SubsidyPaid',
        payload: {
          agentId: asAgentId('agent-1'),
          amount: 10,
          previousBalance: 56,
          nextBalance: 66,
          reason: 'safety-net',
          fundingSource: 'treasury' as const,
        },
        occurredAt: 3,
        sequence: 3,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.balance).toBe(66);
    expect(projection.treasury).toBe(40 + 4 - 10);
    // Taxes and treasury-funded subsidies never move the money supply.
    expect(projection.moneySupply).toBe(1000);
  });

  test('treasury wages and dividend tax are transfers: supply unchanged, accounts conserved', () => {
    const initial = createWorldProjection({
      agents: [createAgent('agent-1', 100)],
      enterprises: [
        {
          enterpriseId: 'firm',
          name: 'Firm',
          ownerAgentId: asAgentId('agent-1'),
          occupationName: 'Maker',
          balance: 100,
          inventory: {},
          maxEmployees: 2,
          employeeAgentIds: [],
          status: 'active',
          foundedAt: 0,
          cumulativeSales: 100,
          cumulativePurchases: 0,
          cumulativeWages: 0,
        },
      ],
      moneySupply: 400,
      treasury: 200,
    });

    const events: WorldEvent[] = [
      // transfer −40: the treasury pays a public wage (no minting)
      createEventEnvelope({
        id: 'event-treasury-wage',
        simulationId: 'sim-1',
        type: 'WagePaid',
        payload: {
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          amount: 40,
          fundingSource: 'treasury' as const,
        },
        occurredAt: 1,
        sequence: 1,
      }),
      // transfer −10: a dividend payout is taxed from the enterprise into the treasury
      createEventEnvelope({
        id: 'event-dividend-tax',
        simulationId: 'sim-1',
        type: 'DividendTaxCharged',
        payload: {
          enterpriseId: 'firm',
          dividendAmount: 100,
          amount: 10,
          enterprisePreviousBalance: 100,
          enterpriseNextBalance: 90,
          previousTreasury: 160,
          nextTreasury: 170,
          policyVersion: 'tax-regime-v2',
        },
        occurredAt: 2,
        sequence: 2,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.balance).toBe(140);
    expect(projection.enterprises.firm?.balance).toBe(90);
    expect(projection.treasury).toBe(200 - 40 + 10);
    // Both movements are transfers between circulating accounts.
    expect(projection.moneySupply).toBe(400);
  });

  test('banking chain (deposit → loan → repayment → interest) keeps the supply constant', () => {
    // The town bank is a circulating account: every banking movement is a
    // transfer between the bank and an agent, so moneySupply never changes and
    // Σ(agent balances) + bank cash stays equal to the seeded supply.
    const initial = createWorldProjection({
      agents: [createAgent('agent-1', 1_000), createAgent('agent-2', 500)],
      moneySupply: 11_500,
      bank: createBankState({ reserves: 10_000 }),
    });

    const events: WorldEvent[] = [
      // transfer −1_000: agent-1 deposits into the bank cash account
      createEventEnvelope({
        id: 'event-deposit',
        simulationId: 'sim-1',
        type: 'DepositMade',
        payload: {
          agentId: asAgentId('agent-1'),
          amount: 1_000,
          previousBalance: 1_000,
          nextBalance: 0,
          bankPreviousBalance: 10_000,
          bankNextBalance: 11_000,
          policyVersion: 'credit-v1',
        },
        occurredAt: 1,
        sequence: 1,
      }),
      // transfer −300: the bank issues loan principal to agent-2
      createEventEnvelope({
        id: 'event-loan-issued',
        simulationId: 'sim-1',
        type: 'LoanIssued',
        payload: {
          loanId: asLoanId('loan-1'),
          borrowerAgentId: asAgentId('agent-2'),
          principal: 300,
          dailyInterestRate: 0.01,
          termDays: 2,
          issuedAt: 0,
          borrowerPreviousBalance: 500,
          borrowerNextBalance: 800,
          bankPreviousBalance: 11_000,
          bankNextBalance: 10_700,
          policyVersion: 'credit-v1',
        },
        occurredAt: 2,
        sequence: 2,
      }),
      // transfer −153: day-1 settlement collects 3 interest + 150 principal
      createEventEnvelope({
        id: 'event-loan-repaid-1',
        simulationId: 'sim-1',
        type: 'LoanRepaid',
        payload: {
          loanId: asLoanId('loan-1'),
          borrowerAgentId: asAgentId('agent-2'),
          settledAt: 86_400_000,
          interestAccrued: 3,
          paidAmount: 153,
          interestPaid: 3,
          principalPaid: 150,
          missedPayments: 0,
          status: 'active' as const,
          borrowerPreviousBalance: 800,
          borrowerNextBalance: 647,
          bankPreviousBalance: 10_700,
          bankNextBalance: 10_853,
          policyVersion: 'credit-v1',
        },
        occurredAt: 3,
        sequence: 3,
      }),
      // transfer +1: the bank pays day-1 deposit interest out of its own cash
      createEventEnvelope({
        id: 'event-deposit-interest',
        simulationId: 'sim-1',
        type: 'DepositInterestPaid',
        payload: {
          paidAt: 86_400_000,
          payments: [
            {
              agentId: asAgentId('agent-1'),
              amount: 1,
              previousBalance: 0,
              nextBalance: 1,
            },
          ],
          bankPreviousBalance: 10_853,
          bankNextBalance: 10_852,
          policyVersion: 'credit-v1',
        },
        occurredAt: 4,
        sequence: 4,
      }),
      // transfer −151.5: day-2 settlement closes the loan (1.5 interest + 150)
      createEventEnvelope({
        id: 'event-loan-repaid-2',
        simulationId: 'sim-1',
        type: 'LoanRepaid',
        payload: {
          loanId: asLoanId('loan-1'),
          borrowerAgentId: asAgentId('agent-2'),
          settledAt: 172_800_000,
          interestAccrued: 1.5,
          paidAmount: 151.5,
          interestPaid: 1.5,
          principalPaid: 150,
          missedPayments: 0,
          status: 'repaid' as const,
          borrowerPreviousBalance: 647,
          borrowerNextBalance: 495.5,
          bankPreviousBalance: 10_852,
          bankNextBalance: 11_003.5,
          policyVersion: 'credit-v1',
        },
        occurredAt: 5,
        sequence: 5,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.balance).toBe(1);
    expect(projection.agents['agent-2']?.balance).toBe(495.5);
    expect(projection.bank?.balance).toBe(11_003.5);
    expect(projection.bank?.loans['loan-1']?.status).toBe('repaid');
    expect(projection.bank?.creditHistoryByAgent['agent-2']).toEqual({
      repaidCount: 1,
      defaultedCount: 0,
    });
    // Transfers only redistribute circulating balances: supply is unchanged and
    // agent balances plus the bank cash account still sum to the seed supply.
    expect(projection.moneySupply).toBe(11_500);
    expect(sumAgentBalances(projection) + (projection.bank?.balance ?? 0)).toBeCloseTo(11_500);
  });

  test('external trade moves the supply against the external sector: export mints, import burns', () => {
    const initial = createWorldProjection({
      agents: [{ ...createAgent('agent-1', 100), inventory: { Apple: 5 } }],
      moneySupply: 1000,
    });

    const events: WorldEvent[] = [
      // injection +50: the external sector pays the agent for 5 exported Apples
      createEventEnvelope({
        id: 'event-external-export',
        simulationId: 'sim-1',
        type: 'ExternalTradeExecuted',
        payload: {
          trader: { agentId: asAgentId('agent-1') },
          direction: 'export' as const,
          commodityName: 'Apple',
          quantity: 5,
          unitPrice: 10,
          totalCurrency: 50,
          balanceBefore: 0,
          balanceAfter: 5,
          spotPrice: 10,
          policyVersion: 'external-trade-v1',
        },
        occurredAt: 1,
        sequence: 1,
      }),
      // burn −30: the agent pays the external sector for 3 imported Apples
      createEventEnvelope({
        id: 'event-external-import',
        simulationId: 'sim-1',
        type: 'ExternalTradeExecuted',
        payload: {
          trader: { agentId: asAgentId('agent-1') },
          direction: 'import' as const,
          commodityName: 'Apple',
          quantity: 3,
          unitPrice: 10,
          totalCurrency: 30,
          balanceBefore: 5,
          balanceAfter: 2,
          spotPrice: 10,
          policyVersion: 'external-trade-v1',
        },
        occurredAt: 2,
        sequence: 2,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.balance).toBe(120);
    expect(projection.agents['agent-1']?.inventory).toEqual({ Apple: 3 });
    // The `external` counterpart sector sits outside circulation, so exports
    // mint and imports burn exactly the settled totals.
    expect(projection.moneySupply).toBe(1000 + 50 - 30);
    expect(projection.externalTrade?.balancesByCommodity).toEqual({ Apple: 2 });
  });

  test('mixed event stream satisfies moneySupply == initial + minted − burned', () => {
    const initial = createWorldProjection({
      agents: [createAgent('agent-1', 100), createAgent('agent-2', 100, 2)],
      moneySupply: 1000,
    });

    const events: WorldEvent[] = [
      // mint +50
      createEventEnvelope({
        id: 'event-wage',
        simulationId: 'sim-1',
        type: 'WagePaid',
        payload: {
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          amount: 50,
          fundingSource: 'mint' as const,
        },
        occurredAt: 1,
        sequence: 1,
      }),
      // mint +25
      createEventEnvelope({
        id: 'event-subsidy',
        simulationId: 'sim-1',
        type: 'SubsidyPaid',
        payload: {
          agentId: asAgentId('agent-2'),
          amount: 25,
          previousBalance: 100,
          nextBalance: 125,
          reason: 'safety-net',
        },
        occurredAt: 2,
        sequence: 2,
      }),
      // burn −10 (upkeep)
      createEventEnvelope({
        id: 'event-upkeep',
        simulationId: 'sim-1',
        type: 'ResidentialUpkeepCharged',
        payload: {
          agentId: asAgentId('agent-2'),
          residentialTier: 2,
          amount: 10,
          unpaidAmount: 0,
          previousBalance: 125,
          nextBalance: 115,
          reason: 'residential-upkeep',
        },
        occurredAt: 3,
        sequence: 3,
      }),
      // burn −200 (upgrade)
      createEventEnvelope({
        id: 'event-upgrade',
        simulationId: 'sim-1',
        type: 'ResidentialTierUpgraded',
        payload: {
          agentId: asAgentId('agent-1'),
          previousResidentialTier: 1,
          nextResidentialTier: 2,
          currencyCost: 200,
          consumedInventory: {},
        },
        occurredAt: 4,
        sequence: 4,
      }),
      // transfer: employer-paid wage does not move the supply
      createEventEnvelope({
        id: 'event-wage-employer',
        simulationId: 'sim-1',
        type: 'WagePaid',
        payload: {
          agentId: asAgentId('agent-2'),
          occupationName: 'Cook',
          amount: 30,
          fundingSource: 'employer' as const,
        },
        occurredAt: 5,
        sequence: 5,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    const minted = 50 + 25;
    const burned = 10 + 200;
    expect(projection.moneySupply).toBe(1000 + minted - burned);
    // Every minted/burned currency unit lands in or leaves an agent balance; transfers
    // only redistribute. Agent balances therefore move by minted − burned + transfers-in.
    expect(sumAgentBalances(projection)).toBe(200 + minted - burned + 30);
  });
});
