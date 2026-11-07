import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import {
  applyEnterpriseDomainEvent,
  normalizeEnterpriseState,
  assertValidEnterpriseState,
  decideCloseEnterprise,
  decideCloseEnterpriseOnOwnerDeparture,
  evaluateEnterpriseLifecycle,
  type EnterpriseState,
} from './index';
import {
  ENTERPRISE_PERIODIC_ACCOUNTING_POLICY as POLICY,
  type EnterprisePeriodicAccountingEvent,
  type EnterprisePeriodicPosition,
} from './periodicAccountingModel';
import {
  enterprisePeriodicArrears,
  hasOpenEnterprisePeriodicPositions,
  decideRecordEnterprisePeriodicAccounting,
} from './periodicAccounting';
function initial(): EnterpriseState {
  return normalizeEnterpriseState({
    enterpriseId: 'firm',
    name: 'actual firm',
    ownerAgentId: asAgentId('manager'),
    occupationName: 'builder',
    balance: 100,
    inventory: { Wood: 2 },
    maxEmployees: 2,
    employeeAgentIds: [],
    status: 'active',
    foundedAt: 0,
    cumulativeSales: 80,
    cumulativePurchases: 0,
    cumulativeWages: 0,
  });
}
function registration(side: 'payer' | 'revenue' = 'payer'): EnterprisePeriodicAccountingEvent {
  const payer = {
      sector: side === 'payer' ? 'enterprise' : 'agent',
      id: side === 'payer' ? 'firm' : 'other',
    },
    revenue = {
      sector: side === 'revenue' ? 'enterprise' : 'agent',
      id: side === 'revenue' ? 'firm' : 'other',
    },
    terms = {
      id: 'promise',
      title: '居民原文',
      terms: '付款承诺不造服务或贷款',
      payer,
      revenue,
      amount: 25,
      firstDueAt: 100000,
      periodMs: 60000,
      periods: 3,
      acceptBy: 80000,
    },
    command =
      side === 'payer'
        ? { type: 'offer', ...terms }
        : { type: 'accept', id: 'promise', expectedRevision: 1 };
  const position: EnterprisePeriodicPosition = {
    id: 'promise',
    side,
    amountMicros: 25000000,
    periods: 3,
    firstDueAt: 100000,
    periodMs: 60000,
    acceptedAt: 10,
    sourceRevision: 2,
    at: 10,
    cursor: 0,
    installments: {},
    authorization: {
      actorId: 'manager',
      principal: { kind: 'enterprise', id: 'firm' },
      source: { kind: 'enterprise', managementVersion: 1, managementDecisionId: null },
      request: {
        resourceKind: 'periodic-obligation',
        resourceId: 'promise',
        resourceRevision: 1,
        controlVersion: 1,
        operation: {
          capability: side === 'payer' ? 'obligations.offer' : 'obligations.accept',
          arguments: {
            command,
            terms,
            payerPrincipal: { kind: side === 'payer' ? 'enterprise' : 'resident', id: payer.id },
            revenuePrincipal: {
              kind: side === 'revenue' ? 'enterprise' : 'resident',
              id: revenue.id,
            },
            policyVersion: POLICY.sourcePolicyVersion,
            maximumTotalMicros: 75000000,
          },
        },
      },
    },
  };
  return { type: 'EnterprisePeriodicPositionRegistered', policyVersion: POLICY.version, position };
}
function change(
  previousSourceRevision: number,
  at: number,
  update: Extract<
    EnterprisePeriodicAccountingEvent,
    { type: 'EnterprisePeriodicPositionChanged' }
  >['change'],
): EnterprisePeriodicAccountingEvent {
  return {
    type: 'EnterprisePeriodicPositionChanged',
    policyVersion: POLICY.version,
    id: 'promise',
    previousSourceRevision,
    at,
    change: update,
  };
}
const lifecycle = (enterprise: EnterpriseState) =>
  evaluateEnterpriseLifecycle({
    enterprise,
    evaluatedAt: 300000,
    policy: {
      policyVersion: 'fixture-policy',
      minimumInitialCapital: 0,
      maximumInitialCapital: 1000,
      maximumEmployees: 2,
      solvency: { evaluationCadenceMs: 60000, minimumCashBalance: 1, gracePeriodMs: 60000 },
      dividend: { paymentCadenceMs: 60000, minimumCashReserve: 0, payoutRatio: 1 },
    },
  });
