import { expect, test } from 'vitest';
import { asAgentId, createCommandEnvelope, type CoreCommandType } from '@aivilization/sim-core';
import {
  personalControlAuthorization,
  type ControlCommand,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import { enterpriseControlVersion, normalizeEnterpriseState } from '@aivilization/enterprise';
import {
  createWorldProjection,
  applyWorldEvent,
  enterpriseControlEvent,
  dispatchWorldCommand,
  type WorldEvent,
  type WorldCommandPolicies,
} from './index';
const policy: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  enterprise: {
    policyVersion: 'enterprise-v1',
    minimumInitialCapital: 1,
    maximumInitialCapital: 10000,
    maximumEmployees: 10,
  },
};
function fixture() {
  const initial = createWorldProjection({
    agents: ['founder', 'manager', 'worker'].map((id) => ({
      agentId: asAgentId(id),
      balance: 0,
      inventory: {},
      physiology: { energy: 100, satiety: 100, health: 100 },
      educationScore: 0,
      residentialTier: 1,
      job: id === 'worker' ? 'Helper' : null,
    })),
    moneySupply: 100,
    enterprises: [
      normalizeEnterpriseState({
        enterpriseId: 'firm',
        name: 'Their firm',
        ownerAgentId: asAgentId('founder'),
        occupationName: 'Helper',
        balance: 100,
        inventory: { Apple: 3 },
        maxEmployees: 3,
        employeeAgentIds: [asAgentId('worker')],
        employeeWageOffers: { worker: 12 },
        ownershipShares: { founder: 0.75, worker: 0.25 },
        status: 'active',
        foundedAt: 0,
        cumulativeSales: 0,
        cumulativePurchases: 0,
        cumulativeWages: 0,
      }),
    ],
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const commit = (es: readonly WorldEvent[]) => {
    let next = w;
    for (const e of es) next = applyWorldEvent(next, e);
    w = next;
    events.push(...es);
  };
  const control = (
    actorId: string,
    command: ControlCommand,
    authorize = personalControlAuthorization(actorId),
  ) => {
    const d = enterpriseControlEvent({
      projection: w,
      actorId,
      enterpriseId: 'firm',
      command,
      authorize,
      available: () => true,
      simulationId: 'sim',
      requestId: `c-${++n}`,
      nextSequence: events.length + 1,
    });
    if (!d.accepted) throw Error(d.reason);
    commit(d.events);
  };
  const act = (
    actor: string,
    type: CoreCommandType,
    payload: unknown,
    expected = true,
    authorize?: ControlAuthorizationPort,
  ) => {
    const es = dispatchWorldCommand({
      projection: w,
      policies: policy,
      command: createCommandEnvelope({
        id: `cmd-${++n}`,
        simulationId: 'sim',
        actorId: actor,
        type,
        payload,
        issuedAt: 0,
      }),
      nextSequence: events.length + 1,
      ...(authorize ? { enterpriseAuthorization: authorize } : {}),
    });
    expect(
      es.some((e) => e.type === 'ActionRejected'),
      JSON.stringify(es),
    ).toBe(!expected);
    commit(es);
    return es;
  };
  const offer = (
    actor: string,
    target: { kind: 'resident' | 'collective'; id: string },
    authorize?: ControlAuthorizationPort,
  ) =>
    control(
      actor,
      {
        type: 'offer',
        target,
        expectedVersion: enterpriseControlVersion(w.enterprises.firm!),
        expiresAt: 1000,
        terms: 'Operating control only',
      },
      authorize,
    );
  return {
    initial,
    events,
    commit,
    control,
    act,
    offer,
    get w() {
      return w;
    },
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
test('actual manager can hire/lay off and close, old owner cannot; liquidation follows capital shares, not the executing manager', () => {
  const t = fixture();
  t.offer('founder', { kind: 'resident', id: 'manager' });
  t.control('manager', { type: 'accept', expectedVersion: 2 });
  t.act(
    'founder',
    'AgentSetEnterpriseJobPosting',
    { enterpriseId: 'firm', wageOffer: 20, openSlots: 2 },
    false,
  );
  t.act('manager', 'AgentSetEnterpriseJobPosting', {
    enterpriseId: 'firm',
    wageOffer: 20,
    openSlots: 2,
  });
  t.act('manager', 'AgentLayoffEnterpriseEmployee', {
    enterpriseId: 'firm',
    employeeAgentId: 'worker',
  });
  expect(t.w.enterprises.firm!.ownerAgentId).toBe('founder');
  expect(t.w.agents.worker!.job).toBeNull();
  t.act('founder', 'AgentCloseEnterprise', { enterpriseId: 'firm' }, false);
  const before = t.w,
    closed = t
      .act('manager', 'AgentCloseEnterprise', { enterpriseId: 'firm' })
      .find((e) => e.type === 'EnterpriseClosed')!;
  expect(t.w.agents.founder!.balance).toBe(75);
  expect(t.w.agents.worker!.balance).toBe(25);
  expect(t.w.agents.manager!.balance).toBe(0);
  expect(t.w.agents.founder!.inventory.Apple).toBe(2.25);
  expect(t.w.agents.worker!.inventory.Apple).toBe(0.75);
  expect(t.w.enterprises.firm!.inventory).toEqual({});
  expect(t.w.moneySupply).toBe(100);
  const forged = {
    ...closed,
    payload: {
      ...closed.payload,
      capitalDistributions: [
        { agentId: asAgentId('manager'), balance: 100, inventory: { Apple: 3 } },
      ],
    },
  };
  expect(() => applyWorldEvent(before, forged)).toThrow(
    'enterprise-capital-distribution-source-mismatch',
  );
  t.replay();
});
test('collective controller requires an actual application grant and preserves operator attribution in the world event', () => {
  const t = fixture();
  t.offer('founder', { kind: 'collective', id: 'group' });
  const authorize: ControlAuthorizationPort = (c) =>
    c.kind === 'collective' && c.id === 'group'
      ? { actorId: 'manager', decisionId: 'decision' }
      : undefined;
  t.control('manager', { type: 'accept', expectedVersion: 2 }, authorize);
  t.act(
    'manager',
    'AgentSetEnterpriseJobPosting',
    { enterpriseId: 'firm', wageOffer: 20, openSlots: 2 },
    false,
  );
  const es = t.act(
    'manager',
    'AgentSetEnterpriseJobPosting',
    { enterpriseId: 'firm', wageOffer: 20, openSlots: 2 },
    true,
    authorize,
  );
  expect(es[0]).toMatchObject({
    payload: {
      ownerAgentId: 'founder',
      managementAuthority: {
        actorId: 'manager',
        decisionId: 'decision',
        controller: { kind: 'collective', id: 'group' },
      },
    },
  });
  t.replay();
});
