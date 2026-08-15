import { asAgentId, type AgentId, type LoanId } from '@aivilization/sim-core';
import {
  activeLoansByBorrower,
  assertValidBankState,
  createBankState,
  emptyCreditHistory,
  normalizeBankState,
  totalDeposits,
  type BankState,
  type LoanState,
} from './model';
import { resolveCreditLimit, validateCreditPolicy, type CreditPolicy } from './policy';

/**
 * Credit domain events. Money moves only as transfers between the bank cash
 * account and the borrower/depositor agent account; the world application
 * layer maps these into durable integration events carrying the same facts.
 */
export type CreditDomainEvent =
  | {
      readonly type: 'DepositMade';
      readonly agentId: AgentId;
      readonly amount: number;
    }
  | {
      readonly type: 'WithdrawalMade';
      readonly agentId: AgentId;
      readonly amount: number;
    }
  | {
      readonly type: 'LoanIssued';
      readonly loanId: LoanId;
      readonly borrowerAgentId: AgentId;
      readonly principal: number;
      readonly dailyInterestRate: number;
      readonly termDays: number;
      readonly issuedAt: number;
    }
  | {
      /**
       * One loan settlement: the day's interest accrual plus the cash
       * collected from the borrower (zero on a fully missed day). Repayment
       * applies interest-first, then principal. `status: 'repaid'` marks the
       * final payoff and increments the borrower's repaidCount.
       */
      readonly type: 'LoanRepaid';
      readonly loanId: LoanId;
      readonly borrowerAgentId: AgentId;
      readonly settledAt: number;
      readonly interestAccrued: number;
      readonly paidAmount: number;
      readonly interestPaid: number;
      readonly principalPaid: number;
      readonly missedPayments: number;
      readonly status: 'active' | 'repaid';
    }
  | {
      /**
       * The loan crossed the missed-payment grace threshold at a daily
       * settlement. The partial payment collected that day (if any) is
       * included; the outstanding principal/interest remain on the book as
       * the bank's recorded loss and the borrower's defaultedCount grows.
       */
      readonly type: 'LoanDefaulted';
      readonly loanId: LoanId;
      readonly borrowerAgentId: AgentId;
      readonly defaultedAt: number;
      readonly interestAccrued: number;
      readonly paidAmount: number;
      readonly interestPaid: number;
      readonly principalPaid: number;
      readonly missedPayments: number;
      readonly outstandingPrincipal: number;
      readonly outstandingInterest: number;
    }
  | {
      /**
       * Daily deposit interest paid out of the bank cash account, batched per
       * accrual cadence. Deposits themselves are unchanged: interest settles
       * directly into depositor cash instead of compounding into the ledger.
       */
      readonly type: 'DepositInterestPaid';
      readonly paidAt: number;
      readonly payments: readonly {
        readonly agentId: AgentId;
        readonly amount: number;
      }[];
    }
  | {
      /**
       * A borrower died with the loan still outstanding: the bank writes the
       * asset off its book (no cash moves — the loan money was already
       * circulating). Death is not a behavioral default, so the borrower's
       * credit history is untouched.
       */
      readonly type: 'LoanWrittenOff';
      readonly loanId: LoanId;
      readonly borrowerAgentId: AgentId;
      readonly writtenOffAt: number;
      readonly outstandingPrincipal: number;
      readonly outstandingInterest: number;
    }
  | {
      /**
       * A depositor died with no heirs: the deposit liability is extinguished
       * and the bank keeps the cash (no transfer, supply unchanged). Emitted
       * only for a positive deposit balance.
       */
      readonly type: 'DepositForfeited';
      readonly agentId: AgentId;
      readonly forfeitedAmount: number;
      readonly forfeitedAt: number;
    };

export type CreditDecision =
  | { readonly status: 'accepted'; readonly events: readonly CreditDomainEvent[] }
  | { readonly status: 'rejected'; readonly reason: string };

/**
 * Deposit command decision. The agent-side balance check is an application
 * concern (the world handler rejects overdraws); the aggregate owns the
 * deposit ledger invariant (positive amounts only).
 */
export function decideDeposit(input: {
  readonly bank: BankState | undefined;
  readonly agentId: AgentId;
  readonly amount: number;
}): CreditDecision {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return rejected('deposit amount must be positive finite');
  }
  return accepted({ type: 'DepositMade', agentId: input.agentId, amount: input.amount });
}

export function decideWithdraw(input: {
  readonly bank: BankState | undefined;
  readonly agentId: AgentId;
  readonly amount: number;
}): CreditDecision {
  const bank = requireBank(input.bank);
  if (bank.status === 'rejected') {
    return bank;
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return rejected('withdrawal amount must be positive finite');
  }
  const deposit = bank.bank.deposits[input.agentId] ?? 0;
  if (input.amount > deposit) {
    return rejected(
      `withdrawal exceeds deposit balance: requested ${input.amount}, available ${deposit}`,
    );
  }
  if (input.amount > bank.bank.balance) {
    return rejected('bank has insufficient liquidity');
  }
  return accepted({ type: 'WithdrawalMade', agentId: input.agentId, amount: input.amount });
}