test('original finite approval creates only an owned accounting position; actual payment alone changes enterprise cash surplus', () => {
  for (const side of ['payer', 'revenue'] as const) {
    const before = initial(),
      registered = applyEnterpriseDomainEvent(before, registration(side));
    expect(before.periodicAccounting).toBeUndefined();
    expect(registered.balance).toBe(100);
    expect(registered.retainedEarnings).toBe(80);
    const paid = applyEnterpriseDomainEvent(
      registered,
      change(2, 100000, { type: 'due', period: 1, status: 'paid' }),
    );
    expect(paid.balance).toBe(side === 'payer' ? 75 : 125);
    expect(paid.retainedEarnings).toBe(side === 'payer' ? 55 : 105);
    expect(paid.cumulativePurchases).toBe(side === 'payer' ? 25 : 0);
    expect(paid.cumulativeSales).toBe(side === 'revenue' ? 105 : 80);
    expect(paid.inventory).toEqual(before.inventory);
    expect(paid.ownerAgentId).toEqual(before.ownerAgentId);
    expect(hasOpenEnterprisePeriodicPositions(paid)).toBe(true);
  }
});
test('unpaid claims block actual dividend, lifecycle distribution and closure; stop preserves claim, settlement releases it', () => {
  let e = applyEnterpriseDomainEvent(initial(), registration());
  e = applyEnterpriseDomainEvent(
    e,
    change(2, 100000, { type: 'due', period: 1, status: 'unpaid' }),
  );
  expect(e.balance).toBe(100);
  expect(e.retainedEarnings).toBe(80);
  expect(enterprisePeriodicArrears(e)).toBe(25);
  expect(lifecycle(e).dividendPayments).toEqual([]);
  expect(() =>
    applyEnterpriseDomainEvent(e, {
      type: 'EnterpriseDividendPaid',
      totalAmount: 10,
      paidAt: 300000,
    }),
  ).toThrow('enterprise-periodic-arrears-block-dividend');
  e = applyEnterpriseDomainEvent(e, change(3, 100001, { type: 'stop' }));
  expect(
    decideCloseEnterprise({ enterprise: e, actorAgentId: asAgentId('manager'), closedAt: 100002 }),
  ).toMatchObject({
    status: 'rejected',
    reason: 'enterprise-periodic-obligations-require-settlement',
  });
  expect(
    decideCloseEnterpriseOnOwnerDeparture({
      enterprise: e,
      ownerAgentId: asAgentId('manager'),
      closedAt: 100002,
    }).status,
  ).toBe('rejected');
  expect(() =>
    applyEnterpriseDomainEvent(e, { type: 'EnterpriseClosed', closedAt: 100002 }),
  ).toThrow('enterprise-periodic-obligations-require-settlement');
  e = applyEnterpriseDomainEvent(e, change(4, 100002, { type: 'settle', period: 1 }));
  expect(e.balance).toBe(75);
  expect(enterprisePeriodicArrears(e)).toBe(0);
  expect(hasOpenEnterprisePeriodicPositions(e)).toBe(false);
  expect(
    decideCloseEnterprise({ enterprise: e, actorAgentId: asAgentId('manager'), closedAt: 100003 })
      .status,
  ).toBe('accepted');
  expect(lifecycle(e).dividendPayments.reduce((n, p) => n + p.amount, 0)).toBe(55);
});
test('receivables also prevent asset disposal, while waiver moves no money and future cessation needs a separate event', () => {
  let e = applyEnterpriseDomainEvent(initial(), registration('revenue'));
  e = applyEnterpriseDomainEvent(
    e,
    change(2, 100000, { type: 'due', period: 1, status: 'unpaid' }),
  );
  expect(enterprisePeriodicArrears(e)).toBe(0);
  expect(hasOpenEnterprisePeriodicPositions(e)).toBe(true);
  e = applyEnterpriseDomainEvent(e, change(3, 100001, { type: 'waive', period: 1 }));
  expect(e.balance).toBe(100);
  expect(e.retainedEarnings).toBe(80);
  expect(hasOpenEnterprisePeriodicPositions(e)).toBe(true);
  e = applyEnterpriseDomainEvent(e, change(4, 100002, { type: 'stop' }));
  expect(hasOpenEnterprisePeriodicPositions(e)).toBe(false);
});
test('historical approvals survive manager replacement and financial distress without new approvals or invented creditors', () => {
  const events = [
    registration(),
    change(2, 100000, { type: 'due', period: 1, status: 'unpaid' }),
    change(3, 100001, { type: 'stop' }),
    change(4, 100002, { type: 'settle', period: 1 }),
  ];
  const expected = events.reduce(applyEnterpriseDomainEvent, initial());
  const replayed = events.reduce(
    (e, event) =>
      applyEnterpriseDomainEvent(
        e,
        JSON.parse(JSON.stringify(event)) as EnterprisePeriodicAccountingEvent,
      ),
    initial(),
  );
  expect(replayed).toEqual(expected);
  assertValidEnterpriseState(replayed);
  let distressed: EnterpriseState = {
    ...applyEnterpriseDomainEvent(initial(), registration()),
    ownerAgentId: asAgentId('new-manager'),
    status: 'bankrupt' as const,
  };
  distressed = applyEnterpriseDomainEvent(
    distressed,
    change(2, 100000, { type: 'due', period: 1, status: 'paid' }),
  );
  expect(distressed.balance).toBe(75);
  expect(distressed.periodicAccounting!.positions.promise!.authorization.actorId).toBe('manager');
  expect(normalizeEnterpriseState(initial()).periodicAccounting).toBeUndefined();
});
test('exact source, immutable financial terms, chronological cursor and one payment are protected on decision and replay', () => {
  const original = registration();
  if (original.type !== 'EnterprisePeriodicPositionRegistered') throw Error('fixture');
  for (const p of [
    { ...original.position, amountMicros: 25000001 },
    { ...original.position, periods: 129 },
    { ...original.position, sourceRevision: 3 },
    { ...original.position, at: 11 },
    { ...original.position, acceptedAt: 90000, at: 90000 },
    {
      ...original.position,
      authorization: {
        ...original.position.authorization,
        principal: { kind: 'enterprise' as const, id: 'other' },
      },
    },
  ])
    expect(
      decideRecordEnterprisePeriodicAccounting(initial(), { ...original, position: p }).accepted,
    ).toBe(false);
  const e = applyEnterpriseDomainEvent(initial(), original);
  for (const event of [
    registration(),
    change(2, 100000, { type: 'due', period: 2, status: 'paid' }),
    change(3, 100000, { type: 'due', period: 1, status: 'paid' }),
    change(2, 99999, { type: 'due', period: 1, status: 'paid' }),
    change(2, 100000, { type: 'stop' }),
    change(2, 100000, { type: 'settle', period: 1 }),
  ])
    expect(decideRecordEnterprisePeriodicAccounting(e, event).accepted).toBe(false);
  const paid = applyEnterpriseDomainEvent(
    e,
    change(2, 100000, { type: 'due', period: 1, status: 'paid' }),
  );
  expect(() =>
    applyEnterpriseDomainEvent(paid, change(2, 100000, { type: 'due', period: 1, status: 'paid' })),
  ).toThrow('enterprise-periodic-source-revision-conflict');
  expect(
    decideRecordEnterprisePeriodicAccounting(
      { ...e, balance: 24 },
      change(2, 100000, { type: 'due', period: 1, status: 'paid' }),
    ),
  ).toMatchObject({ accepted: false, reason: 'enterprise-periodic-insufficient-cash-or-range' });
  expect(
    decideRecordEnterprisePeriodicAccounting(
      { ...e, status: 'closed' },
      change(2, 100000, { type: 'due', period: 1, status: 'paid' }),
    ).accepted,
  ).toBe(false);
});
