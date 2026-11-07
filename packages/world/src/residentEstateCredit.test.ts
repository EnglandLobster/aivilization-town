import { expect, test } from 'vitest';
import {
  asAgentId,
  asLoanId,
  createCommandEnvelope,
  createEventEnvelope,
  advanceClock,
} from '@aivilization/sim-core';
import { createBankState, type CreditPolicy } from '@aivilization/credit';
import {
  ESTATE_CASH_BANK_POLICY,
  applyEstateCashEvent,
  estateCashBalance,
} from '@aivilization/economy';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
type CreditPacket = Extract<WorldEvent, { type: 'ResidentEstateCreditCommitted' }>;
import { residentExitFixture, capturedResidentDeparture } from './testFixtures/residentExit';
import { RESIDENT_EXIT_BANK_PRESERVATION_POLICY } from './residentExitPreservation';
import { handleAgentDepositCommand, handleAgentRequestLoanCommand } from './handlers/credit';
import { handleAdvanceSimulationTimeCommand } from './handlers/timeAdvance';
import {
  enableResidentEstateCreditEvent,
  residentEstateCreditDueEvent,
  nextResidentEstateCreditDueAt,
  assertResidentEstateCreditSnapshot,
} from './residentEstateCredit';
const DAY = 86400000;
const creditPolicy: CreditPolicy = {
  policyVersion: 'estate-credit-world-fixture-v1',
  depositDailyInterestRate: 0.001,
  loanDailyInterestRate: 0.01,
  loanTermDays: 3,
  accrualCadenceMs: DAY,
  reserveRatio: 0.2,
  maxLoansPerAgent: 2,
  graceMissedPayments: 3,
  baseLoanLimit: 5000,
  creditLimitRepaidBonusRatio: 0.2,
  creditLimitDefaultPenaltyRatio: 0.5,
  creditLimitMinMultiplier: 0.1,
  creditLimitMaxMultiplier: 3,
  source: 'world estate-credit integration fixture',
};
const context = (projection: WorldProjection, id: string, sequence = 20) => ({
  projection,
  requestId: id,
  simulationId: 'sim-1',
  nextSequence: sequence,
});
function fixture(deposit: number | 'all' = 100) {
  const f = residentExitFixture();
  const seed: WorldProjection = {
    ...f,
    moneySupply: f.moneySupply + 1000,
    bank: createBankState({ reserves: 1000 }),
    residentExits: {
      ...f.residentExits,
      policy: RESIDENT_EXIT_BANK_PRESERVATION_POLICY,
      cash: applyEstateCashEvent(undefined, {
        type: 'EstateCashEnabled',
        policy: ESTATE_CASH_BANK_POLICY,
      }),
    },
  };
  let w = seed;
  const events: WorldEvent[] = [];
  for (const id of ['loan-1', 'loan-2']) {
    const command = createCommandEnvelope({
      id,
      simulationId: 'sim-1',
      actorId: 'a',
      type: 'AgentRequestLoan',
      issuedAt: 0,
      payload: { amount: 300 },
    });
    const next = handleAgentRequestLoanCommand({
      command,
      projection: w,
      policy: creditPolicy,
      nextSequence: events.length + 1,
    });
    expect(next[0]?.type).toBe('LoanIssued');
    w = next.reduce(applyWorldEvent, w);
    events.push(...next);
  }
  if (deposit !== 0) {
    const command = createCommandEnvelope({
      id: 'deposit',
      simulationId: 'sim-1',
      actorId: 'a',
      type: 'AgentDeposit',
      issuedAt: 0,
      payload: { amount: deposit === 'all' ? w.agents.a!.balance : deposit },
    });
    const next = handleAgentDepositCommand({
      command,
      projection: w,
      policy: creditPolicy,
      nextSequence: events.length + 1,
    });
    expect(next[0]?.type).toBe('DepositMade');
    w = next.reduce(applyWorldEvent, w);
    events.push(...next);
  }
  const enable = enableResidentEstateCreditEvent({ ...context(w, 'enable'), creditPolicy });
  w = applyWorldEvent(w, enable);
  events.push(enable);
  const death = capturedResidentDeparture(w);
  w = applyWorldEvent(w, death);
  events.push(death);
  return { seed, w, events, death, enable };
}
function time(w: WorldProjection, deltaMs = DAY): WorldEvent {
  return createEventEnvelope({
    id: `time-${w.clock.now}-${deltaMs}`,
    simulationId: 'sim-1',
    sequence: 30,
    occurredAt: w.clock.now,
    type: 'SimulationTimeAdvanced',
    payload: { previous: w.clock, next: advanceClock(w.clock, deltaMs), deltaMs },
  });
}
const totalCash = (w: WorldProjection) =>
  Object.values(w.agents).reduce((n, a) => n + a.balance, 0) +
  (w.bank?.balance ?? 0) +
  estateCashBalance(w.residentExits?.cash);