/**
 * Loan approval is issuance: the aggregate enforces the credit limit (history
 * scaled), the per-agent concurrency cap, and the reserve requirement — after
 * issuance the bank must still hold `reserveRatio` of total deposits in cash
 * (which also keeps the bank cash account non-negative).
 */
export function decideIssueLoan(input: {
  readonly bank: BankState | undefined;
  readonly loanId: LoanId;
  readonly borrowerAgentId: AgentId;
  readonly amount: number;
  readonly issuedAt: number;
  readonly policy: CreditPolicy;
}): CreditDecision {
  validateCreditPolicy(input.policy);
  const bank = requireBank(input.bank);
  if (bank.status === 'rejected') {
    return bank;
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return rejected('loan amount must be positive finite');
  }
  if (!Number.isFinite(input.issuedAt) || input.issuedAt < 0) {
    return rejected('loan issuedAt must be non-negative finite');
  }
  if (bank.bank.loans[input.loanId] !== undefined) {
    return rejected(`loan ${input.loanId} already exists`);
  }
  const limit = resolveCreditLimit({
    history: bank.bank.creditHistoryByAgent[input.borrowerAgentId],
    policy: input.policy,
  });
  if (input.amount > limit) {
    return rejected(`loan amount exceeds credit limit ${limit}`);
  }
  const activeCount = activeLoansByBorrower(bank.bank, input.borrowerAgentId).length;
  if (activeCount >= input.policy.maxLoansPerAgent) {
    return rejected(`borrower already has ${activeCount} active loans`);
  }
  const requiredReserve = totalDeposits(bank.bank) * input.policy.reserveRatio;
  if (bank.bank.balance - input.amount < requiredReserve) {
    return rejected(
      `loan issuance would breach the reserve requirement: bank cash ${bank.bank.balance}, required reserve ${requiredReserve}`,
    );
  }
  return accepted({
    type: 'LoanIssued',
    loanId: input.loanId,
    borrowerAgentId: input.borrowerAgentId,
    principal: input.amount,
    dailyInterestRate: input.policy.loanDailyInterestRate,
    termDays: input.policy.loanTermDays,
    issuedAt: input.issuedAt,
  });
}

/**
 * Direct repayment decision (world orchestrates the actual cash collection).
 * The payment applies interest-first, then principal; paying off the full
 * outstanding balance closes the loan as 'repaid'.
 */
export function decideRepayLoan(input: {
  readonly bank: BankState | undefined;
  readonly loanId: LoanId;
  readonly amount: number;
  readonly repaidAt: number;
}): CreditDecision {
  const bank = requireBank(input.bank);
  if (bank.status === 'rejected') {
    return bank;
  }
  const loan = bank.bank.loans[input.loanId];
  if (loan === undefined) {
    return rejected(`loan ${input.loanId} does not exist`);
  }
  if (loan.status !== 'active') {
    return rejected(`loan ${input.loanId} is not active`);
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return rejected('repayment amount must be positive finite');
  }
  if (!Number.isFinite(input.repaidAt) || input.repaidAt < 0) {
    return rejected('repaidAt must be non-negative finite');
  }
  const split = splitLoanPayment(loan, Math.min(input.amount, loan.principal + loan.accruedInterest));
  return accepted({
    type: 'LoanRepaid',
    loanId: loan.loanId,
    borrowerAgentId: loan.borrowerAgentId,
    settledAt: input.repaidAt,
    interestAccrued: 0,
    paidAmount: split.paidAmount,
    interestPaid: split.interestPaid,
    principalPaid: split.principalPaid,
    missedPayments: loan.missedPayments,
    status: split.status,
  });
}

/**
 * Estate liquidation of a deceased customer: every active loan is written off
 * (the bank absorbs the loss; no cash moves) and any deposit is forfeited
 * (the liability is extinguished; no cash moves). Pure book operations, so
 * the money supply is untouched. Loans settle first in loanId order, then the
 * deposit forfeiture; an estate with neither yields no events.
 */
