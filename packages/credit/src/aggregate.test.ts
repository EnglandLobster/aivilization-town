import { asAgentId, asLoanId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyCreditDomainEvent,
  decideDeposit,
  decideIssueLoan,
  decideLiquidateDeceasedCustomer,
  decideRepayLoan,
  decideWithdraw,
  splitLoanPayment,
  type CreditDomainEvent,
} from './aggregate';
import { createBankState, normalizeBankState, type BankState, type LoanState } from './model';
import { resolveCreditLimit, validateCreditPolicy, type CreditPolicy } from './policy';

const borrowerId = asAgentId('borrower');
const depositorId = asAgentId('depositor');

const policy: CreditPolicy = {
  policyVersion: 'credit-v1',
  depositDailyInterestRate: 0.001,
  loanDailyInterestRate: 0.01,
  loanTermDays: 30,
  accrualCadenceMs: 86_400_000,
  reserveRatio: 0.2,
  maxLoansPerAgent: 1,
  graceMissedPayments: 3,
  baseLoanLimit: 5000,
  creditLimitRepaidBonusRatio: 0.2,
  creditLimitDefaultPenaltyRatio: 0.5,
  creditLimitMinMultiplier: 0.1,
  creditLimitMaxMultiplier: 3,
  source: 'credit aggregate test fixture',
};

describe('credit policy validation and credit-limit schedule', () => {
  test('accepts the canonical-shaped policy and rejects invalid fields', () => {
    expect(() => validateCreditPolicy(policy)).not.toThrow();
    expect(() => validateCreditPolicy({ ...policy, policyVersion: '' })).toThrow();
    expect(() => validateCreditPolicy({ ...policy, reserveRatio: 1.5 })).toThrow();
    expect(() => validateCreditPolicy({ ...policy, reserveRatio: -0.1 })).toThrow();
    expect(() => validateCreditPolicy({ ...policy, maxLoansPerAgent: 0 })).toThrow();
    expect(() => validateCreditPolicy({ ...policy, graceMissedPayments: -1 })).toThrow();
    expect(() => validateCreditPolicy({ ...policy, loanTermDays: 0 })).toThrow();
    expect(() => validateCreditPolicy({ ...policy, accrualCadenceMs: 0 })).toThrow();
    expect(() => validateCreditPolicy({ ...policy, baseLoanLimit: 0 })).toThrow();
    expect(() => validateCreditPolicy({ ...policy, creditLimitDefaultPenaltyRatio: 2 })).toThrow();
    expect(
      () =>
        validateCreditPolicy({
          ...policy,
          creditLimitMinMultiplier: 2,
          creditLimitMaxMultiplier: 1,
        }),
    ).toThrow();
  });

  test('evolves the credit limit with history: repaid bonus, default halving, clamps', () => {
    expect(resolveCreditLimit({ history: undefined, policy })).toBe(5000);
    expect(
      resolveCreditLimit({ history: { repaidCount: 1, defaultedCount: 0 }, policy }),
    ).toBeCloseTo(6000);
    expect(
      resolveCreditLimit({ history: { repaidCount: 2, defaultedCount: 0 }, policy }),
    ).toBeCloseTo(7200);
    expect(
      resolveCreditLimit({ history: { repaidCount: 0, defaultedCount: 1 }, policy }),
    ).toBeCloseTo(2500);
    expect(
      resolveCreditLimit({ history: { repaidCount: 1, defaultedCount: 1 }, policy }),
    ).toBeCloseTo(3000);
    // Default-heavy histories clamp at the floor instead of collapsing to zero.
    expect(
      resolveCreditLimit({ history: { repaidCount: 0, defaultedCount: 10 }, policy }),
    ).toBeCloseTo(500);
    // Stellar histories clamp at the ceiling instead of growing without bound.
    expect(
      resolveCreditLimit({ history: { repaidCount: 10, defaultedCount: 0 }, policy }),
    ).toBeCloseTo(15_000);
  });
});