test('real deposit and issued loans survive one atomic actual body departure; no replacement borrower, forfeiture, principal loss or newly granted mandate', () => {
  const f = fixture();
  expect(f.w.agents.a).toBeUndefined();
  expect(f.w.bank?.deposits.a).toBe(100);
  expect(f.w.bank?.loans['loan-1:loan:0']).toMatchObject({
    borrowerAgentId: 'a',
    principal: 300,
    status: 'active',
  });
  expect(f.w.estateCredit?.customers['estate-credit-10']).toMatchObject({
    departure: { ownerId: 'a', eventId: f.death.id, cause: 'death' },
    nextCadenceAt: DAY,
    cashReceiptSerial: 0,
  });
  expect(estateCashBalance(f.w.residentExits?.cash)).toBeCloseTo(525.12345678);
  expect(totalCash(f.w)).toBeCloseTo(f.seed.moneySupply);
  expect(f.w.moneySupply).toBe(f.seed.moneySupply);
  expect(f.events.reduce(applyWorldEvent, f.seed)).toEqual(f.w);
  expect(f.death.payload.exitPreservation?.creditEvents).toHaveLength(1);
  assertResidentEstateCreditSnapshot(f.w);
});
test('one exact cadence pays two original loans then actual deposit interest with three separate gross receipts and conserved circulating cash', () => {
  const f = fixture(),
    w = applyWorldEvent(f.w, time(f.w));
  const e = residentEstateCreditDueEvent({
    ...context(w, 'due-1'),
    customerId: 'estate-credit-10',
  });
  if (
    e.type !== 'ResidentEstateCreditCommitted' ||
    e.payload.event.type !== 'EstateCreditCadenceRecorded'
  )
    throw Error('expected');
  expect(e.payload.event.bankEvents.map((x) => x.type)).toEqual([
    'LoanRepaid',
    'LoanRepaid',
    'DepositInterestPaid',
  ]);
  expect(e.payload.cashEffects).toHaveLength(3);
  expect(e.payload.cashEffects.map((x) => x.source.revision)).toEqual([1, 2, 3]);
  const next = applyWorldEvent(w, e);
  expect(next.bank?.balance).toBeCloseTo(705.9);
  expect(estateCashBalance(next.residentExits?.cash)).toBeCloseTo(319.22345678);
  expect(next.bank?.loans['loan-1:loan:0']?.principal).toBe(200);
  expect(next.estateCredit?.customers['estate-credit-10']).toMatchObject({
    nextCadenceAt: 2 * DAY,
    cashReceiptSerial: 3,
  });
  expect(next.moneySupply).toBe(f.seed.moneySupply);
  expect(totalCash(next)).toBeCloseTo(f.seed.moneySupply);
  expect(applyWorldEvent(w, JSON.parse(JSON.stringify(e)) as typeof e)).toEqual(next);
  expect(() => applyWorldEvent(next, e)).toThrow('cadence-or-revision-mismatch');
});
test('empty original cash misses both loans but bank interest still enters the actual original estate; no netting away separate real effects', () => {
  const f = fixture('all'),
    w = applyWorldEvent(f.w, time(f.w));
  expect(estateCashBalance(w.residentExits?.cash)).toBe(0);
  const e = residentEstateCreditDueEvent({
    ...context(w, 'zero-cash'),
    customerId: 'estate-credit-10',
  });
  if (e.type !== 'ResidentEstateCreditCommitted') throw Error('expected');
  expect(e.payload.cashEffects).toHaveLength(1);
  const next = applyWorldEvent(w, e);
  expect(next.bank?.loans['loan-1:loan:0']).toMatchObject({
    missedPayments: 1,
    principal: 300,
    accruedInterest: 3,
  });
  expect(estateCashBalance(next.residentExits?.cash)).toBeCloseTo(0.62512345678);
  expect(totalCash(next)).toBeCloseTo(f.seed.moneySupply);
});
test('time cannot skip or repeat an unsettled due cursor; each of three boundaries produces replayable facts and the original debt payoff', () => {
  const f = fixture();
  expect(nextResidentEstateCreditDueAt(f.w)).toBe(DAY);
  expect(() => applyWorldEvent(f.w, time(f.w, 2 * DAY))).toThrow('cadence-must-be-settled');
  let w = f.w;
  const events: WorldEvent[] = [];
  for (let i = 1; i <= 3; i++) {
    const t = time(w);
    w = applyWorldEvent(w, t);
    events.push(t);
    expect(() => applyWorldEvent(w, time(w, 1))).toThrow('cadence-must-be-settled');
    const e = residentEstateCreditDueEvent({
      ...context(w, `due-${i}`),
      customerId: 'estate-credit-10',
    });
    w = applyWorldEvent(w, e);
    events.push(e);
    expect(totalCash(w)).toBeCloseTo(f.seed.moneySupply);
  }
  // Actual cash was insufficient for the full third day's second loan; that remaining claim persists.
  expect(w.bank?.loans['loan-1:loan:0']?.status).toBe('repaid');
  expect(w.bank?.loans['loan-2:loan:0']?.status).toBe('active');
  expect(w.bank?.loans['loan-2:loan:0']!.principal).toBeGreaterThan(0);
  expect(events.reduce(applyWorldEvent, f.w)).toEqual(w);
  expect(nextResidentEstateCreditDueAt(w)).toBe(4 * DAY);
});
test('forged source cash, substituted bank borrower, missing or reused gross receipts and altered clock reject the whole immutable packet', () => {
  const f = fixture(),
    w = applyWorldEvent(f.w, time(f.w));
  const e = residentEstateCreditDueEvent({
    ...context(w, 'proofs'),
    customerId: 'estate-credit-10',
  });
  if (
    e.type !== 'ResidentEstateCreditCommitted' ||
    e.payload.event.type !== 'EstateCreditCadenceRecorded'
  )
    throw Error('expected');
  const mutations: ((x: CreditPacket) => void)[] = [
    (x) => Object.assign(x.payload.event, { availableCash: 999 }),
    (x) => Object.assign(x.payload, { cashEffects: x.payload.cashEffects.slice(1) }),
    (x) =>
      Object.assign(x.payload, {
        cashEffects: [x.payload.cashEffects[0], x.payload.cashEffects[0], x.payload.cashEffects[2]],
      }),
    (x) => Object.assign(x, { occurredAt: DAY + 1 }),
    (x) => {
      if (x.payload.event.type !== 'EstateCreditCadenceRecorded') throw Error('expected');
      Object.assign(x.payload.event.bankEvents[0]!, { borrowerAgentId: asAgentId('impostor') });
    },
    (x) => Object.assign(x.payload.cashEffects[0]!.source, { revision: 999 }),
  ];
  const before = structuredClone(w);
  for (const mutate of mutations) {
    const x = structuredClone(e);
    mutate(x);
    expect(() => applyWorldEvent(w, x)).toThrow();
    expect(w).toEqual(before);
  }
});
test('a bank receipt must reference the current real original deposit, original loan position and bank cash rather than a stale or omitted source', () => {
  const f = fixture(),
    w = applyWorldEvent(f.w, time(f.w));
  const e = residentEstateCreditDueEvent({
    ...context(w, 'source'),
    customerId: 'estate-credit-10',
  });
  const before = structuredClone(w);
  for (const bank of [
    { ...w.bank!, balance: w.bank!.balance + 1 },
    { ...w.bank!, deposits: { a: 99 } },
    {
      ...w.bank!,
      loans: {
        ...w.bank!.loans,
        'loan-1:loan:0': { ...w.bank!.loans['loan-1:loan:0']!, principal: 299 },
      },
    },
  ])
    expect(() => applyWorldEvent({ ...w, bank }, e)).toThrow('current-bank-source-mismatch');
  expect(w).toEqual(before);
  if (
    e.type !== 'ResidentEstateCreditCommitted' ||
    e.payload.event.type !== 'EstateCreditCadenceRecorded'
  )
    throw Error('expected');
  const missingDeposit = structuredClone(e);
  if (missingDeposit.payload.event.type !== 'EstateCreditCadenceRecorded') throw Error('expected');
  Object.assign(missingDeposit.payload.event.bankSource, { deposit: 0 });
  expect(() => applyWorldEvent(w, missingDeposit)).toThrow('actual-deposit-source-required');
});
test('bank-customer activation requires explicit v2 and cannot import past exits or anonymous bank positions', () => {
  const old = residentExitFixture();
  expect(() =>
    enableResidentEstateCreditEvent({
      ...context({ ...old, bank: createBankState({ reserves: 0 }) }, 'old'),
      creditPolicy,
    }),
  ).toThrow('explicit-bank-preservation');
  const f = fixture();
  expect(() => enableResidentEstateCreditEvent({ ...context(f.w, 'again'), creditPolicy })).toThrow(
    'existing-customer-import',
  );
  const seed = { ...f.seed, bank: { ...f.seed.bank!, deposits: { absent: 100 } } };
  expect(() =>
    enableResidentEstateCreditEvent({ ...context(seed, 'unobserved'), creditPolicy }),
  ).toThrow('bank-subject-authority-unobserved');
  expect(() =>
    enableResidentEstateCreditEvent({
      ...context(f.seed, 'oversized-policy'),
      creditPolicy: { ...creditPolicy, maxLoansPerAgent: 129 },
    }),
  ).toThrow('capacity-unsupported');
});
test('departure cannot omit or fabricate its own customer capture; snapshots require complete independent bank/customer/population references', () => {
  const f = fixture();
  const preDeath = f.events.slice(0, -1).reduce(applyWorldEvent, f.seed);
  const forged = structuredClone(f.death);
  if (!forged.payload.exitPreservation) throw Error('expected');
  Object.assign(forged.payload.exitPreservation, { creditEvents: [] });
  expect(() => applyWorldEvent(preDeath, forged)).toThrow('single-customer-capture');
  expect(preDeath.agents.a).toBeDefined();
  expect(() =>
    assertResidentEstateCreditSnapshot({
      ...f.w,
      estateCredit: { ...f.w.estateCredit!, customers: {} },
    }),
  ).toThrow('coverage-incomplete');
  const altered = structuredClone(f.w);
  Object.assign(altered.estateCredit!.customers['estate-credit-10']!.departure, {
    eventId: 'fabricated',
  });
  expect(() => assertResidentEstateCreditSnapshot(altered)).toThrow('actual-population-reference');
});
const advance = (w: WorldProjection, deltaMs: number, policy = creditPolicy) =>
  handleAdvanceSimulationTimeCommand({
    projection: w,
    credit: policy,
    nextSequence: 100,
    command: createCommandEnvelope({
      id: `advance-${w.clock.now}-${deltaMs}`,
      simulationId: 'sim-1',
      source: 'system',
      type: 'AdvanceSimulationTime',
      issuedAt: w.clock.now,
      payload: { deltaMs },
    }),
  });
