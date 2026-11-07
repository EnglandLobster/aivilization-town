import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import {
  personalControlAuthorization,
  type ControlCommand,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import {
  applyEnterpriseDomainEvent,
  decideEnterpriseControl,
  enterpriseControlVersion,
  enterpriseController,
  decideSetEnterpriseJobPosting,
  decideLayoffEmployee,
  decideCloseEnterprise,
  enterpriseCapitalDistributions,
  normalizeEnterpriseState,
  assertValidEnterpriseState,
  type EnterpriseState,
  type EnterpriseDomainEvent,
} from './index';
const founder = asAgentId('founder'),
  manager = asAgentId('manager'),
  worker = asAgentId('worker');
function fixture() {
  const initial = normalizeEnterpriseState({
    enterpriseId: 'firm',
    name: 'Residents choose the purpose',
    ownerAgentId: founder,
    occupationName: 'Their role',
    balance: 100,
    inventory: { Apple: 3 },
    maxEmployees: 3,
    employeeAgentIds: [worker],
    employeeWageOffers: { worker: 12 },
    ownershipShares: { founder: 0.75, worker: 0.25 },
    status: 'active',
    foundedAt: 0,
    cumulativeSales: 0,
    cumulativePurchases: 0,
    cumulativeWages: 0,
  });
  let state = initial;
  const events: EnterpriseDomainEvent[] = [];
  const commit = (event: EnterpriseDomainEvent) => {
    state = applyEnterpriseDomainEvent(state, event);
    events.push(event);
    assertValidEnterpriseState(state);
  };
  const control = (
    actorId: string,
    command: ControlCommand,
    authorize: ControlAuthorizationPort = personalControlAuthorization(actorId),
    at = 10,
  ) =>
    decideEnterpriseControl({
      enterprise: state,
      actorId,
      command,
      authorize,
      at,
      available: (c) => ['founder', 'manager', 'worker', 'collective'].includes(c.id),
    });
  const accept = (d: ReturnType<typeof control>) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    commit(d.event);
  };
  const offer = (
    actor: string,
    target: { kind: 'resident' | 'collective'; id: string },
    authorize?: ControlAuthorizationPort,
  ) =>
    accept(
      control(
        actor,
        {
          type: 'offer',
          expectedVersion: enterpriseControlVersion(state),
          target,
          expiresAt: 1000,
          terms: 'Only operating control. Capital rights and debts remain.',
        },
        authorize,
      ),
    );
  return {
    initial,
    events,
    commit,
    control,
    accept,
    offer,
    get state() {
      return state;
    },
    replay: () => expect(events.reduce(applyEnterpriseDomainEvent, initial)).toEqual(state),
  };
}
test('independent handover changes management but preserves assets, equity, employees and their accepted wages', () => {
  const t = fixture();
  t.offer(founder, { kind: 'resident', id: manager });
  expect(enterpriseController(t.state)).toEqual({ kind: 'resident', id: founder });
  expect(t.control(founder, { type: 'accept', expectedVersion: 2 }).accepted).toBe(false);
  t.accept(t.control(manager, { type: 'accept', expectedVersion: 2 }));
  const { control, ...business } = t.state;
  void control;
  expect(business).toEqual(t.initial);
  expect(
    decideSetEnterpriseJobPosting({
      enterprise: t.state,
      actorAgentId: founder,
      wageOffer: 20,
      openSlots: 2,
    }).status,
  ).toBe('rejected');
  expect(
    decideSetEnterpriseJobPosting({
      enterprise: t.state,
      actorAgentId: worker,
      wageOffer: 20,
      openSlots: 2,
    }).status,
  ).toBe('rejected');
  const managed = decideSetEnterpriseJobPosting({
    enterprise: t.state,
    actorAgentId: manager,
    wageOffer: 20,
    openSlots: 2,
  });
  if (managed.status !== 'accepted') throw Error(managed.reason);
  for (const event of managed.events) t.commit(event);
  expect(t.state.employeeWageOffers?.worker).toBe(12);
  expect(t.state.ownershipShares).toEqual(t.initial.ownershipShares);
  expect(
    decideCloseEnterprise({ enterprise: t.state, actorAgentId: founder, closedAt: 20 }).status,
  ).toBe('rejected');
  t.replay();
});
test('collective management needs an exact application authorization; membership and historical founder confer no management', () => {
  const t = fixture();
  t.offer(founder, { kind: 'collective', id: 'collective' });
  expect(t.control(manager, { type: 'accept', expectedVersion: 2 }).accepted).toBe(false);
  const authorize: ControlAuthorizationPort = (c) =>
    c.kind === 'collective' && c.id === 'collective'
      ? { actorId: manager, decisionId: 'decision-accept' }
      : undefined;
  t.accept(t.control(manager, { type: 'accept', expectedVersion: 2 }, authorize));
  expect(
    decideLayoffEmployee({ enterprise: t.state, actorAgentId: manager, employeeAgentId: worker })
      .status,
  ).toBe('rejected');
  const approved = decideSetEnterpriseJobPosting({
    enterprise: t.state,
    actorAgentId: manager,
    wageOffer: 30,
    openSlots: 3,
    authorize,
  });
  if (approved.status !== 'accepted') throw Error(approved.reason);
  const event = approved.events[0]!;
  expect(event).toMatchObject({
    authority: {
      actorId: manager,
      controller: { kind: 'collective', id: 'collective' },
      decisionId: 'decision-accept',
      operation: 'post-job',
    },
  });
  t.commit(event);
  expect(() =>
    applyEnterpriseDomainEvent(t.state, {
      type: 'EnterpriseJobPostingUpdated',
      wageOffer: 999,
      openSlots: 3,
    }),
  ).toThrow('enterprise-management-authority-mismatch');
  t.offer(manager, { kind: 'resident', id: founder }, authorize);
  expect(() => applyEnterpriseDomainEvent(t.state, event)).toThrow(
    'enterprise-management-authority-mismatch',
  );
  t.accept(t.control(founder, { type: 'accept', expectedVersion: 4 }));
  t.replay();
});
test('cancellation, expiry, wrong controller, stale versions and forged transitions cannot transfer assets or management', () => {
  const t = fixture();
  t.offer(founder, { kind: 'resident', id: manager });
  const before = t.state;
  expect(t.control(manager, { type: 'accept', expectedVersion: 1 }).accepted).toBe(false);
  expect(t.control(manager, { type: 'accept', expectedVersion: 2 }, undefined, 1000).accepted).toBe(
    false,
  );
  expect(t.control(worker, { type: 'cancel', expectedVersion: 2 }).accepted).toBe(false);
  expect(t.state).toEqual(before);
  t.accept(t.control(founder, { type: 'cancel', expectedVersion: 2 }));
  expect(t.control(manager, { type: 'accept', expectedVersion: 3 }).accepted).toBe(false);
  const offer = t.events[0];
  if (!offer || offer.type !== 'EnterpriseControlChanged') throw Error('fixture');
  expect(() =>
    applyEnterpriseDomainEvent(t.initial, {
      ...offer,
      control: { ...offer.control, controller: { kind: 'resident', id: manager } },
    }),
  ).toThrow();
  expect(() =>
    assertValidEnterpriseState({ ...t.state, control: { ...t.state.control!, version: 0 } }),
  ).toThrow('invalid-enterprise-control-state');
  t.replay();
});
test('legacy management events and normalization remain unchanged and do not invent prior handovers', () => {
  const t = fixture();
  expect(t.state.control).toBeUndefined();
  const d = decideSetEnterpriseJobPosting({
    enterprise: t.state,
    actorAgentId: founder,
    wageOffer: 10,
    openSlots: 2,
  });
  expect(d).toEqual({
    status: 'accepted',
    events: [{ type: 'EnterpriseJobPostingUpdated', wageOffer: 10, openSlots: 2 }],
  });
  if (d.status === 'accepted') for (const event of d.events) t.commit(event);
  expect(t.state.control).toBeUndefined();
  t.replay();
  const closed: EnterpriseState = { ...t.state, status: 'closed' };
  expect(
    decideEnterpriseControl({
      enterprise: closed,
      actorId: founder,
      at: 10,
      command: { type: 'cancel', expectedVersion: 1 },
      authorize: personalControlAuthorization(founder),
      available: () => true,
    }).accepted,
  ).toBe(false);
});