export function decideLiquidateDeceasedCustomer(input: {
  readonly bank: BankState | undefined;
  readonly agentId: AgentId;
  readonly settledAt: number;
}): CreditDecision {
  const bank = requireBank(input.bank);
  if (bank.status === 'rejected') {
    return bank;
  }
  if (!Number.isFinite(input.settledAt) || input.settledAt < 0) {
    return rejected('liquidation settledAt must be non-negative finite');
  }
  const events: CreditDomainEvent[] = [];
  for (const loan of activeLoansByBorrower(bank.bank, input.agentId)) {
    events.push({
      type: 'LoanWrittenOff',
      loanId: loan.loanId,
      borrowerAgentId: loan.borrowerAgentId,
      writtenOffAt: input.settledAt,
      outstandingPrincipal: loan.principal,
      outstandingInterest: loan.accruedInterest,
    });
  }
  const deposit = bank.bank.deposits[input.agentId] ?? 0;
  if (deposit > 0) {
    events.push({
      type: 'DepositForfeited',
      agentId: input.agentId,
      forfeitedAmount: deposit,
      forfeitedAt: input.settledAt,
    });
  }
  return { status: 'accepted', events };
}

/** Interest-first, principal-second split shared by all repayment paths. */
export function splitLoanPayment(
  loan: LoanState,
  payment: number,
): {
  readonly paidAmount: number;
  readonly interestPaid: number;
  readonly principalPaid: number;
  readonly nextPrincipal: number;
  readonly nextAccruedInterest: number;
  readonly status: 'active' | 'repaid';
} {
  const paidAmount = Math.max(0, payment);
  const interestPaid = Math.min(paidAmount, loan.accruedInterest);
  const principalPaid = Math.min(paidAmount - interestPaid, loan.principal);
  const nextPrincipal = loan.principal - principalPaid;
  const nextAccruedInterest = loan.accruedInterest - interestPaid;
  return {
    paidAmount,
    interestPaid,
    principalPaid,
    nextPrincipal,
    nextAccruedInterest,
    status: nextPrincipal === 0 && nextAccruedInterest === 0 ? 'repaid' : 'active',
  };
}

export function applyCreditDomainEvent(
  state: BankState | undefined,
  event: CreditDomainEvent,
): BankState {
  if (event.type === 'DepositMade' && state === undefined) {
    // The first deposit bootstraps the bank with zero own reserves.
    return normalizeBankState(
      applyCreditDomainEvent(createBankState({ reserves: 0 }), event),
    );
  }
  if (state === undefined) {
    throw new Error(`cannot apply ${event.type} to a missing bank`);
  }
  const current = normalizeAndValidate(state);
  switch (event.type) {
    case 'DepositMade':
      return normalizeBankState({
        ...current,
        balance: current.balance + event.amount,
        deposits: {
          ...current.deposits,
          [event.agentId]: (current.deposits[event.agentId] ?? 0) + event.amount,
        },
      });
    case 'WithdrawalMade': {
      const deposit = current.deposits[event.agentId] ?? 0;
      if (event.amount > deposit) {
        throw new Error(`withdrawal exceeds deposit balance for ${event.agentId}`);
      }
      if (event.amount > current.balance) {
        throw new Error('withdrawal exceeds bank cash');
      }
      const deposits = { ...current.deposits, [event.agentId]: deposit - event.amount };
      if (deposits[event.agentId] === 0) {
        delete deposits[event.agentId];
      }
      return normalizeBankState({
        ...current,
        balance: current.balance - event.amount,
        deposits,
      });
    }
    case 'LoanIssued': {
      if (current.loans[event.loanId] !== undefined) {
        throw new Error(`cannot issue duplicate loan ${event.loanId}`);
      }
      if (event.principal > current.balance) {
        throw new Error('loan issuance exceeds bank cash');
      }
      const loan: LoanState = {
        loanId: event.loanId,
        borrowerAgentId: event.borrowerAgentId,
        principal: event.principal,
        dailyInterestRate: event.dailyInterestRate,
        termDays: event.termDays,
        issuedAt: event.issuedAt,
        accruedInterest: 0,
        lastAccrualAt: event.issuedAt,
        missedPayments: 0,
        status: 'active',
      };
      return normalizeBankState({
        ...current,
        balance: current.balance - event.principal,
        loans: { ...current.loans, [event.loanId]: loan },
      });
    }
    case 'LoanRepaid': {
      const loan = requireActiveLoan(current, event.loanId);
      assertValidLoanSettlement(event);
      return normalizeBankState({
        ...current,
        balance: current.balance + event.paidAmount,
        loans: {
          ...current.loans,
          [event.loanId]: {
            ...loan,
            principal: loan.principal - event.principalPaid,
            accruedInterest: loan.accruedInterest + event.interestAccrued - event.interestPaid,
            lastAccrualAt: event.settledAt,
            missedPayments: event.missedPayments,
            status: event.status,
          },
        },
        ...(event.status === 'repaid'
          ? {
              creditHistoryByAgent: incrementCreditHistory(
                current.creditHistoryByAgent,
                event.borrowerAgentId,
                'repaidCount',
              ),
            }
          : {}),
      });
    }
    case 'LoanDefaulted': {
      const loan = requireActiveLoan(current, event.loanId);
      assertValidLoanSettlement(event);
      const nextPrincipal = loan.principal - event.principalPaid;
      const nextAccruedInterest =
        loan.accruedInterest + event.interestAccrued - event.interestPaid;
      if (
        Math.abs(nextPrincipal - event.outstandingPrincipal) > 1e-6 ||
        Math.abs(nextAccruedInterest - event.outstandingInterest) > 1e-6
      ) {
        throw new Error(`loan default payload does not match the loan book ${event.loanId}`);
      }
      return normalizeBankState({
        ...current,
        balance: current.balance + event.paidAmount,
        loans: {
          ...current.loans,
          [event.loanId]: {
            ...loan,
            principal: nextPrincipal,
            accruedInterest: nextAccruedInterest,
            lastAccrualAt: event.defaultedAt,
            missedPayments: event.missedPayments,
            status: 'defaulted',
          },
        },
        creditHistoryByAgent: incrementCreditHistory(
          current.creditHistoryByAgent,
          event.borrowerAgentId,
          'defaultedCount',
        ),
      });
    }
    case 'DepositInterestPaid': {
      const total = event.payments.reduce((sum, payment) => sum + payment.amount, 0);
      if (total > current.balance + 1e-9) {
        throw new Error('deposit interest payout exceeds bank cash');
      }
      return normalizeBankState({ ...current, balance: current.balance - total });
    }
    case 'LoanWrittenOff': {
      const loan = requireActiveLoan(current, event.loanId);
      if (
        Math.abs(loan.principal - event.outstandingPrincipal) > 1e-6 ||
        Math.abs(loan.accruedInterest - event.outstandingInterest) > 1e-6
      ) {
        throw new Error(`loan write-off payload does not match the loan book ${event.loanId}`);
      }
      return normalizeBankState({
        ...current,
        loans: {
          ...current.loans,
          [event.loanId]: { ...loan, status: 'written-off', lastAccrualAt: event.writtenOffAt },
        },
      });
    }
    case 'DepositForfeited': {
      const deposit = current.deposits[event.agentId] ?? 0;
      if (event.forfeitedAmount <= 0 || Math.abs(deposit - event.forfeitedAmount) > 1e-9) {
        throw new Error(`deposit forfeiture does not match the depositor ledger ${event.agentId}`);
      }
      const deposits = { ...current.deposits };
      delete deposits[event.agentId];
      return normalizeBankState({ ...current, deposits });
    }
  }
}

