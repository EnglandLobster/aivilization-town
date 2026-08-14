import { asLoanId, type CommandEnvelope } from '@aivilization/sim-core';
import {
  assertAgentDepositPayload,
  assertAgentRequestLoanPayload,
  assertAgentWithdrawPayload,
} from '../commands';
import {
  decideDeposit,
  decideIssueLoan,
  decideWithdraw,
  type CreditPolicy,
} from '@aivilization/credit';
import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import {
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
} from './shared';

/**
 * Town-bank command handlers. The world layer owns identity and the
 * agent-side cash checks; all banking invariants (deposit ledger, credit
 * limit, concurrency cap, reserve requirement) are domain decisions in
 * `@aivilization/credit`. Every movement is a transfer between circulating
 * accounts, so moneySupply never changes.
 */
export function handleAgentDepositCommand(input: {
  readonly command: CommandEnvelope<'AgentDeposit', unknown>;
  readonly projection: WorldProjection;
  readonly policy: CreditPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentDepositPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentDeposit', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  if (agent.balance < payload.amount) {
    return rejectCommand(
      input,
      'AgentDeposit',
      `insufficient balance: required ${payload.amount}, available ${agent.balance}`,
    );
  }
  const bank = input.projection.bank;
  const decision = decideDeposit({ bank, agentId: agent.agentId, amount: payload.amount });
  if (decision.status === 'rejected') {
    return rejectCommand(input, 'AgentDeposit', decision.reason);
  }
  const bankPreviousBalance = bank?.balance ?? 0;
  return [
    makeEvent(input, 0, 'DepositMade', {
      agentId: agent.agentId,
      amount: payload.amount,
      previousBalance: agent.balance,
      nextBalance: agent.balance - payload.amount,
      bankPreviousBalance,
      bankNextBalance: bankPreviousBalance + payload.amount,
      policyVersion: input.policy.policyVersion,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Deposited ${payload.amount} into the town bank.`,
      status: 'succeeded',
      tags: ['bank', 'deposit'],
      sourceEventOffsets: [0],
    }),
  ];
}

export function handleAgentWithdrawCommand(input: {
  readonly command: CommandEnvelope<'AgentWithdraw', unknown>;
  readonly projection: WorldProjection;
  readonly policy: CreditPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentWithdrawPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentWithdraw', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const bank = input.projection.bank;
  const decision = decideWithdraw({ bank, agentId: agent.agentId, amount: payload.amount });
  if (decision.status === 'rejected') {
    return rejectCommand(input, 'AgentWithdraw', decision.reason);
  }
  const bankPreviousBalance = bank?.balance ?? 0;
  return [
    makeEvent(input, 0, 'WithdrawalMade', {
      agentId: agent.agentId,
      amount: payload.amount,
      previousBalance: agent.balance,
      nextBalance: agent.balance + payload.amount,
      bankPreviousBalance,
      bankNextBalance: bankPreviousBalance - payload.amount,
      policyVersion: input.policy.policyVersion,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Withdrew ${payload.amount} from the town bank.`,
      status: 'succeeded',
      tags: ['bank', 'withdrawal'],
      sourceEventOffsets: [0],
    }),
  ];
}

export function handleAgentRequestLoanCommand(input: {
  readonly command: CommandEnvelope<'AgentRequestLoan', unknown>;
  readonly projection: WorldProjection;
  readonly policy: CreditPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentRequestLoanPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentRequestLoan', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const bank = input.projection.bank;
  // Deterministic loan id derived from the command so replay reproduces it.
  const loanId = asLoanId(`${input.command.id}:loan:0`);
  const decision = decideIssueLoan({
    bank,
    loanId,
    borrowerAgentId: agent.agentId,
    amount: payload.amount,
    issuedAt: input.projection.clock.now,
    policy: input.policy,
  });
  if (decision.status === 'rejected') {
    return rejectCommand(input, 'AgentRequestLoan', decision.reason);
  }
  const bankPreviousBalance = bank?.balance ?? 0;
  return [
    makeEvent(input, 0, 'LoanIssued', {
      loanId,
      borrowerAgentId: agent.agentId,
      principal: payload.amount,
      dailyInterestRate: input.policy.loanDailyInterestRate,
      termDays: input.policy.loanTermDays,
      issuedAt: input.projection.clock.now,
      borrowerPreviousBalance: agent.balance,
      borrowerNextBalance: agent.balance + payload.amount,
      bankPreviousBalance,
      bankNextBalance: bankPreviousBalance - payload.amount,
      policyVersion: input.policy.policyVersion,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Borrowed ${payload.amount} from the town bank at a daily interest rate of ${input.policy.loanDailyInterestRate} over ${input.policy.loanTermDays} days.`,
      status: 'succeeded',
      tags: ['bank', 'loan', loanId],
      sourceEventOffsets: [0],
    }),
  ];
}