test('capital liquidation preserves fractional assets, orders actual rights deterministically and rejects corrupt shares', () => {
  const initial = fixture().initial;
  const state = {
    ...initial,
    balance: 0.3,
    inventory: { Apple: 0.8, Wood: 0.2 },
    ownershipShares: { worker: 2, founder: 1, manager: 0 },
  };
  const distributions = enterpriseCapitalDistributions(state);
  expect(distributions.map((v) => v.agentId)).toEqual(['founder', 'worker']);
  expect(distributions.reduce((s, v) => s + v.balance, 0)).toBe(state.balance);
  for (const item of ['Apple', 'Wood'] as const)
    expect(distributions.reduce((s, v) => s + (v.inventory[item] ?? 0), 0)).toBe(
      state.inventory[item],
    );
  expect(distributions[0]!.balance).toBeCloseTo(0.1, 15);
  expect(
    enterpriseCapitalDistributions({ ...state, ownershipShares: { founder: 1, worker: 2 } }),
  ).toEqual(distributions);
  for (const shares of [
    { founder: Number.MAX_VALUE, worker: Number.MAX_VALUE },
    { founder: NaN },
    { founder: 1, worker: -1 },
    { founder: 0 },
  ])
    expect(() => enterpriseCapitalDistributions({ ...state, ownershipShares: shares })).toThrow(
      'enterprise-capital-shares-not-distributable',
    );
  expect(
    enterpriseCapitalDistributions({
      ...initial,
      ownershipShares: { founder: 1 },
      balance: 0,
      inventory: {},
    }),
  ).toEqual([{ agentId: founder, balance: 0, inventory: {} }]);
});