function requireActiveLoan(bank: BankState, loanId: LoanId): LoanState {
  const loan = bank.loans[loanId];
  if (loan === undefined) {
    throw new Error(`cannot settle unknown loan ${loanId}`);
  }
  if (loan.status !== 'active') {
    throw new Error(`cannot settle ${loan.status} loan ${loanId}`);
  }
  return loan;
}

function assertValidLoanSettlement(event: {
  readonly interestAccrued: number;
  readonly paidAmount: number;
  readonly interestPaid: number;
  readonly principalPaid: number;
  readonly missedPayments: number;
}): void {
  for (const [name, value] of [
    ['interestAccrued', event.interestAccrued],
    ['paidAmount', event.paidAmount],
    ['interestPaid', event.interestPaid],
    ['principalPaid', event.principalPaid],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`loan settlement ${name} must be non-negative finite`);
    }
  }
  if (!Number.isInteger(event.missedPayments) || event.missedPayments < 0) {
    throw new Error('loan settlement missedPayments must be a non-negative integer');
  }
  if (Math.abs(event.paidAmount - (event.interestPaid + event.principalPaid)) > 1e-6) {
    throw new Error('loan settlement paidAmount must equal interestPaid + principalPaid');
  }
}

function incrementCreditHistory(
  historyByAgent: Readonly<Record<string, { repaidCount: number; defaultedCount: number }>>,
  agentId: AgentId,
  field: 'repaidCount' | 'defaultedCount',
): Readonly<Record<string, { repaidCount: number; defaultedCount: number }>> {
  const history = historyByAgent[agentId] ?? emptyCreditHistory();
  return {
    ...historyByAgent,
    [asAgentId(agentId)]: { ...history, [field]: history[field] + 1 },
  };
}

function normalizeAndValidate(state: BankState): BankState {
  const normalized = normalizeBankState(state);
  assertValidBankState(normalized);
  return normalized;
}

function requireBank(
  bank: BankState | undefined,
): { readonly status: 'ok'; readonly bank: BankState } | { readonly status: 'rejected'; readonly reason: string } {
  if (bank === undefined) {
    return { status: 'rejected', reason: 'bank is not initialized' };
  }
  return { status: 'ok', bank: normalizeAndValidate(bank) };
}

function accepted(event: CreditDomainEvent): CreditDecision {
  return { status: 'accepted', events: [event] };
}

function rejected(reason: string): CreditDecision {
  return { status: 'rejected', reason };
}
