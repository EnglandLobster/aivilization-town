import {
  assertMoneySupplyDelta,
  createMoneyTransfer,
  economicAccount,
  type EconomicAccountSector,
} from '@aivilization/economy';
import {
  applyCreditDomainEvent,
  TOWN_BANK_ACCOUNT_OWNER_ID,
  type CreditDomainEvent,
} from '@aivilization/credit';
import type { AgentId } from '@aivilization/sim-core';
import type { WorldEvent } from '../events';
import type { WorldAgentState, WorldProjection } from '../projection';

/**
 * Projection adapter for the credit bounded context. Banking state
 * transitions are delegated to the credit aggregate; this adapter only moves
 * the counterpart agent cash accounts and checks that every movement is a
 * supply-neutral transfer between circulating accounts.
 */
export function applyCreditProjectionEvent(
  projection: WorldProjection,
  event: WorldEvent,
): WorldProjection | undefined {
  switch (event.type) {
    case 'DepositMade': {
      assertBankTransfer(event, 'agent', event.payload.agentId, event.payload.amount);
      return updateAgent(
        applyBankEvent(projection, {
          type: 'DepositMade',
          agentId: event.payload.agentId,
          amount: event.payload.amount,
        }),
        event.payload.agentId,
        (agent) => ({ ...agent, balance: event.payload.nextBalance }),
      );
    }
    case 'WithdrawalMade': {
      assertBankTransfer(event, 'bank', event.payload.agentId, event.payload.amount);
      return updateAgent(
        applyBankEvent(projection, {
          type: 'WithdrawalMade',
          agentId: event.payload.agentId,
          amount: event.payload.amount,
        }),
        event.payload.agentId,
        (agent) => ({ ...agent, balance: event.payload.nextBalance }),
      );
    }
    case 'LoanIssued': {
      assertBankTransfer(event, 'bank', event.payload.borrowerAgentId, event.payload.principal);
      return updateAgent(
        applyBankEvent(projection, {
          type: 'LoanIssued',
          loanId: event.payload.loanId,
          borrowerAgentId: event.payload.borrowerAgentId,
          principal: event.payload.principal,
          dailyInterestRate: event.payload.dailyInterestRate,
          termDays: event.payload.termDays,
          issuedAt: event.payload.issuedAt,
        }),
        event.payload.borrowerAgentId,
        (agent) => ({ ...agent, balance: event.payload.borrowerNextBalance }),
      );
    }
    case 'LoanRepaid': {
      if (event.payload.paidAmount > 0) {
        assertBankTransfer(event, 'agent', event.payload.borrowerAgentId, event.payload.paidAmount);
      }
      return updateAgent(
        applyBankEvent(projection, {
          type: 'LoanRepaid',
          loanId: event.payload.loanId,
          borrowerAgentId: event.payload.borrowerAgentId,
          settledAt: event.payload.settledAt,
          interestAccrued: event.payload.interestAccrued,
          paidAmount: event.payload.paidAmount,
          interestPaid: event.payload.interestPaid,
          principalPaid: event.payload.principalPaid,
          missedPayments: event.payload.missedPayments,
          status: event.payload.status,
        }),
        event.payload.borrowerAgentId,
        (agent) => ({ ...agent, balance: event.payload.borrowerNextBalance }),
      );
    }
    case 'LoanDefaulted': {
      if (event.payload.paidAmount > 0) {
        assertBankTransfer(event, 'agent', event.payload.borrowerAgentId, event.payload.paidAmount);
      }
      return updateAgent(
        applyBankEvent(projection, {
          type: 'LoanDefaulted',
          loanId: event.payload.loanId,
          borrowerAgentId: event.payload.borrowerAgentId,
          defaultedAt: event.payload.defaultedAt,
          interestAccrued: event.payload.interestAccrued,
          paidAmount: event.payload.paidAmount,
          interestPaid: event.payload.interestPaid,
          principalPaid: event.payload.principalPaid,
          missedPayments: event.payload.missedPayments,
          outstandingPrincipal: event.payload.outstandingPrincipal,
          outstandingInterest: event.payload.outstandingInterest,
        }),
        event.payload.borrowerAgentId,
        (agent) => ({ ...agent, balance: event.payload.borrowerNextBalance }),
      );
    }
    case 'LoanWrittenOff':
      // Pure book operation: no cash moves, so no agent balance update and no
      // supply assertion (the loan money was already circulating).
      return applyBankEvent(projection, {
        type: 'LoanWrittenOff',
        loanId: event.payload.loanId,
        borrowerAgentId: event.payload.borrowerAgentId,
        writtenOffAt: event.payload.writtenOffAt,
        outstandingPrincipal: event.payload.outstandingPrincipal,
        outstandingInterest: event.payload.outstandingInterest,
      });
    case 'DepositForfeited':
      // Pure book operation: the deposit liability is extinguished without a
      // transfer; the bank keeps the cash and moneySupply is unchanged.
      return applyBankEvent(projection, {
        type: 'DepositForfeited',
        agentId: event.payload.agentId,
        forfeitedAmount: event.payload.forfeitedAmount,
        forfeitedAt: event.payload.forfeitedAt,
      });
    case 'DepositInterestPaid': {
      let next = applyBankEvent(projection, {
        type: 'DepositInterestPaid',
        paidAt: event.payload.paidAt,
        payments: event.payload.payments.map((payment) => ({
          agentId: payment.agentId,
          amount: payment.amount,
        })),
      });
      for (const payment of event.payload.payments) {
        assertBankTransfer(event, 'bank', payment.agentId, payment.amount);
        next = updateAgent(next, payment.agentId, (agent) => ({
          ...agent,
          balance: payment.nextBalance,
        }));
      }
      return next;
    }
    default:
      return undefined;
  }
}

function applyBankEvent(projection: WorldProjection, event: CreditDomainEvent): WorldProjection {
  return { ...projection, bank: applyCreditDomainEvent(projection.bank, event) };
}

function assertBankTransfer(
  event: WorldEvent,
  fromSector: 'agent' | 'bank',
  agentId: AgentId,
  amount: number,
): void {
  const toSector: EconomicAccountSector = fromSector === 'agent' ? 'bank' : 'agent';
  const transaction = createMoneyTransfer({
    transactionId: event.id,
    reason: `bank-${event.type}`,
    from:
      fromSector === 'agent'
        ? economicAccount('agent', agentId)
        : economicAccount('bank', TOWN_BANK_ACCOUNT_OWNER_ID),
    to:
      toSector === 'bank'
        ? economicAccount('bank', TOWN_BANK_ACCOUNT_OWNER_ID)
        : economicAccount('agent', agentId),
    amount,
  });
  // Both accounts are in circulation, so banking never moves the money supply.
  assertMoneySupplyDelta({ transaction, moneySupplyDelta: 0 });
}

function updateAgent(
  projection: WorldProjection,
  agentId: AgentId,
  update: (agent: WorldAgentState) => WorldAgentState,
): WorldProjection {
  const current = projection.agents[agentId];
  if (current === undefined) {
    throw new Error(`unknown agent ${agentId}`);
  }
  return {
    ...projection,
    agents: { ...projection.agents, [agentId]: update(current) },
  };
}
