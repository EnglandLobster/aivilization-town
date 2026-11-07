import { expect, test } from 'vitest';
import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { emptyCommonAccountsState, commonAccountsBalance } from '@aivilization/economy';
import { normalizeEnterpriseState, type CapitalCommand } from '@aivilization/enterprise';
import type { ControlAuthorizationPort } from '@aivilization/authority';
import {
  createWorldProjection,
  applyWorldEvent,
  enableResidentCapitalEvent,
  residentCapitalCommand,
  worldCapitalEscrowBalance,
  dispatchWorldCommand,
  type WorldEvent,
  type WorldProjection,
  type WorldCommandPolicies,
} from './index';
function fixture() {
  const initial: WorldProjection = {
    ...createWorldProjection({
      agents: ['a', 'b', 'c'].map((id) => ({
        agentId: asAgentId(id),
        balance: 100,
        residentialTier: 1,
        job: null,
        educationScore: 0,
        inventory: {},
        physiology: { energy: 100, satiety: 100, health: 100 },
      })),
      moneySupply: 370,
    }),
    enterprises: {
      firm: normalizeEnterpriseState({
        enterpriseId: 'firm',
        name: 'Test firm',
        ownerAgentId: asAgentId('a'),
        occupationName: 'Resident chosen work',
        balance: 20,
        inventory: { Wood: 2 },
        maxEmployees: 3,
        employeeAgentIds: [],
        status: 'active',
        foundedAt: 0,
        cumulativeSales: 10,
        cumulativePurchases: 0,
        cumulativeWages: 0,
        retainedEarnings: 10,
      }),
    },
    commonAccounts: {
      ...emptyCommonAccountsState(),
      accounts: {
        pool: {
          id: 'pool',
          collectiveId: 'guild',
          title: 'Explicit test initial shared asset',
          balance: 50,
          revision: 1,
          controlVersion: 1,
          status: 'open',
          createdBy: 'c',
          at: 0,
        },
      },
    },
  };
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const total = () =>
    Object.values(w.agents).reduce((n, a) => n + a.balance, 0) +
    Object.values(w.enterprises).reduce((n, e) => n + e.balance, 0) +
    commonAccountsBalance(w.commonAccounts) +
    worldCapitalEscrowBalance(w.enterprises) +
    (w.treasury ?? 0);
  const commit = (es: readonly WorldEvent[]) => {
    for (const e of es) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
    expect(total()).toBeCloseTo(370, 8);
    expect(w.moneySupply).toBe(370);
  };
  const ctx = (actorId = 'a') => ({
    projection: w,
    actorId,
    enterpriseId: 'firm',
    simulationId: 'capital-test',
    requestId: `capital-test-${++n}`,
    nextSequence: events.length + 1,
  });
  commit([enableResidentCapitalEvent(ctx())]);
  const act = (
    actorId: string,
    command: CapitalCommand | { type: 'initialize' },
    authorize?: ControlAuthorizationPort,
  ) => residentCapitalCommand({ ...ctx(actorId), command, ...(authorize ? { authorize } : {}) });
  const ok = (
    actor: string,
    c: Parameters<typeof act>[1],
    authorize?: ControlAuthorizationPort,
  ) => {
    const d = act(actor, c, authorize);
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) commit(d.events);
    return d;
  };
  ok('a', { type: 'initialize' });
  const rev = (id = 'round') => w.enterprises.firm!.capital!.agreements[id]!.revision;
  const group: ControlAuthorizationPort = (c) =>
    c.kind === 'collective' && c.id === 'guild'
      ? { actorId: 'c', decisionId: 'approved-exact-action' }
      : undefined;
  const proposal = (id = 'round', expiresAt = 500): CapitalCommand => ({
    type: 'propose',
    id,
    terms: 'Explicit investment and private rights price',
    expectedEquityVersion: 1,
    expiresAt,
    positions: [
      { account: { sector: 'agent', id: 'a' }, weight: 25 },
      { account: { sector: 'agent', id: 'b' }, weight: 25 },
      { account: { sector: 'collective', id: 'pool' }, weight: 50 },
    ],
    contributions: [
      { account: { sector: 'agent', id: 'a' }, amountMicros: 10_000_000 },
      { account: { sector: 'agent', id: 'b' }, amountMicros: 20_000_000 },
      { account: { sector: 'collective', id: 'pool' }, amountMicros: 30_000_000 },
    ],
    disbursements: [
      { account: { sector: 'enterprise' }, amountMicros: 30_000_000 },
      { account: { sector: 'agent', id: 'a' }, amountMicros: 30_000_000 },
    ],
  });
  const policies: WorldCommandPolicies = {
    satietyRecoveryByCommodity: {},
    maxSatiety: 100,
    wageCalculator: () => 0,
    laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
    criticalThresholds: { energy: 0, health: 0 },
    enterprise: {
      policyVersion: 'capital-test-policy',
      minimumInitialCapital: 0,
      maximumInitialCapital: 10000,
      maximumEmployees: 10,
      dividend: { paymentCadenceMs: 1000, payoutRatio: 1, minimumCashReserve: 0 },
    },
  };
  const time = (deltaMs: number) =>
    commit(
      dispatchWorldCommand({
        projection: w,
        policies,
        nextSequence: events.length + 1,
        command: createCommandEnvelope({
          id: `time-${++n}`,
          simulationId: 'capital-test',
          source: 'system',
          type: 'AdvanceSimulationTime',
          issuedAt: w.clock.now,
          payload: { deltaMs },
        }),
      }),
    );
  return {
    initial,
    get w() {
      return w;
    },
    events,
    act,
    ok,
    commit,
    rev,
    group,
    proposal,
    time,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
test('real personal and collective cash is escrowed, unanimous rights and current manager settle atomically, and lifecycle dividends reach true accounts', () => {
  const t = fixture();
  t.ok('a', t.proposal());
  t.ok('a', {
    type: 'accept',
    id: 'round',
    expectedRevision: t.rev(),
    account: { sector: 'agent', id: 'a' },
  });
  expect(t.w.agents.a!.balance).toBe(90);
  expect(worldCapitalEscrowBalance(t.w.enterprises)).toBe(10);
  expect(t.w.enterprises.firm!.balance).toBe(20);
  const denied = t.act('c', {
    type: 'accept',
    id: 'round',
    expectedRevision: t.rev(),
    account: { sector: 'collective', id: 'pool' },
  });
  expect(denied).toMatchObject({ accepted: false, reason: 'capital-authority-required' });
  expect(t.w.commonAccounts!.accounts.pool!.balance).toBe(50);
  t.ok('b', {
    type: 'accept',
    id: 'round',
    expectedRevision: t.rev(),
    account: { sector: 'agent', id: 'b' },
  });
  t.ok(
    'c',
    {
      type: 'accept',
      id: 'round',
      expectedRevision: t.rev(),
      account: { sector: 'collective', id: 'pool' },
    },
    t.group,
  );
  expect(worldCapitalEscrowBalance(t.w.enterprises)).toBe(60);
  expect(t.w.commonAccounts!.accounts.pool!.balance).toBe(20);
  expect(t.w.enterprises.firm!.capital!.equityVersion).toBe(1);
  expect(t.act('b', { type: 'execute', id: 'round', expectedRevision: t.rev() })).toMatchObject({
    accepted: false,
    reason: 'capital-current-management-consent-required',
  });
  t.ok('a', {
    type: 'authorize',
    id: 'round',
    expectedRevision: t.rev(),
    expectedControlVersion: 1,
  });
  t.ok('b', { type: 'execute', id: 'round', expectedRevision: t.rev() });
  expect(worldCapitalEscrowBalance(t.w.enterprises)).toBe(0);
  expect(t.w.agents.a!.balance).toBe(120);
  expect(t.w.agents.b!.balance).toBe(80);
  expect(t.w.enterprises.firm!.balance).toBe(50);
  expect(t.w.enterprises.firm!.retainedEarnings).toBe(10);
  t.time(1000);
  expect(t.w.enterprises.firm!.balance).toBe(40);
  expect(t.w.agents.a!.balance).toBe(122.5);
  expect(t.w.agents.b!.balance).toBe(82.5);
  expect(t.w.commonAccounts!.accounts.pool!.balance).toBe(25);
  expect(t.w.agents.c!.balance).toBe(100);
  expect(t.events.some((e) => e.type === 'EnterpriseDividendPaid')).toBe(false);
  t.replay();
});
test('a successful competing agreement refunds the other original payer within the same returned atomic event batch', () => {
  const t = fixture();
  t.ok('a', t.proposal('one'));
  t.ok('a', t.proposal('two'));
  for (const id of ['one', 'two'])
    t.ok('b', {
      type: 'accept',
      id,
      expectedRevision: t.rev(id),
      account: { sector: 'agent', id: 'b' },
    });
  expect(t.w.agents.b!.balance).toBe(60);
  for (const [actor, account] of [
    ['a', { sector: 'agent' as const, id: 'a' }],
    ['c', { sector: 'collective' as const, id: 'pool' }],
  ] as const)
    t.ok(
      actor,
      { type: 'accept', id: 'one', expectedRevision: t.rev('one'), account },
      actor === 'c' ? t.group : undefined,
    );
  t.ok('a', {
    type: 'authorize',
    id: 'one',
    expectedRevision: t.rev('one'),
    expectedControlVersion: 1,
  });
  const d = t.ok('b', { type: 'execute', id: 'one', expectedRevision: t.rev('one') });
  expect(d.accepted && d.events.length).toBe(2);
  expect(t.w.agents.b!.balance).toBe(80);
  expect(t.w.enterprises.firm!.capital!.agreements.two).toMatchObject({
    status: 'cancelled',
    endReason: 'equity-version-changed',
  });
  expect(worldCapitalEscrowBalance(t.w.enterprises)).toBe(0);
  t.replay();
});
test('expiry refunds at the exact boundary during long time advances and rejection or forged ledgers never move company or household cash', () => {
  const setup = () => {
    const t = fixture();
    t.ok('a', t.proposal());
    t.ok('b', {
      type: 'accept',
      id: 'round',
      expectedRevision: t.rev(),
      account: { sector: 'agent', id: 'b' },
    });
    return t;
  };
  const whole = setup(),
    split = setup();
  whole.time(1500);
  split.time(500);
  split.time(1000);
  expect(whole.w.enterprises.firm!.capital!.agreements.round).toMatchObject({
    status: 'cancelled',
    endReason: 'expired',
    endedAt: 500,
  });
  expect(whole.w.agents).toEqual(split.w.agents);
  expect(whole.w.enterprises).toEqual(split.w.enterprises);
  expect(whole.w.commonAccounts).toEqual(split.w.commonAccounts);
  whole.replay();
  split.replay();
  const t = fixture();
  t.ok('a', t.proposal());
  const d = t.act('a', {
    type: 'accept',
    id: 'round',
    expectedRevision: t.rev(),
    account: { sector: 'agent', id: 'a' },
  });
  if (!d.accepted) throw Error('fixture');
  const e = d.events[0]!;
  if (e.type !== 'ResidentCapitalCommitted') throw Error('fixture');
  expect(() => applyWorldEvent(t.w, { ...e, payload: { ...e.payload, transactions: [] } })).toThrow(
    'invalid-capital-commit-source',
  );
  expect(() => applyWorldEvent(t.w, { ...e, payload: { ...e.payload, actorId: 'c' } })).toThrow(
    'capital-actor-source-mismatch',
  );
  expect(t.w.agents.a!.balance).toBe(100);
  t.replay();
});
