import { asAgentId } from '@aivilization/sim-core';
import { assertValidBankState, type BankState } from './model';
import { applyCreditDomainEvent } from './aggregate';
import { validateCreditPolicy } from './policy';
import {
  CREDIT_SHARED_CASH_BUDGET_POLICY,
  evaluateDailyCreditAccrualWithSharedCashBudget,
} from './lifecycle';
import {
  ESTATE_CREDIT_CONTINUITY_POLICY as POLICY,
  type EstateCreditState,
  type EstateCreditCustomer,
  type EstateCreditDeparture,
  type EstateCreditEvent,
  type EstateCreditDecision,
  type EstateCreditBankEvent,
  type EstateCreditBankSource,
} from './estateCustomerModel';
const check = (v: unknown, reason: string) => {
  if (!v) throw Error(reason);
};
const id = (v: unknown) =>
  typeof v === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(v) &&
  !['__proto__', 'prototype', 'constructor'].includes(v);
const time = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => time(v) && v > 0;
const exact = (v: unknown, keys: readonly string[]) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = Object.entries(a).sort(([a], [b]) => a.localeCompare(b)),
    y = Object.entries(b).sort(([a], [b]) => a.localeCompare(b));
  return x.length === y.length && x.every(([k, v], i) => y[i]?.[0] === k && equal(v, y[i]?.[1]));
}
const nextCadence = (at: number, cadence: number) => (Math.floor(at / cadence) + 1) * cadence;
function assertDeparture(d: EstateCreditDeparture) {
  check(
    exact(d, ['eventId', 'ownerId', 'at', 'cause', 'populationPolicyVersion']) &&
      [d.eventId, d.ownerId, d.populationPolicyVersion].every(id) &&
      time(d.at) &&
      ['death', 'emigration'].includes(d.cause),
    'invalid-estate-credit-departure-source',
  );
}
function assertCustomer(c: EstateCreditCustomer, s: EstateCreditState) {
  assertDeparture(c.departure);
  check(
    exact(c, ['id', 'revision', 'departure', 'at', 'nextCadenceAt', 'cashReceiptSerial']) &&
      id(c.id) &&
      positive(c.revision) &&
      time(c.at) &&
      c.at >= c.departure.at &&
      positive(c.nextCadenceAt) &&
      c.nextCadenceAt === nextCadence(c.at, s.creditPolicy.accrualCadenceMs) &&
      time(c.cashReceiptSerial),
    'invalid-estate-credit-customer',
  );
  check(
    c.revision !== 1 || (c.at === c.departure.at && c.cashReceiptSerial === 0),
    'invalid-estate-credit-original-customer',
  );
}
export function assertEstateCreditState(s: EstateCreditState) {
  check(
    exact(s, ['policy', 'creditPolicy', 'customers']) && equal(s.policy, POLICY),
    'unsupported-estate-credit-continuity-policy',
  );
  validateCreditPolicy(s.creditPolicy);
  check(
    Number.isSafeInteger(s.creditPolicy.accrualCadenceMs) &&
      s.creditPolicy.maxLoansPerAgent <= POLICY.maxLoansPerCustomer,
    'estate-credit-policy-capacity-unsupported',
  );
  check(
    !!s.customers &&
      typeof s.customers === 'object' &&
      !Array.isArray(s.customers) &&
      Object.keys(s.customers).length <= POLICY.maxCustomers,
    'estate-credit-customer-capacity',
  );
  const owners = new Set<string>(),
    departures = new Set<string>();
  for (const [k, c] of Object.entries(s.customers)) {
    assertCustomer(c, s);
    check(
      k === c.id && !owners.has(c.departure.ownerId) && !departures.has(c.departure.eventId),
      'duplicate-estate-credit-customer-source',
    );
    owners.add(c.departure.ownerId);
    departures.add(c.departure.eventId);
  }
}
/** One actual cash flow per paid loan/default and per depositor interest payment. Zero cash facts still advance the explicit cadence cursor. */
export function estateCreditCashReceiptCount(events: readonly EstateCreditBankEvent[]) {
  return events.reduce(
    (n, e) =>
      n +
      (e.type === 'DepositInterestPaid'
        ? e.payments.filter((p) => p.amount > 0).length
        : e.paidAmount > 0
          ? 1
          : 0),
    0,
  );
}
export function estateCreditBankSource(bank: BankState, owner: string): EstateCreditBankSource {
  assertValidBankState(bank);
  return {
    balance: bank.balance,
    deposit: bank.deposits[owner] ?? 0,
    loans: Object.values(bank.loans)
      .filter(
        (loan) =>
          loan.borrowerAgentId === owner &&
          (loan.status === 'active' || loan.status === 'defaulted'),
      )
      .sort((a, b) => a.loanId.localeCompare(b.loanId))
      .map((loan) => structuredClone(loan)),
  };
}
function assertBankSource(source: EstateCreditBankSource, owner: string) {
  check(
    exact(source, ['balance', 'deposit', 'loans']) &&
      Number.isFinite(source.balance) &&
      source.balance >= 0 &&
      Number.isFinite(source.deposit) &&
      source.deposit >= 0 &&
      Array.isArray(source.loans),
    'invalid-estate-credit-bank-source',
  );
  check(
    source.loans.length <= POLICY.maxLoansPerCustomer,
    'estate-credit-loan-capacity-unreserved',
  );
  const bank: BankState = {
    balance: source.balance,
    deposits: source.deposit ? { [owner]: source.deposit } : {},
    loans: Object.fromEntries(source.loans.map((loan) => [loan.loanId, loan])),
    creditHistoryByAgent: {},
  };
  assertValidBankState(bank);
  check(
    equal(estateCreditBankSource(bank, owner), source),
    'estate-credit-bank-source-owner-or-order-mismatch',
  );
}
export function assertEstateCreditBankFacts(
  owner: string,
  at: number,
  events: readonly EstateCreditBankEvent[],
) {
  check(Array.isArray(events), 'invalid-estate-credit-bank-events');
  check(events.length <= POLICY.maxLoansPerCustomer + 1, 'estate-credit-bank-event-capacity');
  const loans = new Set<string>();
  let deposit = false;
  let previousLoan: string | null = null;
  for (const e of events) {
    if (e.type === 'DepositInterestPaid') {
      check(
        !deposit &&
          e.paidAt === at &&
          e.payments.length === 1 &&
          e.payments[0]?.agentId === owner &&
          Number.isFinite(e.payments[0].amount) &&
          e.payments[0].amount > 0,
        'estate-credit-deposit-owner-or-time-mismatch',
      );
      deposit = true;
    } else {
      check(
        !deposit &&
          (previousLoan === null || previousLoan.localeCompare(e.loanId) < 0) &&
          (e.type === 'LoanRepaid' || e.type === 'LoanDefaulted') &&
          e.borrowerAgentId === owner &&
          (e.type === 'LoanRepaid' ? e.settledAt : e.defaultedAt) === at &&
          !loans.has(e.loanId),
        'estate-credit-loan-owner-or-order-mismatch',
      );
      loans.add(e.loanId);
      previousLoan = e.loanId;
    }
  }
}
export function applyEstateCreditEvent(
  s: EstateCreditState | undefined,
  e: EstateCreditEvent,
): EstateCreditState {
  if (e.type === 'EstateCreditEnabled') {
    check(!s, 'estate-credit-already-enabled');
    const next = {
      policy: structuredClone(e.policy),
      creditPolicy: structuredClone(e.creditPolicy),
      customers: {},
    };
    assertEstateCreditState(next);
    return next;
  }
  if (!s) throw Error('estate-credit-not-enabled');
  assertEstateCreditState(s);
  let c: EstateCreditCustomer;
  if (e.type === 'EstateCreditCustomerRecorded') {
    check(
      !s.customers[e.customer.id] && e.customer.revision === 1,
      'estate-credit-customer-already-recorded',
    );
    c = structuredClone(e.customer);
  } else {
    const old = s.customers[e.id];
    check(
      old &&
        old.revision === e.previousRevision &&
        e.at === old.nextCadenceAt &&
        e.previousCashReceiptSerial === old.cashReceiptSerial,
      'estate-credit-actual-cadence-or-revision-mismatch',
    );
    if (!old) throw Error('estate-credit-customer-unavailable');
    check(
      Number.isFinite(e.availableCash) && e.availableCash >= 0,
      'invalid-estate-credit-cash-source',
    );
    assertEstateCreditBankFacts(old.departure.ownerId, e.at, e.bankEvents);
    assertBankSource(e.bankSource, old.departure.ownerId);
    for (const fact of e.bankEvents) {
      if (fact.type === 'DepositInterestPaid')
        check(e.bankSource.deposit > 0, 'estate-credit-actual-deposit-source-required');
      else {
        const loan = e.bankSource.loans.find((loan) => loan.loanId === fact.loanId);
        check(
          loan?.status === 'active' && loan.lastAccrualAt < e.at,
          'estate-credit-actual-active-loan-source-required',
        );
      }
    }
    check(
      e.nextCashReceiptSerial ===
        old.cashReceiptSerial + estateCreditCashReceiptCount(e.bankEvents),
      'estate-credit-cash-receipt-count-mismatch',
    );
    let remaining = e.availableCash;
    for (const b of e.bankEvents)
      if (b.type !== 'DepositInterestPaid') {
        check(
          Number.isFinite(b.paidAmount) && b.paidAmount >= 0 && b.paidAmount <= remaining,
          'estate-credit-cash-overdraft',
        );
        remaining -= b.paidAmount;
      }
    c = {
      ...old,
      revision: old.revision + 1,
      at: e.at,
      nextCadenceAt: nextCadence(e.at, s.creditPolicy.accrualCadenceMs),
      cashReceiptSerial: e.nextCashReceiptSerial,
    };
  }
  const next = { ...s, customers: { ...s.customers, [c.id]: c } };
  assertEstateCreditState(next);
  return next;
}
/** World corroborates this exact permanent population fact; no body or bank position is removed here. Admission/activation must reserve capacity before actual departure. */
export function recordEstateCreditCustomer(
  s: EstateCreditState,
  id: string,
  departure: EstateCreditDeparture,
): EstateCreditDecision {
  try {
    const customer = {
      id,
      revision: 1,
      departure: structuredClone(departure),
      at: departure.at,
      nextCadenceAt: nextCadence(departure.at, s.creditPolicy.accrualCadenceMs),
      cashReceiptSerial: 0,
    };
    const e: EstateCreditEvent = { type: 'EstateCreditCustomerRecorded', customer };
    applyEstateCreditEvent(s, e);
    return { accepted: true, events: [e] };
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error ? error.message : 'invalid-estate-credit-customer',
    };
  }
}
/** Same customer's loans share its one actual cash budget. Financial formulas remain the bank aggregate's; customer state only pins source, cadence, policy and receipt serials. */
export function settleEstateCreditCadence(
  s: EstateCreditState,
  bank: BankState,
  id: string,
  at: number,
  availableCash: number,
): EstateCreditDecision {
  try {
    assertEstateCreditState(s);
    assertValidBankState(bank);
    const c = s.customers[id];
    if (!c) throw Error('estate-credit-customer-unavailable');
    check(c.nextCadenceAt === at, 'estate-credit-actual-cadence-or-revision-mismatch');
    check(
      Number.isFinite(availableCash) && availableCash >= 0,
      'invalid-estate-credit-cash-source',
    );
    const owner = asAgentId(c.departure.ownerId),
      d = evaluateDailyCreditAccrualWithSharedCashBudget({
        bank,
        now: at,
        policy: s.creditPolicy,
        collectionPolicy: CREDIT_SHARED_CASH_BUDGET_POLICY,
        borrowerBalance: (key) => (key === owner ? availableCash : undefined),
      });
    const bankEvents: EstateCreditBankEvent[] = d.events.map((e) => {
      if (e.type !== 'LoanRepaid' && e.type !== 'LoanDefaulted' && e.type !== 'DepositInterestPaid')
        throw Error('estate-credit-unrelated-bank-decision');
      return e;
    });
    bankEvents.reduce(applyCreditDomainEvent, bank);
    const e: EstateCreditEvent = {
      type: 'EstateCreditCadenceRecorded',
      id,
      previousRevision: c.revision,
      at,
      availableCash,
      bankSource: estateCreditBankSource(bank, owner),
      bankEvents,
      previousCashReceiptSerial: c.cashReceiptSerial,
      nextCashReceiptSerial: c.cashReceiptSerial + estateCreditCashReceiptCount(bankEvents),
    };
    applyEstateCreditEvent(s, e);
    return { accepted: true, events: [e] };
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error ? error.message : 'invalid-estate-credit-cadence',
    };
  }
}

