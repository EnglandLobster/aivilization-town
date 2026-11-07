import { asAgentId } from '@aivilization/sim-core';
import { expect, test } from 'vitest';
import {
  applyEnterpriseDomainEvent,
  decideCloseEnterprise,
  decideFundEnterprise,
  decideEnableEarnedPayroll,
  decideStartEarnedLabor,
  decideAccrueEarnedLabor,
  decidePayEarnedWage,
  evaluateEnterpriseLifecycle,
  normalizeEnterpriseState,
  type EnterpriseState,
  type EnterpriseDomainEvent,
  type EnterprisePolicy,
} from './index';

const alice = asAgentId('alice'),
  bob = asAgentId('bob'),
  owner = asAgentId('owner');
const policy: EnterprisePolicy = {
  policyVersion: 'enterprise-v2',
  minimumInitialCapital: 0,
  maximumInitialCapital: 10000,
  maximumEmployees: 10,
  solvency: { evaluationCadenceMs: 1000, minimumCashBalance: 1, gracePeriodMs: 2000 },
  dividend: { paymentCadenceMs: 1000, minimumCashReserve: 0, payoutRatio: 1 },
};
function fixture(overrides: Partial<EnterpriseState> = {}) {
  const initial = normalizeEnterpriseState({
    enterpriseId: 'firm',
    name: 'Firm',
    ownerAgentId: owner,
    occupationName: 'Maker',
    balance: 0,
    inventory: {},
    maxEmployees: 5,
    employeeAgentIds: [alice, bob],
    status: 'active',
    foundedAt: 0,
    cumulativeSales: 100,
    cumulativePurchases: 0,
    cumulativeWages: 0,
    wageArrears: 0,
    ...overrides,
  });
  let e = initial;
  const events: EnterpriseDomainEvent[] = [];
  const commit = (event: EnterpriseDomainEvent) => {
    e = applyEnterpriseDomainEvent(e, event);
    events.push(event);
  };
  const decision = (d: ReturnType<typeof decideEnableEarnedPayroll>) => {
    expect(d.accepted).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    commit(d.event);
  };
  decision(decideEnableEarnedPayroll(e));
  return {
    initial,
    events,
    commit,
    decision,
    get e() {
      return e;
    },
    claim: (id: string) => e.earnedPayroll!.claims[id]!,
    start: (id: string, actorId = alice, totalWageMicros = 100_000_000, plannedMs = 100) =>
      decision(
        decideStartEarnedLabor({
          enterprise: e,
          actorId,
          id,
          laborId: `labor-${id}`,
          at: 0,
          plannedMs,
          totalWageMicros,
        }),
      ),
    accrue: (id: string, elapsedMs: number, ended = false) =>
      decision(
        decideAccrueEarnedLabor({
          enterprise: e,
          claimId: id,
          expectedRevision: e.earnedPayroll!.claims[id]!.revision,
          through: elapsedMs,
          elapsedMs,
          ended,
        }),
      ),
    pay: (id: string, actorId = alice) =>
      decision(
        decidePayEarnedWage({
          enterprise: e,
          actorId,
          claimId: id,
          expectedRevision: e.earnedPayroll!.claims[id]!.revision,
        }),
      ),
    replay: () => expect(events.reduce(applyEnterpriseDomainEvent, initial)).toEqual(e),
  };
}

test('interleaved workers only receive their own earned debt, never an enterprise-wide arrears pool', () => {
  const t = fixture({ wageArrears: 13.123456789 });
  t.start('a');
  expect(t.claim('a').earnedMicros).toBe(0);
  expect(t.e.wageArrears).toBe(13.123456789);
  t.accrue('a', 100);
  expect(
    decidePayEarnedWage({ enterprise: t.e, actorId: alice, claimId: 'a', expectedRevision: 2 }),
  ).toEqual({ accepted: false, reason: 'no-payable-earned-wage' });
  t.start('b', bob, 50_000_000);
  t.accrue('b', 100);
  t.commit({ type: 'EnterpriseFunded', amount: 200 });
  t.pay('b', bob);
  expect(t.e.balance).toBe(150);
  expect(t.claim('a').paidMicros).toBe(0);
  expect(t.e.wageArrears).toBe(113.123456789);
  t.pay('a');
  expect(t.e.balance).toBe(50);
  expect(t.e.cumulativeWages).toBe(150);
  expect(t.e.wageArrears).toBe(13.123456789);
  expect(t.e.earnedPayroll!.legacyUnattributedAmount).toBe(13.123456789);
  t.replay();
});