test('the actual time command settles departed customers with no living body, stepping three bank boundaries deterministically', () => {
  const f = fixture();
  const events = advance(f.w, 3 * DAY),
    result = events.reduce(applyWorldEvent, f.w);
  expect(
    events.filter((e) => e.type === 'SimulationTimeAdvanced').map((e) => e.payload.next.now),
  ).toEqual([DAY, 2 * DAY, 3 * DAY]);
  expect(events.filter((e) => e.type === 'ResidentEstateCreditCommitted')).toHaveLength(3);
  let stepped = f.w;
  for (let day = 0; day < 3; day++)
    stepped = advance(stepped, DAY).reduce(applyWorldEvent, stepped);
  expect(result).toEqual(stepped);
  expect(result.clock.now).toBe(3 * DAY);
  expect(result.estateCredit?.customers['estate-credit-10']?.cashReceiptSerial).toBe(9);
  expect(totalCash(result)).toBeCloseTo(f.seed.moneySupply);
  expect(result.moneySupply).toBe(f.seed.moneySupply);
});
test('living borrowers use the explicitly pinned shared budget and still receive real deposit interest', () => {
  const f = fixture();
  let w = f.events.slice(0, -2).reduce(applyWorldEvent, f.seed);
  const amount = w.agents.a!.balance - 150;
  const command = createCommandEnvelope({
    id: 'reserve-cash',
    simulationId: 'sim-1',
    actorId: 'a',
    type: 'AgentDeposit',
    issuedAt: 0,
    payload: { amount },
  });
  w = handleAgentDepositCommand({
    command,
    projection: w,
    policy: creditPolicy,
    nextSequence: 12,
  }).reduce(applyWorldEvent, w);
  w = applyWorldEvent(
    w,
    enableResidentEstateCreditEvent({ ...context(w, 'activate-live'), creditPolicy }),
  );
  const events = advance(w, DAY),
    next = events.reduce(applyWorldEvent, w);
  const loans = events.filter((e) => e.type === 'LoanRepaid');
  expect(loans.map((e) => e.payload.paidAmount)).toEqual([103, 47]);
  expect(
    loans.every(
      (e) => e.payload.collectionPolicyVersion === 'credit-shared-borrower-cash-budget-v1',
    ),
  ).toBe(true);
  expect(next.agents.a!.balance).toBeCloseTo(
    next.bank!.deposits.a! * creditPolicy.depositDailyInterestRate,
  );
  expect(totalCash(next)).toBeCloseTo(f.seed.moneySupply);
  expect(() => applyWorldEvent(f.seed, loans[0]!)).toThrow(
    'explicit-shared-budget-source-required',
  );
});
test('living and departed customers use one real bank book, with living effects before departed receipts', () => {
  const f = fixture();
  const b = { ...f.seed.agents.a!, agentId: asAgentId('b'), balance: 150, inventory: {} };
  let w: WorldProjection = { ...f.w, moneySupply: f.w.moneySupply + 150, agents: { b } };
  const command = createCommandEnvelope({
    id: 'b-deposit',
    simulationId: 'sim-1',
    actorId: 'b',
    type: 'AgentDeposit',
    issuedAt: 0,
    payload: { amount: 150 },
  });
  w = handleAgentDepositCommand({
    command,
    projection: w,
    policy: creditPolicy,
    nextSequence: 30,
  }).reduce(applyWorldEvent, w);
  const events = advance(w, DAY),
    next = events.reduce(applyWorldEvent, w);
  const livingInterest = events.findIndex((e) => e.type === 'DepositInterestPaid'),
    departedSettlement = events.findIndex((e) => e.type === 'ResidentEstateCreditCommitted');
  expect(livingInterest).toBeGreaterThan(0);
  expect(departedSettlement).toBeGreaterThan(livingInterest);
  expect(next.agents.b?.balance).toBeCloseTo(0.15);
  expect(next.bank?.deposits).toEqual({ a: 100, b: 150 });
  expect(next.agents.a).toBeUndefined();
  expect(totalCash(next)).toBeCloseTo(w.moneySupply);
});
test('time refuses a changed runtime policy, an overdue cursor and unported body buckets before financial changes', () => {
  const f = fixture(),
    before = structuredClone(f.w);
  expect(() => advance(f.w, DAY, { ...creditPolicy, depositDailyInterestRate: 0.1 })).toThrow(
    'pinned-runtime-policy-required',
  );
  const overdue = { ...f.w, clock: advanceClock(f.w.clock, DAY + 1) };
  expect(() => advance(overdue, DAY)).toThrow('overdue-cursor-recovery-required');
  expect(() =>
    handleAdvanceSimulationTimeCommand({
      projection: f.w,
      credit: creditPolicy,
      timeSettlementAmortization: { buckets: 2 },
      nextSequence: 100,
      command: createCommandEnvelope({
        id: 'buckets',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        issuedAt: 0,
        payload: { deltaMs: DAY },
      }),
    }),
  ).toThrow('body-bucket-migration-required');
  expect(f.w).toEqual(before);
});

