import type { AgentId, LoanId } from '@aivilization/sim-core';

/**
 * The single authoritative town bank aggregate. One bank per world partition:
 * it holds a cash account (`balance`, a circulating account in the accounting
 * model), the depositor ledger (`deposits`, liabilities owed back to agents),
 * the loan book (`loans`, including settled loans for audit), and per-agent
 * credit history driving the credit limit.
 *
 * Every currency movement in or out of `balance` is a transfer to or from a
 * domestic circulating account, so banking never moves the money supply.
 */
export type BankState = {
  /** Cash held by the bank (its own reserves plus deposit-backed funds). */
  readonly balance: number;
  /** Depositor ledger: agentId → withdrawable deposit balance. */
  readonly deposits: Readonly<Record<string, number>>;
  /** Loan book keyed by loanId; repaid/defaulted loans stay for audit. */
  readonly loans: Readonly<Record<string, LoanState>>;
  readonly creditHistoryByAgent: Readonly<Record<string, CreditHistory>>;
};

export type LoanStatus = 'active' | 'repaid' | 'defaulted' | 'written-off';

export type LoanState = {
  readonly loanId: LoanId;
  readonly borrowerAgentId: AgentId;
  /** Outstanding (unpaid) principal. */
  readonly principal: number;
  /** Daily rate fixed at issuance; replay does not depend on policy drift. */
  readonly dailyInterestRate: number;
  readonly termDays: number;
  /** Simulation time (ms) the loan was issued at. */
  readonly issuedAt: number;
  /** Accrued unpaid interest; simple interest accrues on principal only. */
  readonly accruedInterest: number;
  /** Simulation time of the last daily accrual/settlement. */
  readonly lastAccrualAt: number;
  /** Consecutive daily settlements whose due payment was not fully covered. */
  readonly missedPayments: number;
  readonly status: LoanStatus;
};

export type CreditHistory = {
  readonly repaidCount: number;
  readonly defaultedCount: number;
};

/** Account owner id of the town bank in the economy accounting model. */
export const TOWN_BANK_ACCOUNT_OWNER_ID = 'town-bank';

/**
 * Tolerance for floating-point dust on aggregate money fields. Decision
 * functions compute exact zero on full payoff paths; the reducer snaps only
 * sub-EPSILON drift so replay stays deterministic.
 */
export const CREDIT_AMOUNT_EPSILON = 1e-9;

export function createBankState(input: { readonly reserves: number }): BankState {
  if (!Number.isFinite(input.reserves) || input.reserves < 0) {
    throw new Error('bank reserves must be non-negative finite');
  }
  return {
    balance: input.reserves,
    deposits: {},
    loans: {},
    creditHistoryByAgent: {},
  };
}

export function emptyCreditHistory(): CreditHistory {
  return { repaidCount: 0, defaultedCount: 0 };
}

/**
 * Normalization boundary for snapshots: records are key-sorted for
 * deterministic iteration, absent legacy maps default to empty, and
 * dust-level negative amounts snap to zero.
 */
export function normalizeBankState(state: BankState): BankState {
  return {
    balance: snapNearZero(state.balance),
    deposits: sortRecord(
      Object.fromEntries(
        Object.entries(state.deposits ?? {})
          .map(([agentId, deposit]) => [agentId, snapNearZero(deposit)] as const)
          .filter(([, deposit]) => deposit > 0),
      ),
    ),
    loans: sortRecord(
      Object.fromEntries(
        Object.entries(state.loans ?? {}).map(([loanId, loan]) => [
          loanId,
          normalizeLoanState(loan),
        ]),
      ),
    ),
    creditHistoryByAgent: sortRecord(
      Object.fromEntries(
        Object.entries(state.creditHistoryByAgent ?? {}).map(([agentId, history]) => [
          agentId,
          { repaidCount: history.repaidCount, defaultedCount: history.defaultedCount },
        ]),
      ),
    ),
  };
}

function normalizeLoanState(loan: LoanState): LoanState {
  return {
    ...loan,
    principal: snapNearZero(loan.principal),
    accruedInterest: snapNearZero(loan.accruedInterest),
  };
}

function snapNearZero(value: number): number {
  return Math.abs(value) < CREDIT_AMOUNT_EPSILON ? 0 : value;
}

function sortRecord<TValue>(record: Record<string, TValue>): Record<string, TValue> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function assertValidBankState(state: BankState): void {
  if (!Number.isFinite(state.balance) || state.balance < 0) {
    throw new Error('bank balance must be non-negative finite');
  }
  for (const [agentId, deposit] of Object.entries(state.deposits)) {
    if (agentId.trim().length === 0 || !Number.isFinite(deposit) || deposit <= 0) {
      throw new Error('bank deposits must be positive finite values keyed by agent');
    }
  }
  for (const loan of Object.values(state.loans)) {
    assertValidLoanState(loan);
  }
  for (const [agentId, history] of Object.entries(state.creditHistoryByAgent)) {
    if (agentId.trim().length === 0) {
      throw new Error('credit history must be keyed by agent');
    }
    if (!Number.isInteger(history.repaidCount) || history.repaidCount < 0) {
      throw new Error('credit history repaidCount must be a non-negative integer');
    }
    if (!Number.isInteger(history.defaultedCount) || history.defaultedCount < 0) {
      throw new Error('credit history defaultedCount must be a non-negative integer');
    }
  }
}

export function assertValidLoanState(loan: LoanState): void {
  if (loan.loanId.trim().length === 0) {
    throw new Error('loanId must not be empty');
  }
  if (loan.borrowerAgentId.trim().length === 0) {
    throw new Error('loan borrowerAgentId must not be empty');
  }
  if (!Number.isFinite(loan.principal) || loan.principal < 0) {
    throw new Error('loan principal must be non-negative finite');
  }
  if (!Number.isFinite(loan.dailyInterestRate) || loan.dailyInterestRate < 0) {
    throw new Error('loan dailyInterestRate must be non-negative finite');
  }
  if (!Number.isInteger(loan.termDays) || loan.termDays < 1) {
    throw new Error('loan termDays must be a positive integer');
  }
  if (!Number.isFinite(loan.issuedAt) || loan.issuedAt < 0) {
    throw new Error('loan issuedAt must be non-negative finite');
  }
  if (!Number.isFinite(loan.accruedInterest) || loan.accruedInterest < 0) {
    throw new Error('loan accruedInterest must be non-negative finite');
  }
  if (!Number.isFinite(loan.lastAccrualAt) || loan.lastAccrualAt < 0) {
    throw new Error('loan lastAccrualAt must be non-negative finite');
  }
  if (!Number.isInteger(loan.missedPayments) || loan.missedPayments < 0) {
    throw new Error('loan missedPayments must be a non-negative integer');
  }
}

/** Total deposit liabilities backing the reserve-requirement constraint. */
export function totalDeposits(bank: BankState): number {
  return Object.values(bank.deposits).reduce((total, deposit) => total + deposit, 0);
}

export function activeLoansByBorrower(
  bank: BankState,
  borrowerAgentId: AgentId,
): readonly LoanState[] {
  return Object.values(bank.loans)
    .filter((loan) => loan.borrowerAgentId === borrowerAgentId && loan.status === 'active')
    .sort((left, right) => left.loanId.localeCompare(right.loanId));
}
