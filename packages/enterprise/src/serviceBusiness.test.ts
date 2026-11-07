import { asAgentId } from '@aivilization/sim-core';
import { expect, test } from 'vitest';
import {
  applyEnterpriseDomainEvent,
  decideCloseEnterprise,
  decideEnableEarnedPayroll,
  normalizeEnterpriseState,
  type EnterpriseDomainEvent,
} from './index';
import {
  decideAuthorizeServiceBusiness,
  decideRecordServiceAccounting,
  decideRevokeServiceBusiness,
  hasOpenServiceBusiness,
  serviceEmploymentTerms,
  type EnterpriseServiceAuthorization,
} from './serviceBusiness';
const owner = asAgentId('owner'),
  worker = asAgentId('worker');
function fixture() {
  const initial = normalizeEnterpriseState({
    enterpriseId: 'firm',
    name: 'Resident service business',
    ownerAgentId: owner,
    occupationName: 'Resident-defined service',
    balance: 100,
    inventory: {},
    maxEmployees: 3,
    employeeAgentIds: [worker],
    employeeWageOffers: { [worker]: 123 },
    status: 'active',
    foundedAt: 10,
    cumulativeSales: 0,
    cumulativePurchases: 0,
    cumulativeWages: 0,
  });
  const enabled = decideEnableEarnedPayroll(initial);
  if (!enabled.accepted) throw Error(enabled.reason);
  return applyEnterpriseDomainEvent(initial, enabled.event);
}
const terms: Omit<EnterpriseServiceAuthorization, 'authorizedBy' | 'at' | 'wageOffer'> = {
  serviceId: 'service',
  sourceRevision: 1,
  providerId: worker,
  payer: true,
  revenueRecipient: false,
  debitLimitMicros: 36000000,
  revenueLimitMicros: 0,
  maxWorkMs: 3600000,
  wageBasis: 'none',
};
function sequence() {
  const initial = fixture();
  let state = initial;
  const events: EnterpriseDomainEvent[] = [];
  const apply = (d: ReturnType<typeof decideRecordServiceAccounting>) => {
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    events.push(d.event);
    state = applyEnterpriseDomainEvent(state, d.event);
  };
  return {
    initial,
    events,
    apply,
    get state() {
      return state;
    },
    replay: () => expect(events.reduce(applyEnterpriseDomainEvent, initial)).toEqual(state),
  };
}
test('enterprise financial authorization cannot manufacture attendance or wages; only unused grants may be revoked', () => {
  const t = sequence();
  expect(
    decideAuthorizeServiceBusiness({ enterprise: t.state, actorId: worker, at: 10, terms })
      .accepted,
  ).toBe(false);
  t.apply(
    decideAuthorizeServiceBusiness({
      enterprise: t.state,
      actorId: owner,
      at: 10,
      terms: {
        ...terms,
        payer: false,
        revenueRecipient: true,
        debitLimitMicros: 0,
        revenueLimitMicros: 18000000,
        wageBasis: 'attendance',
      },
    }),
  );
  expect(t.state.balance).toBe(100);
  expect(t.state.earnedPayroll?.claims).toEqual({});
  expect(t.state.inventory).toEqual({});
  expect(t.state.serviceBusiness!.contracts.service!.authorization.wageOffer).toBe(123);
  expect(serviceEmploymentTerms(t.state, 'service', worker)).toBeUndefined();
  expect(
    decideAuthorizeServiceBusiness({ enterprise: t.state, actorId: owner, at: 11, terms }).accepted,
  ).toBe(false);
  expect(decideRevokeServiceBusiness(t.state, worker, 'service', 1, 11).accepted).toBe(false);
  t.apply(decideRevokeServiceBusiness(t.state, owner, 'service', 1, 11));
  expect(t.state.serviceBusiness!.contracts.service!.phase).toBe('revoked');
  expect(t.state.balance).toBe(100);
  t.replay();
});
test('prepaid service remains an escrow asset until actual expense; unused refund is not profit and open contracts prevent closure', () => {
  const t = sequence();
  t.apply(decideAuthorizeServiceBusiness({ enterprise: t.state, actorId: owner, at: 10, terms }));
  const fund = {
    serviceId: 'service',
    previousRevision: 1,
    sourceRevision: 3,
    at: 11,
    phase: 'funded' as const,
    fundedMicros: 36000000,
    costMicros: 0,
    refundMicros: 0,
    revenueMicros: 0,
  };
  t.apply(decideRecordServiceAccounting(t.state, fund));
  expect(t.state.balance).toBe(64);
  expect(t.state.retainedEarnings).toBe(0);
  expect(hasOpenServiceBusiness(t.state)).toBe(true);
  expect(
    decideCloseEnterprise({ enterprise: t.state, actorAgentId: owner, closedAt: 12 }).status,
  ).toBe('rejected');
  expect(() =>
    applyEnterpriseDomainEvent(t.state, { type: 'EnterpriseClosed', closedAt: 12 }),
  ).toThrow('enterprise-service-contracts-require-settlement');
  expect(decideRevokeServiceBusiness(t.state, owner, 'service', 2, 12).accepted).toBe(false);
  t.apply(
    decideRecordServiceAccounting(t.state, {
      ...fund,
      previousRevision: 2,
      sourceRevision: 6,
      at: 20,
      costMicros: 9000000,
    }),
  );
  expect(t.state.balance).toBe(64);
  expect(t.state.retainedEarnings).toBe(-9);
  expect(t.state.cumulativePurchases).toBe(0);
  t.apply(
    decideRecordServiceAccounting(t.state, {
      ...fund,
      previousRevision: 3,
      sourceRevision: 7,
      at: 21,
      phase: 'ended',
      costMicros: 9000000,
      refundMicros: 27000000,
    }),
  );
  expect(t.state.balance).toBe(91);
  expect(t.state.retainedEarnings).toBe(-9);
  expect(hasOpenServiceBusiness(t.state)).toBe(false);
  expect(
    decideCloseEnterprise({ enterprise: t.state, actorAgentId: owner, closedAt: 22 }).status,
  ).toBe('accepted');
  expect(
    decideRecordServiceAccounting(t.state, {
      ...fund,
      previousRevision: 4,
      sourceRevision: 8,
      at: 22,
    }).accepted,
  ).toBe(false);
  t.replay();
});
test('real service revenue increases cash and earnings without inventing commodity sales; contract wages require current membership', () => {
  const t = sequence();
  t.apply(
    decideAuthorizeServiceBusiness({
      enterprise: t.state,
      actorId: owner,
      at: 10,
      terms: {
        ...terms,
        payer: false,
        debitLimitMicros: 0,
        revenueRecipient: true,
        revenueLimitMicros: 18000000,
        wageBasis: 'effective-service',
      },
    }),
  );
  const fund = {
    serviceId: 'service',
    previousRevision: 1,
    sourceRevision: 3,
    at: 11,
    phase: 'funded' as const,
    fundedMicros: 0,
    costMicros: 0,
    refundMicros: 0,
    revenueMicros: 0,
  };
  t.apply(decideRecordServiceAccounting(t.state, fund));
  expect(serviceEmploymentTerms(t.state, 'service', worker)).toMatchObject({
    wageBasis: 'effective-service',
    wageOffer: 123,
  });
  const left = applyEnterpriseDomainEvent(t.state, {
    type: 'EnterpriseEmployeeLeft',
    agentId: worker,
  });
  expect(serviceEmploymentTerms(left, 'service', worker)).toBeUndefined();
  expect(left.serviceBusiness).toEqual(t.state.serviceBusiness);
  expect(
    decideRecordServiceAccounting(t.state, {
      ...fund,
      previousRevision: 2,
      sourceRevision: 4,
      revenueMicros: 18000001,
    }).accepted,
  ).toBe(false);
  t.apply(
    decideRecordServiceAccounting(t.state, {
      ...fund,
      previousRevision: 2,
      sourceRevision: 6,
      at: 20,
      revenueMicros: 9000000,
    }),
  );
  expect(t.state.balance).toBe(109);
  expect(t.state.retainedEarnings).toBe(9);
  expect(t.state.cumulativeSales).toBe(0);
  expect(t.state.inventory).toEqual({});
  const bankrupt = applyEnterpriseDomainEvent(t.state, {
    type: 'EnterpriseBankruptcyDeclared',
    declaredAt: 21,
  });
  const ending = decideRecordServiceAccounting(bankrupt, {
    ...fund,
    previousRevision: 3,
    sourceRevision: 7,
    at: 22,
    phase: 'ended',
    revenueMicros: 10000000,
  });
  expect(ending.accepted).toBe(true);
  if (ending.accepted) expect(applyEnterpriseDomainEvent(bankrupt, ending.event).balance).toBe(110);
  t.replay();
});
test('source revisions, amounts, insufficient funds and role boundaries reject without mutations or duplicate receipts', () => {
  const e = fixture();
  for (const debitLimitMicros of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER])
    expect(
      decideAuthorizeServiceBusiness({
        enterprise: e,
        actorId: owner,
        at: 10,
        terms: { ...terms, debitLimitMicros },
      }).accepted,
    ).toBe(false);
  expect(e.serviceBusiness).toBeUndefined();
  const t = sequence();
  t.apply(
    decideAuthorizeServiceBusiness({
      enterprise: t.state,
      actorId: owner,
      at: 10,
      terms: { ...terms, debitLimitMicros: 200000000 },
    }),
  );
  const facts = {
    serviceId: 'service',
    previousRevision: 1,
    sourceRevision: 3,
    at: 11,
    phase: 'funded' as const,
    fundedMicros: 200000000,
    costMicros: 0,
    refundMicros: 0,
    revenueMicros: 0,
  };
  expect(decideRecordServiceAccounting(t.state, facts)).toMatchObject({
    accepted: false,
    reason: 'enterprise-service-insufficient-cash',
  });
  expect(decideRecordServiceAccounting(t.state, { ...facts, sourceRevision: 1 })).toMatchObject({
    accepted: false,
    reason: 'invalid-service-accounting-transition',
  });
  expect(t.state.balance).toBe(100);
  expect(t.state.retainedEarnings).toBe(0);
  t.replay();
});
