import { expect, test } from 'vitest';
import { asAgentId, asLoanId } from '@aivilization/sim-core';
import { createBankState } from './model';
import { applyCreditDomainEvent } from './aggregate';
import type { CreditPolicy } from './policy';
import {
  ESTATE_CREDIT_CONTINUITY_POLICY as POLICY,
  type EstateCreditState,
} from './estateCustomerModel';
import {
  applyEstateCreditEvent,
  recordEstateCreditCustomer,
  settleEstateCreditCadence,
  assertEstateCreditState,
  assertEstateCreditBankCoverage,
  estateCreditOutstandingLoanCount,
} from './estateCustomers';
const DAY = 86400000,
  owner = asAgentId('a');
const creditPolicy: CreditPolicy = {
  policyVersion: 'estate-credit-fixture-v1',
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
  source: 'explicit domain fixture',
};
function fixture(deposit = true) {
  let bank = createBankState({ reserves: 1000 });
  for (const key of ['loan-1', 'loan-2'])
    bank = applyCreditDomainEvent(bank, {
      type: 'LoanIssued',
      loanId: asLoanId(key),
      borrowerAgentId: owner,
      principal: 300,
      dailyInterestRate: 0.01,
      termDays: 3,
      issuedAt: 0,
    });
  if (deposit)
    bank = applyCreditDomainEvent(bank, { type: 'DepositMade', agentId: owner, amount: 100 });
  const initial = applyEstateCreditEvent(undefined, {
    type: 'EstateCreditEnabled',
    policy: POLICY,
    creditPolicy,
  });
  const source = {
    ownerId: owner,
    eventId: 'actual-death-a',
    populationPolicyVersion: 'population-v2',
    at: 0,
    cause: 'death' as const,
  };
  const d = recordEstateCreditCustomer(initial, 'customer-a', source);
  if (!d.accepted) throw Error(d.reason);
  return { state: d.events.reduce(applyEstateCreditEvent, initial), bank, initial, source };
}
function cadence(
  s: EstateCreditState,
  bank: ReturnType<typeof createBankState>,
  at: number,
  cash: number,
) {
  const d = settleEstateCreditCadence(s, bank, 'customer-a', at, cash);
  if (!d.accepted) throw Error(d.reason);
  const e = d.events[0]!;
  if (e.type !== 'EstateCreditCadenceRecorded') throw Error('expected');
  return e;
}
test('registering a real departure reference preserves original bank positions and creates only a separately owned customer cursor, no body, executor or cash', () => {
  const f = fixture(),
    bank = structuredClone(f.bank);
  expect(f.state.customers['customer-a']).toMatchObject({
    departure: f.source,
    nextCadenceAt: DAY,
    cashReceiptSerial: 0,
  });
  expect(f.bank).toEqual(bank);
  expect(f.bank.deposits.a).toBe(100);
  expect(f.bank.loans['loan-1']?.borrowerAgentId).toBe(owner);
  expect(f.state).not.toHaveProperty('balance');
  expect(recordEstateCreditCustomer(f.state, 'duplicate-customer', f.source).accepted).toBe(false);
  expect(
    recordEstateCreditCustomer(f.state, 'customer-a', {
      ...f.source,
      ownerId: 'other',
      eventId: 'other-death',
    }).accepted,
  ).toBe(false);
});
test('multiple loans share actual preserved cash and deposit interest remains an independent actual bank payment; gross cash receipts have stable serials', () => {
  const f = fixture(),
    e = cadence(f.state, f.bank, DAY, 150),
    next = applyEstateCreditEvent(f.state, e),
    bank = e.bankEvents.reduce(applyCreditDomainEvent, f.bank);
  expect(e.bankEvents.map((b) => b.type)).toEqual([
    'LoanRepaid',
    'LoanRepaid',
    'DepositInterestPaid',
  ]);
  expect(e.bankEvents.slice(0, 2).map((b) => (b.type === 'LoanRepaid' ? b.paidAmount : 0))).toEqual(
    [103, 47],
  );
  expect(e.previousCashReceiptSerial).toBe(0);
  expect(e.nextCashReceiptSerial).toBe(3);
  expect(next.customers['customer-a']?.nextCadenceAt).toBe(2 * DAY);
  expect(bank.balance).toBeCloseTo(649.9);
  expect(bank.deposits.a).toBe(100);
  expect(JSON.parse(JSON.stringify(next))).toEqual(next);
  assertEstateCreditState(next);
  expect(() => applyEstateCreditEvent(next, e)).toThrow('cadence-or-revision-mismatch');
});
test('zero collected cash still records exactly one due cadence and retains unpaid original bank positions, without fabricating interest payouts or repeating a boundary', () => {
  const f = fixture(false),
    e = cadence(f.state, f.bank, DAY, 0),
    next = applyEstateCreditEvent(f.state, e),
    bank = e.bankEvents.reduce(applyCreditDomainEvent, f.bank);
  expect(e.nextCashReceiptSerial).toBe(0);
  expect(e.bankEvents.map((b) => (b.type === 'LoanRepaid' ? b.paidAmount : -1))).toEqual([0, 0]);
  expect(bank.balance).toBe(f.bank.balance);
  expect(bank.loans['loan-1']).toMatchObject({
    principal: 300,
    accruedInterest: 3,
    missedPayments: 1,
  });
  expect(settleEstateCreditCadence(next, bank, 'customer-a', DAY, 0)).toMatchObject({
    accepted: false,
    reason: 'estate-credit-actual-cadence-or-revision-mismatch',
  });
});
test('negative or unknown cash, skipped cadence, malformed departure, duplicate source and a credit policy beyond the admitted loan capacity reject before any state changes', () => {
  const f = fixture(),
    before = structuredClone(f.state);
  for (const cash of [-1, NaN, Infinity])
    expect(settleEstateCreditCadence(f.state, f.bank, 'customer-a', DAY, cash).accepted).toBe(
      false,
    );
  expect(settleEstateCreditCadence(f.state, f.bank, 'customer-a', 2 * DAY, 150).accepted).toBe(
    false,
  );
  expect(
    recordEstateCreditCustomer(f.initial, 'bad-customer', { ...f.source, at: NaN }).accepted,
  ).toBe(false);
  expect(() =>
    applyEstateCreditEvent(undefined, {
      type: 'EstateCreditEnabled',
      policy: POLICY,
      creditPolicy: { ...creditPolicy, maxLoansPerAgent: 129 },
    }),
  ).toThrow('capacity-unsupported');
  expect(f.state).toEqual(before);
});
test('credit customer facts reject another borrower, wrong deposit recipient, changed cash receipt serial and forged snapshot ownership; actual bank events still require the bank aggregate applier', () => {
  const f = fixture(),
    e = cadence(f.state, f.bank, DAY, 150),
    first = e.bankEvents[0]!;
  if (first.type !== 'LoanRepaid') throw Error('expected');
  expect(() =>
    applyEstateCreditEvent(f.state, {
      ...e,
      bankEvents: [{ ...first, borrowerAgentId: asAgentId('other') }],
    }),
  ).toThrow('loan-owner-or-order-mismatch');
  expect(() => applyEstateCreditEvent(f.state, { ...e, nextCashReceiptSerial: 99 })).toThrow(
    'receipt-count-mismatch',
  );
  const deposit = e.bankEvents.at(-1)!;
  if (deposit.type !== 'DepositInterestPaid') throw Error('expected');
  expect(() =>
    applyEstateCreditEvent(f.state, {
      ...e,
      bankEvents: [{ ...deposit, payments: [{ agentId: asAgentId('other'), amount: 0.1 }] }],
    }),
  ).toThrow('deposit-owner-or-time-mismatch');
  expect(() =>
    assertEstateCreditState({
      ...f.state,
      customers: { ...f.state.customers, duplicate: f.state.customers['customer-a']! },
    }),
  ).toThrow('duplicate-estate-credit-customer-source');
  expect(() => applyEstateCreditEvent(f.state, { ...e, availableCash: 100 })).toThrow(
    'cash-overdraft',
  );
});
test('each crossed cadence is necessary and deterministic, with original loan state and actual cash evolving together instead of evaluating several days from one stale balance', () => {
  const run = () => {
    const f = fixture(false);
    let s = f.state,
      b = f.bank,
      cash = 250;
    const events = [];
    for (let day = 1; day <= 3; day++) {
      const e = cadence(s, b, day * DAY, cash);
      for (const x of e.bankEvents)
        cash +=
          x.type === 'DepositInterestPaid'
            ? x.payments.reduce((n, p) => n + p.amount, 0)
            : -x.paidAmount;
      s = applyEstateCreditEvent(s, e);
      b = e.bankEvents.reduce(applyCreditDomainEvent, b);
      events.push(e);
    }
    return { state: s, bank: b, cash, events };
  };
  expect(run()).toEqual(run());
  expect(run().cash).toBe(0);
  expect(run().state.customers['customer-a']?.cashReceiptSerial).toBe(3);
});