describe('deposit and withdrawal decisions', () => {
  test('deposit accepts a positive amount and bootstraps the bank on replay', () => {
    const decision = decideDeposit({ bank: undefined, agentId: depositorId, amount: 250 });
    expect(decision).toEqual({
      status: 'accepted',
      events: [{ type: 'DepositMade', agentId: depositorId, amount: 250 }],
    });
    if (decision.status !== 'accepted') return;
    const bank = decision.events.reduce(applyCreditDomainEvent, undefined);
    expect(bank).toEqual({
      balance: 250,
      deposits: { [depositorId]: 250 },
      loans: {},
      creditHistoryByAgent: {},
    });
  });

  test('deposit rejects non-positive or non-finite amounts', () => {
    expect(decideDeposit({ bank: undefined, agentId: depositorId, amount: 0 }).status).toBe(
      'rejected',
    );
    expect(decideDeposit({ bank: undefined, agentId: depositorId, amount: -5 }).status).toBe(
      'rejected',
    );
    expect(
      decideDeposit({ bank: undefined, agentId: depositorId, amount: Number.NaN }).status,
    ).toBe('rejected');
  });

  test('withdrawal is bounded by the deposit ledger and by bank liquidity', () => {
    const bank = bankWith({ balance: 100, deposits: { [depositorId]: 100 } });
    expect(decideWithdraw({ bank, agentId: depositorId, amount: 60 })).toEqual({
      status: 'accepted',
      events: [{ type: 'WithdrawalMade', agentId: depositorId, amount: 60 }],
    });
    expect(decideWithdraw({ bank, agentId: depositorId, amount: 101 })).toEqual({
      status: 'rejected',
      reason: 'withdrawal exceeds deposit balance: requested 101, available 100',
    });
    // The deposit ledger may exceed the cash on hand when loans are out.
    const illiquid = bankWith({ balance: 40, deposits: { [depositorId]: 100 } });
    expect(decideWithdraw({ bank: illiquid, agentId: depositorId, amount: 60 })).toEqual({
      status: 'rejected',
      reason: 'bank has insufficient liquidity',
    });
    expect(decideWithdraw({ bank, agentId: depositorId, amount: 0 }).status).toBe('rejected');
    expect(decideWithdraw({ bank: undefined, agentId: depositorId, amount: 1 })).toEqual({
      status: 'rejected',
      reason: 'bank is not initialized',
    });
  });

  test('withdrawal replay debits the ledger and drops emptied entries', () => {
    const bank = bankWith({ balance: 100, deposits: { [depositorId]: 100 } });
    const decision = decideWithdraw({ bank, agentId: depositorId, amount: 100 });
    if (decision.status !== 'accepted') throw new Error('expected acceptance');
    const next = decision.events.reduce(applyCreditDomainEvent, bank);
    expect(next.balance).toBe(0);
    expect(next.deposits).toEqual({});
  });
});

