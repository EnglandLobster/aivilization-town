import { asAgentId, asLoanId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { applyCreditDomainEvent, type CreditDomainEvent } from './aggregate';
import { evaluateDailyCreditAccrual } from './lifecycle';
import { createBankState, normalizeBankState, type BankState, type LoanState } from './model';
import type { CreditPolicy } from './policy';

const borrowerId = asAgentId('borrower');
const depositorId = asAgentId('depositor');
const DAY_MS = 86_400_000;

const policy: CreditPolicy = {
  policyVersion: 'credit-v1',
  depositDailyInterestRate: 0.001,
  loanDailyInterestRate: 0.01,
  loanTermDays: 3,
  accrualCadenceMs: DAY_MS,
  reserveRatio: 0.2,
  maxLoansPerAgent: 1,
  graceMissedPayments: 3,
  baseLoanLimit: 5000,
  creditLimitRepaidBonusRatio: 0.2,
  creditLimitDefaultPenaltyRatio: 0.5,
  creditLimitMinMultiplier: 0.1,
  creditLimitMaxMultiplier: 3,
  source: 'credit lifecycle test fixture',
};

describe('daily loan accrual and amortized collection', () => {
  test('accrues simple interest on principal and collects interest-first installments', () => {
    const bank = bankWith({
      balance: 10_000,
      loans: { 'loan-1': loan({ principal: 300, termDays: 3 }) },
    });
    const balances = new Map([[borrowerId, 10_000]]);
    const events: CreditDomainEvent[] = [];
    const settle = (now: number) =>
      evaluateDailyCreditAccrual({
        bank: events.reduce(applyCreditDomainEvent, bank),
        now,
        policy,
        borrowerBalance: (agentId) => balances.get(agentId),
      });

    // Day 1: accrue 300×1% = 3; due = 100 principal share + 3 interest = 103.
    const day1 = settle(DAY_MS);
    expect(day1.events).toEqual([
      {
        type: 'LoanRepaid',
        loanId: asLoanId('loan-1'),
        borrowerAgentId: borrowerId,
        settledAt: DAY_MS,
        interestAccrued: 3,
        paidAmount: 103,
        interestPaid: 3,
        principalPaid: 100,
        missedPayments: 0,
        status: 'active',
      },
    ]);
    events.push(...day1.events);
    balances.set(borrowerId, 10_000 - 103);

    // Day 2: accrue 200×1% = 2; due = 100 + 2 = 102.
    const day2 = settle(2 * DAY_MS);
    expect(day2.events).toEqual([
      expect.objectContaining({
        interestAccrued: 2,
        paidAmount: 102,
        interestPaid: 2,
        principalPaid: 100,
        status: 'active',
      }),
    ]);
    events.push(...day2.events);
    balances.set(borrowerId, 10_000 - 103 - 102);

    // Day 3 (final installment): due = remaining 100 principal + 1 interest.
    const day3 = settle(3 * DAY_MS);
    expect(day3.events).toEqual([
      expect.objectContaining({
        interestAccrued: 1,
        paidAmount: 101,
        interestPaid: 1,
        principalPaid: 100,
        status: 'repaid',
      }),
    ]);
    events.push(...day3.events);

    const finalBank = events.reduce(applyCreditDomainEvent, bank);
    expect(finalBank.loans['loan-1']).toMatchObject({
      principal: 0,
      accruedInterest: 0,
      missedPayments: 0,
      status: 'repaid',
    });
    expect(finalBank.creditHistoryByAgent[borrowerId]).toEqual({
      repaidCount: 1,
      defaultedCount: 0,
    });
    // The bank cash account recovers principal 300 + interest 6 over the three days.
    expect(finalBank.balance).toBe(10_306);
  });

  test('unpaid interest carries into the next due amount without compounding', () => {
    const bank = bankWith({
      balance: 10_000,
      loans: { 'loan-1': loan({ principal: 300, termDays: 3 }) },
    });
    // Day 1 pays nothing: balance only covers part of the interest.
    const day1 = evaluateDailyCreditAccrual({
      bank,
      now: DAY_MS,
      policy,
      borrowerBalance: () => 1,
    });
    expect(day1.events[0]).toMatchObject({
      type: 'LoanRepaid',
      interestAccrued: 3,
      paidAmount: 1,
      interestPaid: 1,
      principalPaid: 0,
      missedPayments: 1,
      status: 'active',
    });
    const afterDay1 = applyCreditDomainEvent(bank, day1.events[0]!);
    expect(afterDay1.loans['loan-1']).toMatchObject({ principal: 300, accruedInterest: 2 });

    // Day 2 accrues another 3 on the unchanged principal (simple interest) and
    // the due amount includes the carried 2.
    const day2 = evaluateDailyCreditAccrual({
      bank: afterDay1,
      now: 2 * DAY_MS,
      policy,
      borrowerBalance: () => 10_000,
    });
    expect(day2.events[0]).toMatchObject({
      interestAccrued: 3,
      paidAmount: 155,
      interestPaid: 5,
      principalPaid: 150,
      missedPayments: 0,
      status: 'active',
    });
  });

  test('a fully covered day resets the consecutive missed-payment counter', () => {
    let bank = bankWith({
      balance: 10_000,
      loans: { 'loan-1': loan({ principal: 300, termDays: 30 }) },
    });
    const accrue = (now: number, balance: number) => {
      const decision = evaluateDailyCreditAccrual({
        bank,
        now,
        policy,
        borrowerBalance: () => balance,
      });
      bank = decision.events.reduce(applyCreditDomainEvent, bank);
      return decision;
    };
    expect(accrue(DAY_MS, 0).events[0]).toMatchObject({ missedPayments: 1 });
    expect(accrue(2 * DAY_MS, 0).events[0]).toMatchObject({ missedPayments: 2 });
    expect(accrue(3 * DAY_MS, 10_000).events[0]).toMatchObject({ missedPayments: 0 });
    expect(accrue(4 * DAY_MS, 0).events[0]).toMatchObject({ missedPayments: 1 });
  });

  test('defaults after more than graceMissedPayments consecutive misses', () => {
    let bank = bankWith({
      balance: 10_000,
      loans: { 'loan-1': loan({ principal: 300, termDays: 3 }) },
    });
    const accrue = (now: number) => {
      const decision = evaluateDailyCreditAccrual({
        bank,
        now,
        policy,
        borrowerBalance: () => 0,
      });
      bank = decision.events.reduce(applyCreditDomainEvent, bank);
      return decision;
    };

    expect(accrue(DAY_MS).events[0]).toMatchObject({ type: 'LoanRepaid', missedPayments: 1 });
    expect(accrue(2 * DAY_MS).events[0]).toMatchObject({ type: 'LoanRepaid', missedPayments: 2 });
    // Third miss is still inside the grace window.
    expect(accrue(3 * DAY_MS).events[0]).toMatchObject({ type: 'LoanRepaid', missedPayments: 3 });
    // Fourth consecutive miss crosses the threshold: default with the day's
    // accrual recorded and the outstanding book kept as the bank's loss memo.
    const day4 = accrue(4 * DAY_MS);
    expect(day4.events[0]).toEqual({
      type: 'LoanDefaulted',
      loanId: asLoanId('loan-1'),
      borrowerAgentId: borrowerId,
      defaultedAt: 4 * DAY_MS,
      interestAccrued: 3,
      paidAmount: 0,
      interestPaid: 0,
      principalPaid: 0,
      missedPayments: 4,
      outstandingPrincipal: 300,
      outstandingInterest: 12,
    });
    expect(bank.loans['loan-1']).toMatchObject({
      status: 'defaulted',
      principal: 300,
      accruedInterest: 12,
    });
    expect(bank.creditHistoryByAgent[borrowerId]).toEqual({ repaidCount: 0, defaultedCount: 1 });

    // Defaulted loans no longer accrue or collect.
    expect(accrue(5 * DAY_MS).events).toEqual([]);
  });

  test('a past-term loan demands the whole remaining principal each cadence', () => {
    let bank = bankWith({
      balance: 10_000,
      loans: { 'loan-1': loan({ principal: 300, termDays: 3 }) },
    });
    const accrue = (now: number, balance: number) => {
      const decision = evaluateDailyCreditAccrual({
        bank,
        now,
        policy,
        borrowerBalance: () => balance,
      });
      bank = decision.events.reduce(applyCreditDomainEvent, bank);
      return decision;
    };
    accrue(DAY_MS, 0);
    accrue(2 * DAY_MS, 0);
    accrue(3 * DAY_MS, 0);
    // Past the 3-day term with full principal outstanding: due = 300 + accrued 12.
    const day4 = accrue(4 * DAY_MS, 1_000);
    expect(day4.events[0]).toMatchObject({
      paidAmount: 312,
      interestPaid: 12,
      principalPaid: 300,
      status: 'repaid',
    });
  });
});

describe('daily deposit interest', () => {
  test('pays deposit interest from the bank cash account in agent order', () => {
    const bank = bankWith({
      balance: 5_000,
      deposits: { [depositorId]: 1_000, [asAgentId('agent-b')]: 2_000 },
    });
    const decision = evaluateDailyCreditAccrual({
      bank,
      now: DAY_MS,
      policy,
      borrowerBalance: () => 0,
    });
    expect(decision.events).toEqual([
      {
        type: 'DepositInterestPaid',
        paidAt: DAY_MS,
        payments: [
          { agentId: asAgentId('agent-b'), amount: 2 },
          { agentId: depositorId, amount: 1 },
        ],
      },
    ]);
    const next = decision.events.reduce(applyCreditDomainEvent, bank);
    expect(next.balance).toBe(5_000 - 3);
    // Deposit principal is untouched: interest settles to depositor cash.
    expect(next.deposits).toEqual(bank.deposits);
  });

  test('caps payouts at the bank cash on hand instead of overdrawing', () => {
    const bank = bankWith({
      balance: 1.5,
      deposits: { [asAgentId('agent-a')]: 1_000, [asAgentId('agent-b')]: 1_000 },
    });
    const decision = evaluateDailyCreditAccrual({
      bank,
      now: DAY_MS,
      policy,
      borrowerBalance: () => 0,
    });
    // agent-a is paid in full first (agentId order); agent-b gets the remainder.
    expect(decision.events).toEqual([
      {
        type: 'DepositInterestPaid',
        paidAt: DAY_MS,
        payments: [
          { agentId: asAgentId('agent-a'), amount: 1 },
          { agentId: asAgentId('agent-b'), amount: 0.5 },
        ],
      },
    ]);
    expect(decision.events.reduce(applyCreditDomainEvent, bank).balance).toBe(0);
  });

  test('agents absent from the balance map skip the cadence entirely', () => {
    const bank = bankWith({
      balance: 5_000,
      deposits: { [depositorId]: 1_000 },
      loans: { 'loan-1': loan({ principal: 300 }) },
    });
    const decision = evaluateDailyCreditAccrual({
      bank,
      now: DAY_MS,
      policy,
      borrowerBalance: () => undefined,
    });
    expect(decision.events).toEqual([]);
  });

  test('multi-day settlement accumulates amortization and deposit interest per cadence', () => {
    const initialBank = bankWith({
      balance: 10_000,
      deposits: { [depositorId]: 2_000 },
      loans: { 'loan-1': loan({ principal: 300, termDays: 3 }) },
    });
    const settleOneCadence = (bank: BankState, now: number, balance: number) => {
      const decision = evaluateDailyCreditAccrual({
        bank,
        now,
        policy,
        borrowerBalance: () => balance,
      });
      return {
        bank: decision.events.reduce(applyCreditDomainEvent, bank),
        events: decision.events,
      };
    };

    // Reference: three sequential daily settlements with the borrower paying.
    let referenceBank = initialBank;
    let referenceBalance = 10_000;
    const referenceEvents: CreditDomainEvent[] = [];
    for (const day of [1, 2, 3]) {
      const step = settleOneCadence(referenceBank, day * DAY_MS, referenceBalance);
      for (const event of step.events) {
        if (event.type === 'LoanRepaid' || event.type === 'LoanDefaulted') {
          referenceBalance -= event.paidAmount;
        }
        if (event.type === 'DepositInterestPaid') {
          referenceBalance += event.payments[0]?.amount ?? 0;
        }
      }
      referenceBank = step.bank;
      referenceEvents.push(...step.events);
    }

    // The borrower repays 103 + 102 + 101 and earns 2 deposit interest daily.
    expect(referenceBalance).toBe(10_000 - 306 + 6);
    expect(referenceBank.balance).toBe(10_000 + 306 - 6);
    expect(referenceEvents.map((event) => event.type)).toEqual([
      'LoanRepaid',
      'DepositInterestPaid',
      'LoanRepaid',
      'DepositInterestPaid',
      'LoanRepaid',
      'DepositInterestPaid',
    ]);
    expect(referenceEvents.map((event) => (event.type === 'LoanRepaid' ? event.status : ''))).toEqual(
      ['active', '', 'active', '', 'repaid', ''],
    );
  });
});

function bankWith(overrides: Partial<BankState> & { readonly balance: number }): BankState {
  return normalizeBankState({
    ...createBankState({ reserves: overrides.balance }),
    ...overrides,
  });
}

function loan(overrides: Partial<LoanState> = {}): LoanState {
  return {
    loanId: asLoanId('loan-1'),
    borrowerAgentId: borrowerId,
    principal: 300,
    dailyInterestRate: 0.01,
    termDays: 3,
    issuedAt: 0,
    accruedInterest: 0,
    lastAccrualAt: 0,
    missedPayments: 0,
    status: 'active',
    ...overrides,
  };
}