/** Original outstanding claims count even after default; repayment history does not reserve another active customer slot. */
export function estateCreditOutstandingLoanCount(bank: BankState, ownerId: string) {
  return Object.values(bank.loans).filter(
    (l) => l.borrowerAgentId === ownerId && (l.status === 'active' || l.status === 'defaulted'),
  ).length;
}
/** Query port observes original subjects; unknown bank positions cannot be silently treated as zero or a new body. */
export function assertEstateCreditBankCoverage(
  bank: BankState,
  subjectKnown: (id: string) => boolean,
) {
  assertValidBankState(bank);
  const counts = new Map<string, number>();
  for (const loan of Object.values(bank.loans)) {
    if (loan.status !== 'active' && loan.status !== 'defaulted') continue;
    if (!subjectKnown(loan.borrowerAgentId))
      throw Error('estate-credit-bank-subject-authority-unobserved');
    counts.set(loan.borrowerAgentId, (counts.get(loan.borrowerAgentId) ?? 0) + 1);
  }
  if ([...counts.values()].some((n) => n > POLICY.maxLoansPerCustomer))
    throw Error('estate-credit-loan-capacity-unreserved');
  if (Object.keys(bank.deposits).some((id) => !subjectKnown(id)))
    throw Error('estate-credit-bank-subject-authority-unobserved');
}