describe('loan issuance decisions', () => {
  test('issues within the credit limit, concurrency cap, and reserve requirement', () => {
    const bank = bankWith({ balance: 10_000, deposits: { [depositorId]: 4_000 } });
    // Reserve requirement: 4_000 × 0.2 = 800 must remain after issuance.
    const acceptedDecision = decideIssueLoan({
      bank,
      loanId: asLoanId('loan-1'),
      borrowerAgentId: borrowerId,
      amount: 5000,
      issuedAt: 1_000,
      policy,
    });
    expect(acceptedDecision.status).toBe('accepted');
    if (acceptedDecision.status !== 'accepted') return;
    expect(acceptedDecision.events[0]).toEqual({
      type: 'LoanIssued',
      loanId: asLoanId('loan-1'),
      borrowerAgentId: borrowerId,
      principal: 5000,
      dailyInterestRate: 0.01,
      termDays: 30,
      issuedAt: 1_000,
    });
    const next = acceptedDecision.events.reduce(applyCreditDomainEvent, bank);
    expect(next.balance).toBe(5_000);
    expect(next.loans['loan-1']).toMatchObject({
      principal: 5000,
      accruedInterest: 0,
      missedPayments: 0,
      status: 'active',
    });

    // maxLoansPerAgent = 1: a second concurrent loan is rejected.
    expect(
      decideIssueLoan({
        bank: next,
        loanId: asLoanId('loan-2'),
        borrowerAgentId: borrowerId,
        amount: 100,
        issuedAt: 2_000,
        policy,
      }),
    ).toEqual({ status: 'rejected', reason: 'borrower already has 1 active loans' });
  });

  test('rejects issuance that would breach the reserve requirement', () => {
    const bank = bankWith({ balance: 10_000, deposits: { [depositorId]: 4_000 } });
    const decision = decideIssueLoan({
      bank,
      loanId: asLoanId('loan-1'),
      borrowerAgentId: borrowerId,
      amount: 5000,
      issuedAt: 0,
      policy: { ...policy, baseLoanLimit: 50_000 },
    });
    expect(decision.status).toBe('accepted');

    // 10_000 − 9_201 < 4_000 × 0.2 = 800 → rejected even though the borrower
    // has plenty of credit limit left.
    expect(
      decideIssueLoan({
        bank,
        loanId: asLoanId('loan-2'),
        borrowerAgentId: borrowerId,
        amount: 9_201,
        issuedAt: 0,
        policy: { ...policy, baseLoanLimit: 50_000 },
      }),
    ).toEqual({
      status: 'rejected',
      reason:
        'loan issuance would breach the reserve requirement: bank cash 10000, required reserve 800',
    });
    // The exact reserve boundary is still acceptable.
    expect(
      decideIssueLoan({
        bank,
        loanId: asLoanId('loan-3'),
        borrowerAgentId: borrowerId,
        amount: 9_200,
        issuedAt: 0,
        policy: { ...policy, baseLoanLimit: 50_000 },
      }).status,
    ).toBe('accepted');
    // No reserves and no deposits: nothing can be lent.
    expect(
      decideIssueLoan({
        bank: bankWith({ balance: 0 }),
        loanId: asLoanId('loan-4'),
        borrowerAgentId: borrowerId,
        amount: 1,
        issuedAt: 0,
        policy,
      }).status,
    ).toBe('rejected');
  });

  test('rejects amounts above the history-scaled credit limit', () => {
    const bank = bankWith({ balance: 100_000 });
    expect(
      decideIssueLoan({
        bank,
        loanId: asLoanId('loan-1'),
        borrowerAgentId: borrowerId,
        amount: 5001,
        issuedAt: 0,
        policy,
      }),
    ).toEqual({ status: 'rejected', reason: 'loan amount exceeds credit limit 5000' });

    const withDefault = bankWith({
      balance: 100_000,
      creditHistoryByAgent: { [borrowerId]: { repaidCount: 0, defaultedCount: 1 } },
    });
    expect(
      decideIssueLoan({
        bank: withDefault,
        loanId: asLoanId('loan-2'),
        borrowerAgentId: borrowerId,
        amount: 2501,
        issuedAt: 0,
        policy,
      }),
    ).toEqual({ status: 'rejected', reason: 'loan amount exceeds credit limit 2500' });

    const withRepaid = bankWith({
      balance: 100_000,
      creditHistoryByAgent: { [borrowerId]: { repaidCount: 1, defaultedCount: 0 } },
    });
    expect(
      decideIssueLoan({
        bank: withRepaid,
        loanId: asLoanId('loan-3'),
        borrowerAgentId: borrowerId,
        amount: 6000,
        issuedAt: 0,
        policy,
      }).status,
    ).toBe('accepted');
  });

  test('rejects duplicate loan ids, invalid amounts, and a missing bank', () => {
    const bank = bankWith({
      balance: 10_000,
      loans: { 'loan-1': loan({ principal: 100 }) },
    });
    expect(
      decideIssueLoan({
        bank,
        loanId: asLoanId('loan-1'),
        borrowerAgentId: borrowerId,
        amount: 100,
        issuedAt: 0,
        policy,
      }),
    ).toEqual({ status: 'rejected', reason: 'loan loan-1 already exists' });
    expect(
      decideIssueLoan({
        bank,
        loanId: asLoanId('loan-2'),
        borrowerAgentId: borrowerId,
        amount: 0,
        issuedAt: 0,
        policy,
      }).status,
    ).toBe('rejected');
    expect(
      decideIssueLoan({
        bank: undefined,
        loanId: asLoanId('loan-3'),
        borrowerAgentId: borrowerId,
        amount: 100,
        issuedAt: 0,
        policy,
      }),
    ).toEqual({ status: 'rejected', reason: 'bank is not initialized' });
  });
});

