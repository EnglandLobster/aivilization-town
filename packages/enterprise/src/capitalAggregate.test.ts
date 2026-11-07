import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import {
  personalControlAuthorization,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import {
  normalizeEnterpriseState,
  applyEnterpriseDomainEvent,
  enterpriseManagementAuthority,
  inheritedEnterpriseCapital,
  decideCapitalAgreement,
  enterpriseController,
  enterpriseControlVersion,
  enterpriseMayOperate,
  decideCloseEnterprise,
  evaluateEnterpriseLifecycle,
  enterpriseCapitalPayments,
  type EnterpriseState,
  type EnterpriseDomainEvent,
  type CapitalCommand,
} from './index';
function fixture() {
  const initial = normalizeEnterpriseState({
    enterpriseId: 'firm',
    name: 'Capital test',
    ownerAgentId: asAgentId('founder'),
    occupationName: 'Resident chosen service',
    balance: 20,
    inventory: { Wood: 2 },
    maxEmployees: 3,
    employeeAgentIds: [asAgentId('employee')],
    status: 'active',
    foundedAt: 0,
    cumulativeSales: 40,
    cumulativePurchases: 0,
    cumulativeWages: 0,
    retainedEarnings: 10,
    ownershipShares: { founder: 1 },
  });
  let state = initial;
  const events: EnterpriseDomainEvent[] = [];
  const commit = (event: EnterpriseDomainEvent) => {
    state = applyEnterpriseDomainEvent(state, event);
    events.push(event);
  };
  commit({
    type: 'EnterpriseCapitalEnabled',
    at: 1,
    policyVersion: 'enterprise-capital-agreements-v1',
    initialPositions: inheritedEnterpriseCapital(initial),
    authority: enterpriseManagementAuthority(initial, 'founder', 'activate-capital')!,
  });
  const run = (
    actorId: string,
    command: CapitalCommand,
    authorize: ControlAuthorizationPort = personalControlAuthorization(actorId),
  ) => {
    const d = decideCapitalAgreement({
      state: state.capital!,
      at: 10,
      actorId,
      command,
      management: {
        controller: enterpriseController(state),
        controlVersion: enterpriseControlVersion(state),
      },
      account: (a) => ({
        controller:
          a.sector === 'agent'
            ? { kind: 'resident', id: a.id }
            : { kind: 'collective', id: 'guild' },
        balanceMicros: 100_000_000,
        open: true,
      }),
      authorize,
    });
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted)
      for (const event of d.events) commit({ type: 'EnterpriseCapitalAgreementCommitted', event });
  };
  const rev = () => state.capital!.agreements.raise!.revision;
  return {
    initial,
    get state() {
      return state;
    },
    events,
    commit,
    run,
    rev,
  };
}
test('explicit mixed capital reuses management boundary, credits real company funds once without manufacturing profit, and preserves workers and legacy origin', () => {
  const t = fixture();
  expect(enterpriseMayOperate(t.initial, 'employee', 'trade')).toBe(true);
  expect(enterpriseMayOperate(t.state, 'employee', 'trade')).toBe(false);
  t.run('founder', {
    type: 'propose',
    id: 'raise',
    terms: 'Residents choose allocation',
    expectedEquityVersion: 1,
    expiresAt: 1000,
    positions: [
      { account: { sector: 'agent', id: 'founder' }, weight: 60 },
      { account: { sector: 'collective', id: 'pool' }, weight: 40 },
    ],
    contributions: [{ account: { sector: 'collective', id: 'pool' }, amountMicros: 20_000_000 }],
    disbursements: [{ account: { sector: 'enterprise' }, amountMicros: 20_000_000 }],
  });
  t.run('founder', {
    type: 'accept',
    id: 'raise',
    expectedRevision: t.rev(),
    account: { sector: 'agent', id: 'founder' },
  });
  t.run(
    'member',
    {
      type: 'accept',
      id: 'raise',
      expectedRevision: t.rev(),
      account: { sector: 'collective', id: 'pool' },
    },
    (c) =>
      c.kind === 'collective' && c.id === 'guild'
        ? { actorId: 'member', decisionId: 'exact-approved-capital' }
        : undefined,
  );
  expect(t.state.balance).toBe(20);
  expect(t.state.capital!.equityVersion).toBe(1);
  t.run('founder', {
    type: 'authorize',
    id: 'raise',
    expectedRevision: t.rev(),
    expectedControlVersion: 1,
  });
  t.run('founder', { type: 'execute', id: 'raise', expectedRevision: t.rev() });
  expect(t.state.balance).toBe(40);
  expect(t.state.retainedEarnings).toBe(10);
  expect(t.state.cumulativeSales).toBe(40);
  expect(t.state.employeeAgentIds).toEqual(t.initial.employeeAgentIds);
  expect(t.state.inventory).toEqual(t.initial.inventory);
  expect(t.state.ownerAgentId).toBe('founder');
  expect(t.state.capital!.initialPositions).toEqual([
    { account: { sector: 'agent', id: 'founder' }, weight: 1 },
  ]);
  expect(() => applyEnterpriseDomainEvent(t.state, t.events.at(-1)!)).toThrow(
    'capital-event-source-mismatch',
  );
  expect(t.events.reduce((s, e) => applyEnterpriseDomainEvent(s, e), t.initial)).toEqual(t.state);
  const decision = evaluateEnterpriseLifecycle({
    enterprise: t.state,
    evaluatedAt: 100,
    policy: {
      policyVersion: 'test',
      minimumInitialCapital: 0,
      maximumInitialCapital: 10000,
      maximumEmployees: 10,
      dividend: { payoutRatio: 1, minimumCashReserve: 0, paymentCadenceMs: 100 },
    },
  });
  expect(decision.dividendPayments).toEqual([]);
  expect(decision.events).toContainEqual({
    type: 'EnterpriseCapitalDividendPaid',
    dividendPolicyVersion: 'test',
    equityVersion: 2,
    totalAmount: 10,
    paidAt: 100,
    payments: [
      { account: { sector: 'agent', id: 'founder' }, amount: 6 },
      { account: { sector: 'collective', id: 'pool' }, amount: 4 },
    ],
  });
  t.commit(decision.events[0]!);
  expect(t.state.balance).toBe(30);
  expect(t.state.retainedEarnings).toBe(0);
  expect(() =>
    applyEnterpriseDomainEvent(t.state, {
      type: 'EnterpriseDividendPaid',
      totalAmount: 1,
      paidAt: 101,
    }),
  ).toThrow('capital-dividend-source-required');
  expect(
    decideCloseEnterprise({
      enterprise: t.state,
      actorAgentId: asAgentId('founder'),
      closedAt: 101,
    }),
  ).toMatchObject({ status: 'rejected', reason: 'capital-liquidation-plan-required' });
});
test('preserves fractional initial rights, refuses substituted dividends and does not convert management into capital ownership', () => {
  const t = fixture(),
    e = { ...t.initial, ownershipShares: { founder: 0.1, employee: 0.9 } };
  const event = {
    type: 'EnterpriseCapitalEnabled' as const,
    at: 1,
    policyVersion: 'enterprise-capital-agreements-v1' as const,
    initialPositions: inheritedEnterpriseCapital(e),
    authority: enterpriseManagementAuthority(e, 'founder', 'activate-capital')!,
  };
  const state = applyEnterpriseDomainEvent(e, event);
  expect(state.capital!.positions).toEqual(event.initialPositions);
  expect(enterpriseCapitalPayments(state, 10)).toEqual([
    { account: { sector: 'agent', id: 'employee' }, amount: 9 },
    { account: { sector: 'agent', id: 'founder' }, amount: 1 },
  ]);
  expect(() =>
    applyEnterpriseDomainEvent(state, {
      type: 'EnterpriseCapitalDividendPaid',
      dividendPolicyVersion: 'test',
      equityVersion: 1,
      totalAmount: 10,
      paidAt: 2,
      payments: [{ account: { sector: 'agent', id: 'founder' }, amount: 10 }],
    }),
  ).toThrow('capital-dividend-rights-mismatch');
  expect(() =>
    applyEnterpriseDomainEvent(state, {
      ...event,
      initialPositions: [{ account: { sector: 'agent', id: 'founder' }, weight: 1 }],
    }),
  ).toThrow('invalid-enterprise-capital-origin');
});

