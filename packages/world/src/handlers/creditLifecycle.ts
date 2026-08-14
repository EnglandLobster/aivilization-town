import {
  applyCreditDomainEvent,
  evaluateDailyCreditAccrual,
  type CreditPolicy,
  type WorldBankState,
} from '../credit';
import { calculateCompletedRecruitmentCycleNumbers } from '@aivilization/society';
import type { AgentId, CommandEnvelope } from '@aivilization/sim-core';
import type { WorldEvent } from '../events';
import type { WorldAgentState, WorldProjection } from '../projection';
import { makeEvent, makeMemoryEvent } from './shared';

/**
 * Application scheduler adapter for the credit daily accrual cadence. It
 * enumerates the crossed accrual boundaries inside each settling agent's
 * interval (amortization-aware: buckets replay every missed cadence one by
 * one) and asks the credit domain for one decision per boundary; all accrual
 * and collection formulas remain in `@aivilization/credit`.
 *
 * Returns the evolved bank state; caller tracks it across settlement times.
 */
export function appendCreditAccrualEvents(input: {
  readonly command: CommandEnvelope<'AdvanceSimulationTime', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
  readonly events: WorldEvent[];
  readonly policy: CreditPolicy;
  readonly bank: WorldBankState;
  readonly agents: readonly WorldAgentState[];
  readonly balanceOf: (agentId: AgentId) => number | undefined;
  readonly setBalance: (agentId: AgentId, balance: number) => void;
  readonly intervalFor: (agent: WorldAgentState) => {
    readonly previousSimulationTime: number;
    readonly currentSimulationTime: number;
  };
}): WorldBankState {
  let bank = input.bank;
  const agentsByBoundary = new Map<number, WorldAgentState[]>();
  for (const agent of input.agents) {
    const interval = input.intervalFor(agent);
    for (const cycle of calculateCompletedRecruitmentCycleNumbers({
      previousSimulationTime: interval.previousSimulationTime,
      nextSimulationTime: interval.currentSimulationTime,
      cycleDurationMs: input.policy.accrualCadenceMs,
    })) {
      const boundary = (cycle + 1) * input.policy.accrualCadenceMs;
      const bucket = agentsByBoundary.get(boundary);
      if (bucket === undefined) {
        agentsByBoundary.set(boundary, [agent]);
      } else {
        bucket.push(agent);
      }
    }
  }

  for (const boundary of [...agentsByBoundary.keys()].sort((left, right) => left - right)) {
    const settling = new Set((agentsByBoundary.get(boundary) ?? []).map((agent) => agent.agentId));
    const decision = evaluateDailyCreditAccrual({
      bank,
      now: boundary,
      policy: input.policy,
      borrowerBalance: (agentId) => (settling.has(agentId) ? input.balanceOf(agentId) : undefined),
    });
    for (const domainEvent of decision.events) {
      const bankPreviousBalance = bank.balance;
      const nextBank = applyCreditDomainEvent(bank, domainEvent);
      bank = nextBank;
      if (domainEvent.type === 'LoanRepaid') {
        const borrowerPreviousBalance = input.balanceOf(domainEvent.borrowerAgentId) ?? 0;
        const borrowerNextBalance = borrowerPreviousBalance - domainEvent.paidAmount;
        const offset = input.events.length;
        input.events.push(
          makeEvent(input, offset, 'LoanRepaid', {
            loanId: domainEvent.loanId,
            borrowerAgentId: domainEvent.borrowerAgentId,
            settledAt: domainEvent.settledAt,
            interestAccrued: domainEvent.interestAccrued,
            paidAmount: domainEvent.paidAmount,
            interestPaid: domainEvent.interestPaid,
            principalPaid: domainEvent.principalPaid,
            missedPayments: domainEvent.missedPayments,
            status: domainEvent.status,
            borrowerPreviousBalance,
            borrowerNextBalance,
            bankPreviousBalance,
            bankNextBalance: nextBank.balance,
            policyVersion: input.policy.policyVersion,
          }),
        );
        input.setBalance(domainEvent.borrowerAgentId, borrowerNextBalance);
        if (domainEvent.status === 'repaid') {
          input.events.push(
            makeMemoryEvent(input, input.events.length, {
              agentId: domainEvent.borrowerAgentId,
              summary: `Fully repaid loan ${domainEvent.loanId} to the town bank.`,
              status: 'succeeded',
              sourceEventOffsets: [offset],
              tags: ['bank', 'loan-repaid'],
              consolidationHint: {
                kind: 'habit',
                patternKey: 'bank:loan-repaid',
                statement:
                  'Fully repaying a loan raises the borrower credit limit for future borrowing.',
              },
            }),
          );
        }
        continue;
      }
      if (domainEvent.type === 'LoanDefaulted') {
        const borrowerPreviousBalance = input.balanceOf(domainEvent.borrowerAgentId) ?? 0;
        const borrowerNextBalance = borrowerPreviousBalance - domainEvent.paidAmount;
        const offset = input.events.length;
        input.events.push(
          makeEvent(input, offset, 'LoanDefaulted', {
            loanId: domainEvent.loanId,
            borrowerAgentId: domainEvent.borrowerAgentId,
            defaultedAt: domainEvent.defaultedAt,
            interestAccrued: domainEvent.interestAccrued,
            paidAmount: domainEvent.paidAmount,
            interestPaid: domainEvent.interestPaid,
            principalPaid: domainEvent.principalPaid,
            missedPayments: domainEvent.missedPayments,
            outstandingPrincipal: domainEvent.outstandingPrincipal,
            outstandingInterest: domainEvent.outstandingInterest,
            borrowerPreviousBalance,
            borrowerNextBalance,
            bankPreviousBalance,
            bankNextBalance: nextBank.balance,
            policyVersion: input.policy.policyVersion,
          }),
        );
        input.setBalance(domainEvent.borrowerAgentId, borrowerNextBalance);
        input.events.push(
          makeMemoryEvent(input, input.events.length, {
            agentId: domainEvent.borrowerAgentId,
            summary: `Defaulted on loan ${domainEvent.loanId} after ${domainEvent.missedPayments} missed daily payments; ${domainEvent.outstandingPrincipal} principal remained unpaid.`,
            status: 'failed',
            sourceEventOffsets: [offset],
            tags: ['bank', 'loan-defaulted'],
            consolidationHint: {
              kind: 'caution',
              patternKey: 'bank:loan-defaulted',
              statement:
                'Missing too many daily loan payments in a row defaults the loan and halves the borrower credit limit.',
            },
          }),
        );
        continue;
      }
      if (domainEvent.type === 'DepositInterestPaid') {
        input.events.push(
          makeEvent(input, input.events.length, 'DepositInterestPaid', {
            paidAt: domainEvent.paidAt,
            payments: domainEvent.payments.map((payment) => {
              const previousBalance = input.balanceOf(payment.agentId) ?? 0;
              const nextBalance = previousBalance + payment.amount;
              input.setBalance(payment.agentId, nextBalance);
              return {
                agentId: payment.agentId,
                amount: payment.amount,
                previousBalance,
                nextBalance,
              };
            }),
            bankPreviousBalance,
            bankNextBalance: nextBank.balance,
            policyVersion: input.policy.policyVersion,
          }),
        );
        continue;
      }
      throw new Error('unexpected credit domain event from daily accrual');
    }
  }
  return bank;
}