describe('loan repayment decisions', () => {
  test('applies payments interest-first, then principal', () => {
    const bank = bankWith({
      balance: 1_000,
      loans: { 'loan-1': loan({ principal: 300, accruedInterest: 6 }) },
    });
    const decision = decideRepayLoan({ bank, loanId: asLoanId('loan-1'), amount: 103, repaidAt: 5 });
    expect(decision.status).toBe('accepted');
    if (decision.status !== 'accepted') return;
    expect(decision.events[0]).toEqual({
      type: 'LoanRepaid',
      loanId: asLoanId('loan-1'),
      borrowerAgentId: borrowerId,
      settledAt: 5,
      interestAccrued: 0,
      paidAmount: 103,
      interestPaid: 6,
      principalPaid: 97,
      missedPayments: 0,
      status: 'active',
    });
    const next = decision.events.reduce(applyCreditDomainEvent, bank);
    expect(next.balance).toBe(1_103);
    expect(next.loans['loan-1']).toMatchObject({
      principal: 203,
      accruedInterest: 0,
      status: 'active',
    });
  });

  test('full payoff closes the loan and records the repaid history', () => {
    const bank = bankWith({
      balance: 1_000,
      loans: { 'loan-1': loan({ principal: 300, accruedInterest: 6 }) },
    });
    // Overpayments clamp to the outstanding balance.
    const decision = decideRepayLoan({
      bank,
      loanId: asLoanId('loan-1'),
      amount: 1_000,
      repaidAt: 5,
    });
    expect(decision.status).toBe('accepted');
    if (decision.status !== 'accepted') return;
    expect(decision.events[0]).toMatchObject({ paidAmount: 306, status: 'repaid' });
    const next = decision.events.reduce(applyCreditDomainEvent, bank);
    expect(next.loans['loan-1']).toMatchObject({ principal: 0, accruedInterest: 0 });
    expect(next.creditHistoryByAgent[borrowerId]).toEqual({ repaidCount: 1, defaultedCount: 0 });
  });

  test('rejects repayment of unknown, settled, or invalid targets', () => {
    const bank = bankWith({
      balance: 1_000,
      loans: {
        'loan-closed': loan({ principal: 0, status: 'repaid' }),
      },
    });
    expect(
      decideRepayLoan({ bank, loanId: asLoanId('loan-missing'), amount: 1, repaidAt: 0 }),
    ).toEqual({ status: 'rejected', reason: 'loan loan-missing does not exist' });
    expect(
      decideRepayLoan({ bank, loanId: asLoanId('loan-closed'), amount: 1, repaidAt: 0 }),
    ).toEqual({ status: 'rejected', reason: 'loan loan-closed is not active' });
    expect(
      decideRepayLoan({ bank, loanId: asLoanId('loan-closed'), amount: -1, repaidAt: 0 }).status,
    ).toBe('rejected');
    expect(
      decideRepayLoan({ bank: undefined, loanId: asLoanId('loan-x'), amount: 1, repaidAt: 0 }),
    ).toEqual({ status: 'rejected', reason: 'bank is not initialized' });
  });

  test('splitLoanPayment pins interest-first ordering and exact zero payoff', () => {
    const target = loan({ principal: 200, accruedInterest: 8 });
    expect(splitLoanPayment(target, 50)).toMatchObject({
      paidAmount: 50,
      interestPaid: 8,
      principalPaid: 42,
      nextPrincipal: 158,
      nextAccruedInterest: 0,
      status: 'active',
    });
    expect(splitLoanPayment(target, 208)).toMatchObject({
      interestPaid: 8,
      principalPaid: 200,
      nextPrincipal: 0,
      nextAccruedInterest: 0,
      status: 'repaid',
    });
    expect(splitLoanPayment(target, 0).status).toBe('active');
  });
});