test('departure and bankruptcy preserve the creditor; new funding can settle ended employment', () => {
  const t = fixture();
  t.start('a');
  t.accrue('a', 40, true);
  t.commit({ type: 'EnterpriseEmployeeLeft', agentId: alice });
  expect(t.e.employeeAgentIds).not.toContain(alice);
  expect(t.e.wageArrears).toBe(40);
  t.commit({ type: 'EnterpriseBankruptcyDeclared', declaredAt: 100 });
  const fund = decideFundEnterprise({ enterprise: t.e, amount: 20 });
  expect(fund.status).toBe('accepted');
  if (fund.status !== 'accepted') throw Error(fund.reason);
  fund.events.forEach(t.commit);
  t.pay('a');
  expect(t.claim('a')).toMatchObject({
    elapsedMs: 40,
    earnedMicros: 40_000_000,
    paidMicros: 20_000_000,
    status: 'ended',
  });
  t.commit({ type: 'EnterpriseFunded', amount: 20 });
  t.pay('a');
  expect(t.e.wageArrears).toBe(0);
  expect(
    decideCloseEnterprise({ enterprise: t.e, actorAgentId: owner, closedAt: 1000 }).status,
  ).toBe('accepted');
  t.replay();
});

test('claim ownership, stale revisions, replayed payment and forged progress cannot alter wages', () => {
  const t = fixture({ balance: 100 });
  t.start('a');
  t.accrue('a', 25);
  expect(
    decidePayEarnedWage({ enterprise: t.e, actorId: bob, claimId: 'a', expectedRevision: 2 }),
  ).toMatchObject({ accepted: false, reason: 'own-earned-wage-required' });
  expect(
    decidePayEarnedWage({ enterprise: t.e, actorId: alice, claimId: 'a', expectedRevision: 1 }),
  ).toMatchObject({ accepted: false, reason: 'earned-wage-revision-conflict' });
  const before = t.e;
  t.pay('a');
  const paid = t.events.at(-1)!;
  expect(() => applyEnterpriseDomainEvent(t.e, paid)).toThrow('earned-payroll-revision-conflict');
  if (paid.type !== 'EnterpriseEarnedWagePaid') throw Error('missing-payment');
  expect(() => applyEnterpriseDomainEvent(before, { ...paid, actorId: bob })).toThrow(
    'invalid-earned-wage-payment',
  );
  const c = t.claim('a');
  for (const claim of [
    { ...c, revision: c.revision + 1, elapsedMs: 50, earnedMicros: 50_000_000, settledAt: 30 },
    {
      ...c,
      revision: c.revision + 1,
      actorId: bob,
      settledAt: 50,
      elapsedMs: 50,
      earnedMicros: 50_000_000,
    },
    { ...c, revision: c.revision + 1, settledAt: 50, elapsedMs: 50, earnedMicros: 90_000_000 },
  ])
    expect(() =>
      applyEnterpriseDomainEvent(t.e, {
        type: 'EnterpriseEarnedWageRecorded',
        previousRevision: t.e.earnedPayroll!.revision,
        claim,
      }),
    ).toThrow();
  t.replay();
});

