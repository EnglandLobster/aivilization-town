import { asAgentId, type AgentId } from '@aivilization/sim-core';
import { applyCreditDomainEvent, splitLoanPayment, type CreditDomainEvent } from './aggregate';
import { assertValidBankState, normalizeBankState, type BankState } from './model';
import { validateCreditPolicy, type CreditPolicy } from './policy';

export type CreditAccrualDecision = {
  readonly events: readonly CreditDomainEvent[];
};

/**
 * One daily credit accrual cadence (application scheduler adapter passes the
 * crossed day boundaries one at a time; this function decides exactly one).
 *
 * Per cadence, in deterministic order:
 * 1. Active loans (loanId order): interest accrues on principal, then the
 *    daily installment is auto-collected from the borrower's cash — the due
 *    amount is the remaining-principal amortization share plus all accrued
 *    interest, and the collected amount is min(due, borrower balance),
 *    applied interest-first. Under-covered days increment the consecutive
 *    missed-payment counter (a fully covered day resets it); once the counter
 *    exceeds `graceMissedPayments` the loan defaults.
 * 2. Deposit interest (agentId order): each settling depositor earns
 *    `deposit × depositDailyInterestRate`, paid out of the post-repayment
 *    bank cash account. A bank without enough cash pays what it has in
 *    agentId order (bank losses are the spread-cost of banking); deposit
 *    principal is never reduced by interest settlement.
 *
 * `borrowerBalance` returns the agent's current cash, or `undefined` when the
 * agent does not settle in this cadence (amortized bucket rotation, or the
 * agent left this partition) — its loans and deposits simply skip the cadence.
 */
export function evaluateDailyCreditAccrual(input: {
  readonly bank: BankState;
  readonly now: number;
  readonly policy: CreditPolicy;
  readonly borrowerBalance: (agentId: AgentId) => number | undefined;
}): CreditAccrualDecision {
  validateCreditPolicy(input.policy);
  if (!Number.isFinite(input.now) || input.now < 0) {
    throw new Error('credit accrual now must be non-negative finite');
  }
  let bank = normalizeBankState(input.bank);
  assertValidBankState(bank);
  const events: CreditDomainEvent[] = [];

  const activeLoans = Object.values(bank.loans)
    .filter((loan) => loan.status === 'active')
    .sort((left, right) => left.loanId.localeCompare(right.loanId));
  for (const loan of activeLoans) {
    const borrowerBalance = input.borrowerBalance(loan.borrowerAgentId);
    if (borrowerBalance === undefined) {
      continue;
    }
    if (!Number.isFinite(borrowerBalance) || borrowerBalance < 0) {
      throw new Error('borrower balance must be non-negative finite');
    }
    const interestAccrued = loan.principal * loan.dailyInterestRate;
    // Accruals happen one cadence apart at day boundaries; the n-th accrual of
    // this loan amortizes principal over the remaining installments so the
    // loan is fully amortized by the termDays-th accrual. Past the term the
    // whole remaining principal falls due each cadence.
    const installmentIndex = Math.ceil((input.now - loan.issuedAt) / input.policy.accrualCadenceMs);
    const remainingInstallments = Math.max(1, loan.termDays - installmentIndex + 1);
    const principalDue = loan.principal / remainingInstallments;
    const accruedWithToday = loan.accruedInterest + interestAccrued;
    const due = principalDue + accruedWithToday;
    const payment = Math.min(due, borrowerBalance);
    const split = splitLoanPayment({ ...loan, accruedInterest: accruedWithToday }, payment);
    const covered = payment >= due;
    const missedPayments = covered ? 0 : loan.missedPayments + 1;

    if (missedPayments > input.policy.graceMissedPayments) {
      const event: CreditDomainEvent = {
        type: 'LoanDefaulted',
        loanId: loan.loanId,
        borrowerAgentId: loan.borrowerAgentId,
        defaultedAt: input.now,
        interestAccrued,
        paidAmount: split.paidAmount,
        interestPaid: split.interestPaid,
        principalPaid: split.principalPaid,
        missedPayments,
        outstandingPrincipal: split.nextPrincipal,
        outstandingInterest: split.nextAccruedInterest,
      };
      events.push(event);
      bank = applyCreditDomainEvent(bank, event);
      continue;
    }

    const event: CreditDomainEvent = {
      type: 'LoanRepaid',
      loanId: loan.loanId,
      borrowerAgentId: loan.borrowerAgentId,
      settledAt: input.now,
      interestAccrued,
      paidAmount: split.paidAmount,
      interestPaid: split.interestPaid,
      principalPaid: split.principalPaid,
      missedPayments,
      status: split.status,
    };
    events.push(event);
    bank = applyCreditDomainEvent(bank, event);
  }

  const depositPayments: { readonly agentId: AgentId; readonly amount: number }[] = [];
  let interestFunds = bank.balance;
  for (const [agentId, deposit] of Object.entries(bank.deposits).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (input.borrowerBalance(asAgentId(agentId)) === undefined) {
      continue;
    }
    const amount = Math.min(deposit * input.policy.depositDailyInterestRate, interestFunds);
    if (amount <= 0) {
      continue;
    }
    interestFunds -= amount;
    depositPayments.push({ agentId: asAgentId(agentId), amount });
  }
  if (depositPayments.length > 0) {
    const event: CreditDomainEvent = {
      type: 'DepositInterestPaid',
      paidAt: input.now,
      payments: depositPayments,
    };
    events.push(event);
    bank = applyCreditDomainEvent(bank, event);
  }

  return { events };
}