describe('credit event replay', () => {
  test('folds a full banking sequence deterministically from genesis', () => {
    const events: CreditDomainEvent[] = [
      { type: 'DepositMade', agentId: depositorId, amount: 4_000 },
      {
        type: 'LoanIssued',
        loanId: asLoanId('loan-1'),
        borrowerAgentId: borrowerId,
        principal: 2_000,
        dailyInterestRate: 0.01,
        termDays: 2,
        issuedAt: 0,
      },
      {
        type: 'LoanRepaid',
        loanId: asLoanId('loan-1'),
        borrowerAgentId: borrowerId,
        settledAt: 86_400_000,
        interestAccrued: 20,
        paidAmount: 1_020,
        interestPaid: 20,
        principalPaid: 1_000,
        missedPayments: 0,
        status: 'active',
      },
      { type: 'WithdrawalMade', agentId: depositorId, amount: 1_000 },
      {
        type: 'LoanRepaid',
        loanId: asLoanId('loan-1'),
        borrowerAgentId: borrowerId,
        settledAt: 172_800_000,
        interestAccrued: 10,
        paidAmount: 1_010,
        interestPaid: 10,
        principalPaid: 1_000,
        missedPayments: 0,
        status: 'repaid',
      },
    ];
    const bank = events.reduce<BankState | undefined>(applyCreditDomainEvent, undefined);
    if (bank === undefined) throw new Error('expected a bank state');
    expect(bank.balance).toBe(4_000 - 2_000 + 1_020 - 1_000 + 1_010);
    expect(bank.deposits).toEqual({ [depositorId]: 3_000 });
    expect(bank.loans['loan-1']).toMatchObject({
      principal: 0,
      accruedInterest: 0,
      missedPayments: 0,
      status: 'repaid',
      lastAccrualAt: 172_800_000,
    });
    expect(bank.creditHistoryByAgent[borrowerId]).toEqual({ repaidCount: 1, defaultedCount: 0 });

    // A JSON round-trip of the snapshot normalizes back to the identical state
    // and decisions against it stay stable (snapshot compatibility).
    const revived = normalizeBankState(JSON.parse(JSON.stringify(bank)) as BankState);
    expect(revived).toEqual(bank);
    expect(
      decideIssueLoan({
        bank: revived,
        loanId: asLoanId('loan-2'),
        borrowerAgentId: borrowerId,
        amount: 2_000,
        issuedAt: 200_000_000,
        policy,
      }).status,
    ).toBe('accepted');
  });

  test('normalizes legacy snapshots with absent maps and dust amounts', () => {
    const legacy = {
      balance: 100,
      deposits: { 'agent-gone': 0, [depositorId]: 50 },
      loans: {},
    } as unknown as BankState;
    const normalized = normalizeBankState(legacy);
    expect(normalized.deposits).toEqual({ [depositorId]: 50 });
    expect(normalized.creditHistoryByAgent).toEqual({});
  });

  test('the reducer rejects events that contradict the loan book', () => {
    const bank = bankWith({ balance: 1_000, loans: { 'loan-1': loan({ principal: 300 }) } });
    expect(() =>
      applyCreditDomainEvent(bank, {
        type: 'LoanRepaid',
        loanId: asLoanId('loan-1'),
        borrowerAgentId: borrowerId,
        settledAt: 1,
        interestAccrued: 0,
        paidAmount: 50,
        interestPaid: 20,
        principalPaid: 20,
        missedPayments: 0,
        status: 'active',
      }),
    ).toThrow();
    expect(() =>
      applyCreditDomainEvent(bank, {
        type: 'LoanDefaulted',
        loanId: asLoanId('loan-1'),
        borrowerAgentId: borrowerId,
        defaultedAt: 1,
        interestAccrued: 0,
        paidAmount: 0,
        interestPaid: 0,
        principalPaid: 0,
        missedPayments: 4,
        outstandingPrincipal: 123,
        outstandingInterest: 0,
      }),
    ).toThrow(/does not match the loan book/);
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

describe('deceased-customer estate liquidation', () => {
  const deceasedId = asAgentId('deceased');

  function bankWithLoanAndDeposit(): BankState {
    // The deceased deposits 4,000 (bank cash 4,000), then borrows 2,000
    // (bank cash 2,000, deposit ledger still 4,000).
    return [
      { type: 'DepositMade' as const, agentId: deceasedId, amount: 4_000 },
      {
        type: 'LoanIssued' as const,
        loanId: asLoanId('loan-1'),
        borrowerAgentId: deceasedId,
        principal: 2_000,
        dailyInterestRate: 0.01,
        termDays: 30,
        issuedAt: 0,
      },
    ].reduce<BankState | undefined>(applyCreditDomainEvent, undefined) as BankState;
  }

  test('writes off active loans without moving bank cash', () => {
    const decision = decideLiquidateDeceasedCustomer({
      bank: bankWithLoanAndDeposit(),
      agentId: deceasedId,
      settledAt: 86_400_000,
    });
    expect(decision.status).toBe('accepted');
    if (decision.status !== 'accepted') throw new Error('unreachable');
    expect(decision.events).toEqual([
      {
        type: 'LoanWrittenOff',
        loanId: asLoanId('loan-1'),
        borrowerAgentId: deceasedId,
        writtenOffAt: 86_400_000,
        outstandingPrincipal: 2_000,
        outstandingInterest: 0,
      },
      {
        type: 'DepositForfeited',
        agentId: deceasedId,
        forfeitedAmount: 4_000,
        forfeitedAt: 86_400_000,
      },
    ]);
    const bank = decision.events.reduce(applyCreditDomainEvent, bankWithLoanAndDeposit());
    // Pure book operations: cash untouched, loan marked written-off, deposit
    // liability extinguished, credit history untouched (death is not default).
    expect(bank.balance).toBe(2_000);
    expect(bank.loans['loan-1']).toMatchObject({ status: 'written-off', principal: 2_000 });
    expect(bank.deposits).toEqual({});
    expect(bank.creditHistoryByAgent[deceasedId]).toEqual(undefined);
  });

  test('returns no events for a customer with no loans and no deposits', () => {
    const decision = decideLiquidateDeceasedCustomer({
      bank: bankWithLoanAndDeposit(),
      agentId: asAgentId('stranger'),
      settledAt: 1_000,
    });
    expect(decision).toEqual({ status: 'accepted', events: [] });
  });

  test('rejected without a bank and on invalid settledAt', () => {
    expect(
      decideLiquidateDeceasedCustomer({
        bank: undefined,
        agentId: borrowerId,
        settledAt: 0,
      }).status,
    ).toBe('rejected');
    expect(
      decideLiquidateDeceasedCustomer({
        bank: bankWithLoanAndDeposit(),
        agentId: borrowerId,
        settledAt: -1,
      }).status,
    ).toBe('rejected');
  });

  test('replay rejects a write-off whose payload disagrees with the book', () => {
    const bank = bankWithLoanAndDeposit();
    expect(() =>
      applyCreditDomainEvent(bank, {
        type: 'LoanWrittenOff',
        loanId: asLoanId('loan-1'),
        borrowerAgentId: depositorId,
        writtenOffAt: 0,
        outstandingPrincipal: 2_001,
        outstandingInterest: 0,
      }),
    ).toThrow('does not match the loan book');
    expect(() =>
      applyCreditDomainEvent(bank, {
        type: 'DepositForfeited',
        agentId: depositorId,
        forfeitedAmount: 3_999,
        forfeitedAt: 0,
      }),
    ).toThrow('does not match the depositor ledger');
  });

  test('replay refuses to settle a written-off loan again', () => {
    const bank = [
      { type: 'DepositMade' as const, agentId: borrowerId, amount: 1_000 },
      {
        type: 'LoanIssued' as const,
        loanId: asLoanId('loan-2'),
        borrowerAgentId: borrowerId,
        principal: 500,
        dailyInterestRate: 0.01,
        termDays: 30,
        issuedAt: 0,
      },
      {
        type: 'LoanWrittenOff' as const,
        loanId: asLoanId('loan-2'),
        borrowerAgentId: borrowerId,
        writtenOffAt: 0,
        outstandingPrincipal: 500,
        outstandingInterest: 0,
      },
    ].reduce<BankState | undefined>(applyCreditDomainEvent, undefined) as BankState;
    expect(() =>
      applyCreditDomainEvent(bank, {
        type: 'LoanWrittenOff',
        loanId: asLoanId('loan-2'),
        borrowerAgentId: borrowerId,
        writtenOffAt: 1,
        outstandingPrincipal: 500,
        outstandingInterest: 0,
      }),
    ).toThrow('cannot settle written-off loan');
  });
});