test('irregular partial progress and small payments preserve exact final wages and stop cancels only future earning', () => {
  const a = fixture({ balance: 10 }),
    b = fixture({ balance: 10 });
  a.start('a', alice, 1_000_001, 997);
  b.start('a', alice, 1_000_001, 997);
  a.accrue('a', 997);
  a.pay('a');
  for (const ms of [1, 23, 107, 619, 997]) {
    b.accrue('a', ms);
    b.pay('a');
  }
  expect(b.claim('a').paidMicros).toBe(a.claim('a').paidMicros);
  expect(b.e.balance).toBeCloseTo(a.e.balance, 10);
  expect(b.e.wageArrears).toBe(0);
  const stopped = fixture({ balance: 1 });
  stopped.start('a', alice, 1_000_001, 997);
  stopped.accrue('a', 107, true);
  stopped.pay('a');
  expect(stopped.claim('a').earnedMicros).toBe(Math.floor((1_000_001 * 107) / 997));
  expect(
    decideAccrueEarnedLabor({
      enterprise: stopped.e,
      claimId: 'a',
      expectedRevision: stopped.claim('a').revision,
      through: 997,
      elapsedMs: 997,
      ended: true,
    }),
  ).toMatchObject({ accepted: false });
  for (const t of [a, b, stopped]) t.replay();
});

test('unpaid or active labor blocks owner distribution and destructive closure, while old enterprises keep old semantics', () => {
  const t = fixture({ balance: 100 });
  t.start('a');
  expect(
    evaluateEnterpriseLifecycle({ enterprise: t.e, evaluatedAt: 1000, policy }).dividendPayments,
  ).toEqual([]);
  expect(
    decideCloseEnterprise({ enterprise: t.e, actorAgentId: owner, closedAt: 1000 }),
  ).toMatchObject({ status: 'rejected' });
  expect(() =>
    applyEnterpriseDomainEvent(t.e, { type: 'EnterpriseClosed', closedAt: 1000 }),
  ).toThrow('enterprise-earned-obligations-require-settlement');
  expect(() =>
    applyEnterpriseDomainEvent(t.e, {
      type: 'EnterpriseDividendPaid',
      totalAmount: 1,
      paidAt: 1000,
    }),
  ).toThrow('enterprise-earned-obligations-block-dividend');
  expect(() =>
    applyEnterpriseDomainEvent(t.e, { type: 'EnterprisePayrollRecorded', amount: 1 }),
  ).toThrow('earned-payroll-requires-creditor-payment');
  expect(() =>
    applyEnterpriseDomainEvent(t.e, { type: 'EnterpriseWageArrearsUpdated', nextArrears: 0 }),
  ).toThrow('earned-payroll-requires-creditor-obligation');
  t.accrue('a', 50, true);
  expect(
    evaluateEnterpriseLifecycle({ enterprise: { ...t.e, balance: 20 }, evaluatedAt: 1000, policy })
      .events[0]?.type,
  ).toBe('EnterpriseInsolvencyStarted');
  t.pay('a');
  expect(
    evaluateEnterpriseLifecycle({ enterprise: t.e, evaluatedAt: 1000, policy }).dividendPayments
      .length,
  ).toBe(1);
  expect(normalizeEnterpriseState(t.initial).earnedPayroll).toBeUndefined();
  expect(
    evaluateEnterpriseLifecycle({ enterprise: t.initial, evaluatedAt: 1000, policy })
      .dividendPayments.length,
  ).toBe(1);
  t.replay();
});

test('invalid units, duplicate labor and safe-integer overflow are rejected without creating obligations', () => {
  const t = fixture();
  for (const wage of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(
      decideStartEarnedLabor({
        enterprise: t.e,
        actorId: alice,
        id: 'invalid',
        laborId: 'invalid',
        at: 0,
        plannedMs: 100,
        totalWageMicros: wage,
      }),
    ).toMatchObject({ accepted: false });
  }
  t.start('a', alice, Number.MAX_SAFE_INTEGER);
  t.accrue('a', 100);
  t.start('b', bob, Number.MAX_SAFE_INTEGER);
  expect(
    decideAccrueEarnedLabor({
      enterprise: t.e,
      claimId: 'b',
      expectedRevision: 1,
      through: 100,
      elapsedMs: 100,
      ended: true,
    }),
  ).toMatchObject({ accepted: false, reason: 'earned-payroll-obligation-overflow' });
  expect(t.claim('b').earnedMicros).toBe(0);
  t.replay();
});
