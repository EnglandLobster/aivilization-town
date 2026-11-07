import { expect, test } from 'vitest';
import { personalControlAuthorization, type ControlCommand } from '@aivilization/authority';
import { asAgentId } from '@aivilization/sim-core';
import {
  applyEnterpriseDomainEvent,
  decideEnterpriseControl,
  enterpriseControlVersion,
  normalizeEnterpriseState,
  type EnterpriseState,
} from './index';
import {
  ENTERPRISE_LABOR_TERMS_POLICY,
  activeEnterpriseLaborTerms,
  decideEnterpriseLaborTerms,
  type EnterpriseLaborTermsCommand,
  type EnterpriseLaborTermsEvent,
} from './laborTerms';
function fixture() {
  const initial = normalizeEnterpriseState({
    enterpriseId: 'firm',
    name: 'Firm',
    ownerAgentId: asAgentId('owner'),
    occupationName: 'Maker',
    balance: 1000,
    inventory: {},
    maxEmployees: 5,
    employeeAgentIds: [asAgentId('worker')],
    status: 'active',
    foundedAt: 0,
    cumulativeSales: 0,
    cumulativePurchases: 0,
    cumulativeWages: 0,
  });
  let state = initial;
  const history: EnterpriseLaborTermsEvent[] = [];
  const enable: EnterpriseLaborTermsEvent = {
    type: 'EnterpriseLaborTermsEnabled',
    at: 0,
    policyVersion: ENTERPRISE_LABOR_TERMS_POLICY.version,
  };
  state = applyEnterpriseDomainEvent(state, enable);
  history.push(enable);
  const decide = (actorId: string, command: EnterpriseLaborTermsCommand, at = 1) =>
    decideEnterpriseLaborTerms({ enterprise: state, actorId, at, command });
  const doIt = (actor: string, command: EnterpriseLaborTermsCommand, at = 1) => {
    const d = decide(actor, command, at);
    if (!d.accepted) throw Error(d.reason);
    state = applyEnterpriseDomainEvent(state, d.event);
    history.push(d.event);
  };
  return {
    initial,
    get state() {
      return state;
    },
    set state(v: EnterpriseState) {
      state = v;
    },
    history,
    decide,
    doIt,
  };
}
const offer = (id = 'terms'): EnterpriseLaborTermsCommand => ({
  type: 'offer',
  id,
  employeeId: 'worker',
  wageMicros: 100_000_000,
  referenceMs: 3_600_000,
  validUntil: 10_000,
});
test('terms need separate employer and employee signatures, no money or body effect, replay exact', () => {
  const t = fixture();
  expect(t.decide('worker', offer()).accepted).toBe(false);
  t.doIt('owner', offer());
  expect(activeEnterpriseLaborTerms(t.state, 'worker', 1)).toBeUndefined();
  expect(t.decide('owner', { type: 'accept', id: 'terms', expectedRevision: 1 }).accepted).toBe(
    false,
  );
  expect(t.decide('worker', { type: 'accept', id: 'terms', expectedRevision: 2 }).accepted).toBe(
    false,
  );
  t.doIt('worker', { type: 'accept', id: 'terms', expectedRevision: 1 }, 2);
  expect(activeEnterpriseLaborTerms(t.state, 'worker', 2)).toMatchObject({
    wageMicros: 100_000_000,
    referenceMs: 3_600_000,
    respondedBy: 'worker',
  });
  expect(t.state.balance).toBe(t.initial.balance);
  expect(t.state.employeeWageOffers).toEqual(t.initial.employeeWageOffers);
  expect(t.state.earnedPayroll).toBeUndefined();
  expect(t.history.reduce(applyEnterpriseDomainEvent, t.initial)).toEqual(t.state);
  expect(normalizeEnterpriseState(t.initial).laborTerms).toBeUndefined();
  expect(() => applyEnterpriseDomainEvent(t.state, t.history.at(-1)!)).toThrow(
    'labor-terms-revision-conflict',
  );
  expect(
    t.decide('owner', { type: 'withdraw', id: 'terms', expectedRevision: 2 }, 3).accepted,
  ).toBe(false);
});
test('replacement affects only current selection, expiry never revives previous accepted quote', () => {
  const t = fixture();
  t.doIt('owner', offer());
  t.doIt('worker', { type: 'accept', id: 'terms', expectedRevision: 1 }, 2);
  t.doIt(
    'owner',
    {
      type: 'offer',
      id: 'second',
      employeeId: 'worker',
      wageMicros: 200_000_000,
      referenceMs: 3_600_000,
      validUntil: 100,
    },
    3,
  );
  expect(activeEnterpriseLaborTerms(t.state, 'worker', 3)?.id).toBe('terms');
  t.doIt('worker', { type: 'accept', id: 'second', expectedRevision: 1 }, 4);
  expect(activeEnterpriseLaborTerms(t.state, 'worker', 99)?.id).toBe('second');
  expect(activeEnterpriseLaborTerms(t.state, 'worker', 100)).toBeUndefined();
  expect(t.state.laborTerms!.offers.terms!.status).toBe('accepted');
});
test('leaving/rejoining invalidates old consent and pending offers; no fabricated agreement on membership change', () => {
  const t = fixture();
  t.doIt('owner', offer());
  t.doIt('worker', { type: 'accept', id: 'terms', expectedRevision: 1 }, 2);
  t.doIt('owner', offer('pending'), 3);
  t.state = applyEnterpriseDomainEvent(t.state, {
    type: 'EnterpriseEmployeeLeft',
    agentId: asAgentId('worker'),
  });
  expect(activeEnterpriseLaborTerms(t.state, 'worker', 4)).toBeUndefined();
  t.state = applyEnterpriseDomainEvent(t.state, {
    type: 'EnterpriseMemberJoined',
    agentId: asAgentId('worker'),
  });
  expect(t.state.laborTerms!.membershipGenerations.worker).toBe(2);
  expect(activeEnterpriseLaborTerms(t.state, 'worker', 4)).toBeUndefined();
  expect(
    t.decide('worker', { type: 'accept', id: 'pending', expectedRevision: 1 }, 4).accepted,
  ).toBe(false);
  t.doIt('owner', offer('new-membership'), 4);
  t.doIt('worker', { type: 'accept', id: 'new-membership', expectedRevision: 1 }, 5);
  expect(activeEnterpriseLaborTerms(t.state, 'worker', 5)?.membershipGeneration).toBe(2);
});
test('bounds, reused identifiers, expired responses and withdrawn offers reject without effects', () => {
  const t = fixture();
  const before = structuredClone(t.state);
  for (const wageMicros of [0, -1, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(
      t.decide('owner', {
        type: 'offer',
        id: 'bad',
        employeeId: 'worker',
        wageMicros,
        referenceMs: 1,
        validUntil: 100,
      }).accepted,
    ).toBe(false);
  for (const referenceMs of [
    0,
    -1,
    Infinity,
    1.5,
    ENTERPRISE_LABOR_TERMS_POLICY.maxReferenceMs + 1,
  ])
    expect(
      t.decide('owner', {
        type: 'offer',
        id: 'bad',
        employeeId: 'worker',
        wageMicros: 1,
        referenceMs,
        validUntil: 100,
      }).accepted,
    ).toBe(false);
  expect(t.state).toEqual(before);
  t.doIt('owner', offer());
  expect(t.decide('owner', offer()).accepted).toBe(false);
  expect(
    t.decide('worker', { type: 'accept', id: 'terms', expectedRevision: 1 }, 10_000).accepted,
  ).toBe(false);
  t.doIt('owner', { type: 'withdraw', id: 'terms', expectedRevision: 1 }, 10_000);
  expect(
    t.decide('worker', { type: 'accept', id: 'terms', expectedRevision: 2 }, 10_001).accepted,
  ).toBe(false);
});

test('management handover blocks signing its old pending offer but preserves accepted enterprise terms', () => {
  const t = fixture();
  t.doIt('owner', offer());
  t.doIt('worker', { type: 'accept', id: 'terms', expectedRevision: 1 }, 2);
  t.doIt('owner', offer('pending'), 3);
  const control = (actorId: string, command: ControlCommand, at: number) => {
    const d = decideEnterpriseControl({
      enterprise: t.state,
      actorId,
      at,
      command,
      authorize: personalControlAuthorization(actorId),
      available: () => true,
    });
    if (!d.accepted) throw Error(d.reason);
    t.state = applyEnterpriseDomainEvent(t.state, d.event);
  };
  control(
    'owner',
    {
      type: 'offer',
      expectedVersion: enterpriseControlVersion(t.state),
      target: { kind: 'resident', id: 'manager' },
      expiresAt: 1000,
      terms: '转交经营权限',
    },
    4,
  );
  control('manager', { type: 'accept', expectedVersion: enterpriseControlVersion(t.state) }, 5);
  expect(
    t.decide('worker', { type: 'accept', id: 'pending', expectedRevision: 1 }, 6).accepted,
  ).toBe(false);
  expect(activeEnterpriseLaborTerms(t.state, 'worker', 6)?.id).toBe('terms');
  expect(t.decide('owner', offer('old-owner'), 6).accepted).toBe(false);
  t.doIt('manager', { type: 'withdraw', id: 'pending', expectedRevision: 1 }, 6);
});