test('owning bank coverage requires observed depositors and outstanding borrowers; original subjects are not guessed from text', () => {
  const { bank } = fixture();
  assertEstateCreditBankCoverage(bank, (id) => id === 'a');
  expect(() => assertEstateCreditBankCoverage(bank, () => false)).toThrow(
    'bank-subject-authority-unobserved',
  );
  expect(() =>
    assertEstateCreditBankCoverage(
      { ...bank, deposits: { ...bank.deposits, unknown: 1 } },
      (id) => id === 'a',
    ),
  ).toThrow('bank-subject-authority-unobserved');
});
test('defaulted claims reserve future customer capacity; settled history does not, and exceeding the actual bound rejects', () => {
  const { bank } = fixture(false),
    template = bank.loans['loan-1']!;
  const claims = (count: number) => ({
    ...bank,
    loans: Object.fromEntries(
      Array.from({ length: count }, (_, i) => {
        const loanId = asLoanId(`claim-${i}`);
        return [loanId, { ...template, loanId, status: 'defaulted' as const }];
      }),
    ),
  });
  const limit = claims(POLICY.maxLoansPerCustomer);
  assertEstateCreditBankCoverage(limit, (id) => id === 'a');
  expect(estateCreditOutstandingLoanCount(limit, 'a')).toBe(128);
  expect(() => assertEstateCreditBankCoverage(claims(129), () => true)).toThrow(
    'loan-capacity-unreserved',
  );
  expect(
    estateCreditOutstandingLoanCount(
      { ...bank, loans: { ...bank.loans, 'loan-1': { ...template, status: 'repaid' } } },
      'a',
    ),
  ).toBe(1);
});