test('capital closure preserves undisposed inventory and wages, validates current cash rights, and releases a cash-only firm exactly once', () => {
  const t = fixture();
  const close = {
    type: 'EnterpriseCapitalClosed' as const,
    at: 2,
    equityVersion: 1,
    totalAmount: 20,
    payments: enterpriseCapitalPayments(t.state, 20),
    authority: enterpriseManagementAuthority(t.state, 'founder', 'close')!,
  };
  expect(() => applyEnterpriseDomainEvent(t.state, close)).toThrow(
    'capital-closure-needs-real-inventory-disposition',
  );
  // Independent initial variants exercise the aggregate guard; these are not runtime inventory edits.
  const cashOnly: EnterpriseState = { ...t.state, inventory: {} };
  expect(() => applyEnterpriseDomainEvent({ ...cashOnly, wageArrears: 1 }, close)).toThrow(
    'capital-closure-has-protected-obligations',
  );
  expect(() => applyEnterpriseDomainEvent(cashOnly, { ...close, equityVersion: 2 })).toThrow(
    'capital-closure-source-mismatch',
  );
  expect(() =>
    applyEnterpriseDomainEvent(cashOnly, {
      ...close,
      payments: [{ account: { sector: 'agent', id: 'employee' }, amount: 20 }],
    }),
  ).toThrow('capital-closure-source-mismatch');
  const closed = applyEnterpriseDomainEvent(cashOnly, close);
  expect(closed).toMatchObject({ status: 'closed', balance: 0, employeeAgentIds: [], closedAt: 2 });
  expect(closed.capital).toEqual(cashOnly.capital);
  expect(() => applyEnterpriseDomainEvent(closed, close)).toThrow(
    'capital-closure-source-mismatch',
  );
  t.run('founder', {
    type: 'propose',
    id: 'pending',
    expectedEquityVersion: 1,
    expiresAt: 1000,
    terms: 'Unfinished responsibility',
    positions: cashOnly.capital!.positions,
    contributions: [],
    disbursements: [],
  });
  expect(() => applyEnterpriseDomainEvent({ ...t.state, inventory: {} }, close)).toThrow(
    'capital-closure-has-pending-agreements',
  );
});