test('completed bank snapshots independently require original living or preserved subjects, even if the financial packet itself looks valid', () => {
  const { w } = fixture();
  const unknown = { ...w.bank!, deposits: { ...w.bank!.deposits, unknown: 1 } };
  expect(() => assertResidentEstateCreditSnapshot({ ...w, bank: unknown })).toThrow(
    'bank-subject-authority-unobserved',
  );
  const e = createEventEnvelope({
    id: 'bad-bank-snapshot',
    simulationId: 'sim-1',
    sequence: 40,
    occurredAt: 0,
    type: 'TownBankSnapshotRecorded' as const,
    payload: {
      bank: unknown,
      recordedAt: 0,
      reason: 'credit-accrual' as const,
      policyVersion: creditPolicy.policyVersion,
    },
  });
  expect(() => applyWorldEvent(w, e)).toThrow('bank-subject-authority-unobserved');
  const borrowed = {
    ...w.bank!,
    loans: {
      ...w.bank!.loans,
      'loan-1:loan:0': {
        ...w.bank!.loans['loan-1:loan:0']!,
        borrowerAgentId: asAgentId('impostor'),
      },
    },
  };
  expect(() => assertResidentEstateCreditSnapshot({ ...w, bank: borrowed })).toThrow(
    'bank-subject-authority-unobserved',
  );
  expect(w.bank!.deposits).toEqual({ a: 100 });
});
test('new lending reserves outstanding defaulted claims before issuance and forged replay cannot bypass the customer limit', () => {
  const f = fixture(),
    live = f.events.slice(0, -1).reduce(applyWorldEvent, f.seed);
  const template = live.bank!.loans['loan-1:loan:0']!;
  const w = {
    ...live,
    bank: {
      ...live.bank!,
      loans: Object.fromEntries(
        Array.from({ length: 128 }, (_, i) => {
          const loanId = asLoanId(`defaulted-${i}`);
          return [loanId, { ...template, loanId, status: 'defaulted' as const }];
        }),
      ),
    },
  };
  assertResidentEstateCreditSnapshot(w);
  const command = createCommandEnvelope({
    id: 'new-loan',
    simulationId: 'sim-1',
    actorId: 'a',
    type: 'AgentRequestLoan',
    issuedAt: 0,
    payload: { amount: 1 },
  });
  const events = handleAgentRequestLoanCommand({
    command,
    projection: w,
    policy: creditPolicy,
    nextSequence: 40,
  });
  expect(events[0]).toMatchObject({
    type: 'ActionRejected',
    payload: { reason: 'estate-credit-loan-capacity-unreserved' },
  });
  const forged = createEventEnvelope({
    id: 'forged-loan',
    simulationId: 'sim-1',
    sequence: 40,
    occurredAt: 0,
    type: 'LoanIssued' as const,
    payload: {
      loanId: asLoanId('extra'),
      borrowerAgentId: asAgentId('a'),
      principal: 1,
      dailyInterestRate: 0.01,
      termDays: 3,
      issuedAt: 0,
      borrowerPreviousBalance: w.agents.a!.balance,
      borrowerNextBalance: w.agents.a!.balance + 1,
      bankPreviousBalance: w.bank.balance,
      bankNextBalance: w.bank.balance - 1,
      policyVersion: creditPolicy.policyVersion,
    },
  });
  expect(() => applyWorldEvent(w, forged)).toThrow('loan-capacity-unreserved');
  expect(Object.keys(w.bank.loans)).toHaveLength(128);
  expect(w.moneySupply).toBe(live.moneySupply);
});

test('a legacy authoritative snapshot cannot rewrite preserved bank claims, original deposit or borrower under the new explicit customer mode', () => {
  const { w } = fixture();
  const packet = (bank: NonNullable<WorldProjection['bank']>) =>
    createEventEnvelope({
      id: 'bank-checkpoint',
      simulationId: 'sim-1',
      sequence: 40,
      occurredAt: 0,
      type: 'TownBankSnapshotRecorded' as const,
      payload: {
        bank,
        recordedAt: 0,
        reason: 'credit-accrual' as const,
        policyVersion: creditPolicy.policyVersion,
      },
    });
  expect(applyWorldEvent(w, packet(w.bank!)).bank).toEqual(w.bank);
  for (const bank of [
    { ...w.bank!, deposits: {} },
    { ...w.bank!, loans: {} },
    { ...w.bank!, balance: w.bank!.balance + 1 },
  ])
    expect(() => applyWorldEvent(w, packet(bank))).toThrow(
      'estate-credit-bank-snapshot-import-not-supported',
    );
  expect(w.bank!.deposits.a).toBe(100);
  expect(Object.keys(w.bank!.loans)).toHaveLength(2);
});
