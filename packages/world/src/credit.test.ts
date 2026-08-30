import {
  asAgentId,
  asLoanId,
  createCommandEnvelope,
  createEventEnvelope,
  replayEvents,
  type CoreCommandType,
} from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createBankState,
  createWorldProjection,
  dispatchWorldCommand,
  type CreditPolicy,
  type WorldCommandPolicies,
  type WorldEvent,
} from './index';

const DAY_MS = 86_400_000;

const creditPolicy: CreditPolicy = {
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
  source: 'world credit integration test fixture',
};

const basePolicies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
};

const policies: WorldCommandPolicies = {
  ...basePolicies,
  credit: creditPolicy,
};

function createAgent(agentId: string, balance: number) {
  return {
    agentId: asAgentId(agentId),
    locationId: null,
    physiology: { energy: 100, satiety: 100, health: 100 },
    educationScore: 0,
    balance,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}

function createBankingProjection() {
  return createWorldProjection({
    agents: [createAgent('agent-saver', 2_000), createAgent('agent-borrower', 500)],
    moneySupply: 12_500,
    bank: createBankState({ reserves: 10_000 }),
    clock: { now: 0, tickDurationMs: 1000 },
  });
}

function makeCommand(input: {
  readonly id: string;
  readonly actorId: string;
  readonly type: CoreCommandType;
  readonly payload: unknown;
  readonly issuedAt: number;
}) {
  return createCommandEnvelope({
    id: input.id,
    simulationId: 'sim-credit',
    actorId: input.actorId,
    type: input.type,
    payload: input.payload,
    issuedAt: input.issuedAt,
  });
}

function makeTimeAdvance(id: string, day: number) {
  return createCommandEnvelope({
    id,
    simulationId: 'sim-credit',
    source: 'system',
    type: 'AdvanceSimulationTime',
    payload: { deltaMs: DAY_MS },
    issuedAt: day * DAY_MS,
  });
}

describe('town bank commands', () => {
  test('deposit moves cash into the bank and creates the bank slice on first use', () => {
    const projection = createWorldProjection({
      agents: [createAgent('agent-saver', 2_000)],
      moneySupply: 2_000,
    });
    const events = dispatchWorldCommand({
      command: makeCommand({
        id: 'deposit-1',
        actorId: 'agent-saver',
        type: 'AgentDeposit',
        payload: { amount: 1_000 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(events.map((event) => event.type)).toEqual(['DepositMade', 'ShortTermMemoryRecorded']);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-saver',
      amount: 1_000,
      previousBalance: 2_000,
      nextBalance: 1_000,
      bankPreviousBalance: 0,
      bankNextBalance: 1_000,
      policyVersion: 'credit-v1',
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-saver']?.balance).toBe(1_000);
    expect(updated.bank).toMatchObject({ balance: 1_000, deposits: { 'agent-saver': 1_000 } });
    // Deposits are transfers: the money supply does not move.
    expect(updated.moneySupply).toBe(2_000);
  });

  test('deposit rejects overdrafts at the world layer and malformed payloads', () => {
    const projection = createBankingProjection();
    const overdraw = dispatchWorldCommand({
      command: makeCommand({
        id: 'deposit-over',
        actorId: 'agent-borrower',
        type: 'AgentDeposit',
        payload: { amount: 501 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(overdraw[0]).toMatchObject({
      type: 'ActionRejected',
      payload: {
        commandType: 'AgentDeposit',
        reason: 'insufficient balance: required 501, available 500',
      },
    });

    const invalid = dispatchWorldCommand({
      command: makeCommand({
        id: 'deposit-bad',
        actorId: 'agent-borrower',
        type: 'AgentDeposit',
        payload: { amount: -1 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 10,
    });
    expect(invalid[0]).toMatchObject({ type: 'ActionRejected' });
  });

  test('withdrawal returns deposit cash and enforces the deposit ledger', () => {
    let projection = createBankingProjection();
    const deposit = dispatchWorldCommand({
      command: makeCommand({
        id: 'deposit-1',
        actorId: 'agent-saver',
        type: 'AgentDeposit',
        payload: { amount: 1_000 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    projection = deposit.reduce(applyWorldEvent, projection);

    const rejected = dispatchWorldCommand({
      command: makeCommand({
        id: 'withdraw-over',
        actorId: 'agent-saver',
        type: 'AgentWithdraw',
        payload: { amount: 1_001 },
        issuedAt: 10,
      }),
      projection,
      policies,
      nextSequence: 10,
    });
    expect(rejected[0]).toMatchObject({
      type: 'ActionRejected',
      payload: {
        commandType: 'AgentWithdraw',
        reason: 'withdrawal exceeds deposit balance: requested 1001, available 1000',
      },
    });

    const withdrawn = dispatchWorldCommand({
      command: makeCommand({
        id: 'withdraw-1',
        actorId: 'agent-saver',
        type: 'AgentWithdraw',
        payload: { amount: 400 },
        issuedAt: 20,
      }),
      projection,
      policies,
      nextSequence: 20,
    });
    expect(withdrawn.map((event) => event.type)).toEqual([
      'WithdrawalMade',
      'ShortTermMemoryRecorded',
    ]);
    projection = withdrawn.reduce(applyWorldEvent, projection);
    expect(projection.agents['agent-saver']?.balance).toBe(1_400);
    expect(projection.bank).toMatchObject({
      balance: 10_600,
      deposits: { 'agent-saver': 600 },
    });
    expect(projection.moneySupply).toBe(12_500);
  });

  test('loan approval issues immediately within the credit limit and reserves', () => {
    const projection = createBankingProjection();
    const events = dispatchWorldCommand({
      command: makeCommand({
        id: 'loan-1',
        actorId: 'agent-borrower',
        type: 'AgentRequestLoan',
        payload: { amount: 300 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(events.map((event) => event.type)).toEqual(['LoanIssued', 'ShortTermMemoryRecorded']);
    expect(events[0]?.payload).toMatchObject({
      loanId: 'loan-1:loan:0',
      borrowerAgentId: 'agent-borrower',
      principal: 300,
      dailyInterestRate: 0.01,
      termDays: 3,
      issuedAt: 0,
      borrowerPreviousBalance: 500,
      borrowerNextBalance: 800,
      bankPreviousBalance: 10_000,
      bankNextBalance: 9_700,
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-borrower']?.balance).toBe(800);
    expect(updated.bank?.loans['loan-1:loan:0']).toMatchObject({
      principal: 300,
      status: 'active',
      missedPayments: 0,
    });
    expect(updated.moneySupply).toBe(12_500);
  });

  test('loan requests reject above the credit limit, over reserves, or without policy', () => {
    const projection = createBankingProjection();
    const overLimit = dispatchWorldCommand({
      command: makeCommand({
        id: 'loan-over-limit',
        actorId: 'agent-borrower',
        type: 'AgentRequestLoan',
        payload: { amount: 5_001 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    expect(overLimit[0]).toMatchObject({
      type: 'ActionRejected',
      payload: { reason: 'loan amount exceeds credit limit 5000' },
    });

    // Drain the reserves with deposits first: 12_000 deposited leaves 22_000 in
    // the bank; the reserve requirement is 12_000 × 0.2 = 2_400.
    const depositHeavyProjection = createWorldProjection({
      agents: [createAgent('agent-saver', 12_000), createAgent('agent-borrower', 500)],
      moneySupply: 22_500,
      bank: createBankState({ reserves: 10_000 }),
    });
    const deposited = dispatchWorldCommand({
      command: makeCommand({
        id: 'deposit-heavy',
        actorId: 'agent-saver',
        type: 'AgentDeposit',
        payload: { amount: 12_000 },
        issuedAt: 0,
      }),
      projection: depositHeavyProjection,
      policies: { ...policies, credit: { ...creditPolicy, baseLoanLimit: 100_000 } },
      nextSequence: 1,
    }).reduce(applyWorldEvent, depositHeavyProjection);
    const overReserve = dispatchWorldCommand({
      command: makeCommand({
        id: 'loan-over-reserve',
        actorId: 'agent-borrower',
        type: 'AgentRequestLoan',
        payload: { amount: 19_601 },
        issuedAt: 10,
      }),
      projection: deposited,
      policies: { ...policies, credit: { ...creditPolicy, baseLoanLimit: 100_000 } },
      nextSequence: 10,
    });
    expect(overReserve[0]).toMatchObject({
      type: 'ActionRejected',
      payload: {
        reason:
          'loan issuance would breach the reserve requirement: bank cash 22000, required reserve 2400',
      },
    });

    const noPolicy = dispatchWorldCommand({
      command: makeCommand({
        id: 'loan-no-policy',
        actorId: 'agent-borrower',
        type: 'AgentRequestLoan',
        payload: { amount: 100 },
        issuedAt: 0,
      }),
      projection,
      policies: basePolicies,
      nextSequence: 1,
    });
    expect(noPolicy[0]).toMatchObject({
      type: 'ActionRejected',
      payload: { commandType: 'AgentRequestLoan', reason: 'missing credit policy' },
    });
  });
});

describe('town bank daily credit cadence', () => {
  test('deposit interest, amortized collection, and full repayment settle deterministically', () => {
    let projection = createBankingProjection();
    const allEvents: WorldEvent[] = [];
    let nextSequence = 1;
    const run = (command: Parameters<typeof dispatchWorldCommand>[0]['command']) => {
      const events = dispatchWorldCommand({
        command,
        projection,
        policies,
        nextSequence,
      });
      allEvents.push(...events);
      projection = events.reduce(applyWorldEvent, projection);
      nextSequence += events.length;
      return events;
    };

    run(
      makeCommand({
        id: 'deposit-1',
        actorId: 'agent-saver',
        type: 'AgentDeposit',
        payload: { amount: 1_000 },
        issuedAt: 0,
      }),
    );
    run(
      makeCommand({
        id: 'loan-1',
        actorId: 'agent-borrower',
        type: 'AgentRequestLoan',
        payload: { amount: 300 },
        issuedAt: 0,
      }),
    );
    expect(projection.agents['agent-borrower']?.balance).toBe(800);

    // Day 1: loan accrues 3 and amortizes 100 principal; the saver earns 1.
    const day1 = run(makeTimeAdvance('advance-day-1', 1));
    expect(day1.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'LoanRepaid',
      'DepositInterestPaid',
    ]);
    expect(day1[1]?.payload).toMatchObject({
      loanId: 'loan-1:loan:0',
      interestAccrued: 3,
      paidAmount: 103,
      interestPaid: 3,
      principalPaid: 100,
      missedPayments: 0,
      status: 'active',
      borrowerPreviousBalance: 800,
      borrowerNextBalance: 697,
    });
    expect(day1[2]?.payload).toMatchObject({
      paidAt: DAY_MS,
      payments: [{ agentId: 'agent-saver', amount: 1, previousBalance: 1_000, nextBalance: 1_001 }],
    });
    expect(projection.moneySupply).toBe(12_500);

    // Day 2: accrue 200×1% = 2; due 102.
    const day2 = run(makeTimeAdvance('advance-day-2', 2));
    expect(day2[1]?.payload).toMatchObject({ paidAmount: 102, status: 'active' });

    // Day 3: final installment closes the loan; the borrower earns history.
    const day3 = run(makeTimeAdvance('advance-day-3', 3));
    expect(day3.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'LoanRepaid',
      'ShortTermMemoryRecorded',
      'DepositInterestPaid',
    ]);
    expect(day3[1]?.payload).toMatchObject({ paidAmount: 101, status: 'repaid' });

    expect(projection.agents['agent-borrower']?.balance).toBe(494);
    expect(projection.agents['agent-saver']?.balance).toBe(1_003);
    expect(projection.bank).toMatchObject({
      // 10_000 reserves + 1_000 deposit − 300 principal + 306 collected − 3 interest paid.
      balance: 11_003,
      deposits: { 'agent-saver': 1_000 },
    });
    expect(projection.bank?.loans['loan-1:loan:0']).toMatchObject({
      principal: 0,
      accruedInterest: 0,
      status: 'repaid',
    });
    expect(projection.bank?.creditHistoryByAgent['agent-borrower']).toEqual({
      repaidCount: 1,
      defaultedCount: 0,
    });
    expect(projection.moneySupply).toBe(12_500);

    // The repaid history lifts the next credit limit to 5000 × 1.2.
    const secondLoan = run(
      makeCommand({
        id: 'loan-2',
        actorId: 'agent-borrower',
        type: 'AgentRequestLoan',
        payload: { amount: 5_500 },
        issuedAt: 3 * DAY_MS,
      }),
    );
    expect(secondLoan.map((event) => event.type)).toEqual([
      'LoanIssued',
      'ShortTermMemoryRecorded',
    ]);

    // The full command stream replays from genesis to the identical state.
    const replayed = replayEvents(createBankingProjection(), allEvents, applyWorldEvent);
    expect(replayed).toEqual(projection);
  });

  test('consecutive missed payments default the loan and cut the credit limit', () => {
    let projection = createWorldProjection({
      agents: [createAgent('agent-broke', 0)],
      moneySupply: 10_000,
      bank: createBankState({ reserves: 10_000 }),
      clock: { now: 0, tickDurationMs: 1000 },
    });
    let nextSequence = 1;
    const run = (command: Parameters<typeof dispatchWorldCommand>[0]['command']) => {
      const events = dispatchWorldCommand({ command, projection, policies, nextSequence });
      projection = events.reduce(applyWorldEvent, projection);
      nextSequence += events.length;
      return events;
    };

    run(
      makeCommand({
        id: 'loan-1',
        actorId: 'agent-broke',
        type: 'AgentRequestLoan',
        payload: { amount: 300 },
        issuedAt: 0,
      }),
    );
    expect(projection.agents['agent-broke']?.balance).toBe(300);

    // The borrower spends the principal externally before day 1.
    projection = {
      ...projection,
      agents: {
        ...projection.agents,
        'agent-broke': { ...projection.agents['agent-broke']!, balance: 0 },
      },
    };

    for (const day of [1, 2, 3]) {
      const events = run(makeTimeAdvance(`advance-day-${day}`, day));
      expect(events.map((event) => event.type)).toEqual(['SimulationTimeAdvanced', 'LoanRepaid']);
      expect(events[1]?.payload).toMatchObject({ paidAmount: 0, missedPayments: day });
    }

    const day4 = run(makeTimeAdvance('advance-day-4', 4));
    expect(day4.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'LoanDefaulted',
      'ShortTermMemoryRecorded',
    ]);
    expect(day4[1]?.payload).toMatchObject({
      loanId: 'loan-1:loan:0',
      missedPayments: 4,
      outstandingPrincipal: 300,
      outstandingInterest: 12,
      borrowerPreviousBalance: 0,
      borrowerNextBalance: 0,
    });
    expect(projection.bank?.loans['loan-1:loan:0']).toMatchObject({ status: 'defaulted' });
    expect(projection.bank?.creditHistoryByAgent['agent-broke']).toEqual({
      repaidCount: 0,
      defaultedCount: 1,
    });
    // The default write-off moves nothing: the borrower kept the principal.
    expect(projection.bank?.balance).toBe(9_700);
    expect(projection.moneySupply).toBe(10_000);

    // Defaulted loans stop accruing; the cadence goes quiet.
    const day5 = run(makeTimeAdvance('advance-day-5', 5));
    expect(day5.map((event) => event.type)).toEqual(['SimulationTimeAdvanced']);

    // The default halves the borrower's credit limit for the next request.
    const afterDefault = dispatchWorldCommand({
      command: makeCommand({
        id: 'loan-2',
        actorId: 'agent-broke',
        type: 'AgentRequestLoan',
        payload: { amount: 2_501 },
        issuedAt: 5 * DAY_MS,
      }),
      projection,
      policies,
      nextSequence,
    });
    expect(afterDefault[0]).toMatchObject({
      type: 'ActionRejected',
      payload: { reason: 'loan amount exceeds credit limit 2500' },
    });
  });

  test('amortized settlement matches the non-amortized run once all buckets caught up', () => {
    // Buckets=2: hashAgentSettlementBucket('agent-a')%2==0, 'agent-b'%2==1.
    const setup = () =>
      createWorldProjection({
        agents: [createAgent('agent-a', 2_000), createAgent('agent-b', 500)],
        moneySupply: 12_500,
        bank: createBankState({ reserves: 10_000 }),
        clock: { now: 0, tickDurationMs: 1000 },
      });
    const runScript = (runPolicies: WorldCommandPolicies, days: number) => {
      let projection = setup();
      let nextSequence = 1;
      const run = (command: Parameters<typeof dispatchWorldCommand>[0]['command']) => {
        const events = dispatchWorldCommand({
          command,
          projection,
          policies: runPolicies,
          nextSequence,
        });
        projection = events.reduce(applyWorldEvent, projection);
        nextSequence += events.length;
      };
      run(
        makeCommand({
          id: 'deposit-1',
          actorId: 'agent-a',
          type: 'AgentDeposit',
          payload: { amount: 1_000 },
          issuedAt: 0,
        }),
      );
      run(
        makeCommand({
          id: 'loan-1',
          actorId: 'agent-b',
          type: 'AgentRequestLoan',
          payload: { amount: 300 },
          issuedAt: 0,
        }),
      );
      for (const day of Array.from({ length: days }, (_, index) => index + 1)) {
        run(makeTimeAdvance(`advance-day-${day}`, day));
      }
      return projection;
    };

    const reference = runScript(policies, 4);
    const amortized = runScript({ ...policies, timeSettlementAmortization: { buckets: 2 } }, 4);
    // The amortized run settles the same four accrual days per agent, just on
    // alternating bucket ticks; after day 4 both agents caught up.
    expect(amortized.bank).toEqual(reference.bank);
    expect(amortized.agents['agent-a']?.balance).toBe(reference.agents['agent-a']?.balance);
    expect(amortized.agents['agent-b']?.balance).toBe(reference.agents['agent-b']?.balance);
    expect(amortized.moneySupply).toBe(reference.moneySupply);
  });
});

describe('town bank replay safety', () => {
  test('rejects a corrupt authority bank snapshot during replay', () => {
    const projection = createWorldProjection({ agents: [] });
    expect(() =>
      applyWorldEvent(
        projection,
        createEventEnvelope({
          id: 'event-invalid-bank-snapshot',
          simulationId: 'sim-credit',
          type: 'TownBankSnapshotRecorded',
          payload: {
            bank: {
              balance: -1,
              deposits: {},
              loans: {},
              creditHistoryByAgent: {},
            },
            recordedAt: 0,
            reason: 'credit-command' as const,
            policyVersion: 'credit-test',
          },
          occurredAt: 0,
          sequence: 1,
        }),
      ),
    ).toThrow('bank balance must be non-negative finite');
  });

  test('the projection reducer rejects settlement events that contradict the book', () => {
    let projection = createBankingProjection();
    const issued = dispatchWorldCommand({
      command: makeCommand({
        id: 'loan-1',
        actorId: 'agent-borrower',
        type: 'AgentRequestLoan',
        payload: { amount: 300 },
        issuedAt: 0,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    projection = issued.reduce(applyWorldEvent, projection);

    // paidAmount must equal interestPaid + principalPaid.
    expect(() =>
      applyWorldEvent(
        projection,
        createEventEnvelope({
          id: 'forged-1',
          simulationId: 'sim-credit',
          type: 'LoanRepaid',
          payload: {
            loanId: asLoanId('loan-1:loan:0'),
            borrowerAgentId: asAgentId('agent-borrower'),
            settledAt: DAY_MS,
            interestAccrued: 3,
            paidAmount: 50,
            interestPaid: 20,
            principalPaid: 20,
            missedPayments: 0,
            status: 'active' as const,
            borrowerPreviousBalance: 800,
            borrowerNextBalance: 750,
            bankPreviousBalance: 9_700,
            bankNextBalance: 9_750,
            policyVersion: 'credit-v1',
          },
          occurredAt: DAY_MS,
          sequence: 99,
        }),
      ),
    ).toThrow(/interestPaid \+ principalPaid/);

    // Settling an unknown loan is rejected outright.
    expect(() =>
      applyWorldEvent(
        projection,
        createEventEnvelope({
          id: 'forged-2',
          simulationId: 'sim-credit',
          type: 'LoanRepaid',
          payload: {
            loanId: asLoanId('loan-unknown'),
            borrowerAgentId: asAgentId('agent-borrower'),
            settledAt: DAY_MS,
            interestAccrued: 0,
            paidAmount: 1,
            interestPaid: 0,
            principalPaid: 1,
            missedPayments: 0,
            status: 'active' as const,
            borrowerPreviousBalance: 800,
            borrowerNextBalance: 799,
            bankPreviousBalance: 9_700,
            bankNextBalance: 9_701,
            policyVersion: 'credit-v1',
          },
          occurredAt: DAY_MS,
          sequence: 100,
        }),
      ),
    ).toThrow(/unknown loan/);
  });

  test('legacy projections without the bank slice stay byte-for-byte compatible', () => {
    const projection = createWorldProjection({ agents: [createAgent('agent-saver', 100)] });
    expect(projection.bank).toBeUndefined();
    expect('bank' in projection).toBe(false);
  });
});
